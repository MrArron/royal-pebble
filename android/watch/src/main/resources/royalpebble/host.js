// The host src/pkjs/index.js runs in inside the Android app's QuickJS: what
// PebbleKit JS gives it on the phone (Pebble, localStorage, setTimeout,
// console, navigator), backed by the app (android/watch WatchServer.kt).
//
// Everything crosses the boundary as JSON text. The app calls __host.*, and
// after every call takes __host.take(): the messages index.js wants sent, the
// storage keys it changed and its timers. It sends one message at a time and
// reports the result with __host.sent(id, ok), as the Pebble app does with
// sendAppMessage's callbacks. Plain ES5, like src/pkjs.
(function(g) {
  'use strict';
  var has = Object.prototype.hasOwnProperty;
  var store = {};     // localStorage: key -> text
  var dirty = {};     // keys changed since the last take(): key -> text, or null when removed
  var handlers = {};  // Pebble.addEventListener
  var out = [];       // [{id, msg}] waiting to be sent, oldest first
  var callbacks = {}; // id -> {ok, err}
  var timers = {};    // id -> {fn, at}
  var nextId = 1;
  var watch = null;   // Pebble.getActiveWatchInfo()
  var logs = null;    // console output, only while the app asks for it
  var RealDate = g.Date;
  var pinned = null;  // tests: Date.now() and new Date() give this time (ms)

  function now() {
    return pinned === null ? RealDate.now() : pinned;
  }

  // A test clock, like test/pkjs/companion.test.js: new Date() and Date.now()
  // give the pinned time; every other use of Date is the real one.
  function PinnedDate() {
    var args = Array.prototype.slice.call(arguments);
    if (!(this instanceof PinnedDate)) {
      return new RealDate(now()).toString();
    }
    if (!args.length) {
      args = [now()];
    }
    return new (Function.prototype.bind.apply(RealDate, [null].concat(args)))();
  }
  PinnedDate.prototype = RealDate.prototype;
  PinnedDate.now = function() { return now(); };
  PinnedDate.UTC = RealDate.UTC;
  PinnedDate.parse = RealDate.parse;

  g.localStorage = {
    getItem: function(k) {
      k = String(k);
      return has.call(store, k) ? store[k] : null;
    },
    setItem: function(k, v) {
      k = String(k);
      store[k] = String(v);
      dirty[k] = store[k];
    },
    removeItem: function(k) {
      k = String(k);
      if (has.call(store, k)) {
        delete store[k];
        dirty[k] = null;
      }
    },
    clear: function() {
      Object.keys(store).forEach(function(k) { dirty[k] = null; });
      store = {};
    }
  };

  g.setTimeout = function(fn, ms) {
    var id = nextId++;
    timers[id] = {fn: fn, at: now() + Math.max(0, +ms || 0)};
    return id;
  };
  g.clearTimeout = function(id) {
    delete timers[id];
  };

  function text(args) {
    return Array.prototype.map.call(args, function(a) {
      return typeof a === 'string' ? a : JSON.stringify(a);
    }).join(' ');
  }
  g.console = {
    log: function() { if (logs) { logs.push(text(arguments)); } },
    warn: function() { if (logs) { logs.push(text(arguments)); } },
    error: function() { if (logs) { logs.push(text(arguments)); } }
  };

  g.navigator = {userAgent: 'Royal Pebble Android app'};

  g.Pebble = {
    addEventListener: function(name, fn) {
      handlers[name] = fn;
    },
    sendAppMessage: function(msg, ok, err) {
      var id = nextId++;
      out.push({id: id, msg: msg});
      callbacks[id] = {ok: ok, err: err};
      return id;
    },
    // The settings page isn't opened from here (the app has its own screens).
    openURL: function() {},
    getActiveWatchInfo: function() {
      return watch;
    }
  };

  g.__host = {
    // Marks index.js as running in the Android app (index.js SIDE).
    android: true,
    // What the app tells index.js about itself, for the usage log (index.js
    // hostInfo): {version, commit, serves, wireLog}, or null.
    info: null,
    setInfo: function(json) {
      g.__host.info = json ? JSON.parse(json) : null;
    },

    // Replaces the whole storage with {key: text} (JSON text of an object).
    load: function(json) {
      store = JSON.parse(json);
      dirty = {};
    },
    // One key changed outside the engine (a download, a settings screen): text or null.
    put: function(key, value) {
      if (value === null) {
        delete store[key];
      } else {
        store[key] = String(value);
      }
    },
    setWatch: function(json) {
      watch = json ? JSON.parse(json) : null;
    },
    setClock: function(ms) {
      pinned = ms === null ? null : +ms;
      g.Date = pinned === null ? RealDate : PinnedDate;
    },
    setConsole: function(on) {
      logs = on ? [] : null;
    },
    // A PebbleKit JS event: 'ready', or 'appmessage' with the payload's JSON text.
    event: function(name, payloadJson) {
      var fn = handlers[name];
      if (fn) {
        fn(payloadJson ? {payload: JSON.parse(payloadJson)} : {});
      }
    },
    // The result of sending message `id`: what sendAppMessage's callbacks get.
    sent: function(id, ok, errJson) {
      var cb = callbacks[id];
      delete callbacks[id];
      if (!cb) {
        return;
      }
      if (ok) {
        if (cb.ok) { cb.ok({data: {}}); }
      } else if (cb.err) {
        cb.err(errJson ? JSON.parse(errJson) : {data: {}, error: {message: 'not sent'}});
      }
    },
    // Runs timer `id` when it's due (the app keeps the clock).
    fire: function(id) {
      var t = timers[id];
      delete timers[id];
      if (t) {
        t.fn();
      }
    },
    // What happened since the last take: {out: [{id, msg}], dirty: {key: text|null},
    // timers: [{id, at}] (all pending, earliest first), logs: [text]}.
    take: function() {
      var r = {
        out: out,
        dirty: dirty,
        timers: Object.keys(timers).map(function(id) { return {id: +id, at: timers[id].at}; })
          .sort(function(a, b) { return a.at - b.at || a.id - b.id; }),
        logs: logs || []
      };
      out = [];
      dirty = {};
      if (logs) {
        logs = [];
      }
      return JSON.stringify(r);
    }
  };
})(globalThis);
