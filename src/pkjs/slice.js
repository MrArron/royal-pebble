// Builds the watch's "today" slice from a cruise data bundle (docs/DATA_FORMAT.md).
//
// Time model (docs/WATCH_PROTOCOL.md): every time is in "cruise minutes", minutes
// since 00:00 ship time on the sail date. Times that cross midnight are then just
// larger numbers. A watch day runs from 04:00 to 04:00 ship time, so a late
// night still belongs to the evening before.

var pack = require('./pack');
var venues = require('./venues');

var DAY_START = 4 * 60;
var MINUTES_PER_DAY = 24 * 60;
var MAX_EVENTS = 160;
var NO_TIME = -1;

var DAY_PORT = 0;
var DAY_SEA = 1;
var DAY_NONE = 2;

var FLAG_STARRED = 1;
var FLAG_FEATURED = 2;
var FLAG_RESERVATION = 4;
var FLAG_PERSONAL = 8;
var FLAG_LAST_CHANCE = 16;  // the last performance of a featured show (finalShows)
var FLAG_ONLY_SHOW = 32;    // a featured show that is on only once
var FLAG_RESERVED = 64;     // the owner marked it reserved (docs/DESIGN_V1_1.md §5)

var ALARM_ALL_ABOARD = 0;
var ALARM_REMINDER = 1;
var ALARM_TO_RESERVE = 2;              // the evening before: starred events still to reserve
var ALL_ABOARD_ALERTS = [60, 30, 15];  // minutes before all-aboard
var MAX_ALARMS = 24;                   // the watch keeps up to 24
var MAX_TO_RESERVE = 5;                // to-reserve alerts per evening; `extra` has the full count

// When the evening's to-reserve alert buzzes (Settings > Me), in minutes after
// midnight ship time. 20:00 unless set.
var RESERVE_ALERT_TIMES = [18 * 60, 19 * 60, 20 * 60, 21 * 60, 22 * 60];
var RESERVE_ALERT_DEFAULT = 20 * 60;

function reserveAlertAt(settings) {
  var v = settings && settings.reserveAlertAt;
  return RESERVE_ALERT_TIMES.indexOf(v) !== -1 ? v : RESERVE_ALERT_DEFAULT;
}

var MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// Days since 1970-01-01 for a civil date (Howard Hinnant's algorithm). The watch
// uses the same one, so both sides agree on day numbers without time zones.
function daysFromCivil(y, m, d) {
  y -= m <= 2 ? 1 : 0;
  var era = Math.floor(y / 400);
  var yoe = y - era * 400;
  var doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  var doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(z) {
  z += 719468;
  var era = Math.floor(z / 146097);
  var doe = z - era * 146097;
  var yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  var y = yoe + era * 400;
  var doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  var mp = Math.floor((5 * doy + 2) / 153);
  var d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  var m = mp + (mp < 10 ? 3 : -9);
  return {y: y + (m <= 2 ? 1 : 0), m: m, d: d};
}

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

function isoFromDays(z) {
  var c = civilFromDays(z);
  return c.y + '-' + pad2(c.m) + '-' + pad2(c.d);
}

function daysFromIso(s) {
  var p = s.split('-');
  return daysFromCivil(+p[0], +p[1], +p[2]);
}

function minutesFromHhmm(s) {
  if (!s) {
    return null;
  }
  var p = s.split(':');
  return (+p[0]) * 60 + (+p[1]);
}

// Cruise minutes for a Date, read on the phone's clock (which the watch shares).
function cruiseMinutes(sailDays, date) {
  var today = daysFromCivil(date.getFullYear(), date.getMonth() + 1, date.getDate());
  return (today - sailDays) * MINUTES_PER_DAY + date.getHours() * 60 + date.getMinutes();
}

function cruiseDayIndex(cruiseMin) {
  return Math.floor((cruiseMin - DAY_START) / MINUTES_PER_DAY);
}

// "St. Thomas, U.S. Virgin Islands" -> "St. Thomas";
// "Orlando (Port Canaveral), Fl" -> "Port Canaveral".
function shortPort(port) {
  var name = (port || '').split(',')[0];
  var paren = name.match(/\(([^)]+)\)/);
  return (paren ? paren[1] : name).trim();
}

function dayStatus(type) {
  switch (type) {
    case 'CRUISING': return 'AT SEA';
    case 'DOCKED': return 'DOCKED';
    case 'EMBARK': return 'EMBARK';
    case 'DEBARK': return 'DEBARK';
    default: return (type || 'PORT').slice(0, 11);
  }
}

function starKey(title, date, time, venue) {
  return [title, date, time || '', venue || ''].join('|');
}

// Reserved marks (docs/DESIGN_V1_1.md §5) are kept with the stars, under the
// event's star key with this prefix, so they share the stars' storage, change
// times (the latest change wins) and the watch's change queue. The flag stays
// when the event is unstarred, so starring it again brings it back.
var RESERVED_PREFIX = 'R|';

function reservedKey(key) {
  return RESERVED_PREFIX + key;
}

function isReservedKey(key) {
  return key.slice(0, RESERVED_PREFIX.length) === RESERVED_PREFIX;
}

function eventSort(a, b) {
  var at = a.start === NO_TIME ? -Infinity : a.start;
  var bt = b.start === NO_TIME ? -Infinity : b.start;
  if (at !== bt) {
    return at < bt ? -1 : 1;
  }
  return a.title < b.title ? -1 : (a.title > b.title ? 1 : 0);
}

