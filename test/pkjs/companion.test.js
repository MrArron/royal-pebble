// The phone companion (src/pkjs/index.js) run against a fake Pebble and phone
// storage: what it records in the usage log. Run: node test/pkjs/companion.test.js
// Made-up data only.
var assert = require('assert');
var path = require('path');

var tests = [];
function test(name, fn) { tests.push({name: name, fn: fn}); }

// A fresh companion: {handlers, store, sent, opened, flushTimers()}.
function companion(initial) {
  var store = {};
  Object.keys(initial || {}).forEach(function(k) { store[k] = initial[k]; });
  var timers = [];
  var c = {store: store, sent: [], opened: [], handlers: {}};
  global.localStorage = {
    getItem: function(k) { return k in store ? store[k] : null; },
    setItem: function(k, v) { store[k] = String(v); },
    removeItem: function(k) { delete store[k]; }
  };
  global.setTimeout = function(fn) { timers.push(fn); };
  global.Pebble = {
    addEventListener: function(n, f) { c.handlers[n] = f; },
    sendAppMessage: function(m, ok) { c.sent.push(m); ok(); },
    openURL: function(u) { c.opened.push(u); },
    getActiveWatchInfo: function() {
      return {model: 'pebble_time_2', platform: 'emery', firmware: {major: 4, minor: 9, patch: 0, suffix: ''}};
    }
  };
  var dir = path.join(__dirname, '../../src/pkjs/');
  Object.keys(require.cache).forEach(function(k) {
    if (k.indexOf(dir) === 0) {
      delete require.cache[k];
    }
  });
  require('../../src/pkjs/index');
  c.run = function() {
    while (timers.length) {
      timers.shift()();
    }
  };
  c.log = function() {
    c.run();
    var saved = JSON.parse(store.usageLog || '{"entries":[]}');
    return saved.entries.map(function(e) { return e[3] + '  ' + e[4]; });
  };
  return c;
}

function has(lines, re) {
  return lines.some(function(l) { return re.test(l); });
}

test('start-up and a watch sync are logged with the watch and the send', function() {
  var c = companion();
  c.handlers.ready();
  c.handlers.appmessage({payload: {msg_type: 10}});
  var lines = c.log();
  assert.ok(has(lines, /^phone  companion started .*watch pebble_time_2 firmware 4\.9\.0/), lines.join('\n'));
  assert.ok(has(lines, /^sync  watch asked for data$/));
  assert.ok(has(lines, /^slice  demo \d+, day -?\d+, \d+ events, \d+ alerts, \d+ messages, built in \d+ ms, sent in \d+ ms, about \d+ bytes$/),
            lines.join('\n'));
});

test('the watch storage report is logged only when it changes', function() {
  var c = companion();
  var report = {msg_type: 14, saved_cutoff: -1, saved_bytes: 193, saved_max: 1048576};
  c.handlers.appmessage({payload: report});
  c.handlers.appmessage({payload: report});
  report.saved_bytes = 4314;
  c.handlers.appmessage({payload: report});
  var lines = c.log().filter(function(l) { return /^watch  storage/.test(l); });
  assert.deepStrictEqual(lines, ['watch  storage: schedule uses 193 of 1048576 bytes',
                                 'watch  storage: schedule uses 4314 of 1048576 bytes']);
});

test('watch log entries are added at the watch time, and a full queue is reported', function() {
  var pack = require('../../src/pkjs/pack');
  var c = companion();
  var at = Math.floor(Date.now() / 1000) - 3600;
  var bytes = pack.encodeLogEntry({at: at, code: 4, x: 1, a: 1, b: -1, c: 5})
    .concat(pack.encodeLogEntry({at: at + 5, code: 11, x: 0, a: 0, b: 0, c: 0}));
  c.handlers.appmessage({payload: {msg_type: 18, log_entries: bytes, log_dropped: 3}});
  c.run();
  var saved = JSON.parse(c.store.usageLog).entries;
  var button = saved.filter(function(e) { return e[3] === 'button'; })[0];
  assert.strictEqual(button[0], at * 1000);
  assert.strictEqual(button[4], 'Up on Home (NEXT)');
  var lines = c.log();
  assert.ok(has(lines, /^connection  watch: phone connection lost$/), lines.join('\n'));
  assert.ok(has(lines, /^error  watch log queue was full: 3 oldest entries lost$/), lines.join('\n'));
});

