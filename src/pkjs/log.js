// Usage log (docs/PROJECT_BRIEF.md, "Usage log"): how Royal Pebble is used on
// this phone and watch, kept in the phone companion's storage and copied out
// from the settings page's Me tab. Fully offline. Personal cruise data: never
// commit a log or quotes from it.
//
// Entries are stored as [ms, cruise day index, minute of that cruise day, kind,
// detail] and rendered only when copied:
//   2026-09-26 14:03:12  D3 14:03  setting  theme: light -> dark
// The day and minute follow the time model in docs/WATCH_PROTOCOL.md (the day
// starts at 04:00, so 00:30 still belongs to the evening before); both are null
// with no cruise saved. Day index 0 (sail day) shows as D1, days before sailing
// as D-1, D-2...
//
// Map notes (Map check, PR 3) live beside the log in their own list: they never
// drop off and Clear log leaves them alone.

var slice = require('./slice');

// Kept in step with package.json's version (test/pkjs/log.test.js checks).
var APP_VERSION = '0.1.0';

var STORE_LOG = 'usageLog';     // {on, label, entries, chars, dropped}
var STORE_NOTES = 'mapNotes';   // [{ms, ...note}]

// Log text kept (rendered line lengths), oldest entries dropped first. The phone
// script's storage holds about 5 M characters for everything (probe, 2026-09-26).
var CAP_CHARS = 768 * 1024;
// Largest part the settings page copies at once: the Pebble app's WebView copied
// 512 KB and failed at 1 MB (probe, 2026-09-26).
var PART_CHARS = 384 * 1024;
var DETAIL_MAX = 400;

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

function cleanText(s) {
  s = String(s === undefined || s === null ? '' : s).replace(/\s+/g, ' ').trim();
  return s.length > DETAIL_MAX ? s.slice(0, DETAIL_MAX - 3) + '...' : s;
}

function dayText(day) {
  if (day === null || day === undefined) {
    return '--';
  }
  return 'D' + (day >= 0 ? day + 1 : day);
}

// One entry as a line of text (no line break). Its length doesn't depend on
// the time zone it's rendered in, so the cap can count it when it's added.
function renderEntry(e) {
  var d = new Date(e[0]);
  var stamp = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
    pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  var ship = e[2] === null || e[2] === undefined ? '--:--' :
    pad2(Math.floor(e[2] / 60) % 24) + ':' + pad2(e[2] % 60);
  return stamp + '  ' + dayText(e[1]) + ' ' + ship + '  ' + e[3] + '  ' + e[4];
}

