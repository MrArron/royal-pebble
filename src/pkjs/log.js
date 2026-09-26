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
  function add(kind, detail) {
    var st = state();
    if (!st.on) {
      return;
    }
    var ms = nowMs();
    var when = stamp(ms);
    var e = [ms, when[0], when[1], cleanText(kind) || 'note', cleanText(detail)];
    st.entries.push(e);
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
  renderEntry: renderEntry,
  encodedLength: encodedLength,
  header: header,
  diffSettings: diffSettings
};
