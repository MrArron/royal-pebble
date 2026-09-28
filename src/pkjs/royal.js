// Royal Caribbean downloads for the phone companion. Mirrors
// tools/cruise-sync/cruise_sync.py (the reference implementation) and produces
// the same bundle (docs/DATA_FORMAT.md). Requests are sequential and minimal:
// one itinerary call and a few schedule pages per download, plus a sign-in and
// the booking calls for a download with login.
//
// These are Royal's unofficial web endpoints; the app key and login client come
// from jdeath/CheckRoyalCaribbeanPrice (MIT).

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

// One request; callback(err, json, status). Error texts are fixed wording plus
// a status code, never Royal's reply (they can reach the usage log).
function request(method, url, headers, body, callback) {
  var xhr = new XMLHttpRequest();
  var finished = false;
  function end(err, json) {
    if (!finished) {
      finished = true;
      callback(err, json, xhr.status);
    }
  }
  xhr.open(method, url, true);
  xhr.setRequestHeader('AppKey', APPKEY);
  xhr.setRequestHeader('Accept', 'application/json');
  Object.keys(headers || {}).forEach(function(k) { xhr.setRequestHeader(k, headers[k]); });
  xhr.timeout = TIMEOUT_MS;
  xhr.onload = function() {
    if (xhr.status === 403) {
      end('Royal Caribbean refused the request (403). Try the backup tool.');
    } else if (xhr.status >= 400) {
      end('Royal Caribbean returned error ' + xhr.status + '.');
    } else {
      var json;
      try {
        json = JSON.parse(xhr.responseText);
      } catch (e) {
        end('The reply from Royal Caribbean was not valid data.');
        return;
      }
      end(null, json);
    }
  };
  xhr.onerror = function() { end('Could not reach Royal Caribbean. Check your internet connection.'); };
  xhr.ontimeout = function() { end('Royal Caribbean did not answer in time. Try again.'); };
  xhr.send(body || null);
}

function getJson(url, callback) {
  request('GET', url, null, null, callback);
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

// ------------------------------------------------------------ with login
// Advanced download (docs/PHASE4_PLAN.md, "Advanced download with your Royal
// login"): sign in once, then fetch the same `mine` as cruise_sync.fetch_mine.
// Everything from here to fetchMine: keep in step with cruise_sync.py. The
// email and password are used for the sign-in request only; the token lives
// until the download ends. Nothing here is saved or logged.

var LOGIN_URL = 'https://www.royalcaribbean.com/auth/oauth2/access_token';
var COMMERCE = API + '/en/royal/web/commerce-api';
// Royal's public web-app client (the same value as cruise_sync.py).
var LOGIN_CLIENT = 'Basic ZzlTMDIzdDc0NDczWlVrOTA5Rk42OEYwYjRONjdQU09oOTJvMDR2TDBCUjY1MzdwSTJ5Mmg5NE02QmJVN0Q2SjpX' +
  'NjY4NDZrUFF2MTc1MDk3NW9vZEg1TTh6QzZUYTdtMzBrSDJRNzhsMldtVTUwRkNncXBQMTN3NzczNzdrN0lC';

// The account id (`sub`) from the token's middle part (base64url JSON).
function accountOf(token) {
  var part = String(token || '').split('.')[1] || '';
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var bits = 0;
  var value = 0;
  var out = '';
  for (var i = 0; i < part.length; i++) {
    var n = chars.indexOf(part.charAt(i));
    if (n < 0) {
      continue;
    }
    value = ((value << 6) | n) & 0xFFFFFF;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((value >> bits) & 255);
    }
  }
  try {
    return JSON.parse(out).sub || null;
  } catch (e) {
    return null;
  }
}

// callback(err, auth): auth is the headers for logged-in requests.
function login(email, password, callback) {
  var body = 'grant_type=password&username=' + encodeURIComponent(email) + '&password=' +
    encodeURIComponent(password) + '&scope=openid+profile+email+vdsid';
  request('POST', LOGIN_URL, {'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': LOGIN_CLIENT},
          body, function(err, json, status) {
    body = null;
    if (status === 400 || status === 401) {
      callback('Royal Caribbean didn\'t accept that email and password.');
      return;
    }
    if (status === 403) {
      callback('Royal Caribbean refused the sign-in (403). Use the Windows sync tool instead.');
      return;
    }
    if (err) {
      callback(status >= 400 ? 'Sign-in failed (error ' + status + ').' : err);
      return;
    }
    var token = (json || {}).access_token || '';
    var account = accountOf(token);
    if (!account) {
      callback('Signed in, but couldn\'t read the login token. Royal may have changed their sign-in.');
      return;
    }
    callback(null, {'Access-Token': token, 'account-id': account, 'vds-id': account});
  });
}

