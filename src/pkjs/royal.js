// Royal Caribbean downloads for the phone companion. Mirrors
// tools/cruise-sync/cruise_sync.py (the reference implementation) and produces
// the same bundle (docs/DATA_FORMAT.md). Requests are sequential and minimal:
// one itinerary call and a few schedule pages per download.
//
// These are Royal's unofficial web endpoints; the app key comes from
// jdeath/CheckRoyalCaribbeanPrice (MIT).

var API = 'https://aws-prd.api.rccl.com';
var APPKEY = 'hyNNqIPHHzaLzVpcICPdAdbFV8yvTsAm';
var PAGE = 200;
var TIMEOUT_MS = 30000;

// Plain, watch-friendly ASCII text: straight quotes, no trademark symbols.
function clean(text) {
  if (!text) {
    return '';
  }
  var s = String(text)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/ /g, ' ')
    .replace(/…/g, '...')
    .replace(/[®℠™©]/g, '');
  if (s.normalize) {
    s = s.normalize('NFKD');
  }
  return s.replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim();
}

// "HERO OF THE SEAS" -> "Hero of the Seas"; leaves mixed case alone.
function shipName(name) {
  var s = clean(name);
  if (s !== s.toUpperCase()) {
    return s;
  }
  return s.toLowerCase().replace(/\b[a-z]/g, function(c) { return c.toUpperCase(); })
    .replace(/ Of The /g, ' of the ');
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
}

// '20270309T070000' -> ['2027-03-09', '07:00']
function splitStamp(stamp) {
  if (!stamp || stamp.length < 13) {
    return [null, null];
  }
  return [stamp.slice(0, 4) + '-' + stamp.slice(4, 6) + '-' + stamp.slice(6, 8),
          stamp.slice(9, 11) + ':' + stamp.slice(11, 13)];
}

function parseShips(json) {
  var ships = ((json || {}).payload || {}).ships || [];
  return ships.filter(function(s) { return s.brand === 'R'; })
    .map(function(s) { return {code: s.shipCode, name: shipName(s.name)}; })
    .sort(function(a, b) { return a.name < b.name ? -1 : 1; });
}

function parseItinerary(json) {
  var payload = (json || {}).payload || {};
  var info = payload.sailingInfo;
  info = Array.isArray(info) ? info[0] : info;
  var events = (((info || {}).itinerary || {}).events) || [];
  return events.map(function(ev) {
    var port = (ev || {}).port || {};
    var kind = port.portType || 'UNKNOWN';
    var arrive = splitStamp(port.arrivalDateTime);
    var depart = splitStamp(port.departureDateTime);
    // Royal fills unused times with placeholders (00:00, 23:59); drop them.
    return {
      day: ev.day,
      date: arrive[0],
      port: clean(port.portName),
      code: port.portCode,
      type: kind,
      arrive: (kind === 'CRUISING' || kind === 'EMBARK') ? null : arrive[1],
      depart: (kind === 'CRUISING' || kind === 'DEBARK') ? null : depart[1]
    };
  });
}

// Adds one page of products to `acc` ({cats, venues, events, seen}).
// Returns the number of products on the page.
function addProducts(acc, json) {
  var products = (((json || {}).payload) || {}).products || [];
  function index(table, value) {
    var key = JSON.stringify(value);
    for (var i = 0; i < table.length; i++) {
      if (JSON.stringify(table[i]) === key) {
        return i;
      }
    }
    table.push(value);
    return table.length - 1;
  }
  products.forEach(function(p) {
    if (((p.productType || {}).productType) !== 'NON_REVENUE_SCHEDULABLE') {
      return;
    }
    var parent = 'Other';
    var child = '';
    var pcs = p.productCategory || [];
    if (pcs.length) {
      parent = capitalize(clean(pcs[0].categoryName)) || 'Other';
      var kids = pcs[0].childCategory || [];
      if (kids.length) {
        var items = kids[0].items;
        items = Array.isArray(items) ? items[0] : items;
        child = clean((items || {}).categoryName);
      }
    }
    var cat = index(acc.cats, [parent, child]);
    var venue = index(acc.venues, clean((p.productLocation || {}).locationTitle));
    var title = clean(p.productTitle);
    var minutes = ((p.productDuration || {}).durationInMinutes) || 0;
    (p.offering || []).forEach(function(o) {
      var d = o.offeringDate;
      var t = o.offeringTime;
      if (!d || d.length !== 8) {
        return;
      }
      var date = d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8);
      var time = (t && t.length === 4 && t !== '0000') ? t.slice(0, 2) + ':' + t.slice(2, 4) : null;  // 00:00 = untimed
      var key = [title, date, time, venue].join('|');
      if (acc.seen[key]) {
        return;
      }
      acc.seen[key] = true;
      acc.events.push([title, venue, cat, date, time, parseInt(o.offeringDurationInMinutes || minutes, 10) || 0,
                       (p.isFeatured || o.isFeatured) ? 1 : 0, p.isReservationRequired ? 1 : 0]);
    });
  });
  return products.length;
}