// Royal lists a late departure as a clock time on the port day's date. One
// before arrival, or before the watch day starts (04:00), is after midnight.
function afterMidnight(min, arrive) {
  if (min === null) {
    return null;
  }
  if (min < DAY_START || (arrive !== null && min < arrive)) {
    return min + MINUTES_PER_DAY;
  }
  return min;
}

// Settings > Days can change a day's type, port and times offline (a skipped or
// added port); the edit only holds the fields that differ from Royal's.
var EDIT_FIELDS = ['type', 'port', 'arrive', 'depart'];

function editedDay(it, edit) {
  if (!edit) {
    return it;
  }
  var out = {};
  Object.keys(it).forEach(function(k) { out[k] = it[k]; });
  EDIT_FIELDS.forEach(function(k) {
    if (edit.hasOwnProperty(k)) {
      out[k] = edit[k];
    }
  });
  return out;
}

var HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// Checks one day's settings as returned by the settings page. Returns the
// cleaned object, or null when nothing valid is left.
function cleanDaySettings(d) {
  if (!d || typeof d !== 'object') {
    return null;
  }
  var out = {};
  if (typeof d.offset === 'number' && d.offset % 30 === 0 && d.offset >= -720 && d.offset <= 720 && d.offset) {
    out.offset = d.offset;
  }
  if ([30, 45, 60].indexOf(d.buffer) !== -1) {
    out.buffer = d.buffer;
  }
  if (HHMM.test(d.allAboard || '')) {
    out.allAboard = d.allAboard;
  }
  var e = d.edit;
  if (e && typeof e === 'object') {
    var edit = {};
    if (/^[A-Z_]{1,20}$/.test(e.type || '')) {
      edit.type = e.type;
    }
    if (typeof e.port === 'string') {
      edit.port = e.port.slice(0, 60);
    }
    ['arrive', 'depart'].forEach(function(k) {
      if (e[k] === null || HHMM.test(e[k] || '')) {
        edit[k] = e[k];
      }
    });
    if (Object.keys(edit).length) {
      out.edit = edit;
    }
  }
  return Object.keys(out).length ? out : null;
}

// Minutes between all-aboard and departure unless set per day. Tender ports get
// longer: the last tender back leaves well before the ship does. Royal's tender
// day type isn't confirmed yet, so match anything containing TENDER.
function defaultBuffer(type) {
  return /TENDER/.test(type || '') ? 60 : 30;
}

function buildDay(bundle, settings, dayIndex, sailDays) {
  var date = isoFromDays(sailDays + dayIndex);
  var it = null;
  (bundle.itinerary || []).forEach(function(entry) {
    if (entry.date === date) {
      it = entry;
    }
  });

  if (!it) {
    var sail = civilFromDays(sailDays);
    var before = dayIndex < 0;
    return {
      date: date,
      kind: DAY_NONE,
      status: before ? 'SAILS ' + MONTHS[sail.m - 1] + ' ' + sail.d : 'CRUISE ENDED',
      location: (bundle.ship && bundle.ship.name) || 'Your cruise',
      allAboard: NO_TIME,
      arrive: NO_TIME,
      depart: NO_TIME,
      localOffset: 0
    };
  }

  var perDay = (settings.days && settings.days[date]) || {};
  it = editedDay(it, perDay.edit);
  var offset = perDay.offset || 0;
  var buffer = perDay.buffer || defaultBuffer(it.type);
  var allAboard = NO_TIME;
  if (it.type !== 'DEBARK' && it.type !== 'CRUISING') {
    var override = afterMidnight(minutesFromHhmm(perDay.allAboard), null);
    var depart = afterMidnight(minutesFromHhmm(it.depart), minutesFromHhmm(it.arrive));
    // Itinerary times are port-local; ship time = local - offset.
    var shipMin = override !== null ? override : (depart !== null ? depart - offset - buffer : null);
    if (shipMin !== null) {
      allAboard = dayIndex * MINUTES_PER_DAY + shipMin;
    }
  }

  // Arrival and departure for the morning summary, in ship time like
  // all-aboard (a departure after midnight is a larger number).
  var arrive = NO_TIME;
  var departShip = NO_TIME;
  if (it.type !== 'CRUISING') {
    var arr = minutesFromHhmm(it.arrive);
    var dep = afterMidnight(minutesFromHhmm(it.depart), arr);
    arrive = arr === null ? NO_TIME : dayIndex * MINUTES_PER_DAY + arr - offset;
    departShip = dep === null ? NO_TIME : dayIndex * MINUTES_PER_DAY + dep - offset;
  }

  return {
    date: date,
    kind: it.type === 'CRUISING' ? DAY_SEA : DAY_PORT,
    status: dayStatus(it.type),
    location: it.type === 'CRUISING' ? 'At Sea' : (shortPort(it.port) || 'Port'),
    allAboard: allAboard,
    arrive: arrive,
    depart: departShip,
    localOffset: offset
  };
}

// Settings > Filters: hidden categories as "Category" or "Category / Subcategory".
// Shop is hidden until the user changes filters.
var DEFAULT_HIDDEN = ['Shop'];

function hiddenCats(settings) {
  return Array.isArray(settings.hiddenCats) ? settings.hiddenCats : DEFAULT_HIDDEN;
}

function isHidden(hidden, cat) {
  return hidden.indexOf(cat[0]) !== -1 || hidden.indexOf(cat[0] + ' / ' + (cat[1] || '')) !== -1;
}

