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

// Product types kept for the schedule (docs/DATA_FORMAT.md): the free
// activities, plus the shows you reserve (ENTERTAINMENT: free, reservation
// required), the paid classes and experiences (ACTIVITIES), which come
// through with `reservation` set, and the shore excursions (SHOREX, paid).
// Spa and dining are booking slots, not events. Everything from here to
// finishSchedule: keep in step with cruise_sync.py.
var SCHEDULE_TYPES = ['NON_REVENUE_SCHEDULABLE', 'ENTERTAINMENT', 'ACTIVITIES', 'SHOREX'];
var PAID_TYPES = ['ACTIVITIES', 'SHOREX'];
var EXCURSION_CAT = ['Shore excursions', ''];
// Left out by title: NextCruise sales appointments (about 22 slots a day)
// would push busy days past the watch's 160 events.
var SKIP_TITLES = /nextcruise/i;
// Event details (docs/DATA_FORMAT.md, docs/PHASE4_PLAN.md items 2-7).
// Notes left out: boilerplate, the fee (already `paid`) and long legal text.
var NOTE_SKIP = /^(images are illustrative|this activity has a fee|fee applies)/i;
var NOTE_MAX = 120;
var EARLY_MAX = 120;  // arrive-early minutes from lead time or advisement text
var MEET_MAX = 240;   // a shore excursion's meeting time before its start
// Arrive-by wordings with a number. "Doors open 45 minutes prior" and "seats
// released 10 minutes prior" are facts, not arrive-by times, so they stay notes.
var EARLY_TEXT = [/\barrive (\d+) minutes? early\b/i, /\bsign up (?:at the venue )?(\d+) minutes? before\b/i];
// Words a short description may add and still only restate the title.
var SHORT_FILLER = ['a', 'an', 'and', 'at', 'by', 'competition', 'for', 'game', 'in', 'of', 'on', 'seminar', 'show',
                    'the', 'to', 'with', 'your'];

// The adult "from" price in dollars (cents kept), or null when none is listed.
function productPrice(p) {
  var v = (p.startingFromPrice || {}).adultPrice;
  return typeof v === 'number' && v > 0 ? Math.round(v * 100) / 100 : null;
}

// Royal's age restriction wording -> [min, max] years, or null when it isn't
// a limit ("Guests 16 and under must be accompanied" is a note).
function restrictionAge(text) {
  var s = clean(text).toLowerCase();
  var m = /^minimum (\d+) years? old$/.exec(s);
  if (m) {
    return [+m[1], null];
  }
  m = /^maximum (\d+) years? old$/.exec(s);
  if (m) {
    return [null, +m[1]];
  }
  m = /^(\d+) to (\d+) years? old$/.exec(s);
  return m ? [+m[1], +m[2]] : null;
}

// Age patterns in a title or venue name: (18+), (13-17), (Ages 13-17),
// (17 & Under), Adults-Only.
function textAge(text) {
  var s = clean(text).toLowerCase();
  var m = /\((?:ages )?(\d+)\s*-\s*(\d+)\)/.exec(s);
  if (m) {
    return [+m[1], +m[2]];
  }
  m = /\((\d+)\+\)/.exec(s);
  if (m) {
    return [+m[1], null];
  }
  m = /\((\d+) & under\)/.exec(s);
  if (m) {
    return [null, +m[1]];
  }
  return /\badults?[- ]only\b/.test(s) ? [18, null] : null;
}

// [min, max] years (either may be null) or null. From Royal's age
// restrictions, its age experiences (ages/age18), then title and venue
// patterns; if several apply, the tightest wins.
function ageOf(p, title, venue) {
  var found = [];
  (p.restrictions || []).forEach(function(r) {
    if (r.restrictionType === 'age') {
      found.push(restrictionAge(r.restrictionDisplayText));
    }
  });
  (p.experiences || []).forEach(function(e) {
    var m = /^ages\/age(\d+)$/.exec(e.experienceID || '');
    if (m) {
      found.push([+m[1], null]);
    }
  });
  found.push(textAge(title), textAge(venue));
  var low = null;
  var high = null;
  found.forEach(function(a) {
    if (a && a[0] !== null && (low === null || a[0] > low)) {
      low = a[0];
    }
    if (a && a[1] !== null && (high === null || a[1] < high)) {
      high = a[1];
    }
  });
  return low === null && high === null ? null : [low, high];
}