function finishSchedule(acc) {
  acc.events.sort(function(a, b) {
    var ka = [a[3], a[4] || '', a[0]];
    var kb = [b[3], b[4] || '', b[0]];
    for (var i = 0; i < 3; i++) {
      if (ka[i] !== kb[i]) {
        return ka[i] < kb[i] ? -1 : 1;
      }
    }
    return 0;
  });
  return {
    published: acc.events.length > 0,
    cats: acc.cats,
    venues: acc.venues,
    fields: ['title', 'venue', 'cat', 'date', 'time', 'minutes', 'featured', 'reservation'],
    events: acc.events
  };
}

function getJson(url, callback) {
  var xhr = new XMLHttpRequest();
  xhr.open('GET', url, true);
  xhr.setRequestHeader('AppKey', APPKEY);
  xhr.setRequestHeader('Accept', 'application/json');
  xhr.timeout = TIMEOUT_MS;
  xhr.onload = function() {
    if (xhr.status === 403) {
      callback('Royal Caribbean refused the request (403). Try the backup tool.');
    } else if (xhr.status >= 400) {
      callback('Royal Caribbean returned error ' + xhr.status + '.');
    } else {
      try {
        callback(null, JSON.parse(xhr.responseText));
      } catch (e) {
        callback('The reply from Royal Caribbean was not valid data.');
      }
    }
  };
  xhr.onerror = function() { callback('Could not reach Royal Caribbean. Check your internet connection.'); };
  xhr.ontimeout = function() { callback('Royal Caribbean did not answer in time. Try again.'); };
  xhr.send();
}

function fetchShips(callback) {
  getJson(API + '/en/royal/web/v2/ships', function(err, json) {
    callback(err, err ? null : parseShips(json));
  });
}

// ship: {code, name}; sailDate: 'YYYY-MM-DD'. callback(err, bundle)
function download(ship, sailDate, callback) {
  var date8 = sailDate.replace(/-/g, '');
  getJson(API + '/en/royal/web/v3/ships/' + ship.code + '/sailDate/' + date8, function(err, json) {
    if (err) {
      callback(err);
      return;
    }
    var itinerary = parseItinerary(json);
    if (!itinerary.length) {
      callback('Royal Caribbean has no itinerary for ' + ship.name + ' on that date.');
      return;
    }
    var acc = {cats: [], venues: [], events: [], seen: {}};
    function page(offset) {
      getJson(API + '/en/royal/web/v3/products?sailingID=' + ship.code + date8 + '&limit=' + PAGE +
              '&offset=' + offset, function(err2, json2) {
        if (err2) {
          callback(err2);
          return;
        }
        var count = addProducts(acc, json2);
        if (count >= PAGE && offset < 20000) {
          page(offset + PAGE);
          return;
        }
        callback(null, {
          format: 'cruise-watch',
          v: 1,
          generated: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
          ship: {code: ship.code, name: ship.name},
          sailDate: sailDate,
          itinerary: itinerary,
          schedule: finishSchedule(acc)
        });
      });
    }
    page(0);
  });
}

module.exports = {
  clean: clean,
  shipName: shipName,
  parseShips: parseShips,
  parseItinerary: parseItinerary,
  addProducts: addProducts,
  finishSchedule: finishSchedule,
  fetchShips: fetchShips,
  download: download,
  API: API,
  APPKEY: APPKEY
};