// Categories in a bundle's schedule with event counts, for Settings > Filters:
// [{name, n, subs: [{name, n}]}] sorted by name; '' is a missing subcategory.
function categorySummary(bundle) {
  var sched = (bundle && bundle.schedule) || {};
  var ci = (sched.fields || []).indexOf('cat');
  var byName = {};
  (sched.events || []).forEach(function(row) {
    var cat = (sched.cats || [])[row[ci]];
    if (!cat || !cat[0]) {
      return;
    }
    var c = byName[cat[0]] = byName[cat[0]] || {name: cat[0], n: 0, subs: {}};
    var sub = cat[1] || '';
    c.n++;
    c.subs[sub] = (c.subs[sub] || 0) + 1;
  });
  function byNameSort(a, b) {
    return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
  }
  return Object.keys(byName).map(function(k) {
    var c = byName[k];
    return {name: c.name, n: c.n, subs: Object.keys(c.subs).map(function(s) {
      return {name: s, n: c.subs[s]};
    }).sort(byNameSort)};
  }).sort(byNameSort);
}

// Checks personal entries as returned by the settings page: [{title, venue,
// date, time, minutes}]. Title and venue fit the watch's limits.
function cleanPersonal(list) {
  if (!Array.isArray(list)) {
    return null;
  }
  var out = [];
  list.forEach(function(p) {
    if (!p || typeof p.title !== 'string' || !p.title.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(p.date || '') ||
        out.length >= 100) {
      return;
    }
    out.push({
      title: p.title.trim().slice(0, 63),
      venue: typeof p.venue === 'string' ? p.venue.trim().slice(0, 31) : '',
      date: p.date,
      time: HHMM.test(p.time || '') ? p.time : null,
      minutes: typeof p.minutes === 'number' && p.minutes > 0 && p.minutes <= 1440 ? Math.round(p.minutes) : 0
    });
  });
  return out;
}

// Applies star changes from the settings page ({key: true | false}) to stars.
// With `times` ({key: ms}, when each star last changed) the latest change wins:
// the page reports when each change was made (`changeTimes`, else `now`), and
// one older than a change already saved (from the watch) is skipped.
function applyStarChanges(stars, changes, times, changeTimes, now) {
  if (!changes || typeof changes !== 'object') {
    return stars;
  }
  changeTimes = changeTimes && typeof changeTimes === 'object' ? changeTimes : {};
  Object.keys(changes).forEach(function(k) {
    if (k.length > 300 || typeof changes[k] !== 'boolean') {
      return;
    }
    if (times) {
      var t = changeTimes[k];
      t = typeof t === 'number' && t > 0 && t <= now ? t : now;
      if (times[k] > t) {
        return;
      }
      times[k] = t;
    }
    if (changes[k]) {
      stars[k] = true;
    } else {
      delete stars[k];
    }
  });
  return stars;
}

// Whether `text`, as the watch got it (pack.js, cut to `packedMax` bytes), and
// then cut to `keptMax` bytes by the watch's star queue, is `sent`.
function sameWatchText(text, sent, packedMax, keptMax) {
  var full = pack.utf8(text || '', packedMax);
  if (sent.length !== Math.min(full.length, keptMax)) {
    return false;
  }
  for (var i = 0; i < sent.length; i++) {
    if (full[i] !== sent[i]) {
      return false;
    }
  }
  return true;
}

// Applies star changes made on the watch (pack.decodeStarChanges) to stars.
// The watch identifies events by start (cruise minutes), title and venue, not
// by star key, so each change is matched against the schedule and personal
// entries the same way the watch built them (buildEvents: a time before 04:00
// is after midnight on its listed date). With `times`, the latest change wins,
// as in applyStarChanges.
// A change with `reserved` set is about the event's reserved mark (saved under
// reservedKey) instead of its star.
// Returns {applied, ignored (older than a saved change), unmatched}, each a
// list of {key or title, on, reserved}.
function applyWatchStarChanges(bundle, settings, stars, times, changes) {
  var sailDays = daysFromIso(bundle.sailDate);
  var candidates = scheduleEvents(bundle).concat(((settings && settings.personal) || []).map(function(p) {
    return {title: p.title, venue: p.venue || '', date: p.date, time: p.time || null,
            key: starKey(p.title, p.date, p.time, p.venue)};
  }));
  var r = {applied: [], ignored: [], unmatched: []};
  changes.forEach(function(c) {
    var keys = {};
    if (c.sail === sailDays) {
      candidates.forEach(function(e) {
        var start = eventStart(sailDays, e.date, e.time);
        if (start !== c.start || (start === NO_TIME && daysFromIso(e.date) - sailDays !== c.day)) {
          return;
        }
        if (sameWatchText(e.title, c.title, pack.TITLE_MAX, pack.STAR_CHANGE_TITLE_MAX) &&
            sameWatchText(e.venue, c.venue, pack.VENUE_MAX, pack.STAR_CHANGE_VENUE_MAX)) {
          keys[e.key] = true;
        }
      });
    }
    var list = Object.keys(keys);
    if (!list.length) {
      r.unmatched.push({title: String.fromCharCode.apply(null, c.title), on: c.on, reserved: !!c.reserved});
      return;
    }
    var at = c.at * 1000;
    list.forEach(function(key) {
      // A Reserved change is about the event's reserved mark, not its star.
      key = c.reserved ? reservedKey(key) : key;
      if (times && times[key] > at) {
        r.ignored.push({key: key, on: c.on, reserved: !!c.reserved});
        return;
      }
      if (times) {
        times[key] = at;
      }
      if (c.on) {
        stars[key] = true;
      } else {
        delete stars[key];
      }
      r.applied.push({key: key, on: c.on, reserved: !!c.reserved});
    });
  });
  return r;
}