// '0745' -> 465, or null.
function clockMinutes(hhmm4) {
  return /^\d{4}$/.test(hhmm4 || '') ? (+hhmm4.slice(0, 2)) * 60 + (+hhmm4.slice(2, 4)) : null;
}

// Minutes to arrive before an offering's start, or null. A shore excursion
// uses its meeting time; others Royal's lead time, then a number in an
// advisement.
function earlyOf(p, o) {
  var start = clockMinutes(o.offeringTime);
  if (!start) {  // untimed (00:00) or missing
    return null;
  }
  if ((p.productType || {}).productType === 'SHOREX') {
    var meet = clockMinutes(o.meetingTime);
    return meet !== null && meet < start ? Math.min(start - meet, MEET_MAX) : null;
  }
  var lead = (p.productDuration || {}).leadTimeInMinutes;
  if (typeof lead === 'number' && lead % 1 === 0 && lead > 0) {
    return Math.min(lead, EARLY_MAX);
  }
  var advs = p.advisements || [];
  for (var i = 0; i < advs.length; i++) {
    for (var j = 0; j < EARLY_TEXT.length; j++) {
      var m = EARLY_TEXT[j].exec(clean(advs[i].advisementTitle));
      if (m && +m[1] > 0) {
        return Math.min(+m[1], EARLY_MAX);
      }
    }
  }
  return null;
}

function words(text) {
  var out = {};
  (text.toLowerCase().match(/[a-z0-9]+/g) || []).forEach(function(w) {
    out[w.length > 3 && w.charAt(w.length - 1) === 's' ? w.slice(0, -1) : w] = true;
  });
  return out;
}

// A short description worth keeping: after lowercasing and dropping
// punctuation it has a word (beyond filler like "Seminar:") or a parenthesis
// that the title lacks.
function saysMore(short, title) {
  var have = words(title);
  var extra = Object.keys(words(short)).some(function(w) {
    return !have[w] && SHORT_FILLER.indexOf(w) === -1;
  });
  return extra || (short.indexOf('(') !== -1 && title.indexOf('(') === -1);
}

// [id, text] notes for a product: a short description that says more than
// the title, restrictions that aren't age limits, advisements and the waiver
// flag. Boilerplate, long text and repeated text are left out.
function notesOf(p, title) {
  var out = [];
  function add(id, text) {
    text = clean(text);
    if (text && text.length <= NOTE_MAX && !NOTE_SKIP.test(text) && out.every(function(n) {
      return n[1].toLowerCase() !== text.toLowerCase();
    })) {
      out.push([clean(id), text]);
    }
  }
  var short = clean(p.productShortDescription);
  if (short && saysMore(short, title)) {
    add('short', short);
  }
  (p.restrictions || []).forEach(function(r) {
    if (r.restrictionType !== 'age' || restrictionAge(r.restrictionDisplayText) === null) {
      add(r.restrictionID, r.restrictionDisplayText);
    }
  });
  (p.advisements || []).forEach(function(a) { add(a.advisementID, a.advisementTitle); });
  if (p.isWaiverRequired && !out.some(function(n) { return /waiver|disclaimer/i.test(n[1]); })) {
    add('waiver', 'Signed waiver required');
  }
  return out;
}

function newScheduleAcc() {
  return {cats: [], venues: [], notes: [], infos: [], events: [], seen: {}};
}

