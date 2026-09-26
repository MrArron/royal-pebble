// Unit tests for the usage log store. Run: node test/pkjs/log.test.js
// Made-up data only: no real cabin numbers or titles from a real log.
var assert = require('assert');
var log = require('../../src/pkjs/log');

var tests = [];
function test(name, fn) { tests.push({name: name, fn: fn}); }

function memStorage(quota) {
  var data = {};
  return {
    data: data,
    getItem: function(k) { return k in data ? data[k] : null; },
    setItem: function(k, v) {
      v = String(v);
      if (quota) {
        var used = 0;
        Object.keys(data).forEach(function(key) { if (key !== k) { used += data[key].length; } });
        if (used + v.length > quota) {
          throw new Error('QuotaExceededError');
        }
      }
      data[k] = v;
    },
    removeItem: function(k) { delete data[k]; }
  };
}

// A log on `storage` with a settable clock; saves only on flush().
function makeTestLog(storage, sailDate) {
  var clock = {ms: new Date(2027, 2, 7, 14, 3, 12).getTime()};
  var l = log.makeLog(storage, {
    now: function() { return clock.ms; },
    sailDate: function() { return sailDate || null; },
    defer: function() {}
  });
  l.clock = clock;
  return l;
}

test('APP_VERSION matches package.json', function() {
  assert.strictEqual(log.APP_VERSION, require('../../package.json').version);
});

test('an entry renders with the timestamp, cruise day and ship time', function() {
  var l = makeTestLog(memStorage(), '2027-03-06');
  l.add('setting', 'theme: "light" -> "dark"');
  var p = l.pageState('HEADER');
  assert.strictEqual(p.count, 1);
  assert.strictEqual(p.text, '2027-03-07 14:03:12  D2 14:03  setting  theme: "light" -> "dark"');
  assert.strictEqual(p.chars, p.text.length + 1);
  assert.strictEqual(p.header, 'HEADER');
});

test('after midnight counts as the evening before (04:00 day boundary)', function() {
  var l = makeTestLog(memStorage(), '2027-03-06');
  l.clock.ms = new Date(2027, 2, 8, 0, 30, 0).getTime();
  l.add('open', 'late');
  l.clock.ms = new Date(2027, 2, 8, 4, 0, 0).getTime();
  l.add('open', 'morning');
  var lines = l.pageState('').text.split('\n');
  assert.strictEqual(lines[0], '2027-03-08 00:30:00  D2 00:30  open  late');
  assert.strictEqual(lines[1], '2027-03-08 04:00:00  D3 04:00  open  morning');
});

test('before sailing and with no cruise saved', function() {
  var l = makeTestLog(memStorage(), '2027-03-10');
  l.add('open', 'x');
  assert.ok(/  D-3 14:03  open  x$/.test(l.pageState('').text), l.pageState('').text);
  var none = makeTestLog(memStorage(), null);
  none.add('open', 'x');
  assert.ok(/  -- --:--  open  x$/.test(none.pageState('').text));
});

test('details are one line and capped', function() {
  var l = makeTestLog(memStorage());
  l.add('note', 'a\nb\t c  ' + new Array(600).join('z'));
  var line = l.pageState('').text;
  assert.ok(line.indexOf('\n') === -1);
  assert.ok(/  note  a b c zz/.test(line));
  assert.ok(/\.\.\.$/.test(line) && line.length < 460, line.length);
});

test('entries persist on flush and load back', function() {
  var st = memStorage();
  var l = makeTestLog(st, '2027-03-06');
  l.add('open', 'one');
  l.add('open', 'two');
  assert.strictEqual(st.getItem(log.STORE_LOG), null, 'not saved before flush');
  l.flush();
  var again = makeTestLog(st, '2027-03-06');
  assert.strictEqual(again.count(), 2);
  assert.strictEqual(again.chars(), l.chars());
});

test('a burst of entries is saved once', function() {
  var queued = [];
  var st = memStorage();
  var l = log.makeLog(st, {defer: function(fn) { queued.push(fn); }});
  l.add('a', '1');
  l.add('a', '2');
  l.add('a', '3');
  assert.strictEqual(queued.length, 1);
  queued[0]();
  assert.strictEqual(JSON.parse(st.getItem(log.STORE_LOG)).entries.length, 3);
});

test('the oldest entries drop first past the cap', function() {
  var l = makeTestLog(memStorage());
  var detail = new Array(300).join('x');
  var n = 0;
  while (n < 5000) {
    l.add('pad', n + ' ' + detail);
    n++;
  }
  var p = l.pageState('');
  assert.ok(p.chars <= log.CAP_CHARS, p.chars);
  assert.ok(p.chars > log.CAP_CHARS - 400);
  assert.strictEqual(p.count + p.dropped, 5000);
  assert.ok(p.text.split('\n')[0].indexOf('  pad  ' + p.dropped + ' ') !== -1, 'oldest kept is the next one');
});