// A logged-in GET: path under API, params as an object.
function authGet(auth, url, params, callback) {
  var qs = Object.keys(params || {}).map(function(k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
  }).join('&');
  request('GET', url + (qs ? '?' + qs : ''), auth, null, callback);
}

// Runs fn(item, next) for each item in turn, then done().
function series(items, fn, done) {
  var i = 0;
  (function next() {
    if (i >= items.length) {
      done();
      return;
    }
    fn(items[i++], next);
  })();
}

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

// Royal's many time spellings -> 'HH:MM' (24h), or null when it isn't one.
// Handles '2027-03-09T07:00:00', '20270309T070000', '7:00 AM', '17:30' and '1730'.
function hhmm(text) {
  var s = clean(text);
  if (!s) {
    return null;
  }
  var m = /\d{4}-?\d{2}-?\d{2}[T ](\d{2}):?(\d{2})/.exec(s);
  if (!m) {
    m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp])\.?[Mm]\.?(\s.*)?$/.exec(s);
    if (m) {
      var h12 = (+m[1]) % 12 + (m[3].toLowerCase() === 'p' ? 12 : 0);
      return +m[2] < 60 ? pad2(h12) + ':' + m[2] : null;
    }
    m = /^(\d{1,2}):(\d{2})(?::\d{2})?(\s.*)?$/.exec(s) || /^(\d{2})(\d{2})$/.exec(s);
  }
  if (!m) {
    return null;
  }
  var h = +m[1];
  var mi = +m[2];
  return h < 24 && mi < 60 ? pad2(h) + ':' + pad2(mi) : null;
}

// '2027-03-09T07:00:00' -> ['2027-03-09', '07:00']; [null, null] when unreadable.
function isoParts(text) {
  var m = /^(\d{4})-?(\d{2})-?(\d{2})[T ](\d{2}):?(\d{2})/.exec(String(text || ''));
  return m ? [m[1] + '-' + m[2] + '-' + m[3], m[4] + ':' + m[5]] : [null, null];
}

function orNone(value) {
  return clean(value) || null;
}

function isCount(v) {
  return typeof v === 'number' && v % 1 === 0;
}

// Gangway times, approximate coordinates per port day and the embarkation
// port's time zone.
function fetchVoyage(auth, code, date8, callback) {
  authGet(auth, API + '/en/royal/web/v3/ships/voyages/' + code + date8 + '/enriched', null, function(err, json) {
    if (err) {
      callback(err);
      return;
    }
    var payload = (json || {}).payload || {};
    var info = payload.sailingInfo;
    info = (Array.isArray(info) ? info[0] : info) || {};
    var ports = [];
    ((info.itinerary || {}).portInfo || []).forEach(function(p) {
      var entry = {day: p.day, code: p.portCode};
      var n = 0;
      ['gangwayDown', 'gangwayUp'].forEach(function(key) {
        var raw = clean(p[key]);
        if (raw) {
          entry[key] = hhmm(raw) || raw;
          n++;
        }
      });
      var pois = p.pointsOfInterest || [];
      for (var i = 0; i < pois.length; i++) {
        var lat = pois[i].latitude;
        var lon = pois[i].longitude;
        if (typeof lat === 'number' && typeof lon === 'number' && (lat || lon)) {
          entry.lat = Math.round(lat * 10000) / 10000;
          entry.lon = Math.round(lon * 10000) / 10000;
          n++;
          break;
        }
      }
      if (n) {
        ports.push(entry);
      }
    });
    callback(null, {ports: ports, embarkTimeZone: orNone((info.departurePortInformation || {}).timeZoneName)});
  });
}