test('settings page: opened, closed, setting changes and log settings', function() {
  var c = companion();
  c.handlers.showConfiguration();
  assert.strictEqual(c.opened.length, 1);
  var result = {action: 'save', theme: 'dark', reminderLead: 30, reserveAlertAt: 1200, units: 'ft',
                me: {stateroom: '1234', deck: '', stairs: '', muster: '', clockNote: ''},
                usage: {on: true, label: 'Test watch', clear: false}};
  c.handlers.webviewclosed({response: encodeURIComponent(JSON.stringify(result))});
  var lines = c.log();
  assert.ok(has(lines, /^settings  page opened: \d+ KB URL, built in \d+ ms, log \d+ of \d+ entries shown$/), lines.join('\n'));
  assert.ok(has(lines, /^settings  page closed: save, result 0 KB$/));
  assert.ok(has(lines, /^log  device label: "" -> "Test watch"$/));
  assert.ok(has(lines, /^setting  theme: \(none\) -> "dark"$/), lines.join('\n'));
  assert.ok(has(lines, /^setting  me\.stateroom: \(none\) -> "1234"$/));
  assert.ok(has(lines, /^setting  reminderLead: \(none\) -> 30$/));
  assert.strictEqual(JSON.parse(c.store.settingsPage).pending, false);

  // The next page carries the log and the header with the label.
  c.handlers.showConfiguration();
  var html = decodeURIComponent(c.opened[1].slice('data:text/html;charset=utf-8,'.length));
  assert.ok(html.indexOf('Royal Pebble usage log') !== -1);
  assert.ok(html.indexOf('Device: Test watch') !== -1);
  assert.ok(html.indexOf('setting  theme: (none) -> \\"dark\\"') !== -1);
});

test('backing out saves nothing and is logged; turning the log off stops it', function() {
  var c = companion();
  c.handlers.showConfiguration();
  c.handlers.webviewclosed({response: ''});
  assert.ok(has(c.log(), /^settings  page closed without saving$/));
  c.handlers.webviewclosed({response: encodeURIComponent(JSON.stringify({action: 'save', usage: {on: false}}))});
  var n = c.log().length;
  c.handlers.appmessage({payload: {msg_type: 10}});
  var lines = c.log();
  assert.strictEqual(lines.length, n, 'nothing added while off');
  assert.strictEqual(lines[lines.length - 1], 'log  turned off');
});

test('a big page that never came back makes the next one smaller', function() {
  // A full log, and a last page of 1.5 MB that returned nothing.
  var entries = [];
  var t = Date.now() - 86400000;
  for (var i = 0; i < 4000; i++) {
    entries.push([t + i * 1000, null, null, 'pad', 'entry ' + i + ' ' + new Array(150).join('y')]);
  }
  var c = companion({
    usageLog: JSON.stringify({on: true, label: '', entries: entries, dropped: 0}),
    settingsPage: JSON.stringify({pending: true, urlKB: 1500, shrink: 0})
  });
  c.handlers.showConfiguration();
  var url = c.opened[0];
  assert.ok(url.length <= 900 * 1024, 'kept under half the limit: ' + Math.round(url.length / 1024) + ' KB');
  var lines = c.log();
  assert.ok(has(lines, /^error  last settings page \(1500 KB\) returned nothing; this one is kept under 900 KB$/));
  var opened = lines.filter(function(l) { return /^settings  page opened/.test(l); })[0];
  var m = /log (\d+) of (\d+) entries shown/.exec(opened);
  assert.ok(+m[1] > 0 && +m[1] < +m[2], opened);
  var html = decodeURIComponent(url.slice('data:text/html;charset=utf-8,'.length));
  assert.ok(html.indexOf('entry 3999 ') !== -1, 'newest kept');
  assert.strictEqual(html.indexOf('entry 0 '), -1, 'oldest left out');
  assert.strictEqual(JSON.parse(c.store.settingsPage).shrink, 1);
});

test('script errors in a handler are logged, then thrown', function() {
  var c = companion();
  global.Pebble.openURL = function() { throw new Error('boom'); };
  assert.throws(function() { c.handlers.showConfiguration(); }, /boom/);
  assert.ok(has(c.log(), /^error  showConfiguration: boom$/));
});

var failed = 0;
tests.forEach(function(t) {
  try {
    t.fn();
    console.log('ok   ' + t.name);
  } catch (e) {
    failed++;
    console.log('FAIL ' + t.name + '\n     ' + (e.stack || e));
  }
});
console.log(tests.length - failed + '/' + tests.length + ' passed');
process.exit(failed ? 1 : 0);
