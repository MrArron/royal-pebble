// The byte-for-byte gate between the Android app and PebbleKit JS
// (docs/WATCH_PROTOCOL.md, Android companion app). For a scenario, prints
// {spec, node}: `spec` is a whole watch session (the phone's saved data, a
// pinned clock, what the watch sends), and `node` is what src/pkjs/index.js
// does with it in Node, with the real require: every message it sends and
// the storage it leaves. WatchServerSessionTest runs the same spec through
// the app's WatchServer in QuickJS and compares the two.
//
// The fake Pebble here mirrors android/watch/src/main/resources/royalpebble/host.js:
// sends are acked one at a time after the handler returns, then due timers fire.
// Made-up data only. Usage: node session.js demo|sailing
'use strict';
var path = require('path');
var SRC = path.join(__dirname, '../../../../../src/pkjs/');
var FIXTURES = path.join(__dirname, '../../../../../test/fixtures/');
var pack = require(SRC + 'pack');
var slice = require(SRC + 'slice');
var demo = require(SRC + 'demo');

var MSG = {REQUEST: 10, DEMO_NEXT: 12, STAR_CHANGES: 13, SAVED: 14, DIR_REQUEST: 15, ROUTE_REQUEST: 16,
           LOG: 18, VOICE: 19};

function local(y, mo, d, h, mi) {
  return new Date(y, mo - 1, d, h, mi).getTime();
}

// Royal's public Harmony schedule (test/fixtures) on a made-up 3-night itinerary.
function fixtureBundle() {
  return {
    format: 'cruise-watch', v: 1, generated: '2026-09-30T12:00:00Z',
    ship: {code: 'HM', name: 'Harmony of the Seas'},
    sailDate: '2026-09-30',
    itinerary: [
      {day: 1, date: '2026-09-30', port: 'Orlando (Port Canaveral), Fl', type: 'EMBARK', arrive: null, depart: '16:00'},
      {day: 2, date: '2026-10-01', port: 'Cruising', type: 'CRUISING', arrive: null, depart: null},
      {day: 3, date: '2026-10-02', port: 'Nassau, Bahamas', type: 'DOCKED', arrive: '08:00', depart: '17:00'},
      {day: 4, date: '2026-10-03', port: 'Orlando (Port Canaveral), Fl', type: 'DEBARK', arrive: '06:00', depart: null}
    ],
    schedule: JSON.parse(JSON.stringify(require(FIXTURES + 'expected-schedule.json')))
  };
}

// The watch names the sailing by its days-from-civil number (slice.js).
function sailDays(iso) {
  return slice.daysFromIso(iso);
}

// A star change as the watch queues it (src/c/stars.c) for one of `sl`'s events.
function starChange(seq, at, sailDate, ev, on) {
  return pack.encodeStarChange({seq: seq, at: Math.floor(at / 1000), sail: sailDays(sailDate), start: ev.start,
                                day: 0, on: on, title: ev.title, venue: ev.venue});
}

function common(steps, now, sailDate, sl) {
  var timed = sl.events.filter(function(e) { return e.start >= 0 && e.venue; });
  var ev = timed[0] || sl.events[0];
  steps.push({message: {msg_type: MSG.REQUEST}});
  steps.push({message: {msg_type: MSG.DIR_REQUEST, dir_ref: 0}});
  steps.push({message: {msg_type: MSG.DIR_REQUEST, dir_ref: 102}});
  steps.push({message: {msg_type: MSG.DIR_REQUEST, dir_ref: 1046}});
  steps.push({message: {msg_type: MSG.DIR_REQUEST, dir_ref: 1}});
  steps.push({message: {msg_type: MSG.ROUTE_REQUEST, dir_ref: 1046, route_rest: 0}});
  steps.push({message: {msg_type: MSG.ROUTE_REQUEST, dir_ref: 1046, route_rest: 3}});
  if (ev) {
    steps.push({message: {msg_type: MSG.ROUTE_REQUEST, route_start: ev.start, route_venue: ev.venue,
                          route_title: ev.title, route_rest: 0}});
  }
  steps.push({advance: 60000});
  steps.push({message: {msg_type: MSG.VOICE, voice_seq: 1, voice_text: 'how do I get to the theater', voice_state: 0}});
  steps.push({message: {msg_type: MSG.ROUTE_REQUEST, dir_ref: 0, route_rest: 2}});
  steps.push({message: {msg_type: MSG.VOICE, voice_seq: 2, voice_text: "I'm at the Windjammer", voice_state: 2}});
  steps.push({message: {msg_type: MSG.VOICE, voice_seq: 2}});
  steps.push({message: {msg_type: MSG.VOICE, voice_seq: 3, voice_text: 'where is the closest restroom', voice_state: 1}});
  steps.push({message: {msg_type: MSG.VOICE, voice_seq: 4, voice_text: 'what time is it in port', voice_state: 0}});
  if (ev) {
    steps.push({message: {msg_type: MSG.STAR_CHANGES, star_count: 2,
                          star_changes: starChange(7, now, sailDate, ev, true)
                            .concat(starChange(8, now, sailDate, {start: 600, title: 'No such event', venue: 'Nowhere'}, true))}});
  }
  steps.push({message: {msg_type: MSG.SAVED, saved_cutoff: -1, saved_bytes: 5120, saved_max: 16384}});
  steps.push({message: {msg_type: MSG.SAVED, saved_cutoff: 2000, saved_bytes: 16000, saved_max: 16384}});
  steps.push({message: {msg_type: MSG.LOG, log_dropped: 2,
                        log_entries: pack.encodeLogEntry({at: Math.floor(now / 1000), code: 4, x: 1, a: 1, b: -1, c: 5})
                          .concat(pack.encodeLogEntry({at: Math.floor(now / 1000) + 5, code: 11, x: 0, a: 0, b: 0, c: 0}))}});
  steps.push({advance: 3600 * 1000});
  steps.push({message: {msg_type: MSG.REQUEST}});
}