test('off records nothing; turning off and on is logged', function() {
  var l = makeTestLog(memStorage());
  l.applySettings({on: false});
  l.add('open', 'hidden');
  l.applySettings({on: true});
  var lines = l.pageState('').text.split('\n');
  assert.deepStrictEqual(lines.map(function(s) { return s.split('  ').slice(2).join('  '); }),
                         ['log  turned off', 'log  turned on']);
});

test('clear empties the log but keeps map notes; label is saved', function() {
  var st = memStorage();
  var l = makeTestLog(st);
  l.add('open', 'x');
  l.add('open', 'y');
  l.addMapNote({place: 'Test Place', answer: 'app right'});
  l.applySettings({clear: true, label: '  Test   watch '});
  assert.strictEqual(l.count(), 2);  // "cleared" and the label change
  assert.ok(/log  cleared \(2 entries\)$/.test(l.pageState('').text.split('\n')[0]));
  assert.strictEqual(l.label(), 'Test watch');
  assert.strictEqual(l.mapNotes().length, 1);
  assert.strictEqual(l.mapNotes()[0].place, 'Test Place');
  l.flush();
  assert.strictEqual(makeTestLog(st).label(), 'Test watch');
});

test('map notes never drop when the log is full', function() {
  var l = makeTestLog(memStorage());
  for (var i = 0; i < 30; i++) {
    l.addMapNote({n: i});
  }
  for (i = 0; i < 4000; i++) {
    l.add('pad', new Array(300).join('x'));
  }
  assert.strictEqual(l.mapNotes().length, 30);
});

test('full storage drops old entries instead of failing', function() {
  var st = memStorage(200 * 1024);
  st.setItem('bundle', new Array(100 * 1024).join('b'));
  var l = makeTestLog(st);
  for (var i = 0; i < 1000; i++) {
    l.add('pad', i + ' ' + new Array(200).join('x'));
  }
  l.flush();
  var saved = JSON.parse(st.getItem(log.STORE_LOG));
  assert.ok(saved.entries.length > 0 && saved.entries.length < 1000);
  assert.strictEqual(st.getItem('bundle').length, 100 * 1024 - 1, 'other data untouched');
});

test('the page gets the newest entries that fit', function() {
  var l = makeTestLog(memStorage());
  for (var i = 0; i < 100; i++) {
    l.add('pad', 'entry ' + i + ' "quoted" 50%');
  }
  var all = l.pageState('');
  var one = log.encodedLength(all.text.split('\n')[99] + '\n');
  var p = l.pageState('', one * 10 + 5);
  assert.strictEqual(p.shown, 10);
  assert.strictEqual(p.count, 100);
  assert.ok(/entry 90 /.test(p.text.split('\n')[0]));
  assert.ok(/entry 99 /.test(p.text.split('\n')[9]));
  // encodedLength matches what the page URL really adds.
  var s = all.text;
  assert.strictEqual(log.encodedLength(s), encodeURIComponent(JSON.stringify(s)).length - 6);
});

test('header names versions, watch, device and the clock', function() {
  var h = log.header({
    bundle: {v: 1, generated: '2027-03-01T10:00:00Z', ship: {code: 'HM'}, sailDate: '2027-03-06'},
    watch: {model: 'pebble_time_2', firmware: {major: 4, minor: 9, patch: 1, suffix: ''}},
    phone: 'Android', label: 'Test watch', count: 12, dropped: 3, now: new Date(2027, 2, 7)
  }).split('\n');
  assert.strictEqual(h[0], 'Royal Pebble usage log');
  assert.ok(/^App \d+\.\d+\.\d+, bundle v1 made 2027-03-01T10:00:00Z, ship HM, sails 2027-03-06$/.test(h[1]), h[1]);
  assert.strictEqual(h[2], 'Watch pebble_time_2, firmware 4.9.1; phone Android');
  assert.strictEqual(h[3], 'Device: Test watch');
  assert.ok(/^12 entries, 3 oldest dropped when full; times on the phone clock, now UTC[+-]\d/.test(h[4]), h[4]);
  var demo = log.header({bundle: null, watch: null, count: 0, now: new Date()});
  assert.ok(/no cruise saved/.test(demo) && /firmware unknown/.test(demo) && /\(no label\)/.test(demo));
});

test('phone text is short: Android version, model and WebView', function() {
  assert.strictEqual(log.phoneFromUa('Mozilla/5.0 (Linux; Android 15; Test Phone 9 Build/AB1C.123456.001; wv) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/150.0.1234.5 Mobile Safari/537.36'),
    'Android 15, Test Phone 9, WebView Chrome 150.0.1234.5');
  assert.strictEqual(log.phoneFromUa('Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 Chrome/150.0.0.0'),
    'Android 14, K, Chrome 150.0.0.0');
  assert.strictEqual(log.phoneFromUa('PebbleKitJS/1.0'), 'PebbleKitJS/1.0');
  assert.strictEqual(log.phoneFromUa(undefined), 'unknown');
});