// `storage` is localStorage (or a test stand-in). `opts.sailDate()` returns the
// saved cruise's sail date (ISO) or null; `opts.now()` the time in ms;
// `opts.defer(fn)` runs a save later (setTimeout), so a burst of entries is
// saved once.
function makeLog(storage, opts) {
  opts = opts || {};
  var nowMs = opts.now || function() { return Date.now(); };
  var sailDate = opts.sailDate || function() { return null; };
  var defer = opts.defer || function(fn) { setTimeout(fn, 0); };
  var s = null;
  var saveQueued = false;

  function read(key, fallback) {
    try {
      var text = storage.getItem(key);
      return text ? JSON.parse(text) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function state() {
    if (!s) {
      s = read(STORE_LOG, null) || {};
      s.on = s.on !== false;
      s.label = typeof s.label === 'string' ? s.label : '';
      s.entries = Array.isArray(s.entries) ? s.entries : [];
      s.dropped = s.dropped || 0;
      s.chars = 0;
      s.entries.forEach(function(e) { s.chars += renderEntry(e).length + 1; });
    }
    return s;
  }

  function trim(max) {
    var st = state();
    while (st.chars > max && st.entries.length) {
      st.chars -= renderEntry(st.entries.shift()).length + 1;
      st.dropped++;
    }
  }

  // Writes the log now. When storage is full, drops the oldest quarter of the
  // log until it fits: the rest of the app's data matters more than old entries.
  function flush() {
    saveQueued = false;
    var st = state();
    for (;;) {
      try {
        storage.setItem(STORE_LOG, JSON.stringify(st));
        return;
      } catch (e) {
        if (!st.entries.length) {
          console.log('Usage log: could not save (' + e + ')');
          return;
        }
        trim(Math.floor(st.chars * 3 / 4));
      }
    }
  }

  function queueSave() {
    if (!saveQueued) {
      saveQueued = true;
      defer(flush);
    }
  }

  function stamp(ms) {
    var iso = sailDate();
    if (!iso) {
      return [null, null];
    }
    var cm = slice.cruiseMinutes(slice.daysFromIso(iso), new Date(ms));
    var day = slice.cruiseDayIndex(cm);
    return [day, cm - day * 1440];
  }

  // Adds an entry when logging is on. `kind` is one word; `detail` free text.
  // `ms` (optional) is when it happened, for the watch's entries: they can
  // arrive late and go in time order.
  function add(kind, detail, ms) {
    var st = state();
    if (!st.on) {
      return;
    }
    ms = typeof ms === 'number' ? ms : nowMs();
    var when = stamp(ms);
    var e = [ms, when[0], when[1], cleanText(kind) || 'note', cleanText(detail)];
    var i = st.entries.length;
    while (i > 0 && st.entries[i - 1][0] > ms) {
      i--;
    }
    st.entries.splice(i, 0, e);
    st.chars += renderEntry(e).length + 1;
    trim(CAP_CHARS);
    queueSave();
  }

  // Settings page result: {on, label, clear}. Returns what changed, for the log.
  function applySettings(r) {
    if (!r || typeof r !== 'object') {
      return;
    }
    var st = state();
    if (r.clear) {
      var n = st.entries.length;
      st.entries = [];
      st.chars = 0;
      st.dropped = 0;
      // Recorded even when logging was just turned off, so a gap is explained.
      var was = st.on;
      st.on = true;
      add('log', 'cleared (' + n + ' entries)');
      st.on = was;
    }
    if (typeof r.label === 'string' && cleanText(r.label).slice(0, 40) !== st.label) {
      var label = cleanText(r.label).slice(0, 40);
      add('log', 'device label: "' + st.label + '" -> "' + label + '"');
      st.label = label;
    }
    if (typeof r.on === 'boolean' && r.on !== st.on) {
      if (r.on) {
        st.on = true;
        add('log', 'turned on');
      } else {
        add('log', 'turned off');
        st.on = false;
      }
    }
    queueSave();
  }

  // For the settings page: counts and the log text, newest entries last. With
  // `maxEncoded`, keeps only the newest lines whose text fits in that many
  // characters once embedded in the page URL (JSON, then URI encoding).
  function pageState(header, maxEncoded) {
    var st = state();
    var lines = st.entries.map(renderEntry);
    var shown = lines.length;
    if (maxEncoded !== undefined) {
      var used = 0;
      shown = 0;
      for (var i = lines.length - 1; i >= 0; i--) {
        used += encodedLength(lines[i] + '\n');
        if (used > maxEncoded) {
          break;
        }
        shown++;
      }
    }
    return {
      on: st.on,
      label: st.label,
      count: st.entries.length,
      chars: st.chars,
      dropped: st.dropped,
      since: st.entries.length ? st.entries[0][0] : null,
      header: header,
      shown: shown,
      text: lines.slice(lines.length - shown).join('\n')
    };
  }

  function addMapNote(note) {
    var list = read(STORE_NOTES, []);
    var n = {ms: nowMs()};
    Object.keys(note || {}).forEach(function(k) { n[k] = note[k]; });
    list.push(n);
    storage.setItem(STORE_NOTES, JSON.stringify(list));
  }

  return {
    add: add,
    flush: flush,
    applySettings: applySettings,
    pageState: pageState,
    isOn: function() { return state().on; },
    label: function() { return state().label; },
    count: function() { return state().entries.length; },
    chars: function() { return state().chars; },
    mapNotes: function() { return read(STORE_NOTES, []); },
    addMapNote: addMapNote,
    clearMapNotes: function() { storage.setItem(STORE_NOTES, '[]'); }
  };
}

// Characters `text` adds to the page URL: JSON escaping inside the page's state,
// then encodeURIComponent.
function encodedLength(text) {
  return encodeURIComponent(JSON.stringify(text)).length - 6;  // less the quotes (%22 each)
}

// ---- The watch's entries (docs/WATCH_PROTOCOL.md, Usage log) -------------

var SCREENS = ['', 'Home', 'Summary card', 'Today', 'Event details', 'My info', 'Ship directory',
               'Route to place', 'Route to restroom', 'Route to next event', 'Alert', 'Notice'];
var HOME_CARDS = ['loading or no phone', 'days to sail', 'connect your phone', 'no cruise today',
                  'all-aboard countdown', 'NEXT', 'FEATURED', 'NOW', 'nothing starred today'];
var BUTTONS = ['Back', 'Up', 'Select', 'Down'];
var LAUNCH = ['by the system', 'by you', 'by the phone', 'by an alert', 'by the worker', 'by quick launch',
              'from a timeline pin', 'by a smartstrap'];
var ALERT_KINDS = ['all-aboard warning', 'reminder', 'to-reserve alert'];
var STORES = ['schedule', 'star queue', 'usage log', 'other'];
var MSG_TYPES = {10: 'REQUEST', 12: 'DEMO_NEXT', 13: 'STAR_CHANGES', 14: 'SAVED', 15: 'DIR_REQUEST',
                 16: 'ROUTE_REQUEST', 18: 'LOG'};
var APP_MSG = {2: 'SEND_TIMEOUT', 4: 'SEND_REJECTED', 8: 'NOT_CONNECTED', 16: 'APP_NOT_RUNNING',
               32: 'INVALID_ARGS', 64: 'BUSY', 128: 'BUFFER_OVERFLOW', 512: 'ALREADY_RELEASED',
               4096: 'OUT_OF_MEMORY', 8192: 'CLOSED', 16384: 'INTERNAL_ERROR', 32768: 'INVALID_STATE'};
var STATUS = {'-1': 'E_ERROR', '-2': 'E_UNKNOWN', '-3': 'E_INTERNAL', '-4': 'E_INVALID_ARGUMENT',
              '-5': 'E_OUT_OF_MEMORY', '-6': 'E_OUT_OF_STORAGE', '-7': 'E_OUT_OF_RESOURCES', '-8': 'E_RANGE',
              '-9': 'E_DOES_NOT_EXIST', '-10': 'E_INVALID_OPERATION', '-11': 'E_BUSY', '-12': 'E_AGAIN'};

function named(table, v) {
  var n = table[v];
  return n ? n + ' (' + v + ')' : String(v);
}

function kb(bytes) {
  return (Math.round(bytes / 102.4) / 10) + ' KB';
}

function seconds(s) {
  if (s < 60) {
    return s + ' s';
  }
  if (s < 3600) {
    return Math.floor(s / 60) + ' min ' + (s % 60) + ' s';
  }
  return Math.floor(s / 3600) + ' h ' + Math.floor(s / 60) % 60 + ' min';
}

function battery(v) {
  return 'battery ' + (v & 255) + '%' + (v & 256 ? ' charging' : v & 512 ? ' plugged in' : '');
}

// Cruise minutes as "D3 14:15" (the log's own day and time) when the sail
// date (ISO) is known.
function cruiseText(cm, sailIso) {
  if (cm === -1) {
    return 'none';
  }
  if (!sailIso) {
    return 'cruise minute ' + cm;
  }
  var day = slice.cruiseDayIndex(cm);
  var min = cm - day * 1440;
  return dayText(day) + ' ' + pad2(Math.floor(min / 60) % 24) + ':' + pad2(min % 60);
}

function screenText(screen, detail, sailIso) {
  var name = SCREENS[screen] || 'screen ' + screen;
  switch (screen) {
    case 1: return name + ' (' + (HOME_CARDS[detail] || 'card ' + detail) + ')';
    case 2: return name + (detail ? ' (tomorrow)' : ' (today)');
    case 4: case 9: return name + ' (' + cruiseText(detail, sailIso) + ')';
    case 6: case 7: case 8: return name + ' page ' + detail;
    case 10: return name + ' (at ' + cruiseText(detail, sailIso) + ')';
    case 11: return name + ' (' + detail + ')';
    default: return name;
  }
}

// One watch entry ({at, code, x, a, b, c}) as {kind, detail}. `sailIso` is the
// sail date the watch's cruise minutes count from.
function watchEntry(e, sailIso) {
  var x = e.x, a = e.a, b = e.b, c = e.c;
  switch (e.code) {
    case 1:
      return {kind: 'open', detail: 'opened ' + (LAUNCH[x] || 'launch reason ' + x) + ', ' + battery(a) + ', ' +
              (c & 1 ? 'phone connected' : 'phone away') + (c & 2 ? ', schedule from watch storage' : '') +
              ', ' + kb(b) + ' free'};
    case 2:
      return {kind: 'close', detail: 'closed after ' + seconds(b) + ', ' + battery(a) +
              ', lowest free memory ' + kb(c)};
    case 3:
      return {kind: 'screen', detail: screenText(x, c, sailIso) + ': ' + seconds(b) +
              (a ? ', ' + a + (a === 1 ? ' scroll' : ' scrolls') : '')};
    case 4:
      return {kind: 'button', detail: (BUTTONS[a & 15] || 'button ' + (a & 15)) + (a & 16 ? ' (long)' : '') +
              ' on ' + screenText(x, c, sailIso) + (b >= 0 ? ', row ' + b : '') + (a & 32 ? ', did nothing' : '')};
    case 5:
      return {kind: 'alert', detail: x ? x + ' wakeups scheduled from ' + a + ' alerts, ' + cruiseText(b, sailIso) +
              ' to ' + cruiseText(c, sailIso) : 'no wakeups scheduled (' + a + ' alerts)'};
    case 6:
      return {kind: 'alert', detail: (ALERT_KINDS[x] || (x === 255 ? 'alert not in the plan' : 'alert kind ' + x)) +
              ' at ' + cruiseText(b, sailIso) + ' fired ' + (a < 0 ? -a + ' s early' : a + ' s late') +
              (c ? ', opened the app' : ', app was open')};
    case 7:
      return {kind: 'alert', detail: 'alert at ' + cruiseText(b, sailIso) + ' closed with ' +
              (x ? 'Select' : 'Back') + ' after ' + seconds(a)};
    case 8:
      return {kind: 'alert', detail: x + (x === 1 ? ' alert time' : ' alert times') +
              ' missed while the app was closed: ' + cruiseText(b, sailIso) +
              (c !== b ? ' to ' + cruiseText(c, sailIso) : '')};
    case 9:
      return {kind: 'error', detail: 'wakeup for ' + cruiseText(b, sailIso) + ' not scheduled: ' + named(STATUS, a)};
    case 10:
      return {kind: 'battery', detail: battery(a)};
    case 11:
      return {kind: 'connection', detail: x ? 'watch: phone connected' : 'watch: phone connection lost'};
    case 12:
      return {kind: 'error', detail: x === 1 ? 'phone message dropped on the watch: ' + named(APP_MSG, a) :
              'watch message ' + named(MSG_TYPES, b) + (x === 2 ? ' not sent, outbox busy' :
                                                       ' not delivered: ' + named(APP_MSG, a))};
    case 13:
      return {kind: 'error', detail: 'watch storage write failed (' + (STORES[x] || x) + ', key ' + b + '): ' +
              named(STATUS, a)};
    default:
      return {kind: 'watch', detail: 'entry ' + e.code + ': ' + [x, a, b, c].join(' ')};
  }
}

// The export header. `info`: {bundle, watch (Pebble.getActiveWatchInfo()),
// phone (text), label, count, dropped, now (Date)}.
function header(info) {
  var b = info.bundle;
  var w = info.watch;
  var fw = w && w.firmware ? w.firmware.major + '.' + w.firmware.minor + '.' + w.firmware.patch +
    (w.firmware.suffix ? '-' + w.firmware.suffix : '') : 'unknown';
  var off = -(info.now || new Date()).getTimezoneOffset();
  var zone = 'UTC' + (off < 0 ? '-' : '+') + Math.floor(Math.abs(off) / 60) +
    (Math.abs(off) % 60 ? ':' + pad2(Math.abs(off) % 60) : '');
  return [
    'Royal Pebble usage log',
    'App ' + APP_VERSION + ', ' + (b ? 'bundle v' + (b.v || '?') + ' made ' + (b.generated || '?') +
      ', ship ' + ((b.ship && b.ship.code) || '?') + ', sails ' + b.sailDate : 'no cruise saved (demo)'),
    'Watch ' + ((w && (w.model || w.platform)) || 'unknown') + ', firmware ' + fw + '; phone ' + (info.phone || 'unknown'),
    'Device: ' + (info.label || '(no label)'),
    info.count + ' entries' + (info.dropped ? ', ' + info.dropped + ' oldest dropped when full' : '') +
      '; times on the phone clock, now ' + zone
  ].join('\n');
}

// "Android 17, Pixel 11 Pro XL, WebView Chrome 153.0.8010.36" from the phone
// script's user agent; anything else is kept, cut to 120 characters.
function phoneFromUa(ua) {
  ua = String(ua || '');
  var dev = /\(Linux; (Android [^;)]+); ([^;)]+?)(?: Build\/[^;)]*)?[;)]/.exec(ua);
  var chrome = /Chrome\/([\d.]+)/.exec(ua);
  if (!dev) {
    return ua ? ua.slice(0, 120) : 'unknown';
  }
  return dev[1] + ', ' + dev[2] + (chrome ? ', ' + (/; wv\)/.test(ua) ? 'WebView ' : '') + 'Chrome ' + chrome[1] : '');
}