var SCENARIOS = {
  // No cruise saved: the demo cruise, then the next demo screen.
  demo: function() {
    var now = local(2027, 3, 7, 14, 5);
    var d = demo.make(new Date(now), 0);
    var sl = slice.buildSlice(d.bundle, d.settings, d.stars, new Date(now), null);
    var steps = [{ready: true}];
    common(steps, now, d.bundle.sailDate, sl);
    steps.push({message: {msg_type: MSG.DEMO_NEXT}});
    steps.push({message: {msg_type: MSG.DEMO_NEXT}});
    return {now: now, store: {}, steps: steps};
  },
  // A saved sailing with stars, settings and a made-up cabin, on the sea day.
  sailing: function() {
    var now = local(2026, 10, 1, 9, 30);
    var b = fixtureBundle();
    var stars = {};
    b.schedule.events.slice(0, 12).forEach(function(e) {
      stars[slice.starKey(e[0], e[3], e[4], b.schedule.venues[e[1]])] = true;
    });
    var settings = {reminderLead: 30, theme: 'dark', units: 'ft', alwaysHints: true,
                    me: {stateroom: '9999', muster: 'C2', dining: 'Main'}};
    var sl = slice.buildSlice(b, settings, stars, new Date(now), null);
    var steps = [{ready: true}];
    common(steps, now, b.sailDate, sl);
    steps.push({message: {msg_type: MSG.VOICE, voice_seq: 5, voice_text: 'take me to my cabin', voice_state: 0}});
    steps.push({message: {msg_type: MSG.ROUTE_REQUEST, dir_ref: 400, route_rest: 0}});
    steps.push({advance: 20 * 3600 * 1000});  // the next watch day
    steps.push({message: {msg_type: MSG.REQUEST}});
    return {now: now, store: {bundle: JSON.stringify(b), settings: JSON.stringify(settings), stars: JSON.stringify(stars)},
            steps: steps};
  }
};

// index.js in Node against a fake Pebble that behaves like host.js.
function runNode(spec) {
  var RealDate = global.Date;
  var clock = spec.now;
  global.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [clock]));
    }
    static now() { return clock; }
  };
  var store = {};
  Object.keys(spec.store).forEach(function(k) { store[k] = spec.store[k]; });
  var nextId = 1;
  var out = [];
  var timers = {};
  var handlers = {};
  var sent = [];
  global.localStorage = {
    getItem: function(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function(k, v) { store[k] = String(v); },
    removeItem: function(k) { delete store[k]; }
  };
  global.setTimeout = function(fn, ms) {
    var id = nextId++;
    timers[id] = {fn: fn, at: clock + Math.max(0, +ms || 0)};
    return id;
  };
  global.clearTimeout = function(id) { delete timers[id]; };
  global.Pebble = {
    addEventListener: function(n, f) { handlers[n] = f; },
    sendAppMessage: function(m, ok) { out.push({id: nextId++, msg: m, ok: ok}); },
    openURL: function() {},
    getActiveWatchInfo: function() { return spec.watch || null; }
  };
  var realLog = console.log;
  console.log = function() {};
  try {
    Object.keys(require.cache).forEach(function(k) {
      if (k.indexOf(SRC) === 0) {
        delete require.cache[k];
      }
    });
    require(SRC + 'index');
    function drain() {
      for (;;) {
        if (out.length) {
          var m = out.shift();
          // As the app sees it: what JSON.stringify keeps (QuickJS's take()).
          sent.push(JSON.parse(JSON.stringify(m.msg)));
          if (m.ok) { m.ok({data: {}}); }
          continue;
        }
        var due = Object.keys(timers).map(function(id) { return {id: +id, at: timers[id].at}; })
          .filter(function(t) { return t.at <= clock; })
          .sort(function(a, b) { return a.at - b.at || a.id - b.id; })[0];
        if (due) {
          var t = timers[due.id];
          delete timers[due.id];
          t.fn();
          continue;
        }
        break;
      }
    }
    drain();
    spec.steps.forEach(function(step) {
      if (step.ready) {
        handlers.ready({});
      } else if (step.message) {
        handlers.appmessage({payload: JSON.parse(JSON.stringify(step.message))});
      } else if (step.advance) {
        clock += step.advance;
      }
      drain();
    });
  } finally {
    console.log = realLog;
    global.Date = RealDate;
  }
  return {sent: sent, store: store};
}

var name = process.argv[2];
if (!SCENARIOS[name]) {
  console.error('usage: node session.js ' + Object.keys(SCENARIOS).join('|'));
  process.exit(2);
}
var spec = SCENARIOS[name]();
process.stdout.write(JSON.stringify({spec: spec, node: runNode(spec)}));