// Meeting time, end time and length of a booked, timed product from its
// catalog page; {} when the page has no offering matching the booked one.
function offeringTimes(auth, code, date8, booking, summary, offering, callback) {
  var prefix = (summary.productTypeCategory || {}).id;
  var opts = summary.baseOptions || [];
  var product = (((opts[0] || {}).selected) || {}).code;
  if (!prefix || !product) {
    callback(null, {});
    return;
  }
  authGet(auth, COMMERCE + '/catalog/v2/' + code + '/categories/' + prefix + '/products/' + product, {
    reservationId: booking.bookingId, passengerId: booking.passengerId,
    currencyIso: booking.bookingCurrency || 'USD',
    startDate: date8.slice(0, 4) + '-' + date8.slice(4, 6) + '-' + date8.slice(6, 8)
  }, function(err, json) {
    if (err) {
      callback(err);
      return;
    }
    var detail = (json || {}).payload || {};
    var offers = (detail.bookingOfferingData || {}).offerings || [];
    var match = offers.filter(function(o) { return o.id && o.id === offering.id; });
    if (!match.length) {
      match = offers.filter(function(o) { return o.dateTime && o.dateTime === offering.dateTime; });
    }
    var out = {};
    if (match.length) {
      var date = isoParts(offering.dateTime)[0];
      [['meetingTime', 'meet'], ['endDateTime', 'end']].forEach(function(k) {
        var dt = isoParts(match[0][k[0]]);
        if (dt[1] && dt[0] === date) {
          out[k[1]] = dt[1];
        }
      });
    }
    if (isCount(detail.durationInMins) && detail.durationInMins > 0) {
      out.minutes = detail.durationInMins;
    }
    callback(null, out);
  });
}

// {JSON [lowercase title, date, time]: {meet, minutes}} from the public shore
// excursion sessions in a schedule (finishSchedule), for booked orders. A
// session listed more than once is left out: no guessing.
function publicExcursionTimes(sched) {
  var out = {};
  if (!sched) {
    return out;
  }
  var f = {};
  (sched.fields || []).forEach(function(name, i) { f[name] = i; });
  if (f.info === undefined) {
    return out;
  }
  var cats = sched.cats || [];
  var infos = sched.infos || [];
  var seen = {};
  (sched.events || []).forEach(function(e) {
    var c = cats[e[f.cat]] || [];
    if (!e[f.time] || c[0] !== EXCURSION_CAT[0] || c[1] !== EXCURSION_CAT[1]) {
      return;
    }
    var key = JSON.stringify([e[f.title].toLowerCase(), e[f.date], e[f.time]]);
    if (seen[key]) {
      delete out[key];
      return;
    }
    seen[key] = true;
    var times = {};
    var info = e[f.info] !== null && e[f.info] !== undefined ? infos[e[f.info]] : null;
    var early = info ? info[1] : null;
    var start = clockMinutes(e[f.time].replace(':', ''));
    if (isCount(early) && early > 0 && early <= start) {
      times.meet = pad2(Math.floor((start - early) / 60)) + ':' + pad2((start - early) % 60);
    }
    if (e[f.minutes]) {
      times.minutes = e[f.minutes];
    }
    out[key] = times;
  });
  return out;
}