// Drops star change times ({key: ms}) that can't matter any more: keeps those
// of events in the bundle's schedule, personal entries and starred keys, and
// the same for reserved marks. Returns a new object.
function pruneStarTimes(times, bundle, settings, stars) {
  var keep = {};
  scheduleEvents(bundle).forEach(function(e) { keep[e.key] = true; });
  ((settings && settings.personal) || []).forEach(function(p) {
    keep[starKey(p.title, p.date, p.time, p.venue)] = true;
  });
  var out = {};
  Object.keys(times || {}).forEach(function(k) {
    var eventKey = isReservedKey(k) ? k.slice(RESERVED_PREFIX.length) : k;
    if (keep[eventKey] || (stars && stars[k])) {
      out[k] = times[k];
    }
  });
  return out;
}

// Checks hiddenCats as returned by the settings page.
function cleanHiddenCats(list) {
  if (!Array.isArray(list)) {
    return null;
  }
  var out = [];
  list.forEach(function(s) {
    if (typeof s === 'string' && s && s.length <= 80 && out.indexOf(s) === -1 && out.length < 200) {
      out.push(s);
    }
  });
  return out;
}

function buildEvents(bundle, settings, stars, dayIndex, sailDays) {
  var from = dayIndex * MINUTES_PER_DAY + DAY_START;
  var to = from + MINUTES_PER_DAY;
  var today = isoFromDays(sailDays + dayIndex);
  var hidden = hiddenCats(settings);
  var events = [];
  var ship = (bundle.ship && bundle.ship.code) || '';
  var whereOf = venues.whereFinder(ship, (settings.venues || {})[ship], (settings.me || {}).deck);
  var finals = finalShows(bundle);

  function add(title, venue, date, time, minutes, flags, cat, paid) {
    var tod = minutesFromHhmm(time);
    // Royal lists after-midnight events under the evening's date (a 01:00 curfew
    // is dated the night before), so times before 04:00 are after that midnight.
    if (tod !== null && tod < DAY_START) {
      tod += MINUTES_PER_DAY;
    }
    var start = tod === null ? NO_TIME : (daysFromIso(date) - sailDays) * MINUTES_PER_DAY + tod;
    if (start === NO_TIME ? date !== today : (start < from || start >= to)) {
      return;
    }
    var key = starKey(title, date, time, venue);
    if (stars[key]) {
      flags |= FLAG_STARRED;
    } else if (paid || (cat && isHidden(hidden, cat))) {
      // Filtered out unless starred. A paid session is starred when the owner
      // picks it under Booked activities, so the others never reach the watch.
      return;
    }
    if ((flags & FLAG_RESERVATION) && stars[reservedKey(key)]) {
      flags |= FLAG_RESERVED;
    }
    events.push({
      title: title,
      venue: venue || '',
      start: start,
      minutes: minutes || 0,
      flags: flags,
      where: whereOf(venue),
      key: key
    });
  }

  var sched = bundle.schedule || {};
  var f = {};
  (sched.fields || []).forEach(function(name, i) { f[name] = i; });
  (sched.events || []).forEach(function(row) {
    var cat = (sched.cats || [])[row[f.cat]] || [];
    var flags = (row[f.featured] ? FLAG_FEATURED : 0) | (row[f.reservation] ? FLAG_RESERVATION : 0);
    var fin = finals[starKey(row[f.title], row[f.date], row[f.time], (sched.venues || [])[row[f.venue]])];
    flags |= fin === FINAL_LAST_CHANCE ? FLAG_LAST_CHANCE : fin === FINAL_ONLY_SHOW ? FLAG_ONLY_SHOW : 0;
    add(row[f.title], (sched.venues || [])[row[f.venue]], row[f.date], row[f.time], row[f.minutes], flags, cat,
        f.paid !== undefined && !!row[f.paid]);
  });

  (settings.personal || []).forEach(function(p) {
    add(p.title, p.venue, p.date, p.time, p.minutes, FLAG_PERSONAL);
  });

  events.sort(eventSort);
  if (events.length > MAX_EVENTS) {
    // Too many for the watch: drop the earliest timed events (already past, most likely).
    var untimed = events.filter(function(e) { return e.start === NO_TIME; });
    var timed = events.filter(function(e) { return e.start !== NO_TIME; });
    events = untimed.concat(timed.slice(timed.length - (MAX_EVENTS - untimed.length)));
  }
  return events;
}

// Schedule events of a bundle as objects, with their star keys.
function scheduleEvents(bundle) {
  var sched = (bundle && bundle.schedule) || {};
  var f = {};
  (sched.fields || []).forEach(function(name, i) { f[name] = i; });
  return (sched.events || []).map(function(row) {
    var e = {title: row[f.title], venue: (sched.venues || [])[row[f.venue]] || '', date: row[f.date],
             time: row[f.time] || null, minutes: row[f.minutes] || 0, featured: !!row[f.featured],
             paid: f.paid !== undefined && !!row[f.paid]};
    e.key = starKey(e.title, e.date, e.time, e.venue);
    return e;
  });
}