// Settings that differ between two settings objects, as ["path: old -> new"],
// following nested objects (me.stateroom, days.2027-03-07.offset...).
function diffSettings(before, after) {
  var out = [];
  function show(v) {
    if (v === undefined) {
      return '(none)';
    }
    var t = JSON.stringify(v);
    return t.length > 120 ? t.slice(0, 117) + '...' : t;
  }
  function isObj(v) {
    return v && typeof v === 'object' && !Array.isArray(v);
  }
  function walk(a, b, path) {
    if (isObj(a) || isObj(b)) {
      var keys = {};
      Object.keys(isObj(a) ? a : {}).forEach(function(k) { keys[k] = 1; });
      Object.keys(isObj(b) ? b : {}).forEach(function(k) { keys[k] = 1; });
      Object.keys(keys).sort().forEach(function(k) {
        walk(isObj(a) ? a[k] : undefined, isObj(b) ? b[k] : undefined, path ? path + '.' + k : k);
      });
    } else if (JSON.stringify(a) !== JSON.stringify(b)) {
      out.push(path + ': ' + show(a) + ' -> ' + show(b));
    }
  }
  walk(before || {}, after || {}, '');
  return out;
}

module.exports = {
  APP_VERSION: APP_VERSION,
  CAP_CHARS: CAP_CHARS,
  PART_CHARS: PART_CHARS,
  STORE_LOG: STORE_LOG,
  STORE_NOTES: STORE_NOTES,
  makeLog: makeLog,
  watchEntry: watchEntry,
  renderEntry: renderEntry,
  encodedLength: encodedLength,
  header: header,
  phoneFromUa: phoneFromUa,
  diffSettings: diffSettings
};