// Adds one page of products to `acc` (newScheduleAcc()).
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
    var kind = (p.productType || {}).productType;
    if (SCHEDULE_TYPES.indexOf(kind) === -1 || SKIP_TITLES.test(p.productTitle || '')) {
      return;
    }
    var parent = 'Other';
    var child = '';
    var pcs = p.productCategory || [];
    if (kind === 'SHOREX') {
      parent = EXCURSION_CAT[0];
      child = EXCURSION_CAT[1];
    } else if (pcs.length) {
      parent = capitalize(clean(pcs[0].categoryName)) || 'Other';
      var kids = pcs[0].childCategory || [];
      if (kids.length) {
        var items = kids[0].items;
        items = Array.isArray(items) ? items[0] : items;
        child = clean((items || {}).categoryName);
      }
    }
    var cat = index(acc.cats, [parent, child]);
    var loc = p.productLocation || {};
    var venueName = clean(loc.locationTitle);
    // By name and code, so a blank title with a code (VINT) is its own venue.
    var venue = index(acc.venues, [venueName, loc.locationCode || null]);
    var title = clean(p.productTitle);
    var minutes = ((p.productDuration || {}).durationInMinutes) || 0;
    // Paid classes, experiences and shore excursions (docs/DATA_FORMAT.md):
    // only the sessions the owner picks on the settings page reach the watch.
    var paid = PAID_TYPES.indexOf(kind) !== -1 ? 1 : 0;
    var price = productPrice(p);
    var age = ageOf(p, title, venueName);
    var notes = notesOf(p, title).map(function(n) { return index(acc.notes, n); });
    var pid = clean(p.productID) || null;
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
      var early = earlyOf(p, o);
      var info = (age || early !== null || notes.length) ? index(acc.infos, [age, early, notes]) : null;
      acc.events.push([title, venue, cat, date, time, parseInt(o.offeringDurationInMinutes || minutes, 10) || 0,
                       (p.isFeatured || o.isFeatured) ? 1 : 0, p.isReservationRequired ? 1 : 0, paid, price,
                       info, pid]);
    });
  });
  return products.length;
}

// '212 events (53 shore excursion sessions): 23 with age limits, 8 arrive
// early, 95 with notes', for the usage log.
function scheduleSummary(sched) {
  var f = {};
  sched.fields.forEach(function(name, i) { f[name] = i; });
  var infos = sched.infos || [];
  var n = {excursions: 0, age: 0, early: 0, notes: 0};
  sched.events.forEach(function(e) {
    var c = sched.cats[e[f.cat]] || [];
    if (c[0] === EXCURSION_CAT[0] && c[1] === EXCURSION_CAT[1]) {
      n.excursions++;
    }
    var r = e[f.info] === null || e[f.info] === undefined ? null : infos[e[f.info]];
    if (r) {
      n.age += r[0] ? 1 : 0;
      n.early += r[1] !== null ? 1 : 0;
      n.notes += r[2].length ? 1 : 0;
    }
  });
  return sched.events.length + ' events (' + n.excursions + ' shore excursion sessions): ' + n.age +
    ' with age limits, ' + n.early + ' arrive early, ' + n.notes + ' with notes';
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
    venues: acc.venues.map(function(v) { return v[0]; }),
    venueCodes: acc.venues.map(function(v) { return v[1]; }),
    notes: acc.notes,
    infos: acc.infos,
    fields: ['title', 'venue', 'cat', 'date', 'time', 'minutes', 'featured', 'reservation', 'paid', 'price',
             'info', 'pid'],
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
    var acc = newScheduleAcc();
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
  newScheduleAcc: newScheduleAcc,
  addProducts: addProducts,
  finishSchedule: finishSchedule,
  scheduleSummary: scheduleSummary,
  restrictionAge: restrictionAge,
  textAge: textAge,
  ageOf: ageOf,
  earlyOf: earlyOf,
  notesOf: notesOf,
  fetchShips: fetchShips,
  download: download,
  API: API,
  APPKEY: APPKEY
};