test('settings diff follows nested values', function() {
  var d = log.diffSettings(
    {theme: 'light', me: {stateroom: '1234'}, days: {'2027-03-07': {offset: 0}}, hiddenCats: ['a']},
    {theme: 'dark', me: {stateroom: '5678', deck: '9'}, days: {}, hiddenCats: ['a'], units: 'ft'});
  assert.deepStrictEqual(d, [
    'days.2027-03-07.offset: 0 -> (none)',
    'me.deck: (none) -> "9"',
    'me.stateroom: "1234" -> "5678"',
    'theme: "light" -> "dark"',
    'units: (none) -> "ft"'
  ]);
  assert.deepStrictEqual(log.diffSettings({a: [1, 2]}, {a: [1, 2]}), []);
});

test('late entries (the watch queue) go in time order', function() {
  var l = makeTestLog(memStorage(), '2027-03-06');
  var t = l.clock.ms;
  l.add('open', 'phone entry');
  l.add('screen', 'from the watch, earlier', t - 60000);
  l.clock.ms = t + 1000;
  l.add('open', 'later');
  var lines = l.pageState('').text.split('\n').map(function(x) { return x.split('  ').slice(2).join('  '); });
  assert.deepStrictEqual(lines, ['screen  from the watch, earlier', 'open  phone entry', 'open  later']);
});

test('watch entries decode and render', function() {
  var pack = require('../../src/pkjs/pack');
  var sail = '2027-03-06';
  var entries = [
    {at: 1804000000, code: 1, x: 3, a: 80 + 256, b: 65536, c: 3},
    {at: 1804000100, code: 2, x: 0, a: 79, b: 125, c: 51200},
    {at: 1804000101, code: 3, x: 1, a: 0, b: 42, c: 5},
    {at: 1804000102, code: 3, x: 3, a: 4, b: 12, c: 0},
    {at: 1804000103, code: 4, x: 3, a: 2 + 32, b: 7, c: 0},
    {at: 1804000104, code: 4, x: 6, a: 2 + 16, b: 1, c: 1003},
    {at: 1804000105, code: 5, x: 8, a: 12, b: 1440 + 825, c: 2880 + 540},
    {at: 1804000106, code: 6, x: 1, a: 23, b: 1440 + 825, c: 1},
    {at: 1804000107, code: 7, x: 1, a: 9, b: 1440 + 825, c: 0},
    {at: 1804000108, code: 8, x: 2, a: 0, b: 1440 + 600, c: 1440 + 630},
    {at: 1804000109, code: 9, x: 0, a: -7, b: 1440 + 700, c: 0},
    {at: 1804000110, code: 12, x: 0, a: 2, b: 10, c: 0},
    {at: 1804000111, code: 13, x: 1, a: -6, b: 31, c: 0},
    {at: 1804000112, code: 3, x: 1, a: 0, b: 3, c: 7}
  ];
  var bytes = [];
  entries.forEach(function(e) { bytes = bytes.concat(pack.encodeLogEntry(e)); });
  var decoded = pack.decodeLogEntries(bytes);
  assert.deepStrictEqual(decoded, entries);
  var text = decoded.map(function(e) { var r = log.watchEntry(e, sail); return r.kind + '  ' + r.detail; });
  assert.deepStrictEqual(text, [
    'open  opened by an alert, battery 80% charging, phone connected, schedule from watch storage, 64 KB free',
    'close  closed after 2 min 5 s, battery 79%, lowest free memory 50 KB',
    'screen  Home (NEXT): 42 s',
    'screen  Today: 12 s, 4 scrolls',
    'button  Select on Today, row 7, did nothing',
    'button  Select (long) on Ship directory page 1003, row 1',
    'alert  8 wakeups scheduled from 12 alerts, D2 13:45 to D3 09:00',
    'alert  reminder at D2 13:45 fired 23 s late, opened the app',
    'alert  alert at D2 13:45 closed with Select after 9 s',
    'alert  2 alert times missed while the app was closed: D2 10:00 to D2 10:30',
    'error  wakeup for D2 11:40 not scheduled: E_OUT_OF_RESOURCES (-7)',
    'error  watch message REQUEST (10) not delivered: SEND_TIMEOUT (2)',
    'error  watch storage write failed (star queue, key 31): E_OUT_OF_STORAGE (-6)',
    'screen  Home (NOW): 3 s'
  ]);
  // 01:00 after midnight still belongs to the evening before.
  var late = log.watchEntry({at: 0, code: 3, x: 10, a: 0, b: 5, c: 2880 + 1500}, sail).detail;
  assert.strictEqual(late, 'Alert (at D3 01:00): 5 s');
  assert.strictEqual(log.watchEntry({at: 0, code: 10, x: 0, a: 55, b: 0, c: 0}, null).detail, 'battery 55%');
  assert.strictEqual(log.watchEntry({at: 0, code: 3, x: 9, a: 0, b: 1, c: 900}, null).detail,
                     'Route to next event (cruise minute 900): 1 s');
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