// Start in cruise minutes (NO_TIME if untimed) and watch day of a listed event.
function eventStart(sailDays, date, time) {
  var tod = minutesFromHhmm(time);
  if (tod === null) {
    return NO_TIME;
  }
  return (daysFromIso(date) - sailDays) * MINUTES_PER_DAY + (tod < DAY_START ? tod + MINUTES_PER_DAY : tod);
}

function eventWatchDay(sailDays, e) {
  var start = eventStart(sailDays, e.date, e.time);
  return start === NO_TIME ? daysFromIso(e.date) - sailDays : cruiseDayIndex(start);
}

// Over, as on the watch (data.c event_is_finished): past its end or, with no
// length, 30 minutes after it starts. Untimed entries last their watch day.
var FINISHED_GRACE = 30;

function eventFinished(sailDays, e, nowMin) {
  var start = eventStart(sailDays, e.date, e.time);
  if (start === NO_TIME) {
    return (daysFromIso(e.date) - sailDays + 1) * MINUTES_PER_DAY + DAY_START <= nowMin;
  }
  return start + (e.minutes || FINISHED_GRACE) <= nowMin;
}

function sameTitle(a, b) {
  return (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
}

// On re-import, checks each upcoming star against the new schedule. Stars are
// keyed by title + date + time + venue (no event id in v1), so a rescheduled
// event would silently lose its star and reminder:
// - key still there: nothing to do;
// - exactly one new event with the same title on the same watch day: moved, and
//   the star follows it;
// - several: don't guess, drop the star and ask the user to check the times;
// - none: cancelled, drop the star.
// Only stars of events in the old schedule are checked (not personal entries or
// finished events). Nothing is checked for a different sailing, or when the new
// schedule is empty (not published, or a failed fetch).
// With `times` ({key: ms}, see applyStarChanges) a moved star keeps its change
// time under its new key.
// Returns {stars, times (new objects), changes: [{kind: 'moved' | 'check' |
// 'cancelled', title, date, time, venue, minutes, to: {date, time, venue}
// (moved), options (check)}]}.
function reconcileStars(oldBundle, newBundle, stars, settings, now, times) {
  var out = {};
  Object.keys(stars || {}).forEach(function(k) { out[k] = stars[k]; });
  var outTimes = {};
  Object.keys(times || {}).forEach(function(k) { outTimes[k] = times[k]; });
  var result = {stars: out, times: outTimes, changes: []};
  var newEvents = scheduleEvents(newBundle);
  if (!oldBundle || !newEvents.length || oldBundle.sailDate !== newBundle.sailDate ||
      (oldBundle.ship && oldBundle.ship.code) !== (newBundle.ship && newBundle.ship.code)) {
    return result;
  }
  var sailDays = daysFromIso(newBundle.sailDate);
  var nowMin = cruiseMinutes(sailDays, now);
  var oldByKey = {};
  scheduleEvents(oldBundle).forEach(function(e) { oldByKey[e.key] = e; });
  var newKeys = {};
  newEvents.forEach(function(e) { newKeys[e.key] = true; });
  var personalKeys = {};
  ((settings && settings.personal) || []).forEach(function(p) {
    personalKeys[starKey(p.title, p.date, p.time, p.venue)] = true;
  });

  Object.keys(out).sort().forEach(function(key) {
    var old = oldByKey[key];
    if (!out[key] || newKeys[key] || personalKeys[key] || !old || eventFinished(sailDays, old, nowMin)) {
      return;  // reserved marks too: they aren't event keys, and follow their star below
    }
    var day = eventWatchDay(sailDays, old);
    var candidates = newEvents.filter(function(e) {
      return !oldByKey[e.key] && sameTitle(e.title, old.title) && eventWatchDay(sailDays, e) === day;
    });
    var change = {title: old.title, date: old.date, time: old.time, venue: old.venue, minutes: old.minutes};
    var reserved = !!out[reservedKey(key)];
    delete out[key];
    delete out[reservedKey(key)];
    if (candidates.length === 1) {
      var to = candidates[0];
      out[to.key] = true;
      if (outTimes[key]) {
        outTimes[to.key] = outTimes[key];
      }
      // A reserved mark moves with its star.
      if (reserved) {
        out[reservedKey(to.key)] = true;
        if (outTimes[reservedKey(key)]) {
          outTimes[reservedKey(to.key)] = outTimes[reservedKey(key)];
        }
      }
      change.kind = 'moved';
      change.to = {date: to.date, time: to.time, venue: to.venue};
    } else if (candidates.length > 1) {
      change.kind = 'check';
      change.options = candidates.length;
    } else {
      change.kind = 'cancelled';
    }
    result.changes.push(change);
  });
  result.changes.sort(function(a, b) {
    return eventStart(sailDays, a.date, a.time) - eventStart(sailDays, b.date, b.time);
  });
  return result;
}

// Star changes as watch notices (docs/WATCH_PROTOCOL.md, NOTICE): {kind (0
// moved, 1 cancelled, 2 check), from, to (cruise minutes, NO_TIME untimed),
// title, venue (new venue, or the old one if not moved), oldVenue (only when
// the venue changed)}. At most MAX_NOTICES, soonest first.
var NOTICE_MOVED = 0;
var NOTICE_CANCELLED = 1;
var NOTICE_CHECK = 2;
var MAX_NOTICES = 8;

function buildNotices(sailDate, changes) {
  var sailDays = daysFromIso(sailDate);
  return (changes || []).slice(0, MAX_NOTICES).map(function(c) {
    var from = eventStart(sailDays, c.date, c.time);
    var moved = c.kind === 'moved';
    return {
      kind: moved ? NOTICE_MOVED : (c.kind === 'check' ? NOTICE_CHECK : NOTICE_CANCELLED),
      from: from,
      to: moved ? eventStart(sailDays, c.to.date, c.to.time) : from,
      title: c.title,
      venue: moved ? c.to.venue : c.venue,
      oldVenue: moved && c.to.venue !== c.venue ? c.venue : ''
    };
  });
}

// The last performance of each featured show in the cruise, matched by title
// across all days (docs/DESIGN_V1_1.md §8.4): {starKey: FINAL_LAST_CHANCE, or
// FINAL_ONLY_SHOW when the show is on only once}. Personal entries and
// unfeatured events never get one.
var FINAL_LAST_CHANCE = 1;
var FINAL_ONLY_SHOW = 2;

function finalShows(bundle) {
  var sailDays = daysFromIso(bundle.sailDate);
  var byTitle = {};
  scheduleEvents(bundle).forEach(function(e) {
    if (!e.featured || e.paid) {
      return;  // paid classes are booked, not caught before they end
    }
    var t = (e.title || '').trim().toLowerCase();
    var shows = byTitle[t] = byTitle[t] || {};
    shows[e.key] = eventStart(sailDays, e.date, e.time);
  });
  var out = {};
  Object.keys(byTitle).forEach(function(t) {
    var keys = Object.keys(byTitle[t]);
    var last = keys[0];
    keys.forEach(function(k) {
      if (byTitle[t][k] > byTitle[t][last]) {
        last = k;
      }
    });
    out[last] = keys.length === 1 ? FINAL_ONLY_SHOW : FINAL_LAST_CHANCE;
  });
  return out;
}

// Tomorrow's card for the evening summary (docs/DESIGN_V1_1.md §8.1): the
// day, how many starred events and personal entries it holds and the first
// timed one, how many featured events, a show to catch (`last`, with
// `lastKind` a FINAL_ value, 0 none): a last chance before an only show, the
// earliest of each; and how many starred events still need a reservation
// (`toReserve`, §5).
function buildTomorrow(bundle, settings, stars, dayIndex, sailDays) {
  var day = buildDay(bundle, settings, dayIndex + 1, sailDays);
  var t = {kind: day.kind, status: '', location: '', arrive: NO_TIME, depart: NO_TIME,
           allAboard: NO_TIME, starred: 0, featured: 0, first: '', firstStart: NO_TIME,
           last: '', lastKind: 0, toReserve: 0};
  if (day.kind === DAY_NONE) {
    return t;
  }
  t.status = day.status;
  t.location = day.location;
  t.arrive = day.arrive;
  t.depart = day.depart;
  t.allAboard = day.allAboard;
  buildEvents(bundle, settings, stars, dayIndex + 1, sailDays).forEach(function(e) {
    if (e.flags & (FLAG_STARRED | FLAG_PERSONAL)) {
      t.starred++;
      if (t.firstStart === NO_TIME && e.start !== NO_TIME) {
        t.first = e.title;
        t.firstStart = e.start;
      }
    }
    if (e.flags & FLAG_FEATURED) {
      t.featured++;
    }
    if (notReserved(e)) {
      t.toReserve++;
    }
    var kind = e.flags & FLAG_LAST_CHANCE ? FINAL_LAST_CHANCE : e.flags & FLAG_ONLY_SHOW ? FINAL_ONLY_SHOW : 0;
    if (kind && (!t.lastKind || kind < t.lastKind)) {
      t.last = e.title;
      t.lastKind = kind;
    }
  });
  return t;
}

// The countdown before the cruise (docs/DESIGN_V1_1.md §8.2): starred events
// across the whole cruise (keys that still match the schedule, whatever the
// Filters) plus personal entries.
function cruiseStarred(bundle, settings, stars) {
  var n = ((settings && settings.personal) || []).length;
  scheduleEvents(bundle).forEach(function(e) {
    if (stars[e.key]) {
      n++;
    }
  });
  return n;
}

function formatSync(iso) {
  if (!iso) {
    return 'Never';
  }
  var d = new Date(iso);
  if (isNaN(d.getTime())) {
    return iso;
  }
  var h = d.getHours();
  var h12 = h % 12 === 0 ? 12 : h % 12;
  var mon = MONTHS[d.getMonth()];
  return mon.charAt(0) + mon.slice(1).toLowerCase() + ' ' + d.getDate() + ', ' + h12 + ':' +
    pad2(d.getMinutes()) + (h < 12 ? 'a' : 'p');
}

// "From" directions start at the previous starred event or personal entry when
// it ends less than this many minutes before the next one starts, or overlaps
// it (docs/DESIGN_V1_1.md, decisions). No length counts as FINISHED_GRACE.
var FROM_GAP = 15;

// The stop just before `e` among `stops` (timed starred events and personal
// entries, sorted by start): the latest to start before it that ends less than
// FROM_GAP minutes before it starts. Null when there is none.
function previousStop(stops, e) {
  var prev = null;
  stops.forEach(function(p) {
    if (p.start < e.start && p.start + (p.minutes || FINISHED_GRACE) > e.start - FROM_GAP) {
      prev = p;
    }
  });
  return prev;
}

// Starred, needs a reservation and isn't marked reserved (§5).
function notReserved(e) {
  var f = e.flags;
  return !!((f & FLAG_STARRED) && (f & FLAG_RESERVATION) && !(f & FLAG_RESERVED));
}

// Alerts for the watch to fire on its own (docs/WATCH_PROTOCOL.md): all-aboard
// warnings and reminders before starred events and personal entries, for today
// and tomorrow's watch days, so tomorrow still works if the phone is away at the
// 04:00 rollover. Each: {at, ref, kind, extra, title, venue} where `at` is when to
// buzz and `ref` the all-aboard or event start (cruise minutes). `extra` is the
// local offset for all-aboard, the duration for reminders. Reminders also have
// `where`, the venue's short name as `venue` and "From" directions: `from`
// (venues.FROM_*), `fromPos` and `fromVenue` (the previous venue's short name,
// for a route). `notReserved` is set on a reminder for a starred event that
// needs a reservation and isn't marked reserved.
// Each evening also gets to-reserve alerts (§5): at the Me tab's time (see
// reserveAlertAt) on a watch day, one per starred event of the next watch day
// that needs a reservation and isn't marked reserved, at most MAX_TO_RESERVE,
// in time order. `ref` is the event's start, `extra` how many there are in all.
function buildAlarms(bundle, settings, stars, now, testAt) {
  settings = settings || {};
  stars = stars || {};
  var sailDays = daysFromIso(bundle.sailDate);
  var nowMin = cruiseMinutes(sailDays, now);
  var today = cruiseDayIndex(nowMin);
  var lead = [5, 15, 30].indexOf(settings.reminderLead) !== -1 ? settings.reminderLead : 15;
  var ship = (bundle.ship && bundle.ship.code) || '';
  var finder = venues.venueFinder(ship, (settings.venues || {})[ship], (settings.me || {}).deck);
  var alarms = [];

  // Starred events and personal entries from yesterday's watch day on, so the
  // first reminder after 04:00 can start from a late-night stop.
  var days = {};
  var stops = [];
  for (var d = today - 1; d <= today + 1; d++) {
    days[d] = buildEvents(bundle, settings, stars, d, sailDays).filter(function(e) {
      return e.start !== NO_TIME && (e.flags & (FLAG_STARRED | FLAG_PERSONAL));
    });
    stops = stops.concat(days[d]);
  }

  for (d = today; d <= today + 1; d++) {
    var day = buildDay(bundle, settings, d, sailDays);
    if (day.allAboard !== NO_TIME) {
      ALL_ABOARD_ALERTS.forEach(function(before) {
        alarms.push({at: day.allAboard - before, ref: day.allAboard, kind: ALARM_ALL_ABOARD,
                     extra: day.localOffset, title: day.location, venue: ''});
      });
    }
    days[d].forEach(function(e) {
      var prev = previousStop(stops, e);
      var route = prev ? finder.route(prev.venue, e.venue) : null;
      alarms.push({at: e.start - lead, ref: e.start, kind: ALARM_REMINDER, extra: e.minutes,
                   title: e.title, venue: finder.short(e.venue), where: route ? route.where : e.where,
                   from: route ? route.kind : venues.FROM_NONE, fromPos: route ? route.fromPos : 0,
                   fromVenue: route && route.kind === venues.FROM_ROUTE ? finder.short(prev.venue) : '',
                   notReserved: notReserved(e)});
    });
    var toReserve = buildEvents(bundle, settings, stars, d + 1, sailDays).filter(notReserved);
    toReserve.slice(0, MAX_TO_RESERVE).forEach(function(e) {
      alarms.push({at: d * MINUTES_PER_DAY + reserveAlertAt(settings), ref: e.start, kind: ALARM_TO_RESERVE,
                   extra: toReserve.length, title: e.title, venue: finder.short(e.venue), notReserved: true});
    });
  }

  if (testAt) {
    alarms = alarms.concat(testAlarms(sailDays, testAt));
  }
  return alarms
    .filter(function(a) { return a.at > nowMin; })
    .sort(function(a, b) { return a.at - b.at || a.kind - b.kind || a.ref - b.ref; })
    .slice(0, MAX_ALARMS);
}

// Alerts from Settings > Me > Test alerts, anchored to when it was tapped: a
// reminder 2 minutes later, an all-aboard warning a minute after that and a
// to-reserve alert (two events) a minute after that.
function testAlarms(sailDays, requestedAt) {
  var t = cruiseMinutes(sailDays, requestedAt);
  return [
    {at: t + 2, ref: t + 17, kind: ALARM_REMINDER, extra: 30, title: 'Test reminder', venue: 'Alert test'},
    {at: t + 3, ref: t + 18, kind: ALARM_ALL_ABOARD, extra: 0, title: 'Test all-aboard', venue: ''},
    {at: t + 4, ref: t + MINUTES_PER_DAY, kind: ALARM_TO_RESERVE, extra: 2, title: 'Test show',
     venue: 'Alert test', notReserved: true},
    {at: t + 4, ref: t + MINUTES_PER_DAY + 90, kind: ALARM_TO_RESERVE, extra: 2, title: 'Test show 2',
     venue: 'Alert test', notReserved: true}
  ];
}

// The watch saves only what fits (docs/WATCH_PROTOCOL.md, "Stored on the
// watch") and reports the first starred event or alert that didn't, in cruise
// minutes. Returns when that is on the ship's clock, {date, time: 'HH:MM'}, or
// null when everything fit or that time has passed.
function cutoffWhen(sailDate, cutoff, now) {
  if (typeof cutoff !== 'number' || cutoff === NO_TIME) {
    return null;
  }
  var sailDays = daysFromIso(sailDate);
  if (cutoff <= cruiseMinutes(sailDays, now)) {
    return null;
  }
  var day = Math.floor(cutoff / MINUTES_PER_DAY);
  var min = cutoff - day * MINUTES_PER_DAY;
  return {date: isoFromDays(sailDays + day), time: pad2(Math.floor(min / 60)) + ':' + pad2(min % 60)};
}

// settings: {theme, showFeatured, hiddenCats,
//            days: {date: {offset, buffer, allAboard, edit: {type, port, arrive, depart}}},
//            personal: [...], me: {stateroom, deck, stairs, muster, clockNote},
//            reminderLead, reserveAlertAt (minutes after midnight),
//            venues: {shipCode: owner's venue edits}}
// stars: {starKey: true}
// testAt: Date when Test alerts was tapped, or null.
function buildSlice(bundle, settings, stars, now, testAt) {
  settings = settings || {};
  stars = stars || {};
  var sailDays = daysFromIso(bundle.sailDate);
  var dayIndex = cruiseDayIndex(cruiseMinutes(sailDays, now));
  var me = settings.me || {};
  var mine = bundle.mine || {};
  var sailDay = buildDay(bundle, settings, 0, sailDays);

  return {
    sailDays: sailDays,
    sailDate: bundle.sailDate,
    dayIndex: dayIndex,
    day: buildDay(bundle, settings, dayIndex, sailDays),
    tomorrow: buildTomorrow(bundle, settings, stars, dayIndex, sailDays),
    shipName: (bundle.ship && bundle.ship.name) || '',
    sailPort: sailDay.kind === DAY_PORT ? sailDay.location : '',
    cruiseStarred: cruiseStarred(bundle, settings, stars),
    events: buildEvents(bundle, settings, stars, dayIndex, sailDays),
    alarms: buildAlarms(bundle, settings, stars, now, testAt),
    reminderLead: [5, 15, 30].indexOf(settings.reminderLead) !== -1 ? settings.reminderLead : 15,
    theme: settings.theme === 'dark' ? 1 : 0,
    showFeatured: settings.showFeatured === false ? 0 : 1,
    info: {
      // Guarantee bookings list "GTY" until a cabin is assigned.
      stateroom: me.stateroom || (/[0-9]/.test(mine.stateroom || '') ? mine.stateroom : '-'),
      deck: me.deck || '',
      stairs: me.stairs || '',
      muster: me.muster || 'Not set',
      clockNote: me.clockNote || 'Ship time not confirmed',
      lastSync: formatSync(bundle.generated)
    }
  };
}

module.exports = {
  DAY_START: DAY_START,
  NO_TIME: NO_TIME,
  DAY_PORT: DAY_PORT,
  DAY_SEA: DAY_SEA,
  DAY_NONE: DAY_NONE,
  FLAG_STARRED: FLAG_STARRED,
  FLAG_FEATURED: FLAG_FEATURED,
  FLAG_RESERVATION: FLAG_RESERVATION,
  FLAG_PERSONAL: FLAG_PERSONAL,
  FLAG_LAST_CHANCE: FLAG_LAST_CHANCE,
  FLAG_ONLY_SHOW: FLAG_ONLY_SHOW,
  FLAG_RESERVED: FLAG_RESERVED,
  ALARM_ALL_ABOARD: ALARM_ALL_ABOARD,
  ALARM_REMINDER: ALARM_REMINDER,
  ALARM_TO_RESERVE: ALARM_TO_RESERVE,
  RESERVE_ALERT_TIMES: RESERVE_ALERT_TIMES,
  RESERVE_ALERT_DEFAULT: RESERVE_ALERT_DEFAULT,
  reserveAlertAt: reserveAlertAt,
  NOTICE_MOVED: NOTICE_MOVED,
  NOTICE_CANCELLED: NOTICE_CANCELLED,
  NOTICE_CHECK: NOTICE_CHECK,
  FINAL_LAST_CHANCE: FINAL_LAST_CHANCE,
  FINAL_ONLY_SHOW: FINAL_ONLY_SHOW,
  finalShows: finalShows,
  buildTomorrow: buildTomorrow,
  buildEvents: buildEvents,
  buildAlarms: buildAlarms,
  reconcileStars: reconcileStars,
  buildNotices: buildNotices,
  cleanDaySettings: cleanDaySettings,
  cleanHiddenCats: cleanHiddenCats,
  cleanPersonal: cleanPersonal,
  applyStarChanges: applyStarChanges,
  applyWatchStarChanges: applyWatchStarChanges,
  pruneStarTimes: pruneStarTimes,
  categorySummary: categorySummary,
  hiddenCats: hiddenCats,
  defaultBuffer: defaultBuffer,
  daysFromCivil: daysFromCivil,
  civilFromDays: civilFromDays,
  isoFromDays: isoFromDays,
  daysFromIso: daysFromIso,
  cruiseMinutes: cruiseMinutes,
  cruiseDayIndex: cruiseDayIndex,
  shortPort: shortPort,
  starKey: starKey,
  reservedKey: reservedKey,
  isReservedKey: isReservedKey,
  notReserved: notReserved,
  formatSync: formatSync,
  cutoffWhen: cutoffWhen,
  buildSlice: buildSlice
};