// Stateroom, cabin details and purchased add-ons for the matching booking
// (docs/DATA_FORMAT.md, mine). Parts that fail are skipped with a note. A
// booked excursion's meeting time and length come from the public listing
// (`sched`) when it has them; the logged-in catalog is asked only for what is
// still missing. callback(err, mine)
function fetchMine(auth, code, date8, sched, callback) {
  var pub = publicExcursionTimes(sched);
  authGet(auth, API + '/v1/profileBookings/enriched/' + encodeURIComponent(auth['account-id']),
          {brand: 'R', includeCheckin: 'true'}, function(err, json) {
    if (err) {
      callback(err);
      return;
    }
    var bookings = ((json || {}).payload || {}).profileBookings || [];
    var b = bookings.filter(function(x) {
      return x.shipCode === code && String(x.sailDate || '').replace(/-/g, '') === date8;
    })[0];
    if (!b) {
      callback('Signed in, but found no booking on your account for that ship and date.');
      return;
    }
    // Guarantee bookings list "GTY" until a cabin is assigned; a real one has digits.
    var room = String(b.stateroomNumber || '');
    var me = (b.passengers || []).filter(function(p) { return String(p.passengerId) === String(b.passengerId); })[0];
    var mine = {
      stateroom: /[0-9]/.test(room) ? room : null,
      deck: orNone(b.deckNumber),
      muster: orNone(b.musterStation),
      // Terminal arrival appointment, empty until online check-in is done
      arrival: me ? (hhmm(me.arrivalTime) || orNone(me.arrivalTime)) : null,
      orders: []
    };
    fetchVoyage(auth, code, date8, function(err2, voyage) {
      if (err2) {
        mine.voyageError = err2;
      } else {
        mine.ports = voyage.ports;
        mine.embarkTimeZone = voyage.embarkTimeZone;
      }
      var params = {passengerId: b.passengerId, reservationId: b.bookingId, sailingId: code + date8,
                    includeMedia: 'false'};
      var base = COMMERCE + '/calendar/v1/' + code + '/orderHistory';
      authGet(auth, base, params, function(err3, json3) {
        if (err3) {
          mine.ordersError = err3;
          callback(null, mine);
          return;
        }
        var history = (json3 || {}).payload || {};
        var orders = (history.myOrders || []).concat(history.ordersOthersHaveBookedForMe || [])
          .filter(function(o) { return o.orderCode && o.status !== 'CANCELLED'; });
        series(orders, function(order, nextOrder) {
          authGet(auth, base + '/' + order.orderCode, params, function(err4, json4) {
            if (err4) {
              nextOrder();
              return;
            }
            var items = ((json4 || {}).payload || {}).orderHistoryDetailItems || [];
            series(items, function(item, nextItem) {
              var summary = item.productSummary || {};
              var guests = (item.guests || []).filter(function(g) { return g.orderStatus !== 'CANCELLED'; });
              if (!guests.length || item.status === 'CANCELLED') {
                nextItem();
                return;
              }
              var cat = summary.productTypeCategory || {};
              var entry = {title: clean(summary.title), category: cat.id !== undefined ? cat.id : '',
                           guests: guests.length};
              mine.orders.push(entry);
              // Timed bookings (shore excursions, and probably dining and shows)
              // carry the booked session; packages and credits don't.
              var offering = item.offering || {};
              var dt = isoParts(offering.dateTime);
              if (!dt[0]) {
                nextItem();
                return;
              }
              entry.date = dt[0];
              entry.time = dt[1];
              if (isCount(offering.dayOfCruise)) {
                entry.day = offering.dayOfCruise;
              }
              if (offering.portCode) {
                entry.port = offering.portCode;
              }
              var p = pub[JSON.stringify([entry.title.toLowerCase(), dt[0], dt[1]])] || {};
              Object.keys(p).forEach(function(k) { entry[k] = p[k]; });
              if ('meet' in entry && 'minutes' in entry) {
                nextItem();
                return;
              }
              offeringTimes(auth, code, date8, b, summary, offering, function(err5, times) {
                if (!err5) {
                  Object.keys(times).forEach(function(k) { entry[k] = times[k]; });
                }
                nextItem();
              });
            }, nextOrder);
          });
        }, function() {
          mine.orders = mine.orders.map(function(o, i) { return [o, i]; }).sort(function(x, y) {
            var a = [x[0].date || '9999', x[0].time || '', x[0].title];
            var c = [y[0].date || '9999', y[0].time || '', y[0].title];
            for (var i = 0; i < 3; i++) {
              if (a[i] !== c[i]) {
                return a[i] < c[i] ? -1 : 1;
              }
            }
            return x[1] - y[1];
          }).map(function(x) { return x[0]; });
          callback(null, mine);
        });
      });
    });
  });
}

// Sign in, download the sailing as usual, then add `mine`.
// callback(err, bundle, mineErr): with err nothing downloaded; with mineErr
// the sailing downloaded but the booking details didn't.
function downloadWithLogin(ship, sailDate, email, password, callback) {
  login(email, password, function(err, auth) {
    if (err) {
      callback(err);
      return;
    }
    download(ship, sailDate, function(err2, bundle) {
      if (err2) {
        callback(err2);
        return;
      }
      fetchMine(auth, ship.code, sailDate.replace(/-/g, ''), bundle.schedule, function(err3, mine) {
        auth = null;
        if (err3) {
          callback(null, bundle, err3);
          return;
        }
        bundle.mine = mine;
        callback(null, bundle, null);
      });
    });
  });
  email = password = null;
}

// 'booking found: 3 purchases (1 timed), 2 port days', for the usage log:
// counts only, never the stateroom or titles.
function mineSummary(mine) {
  var timed = mine.orders.filter(function(o) { return o.time; }).length;
  return 'booking found: ' + mine.orders.length + ' purchases (' + timed + ' timed), ' +
    (mine.ports ? mine.ports.length + ' port days' : 'port details skipped') +
    (mine.ordersError ? ', purchases skipped' : '');
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
  downloadWithLogin: downloadWithLogin,
  login: login,
  fetchMine: fetchMine,
  mineSummary: mineSummary,
  hhmm: hhmm,
  accountOf: accountOf,
  publicExcursionTimes: publicExcursionTimes,
  API: API,
  APPKEY: APPKEY
};
