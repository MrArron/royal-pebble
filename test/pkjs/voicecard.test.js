// Unit tests for voice cards (docs/WATCH_PROTOCOL.md, Voice). Run: node test/pkjs/voicecard.test.js
var assert = require('assert');
var voicecard = require('../../src/pkjs/voicecard');
var directory = require('../../src/pkjs/directory');
var demo = require('../../src/pkjs/demo');

var tests = [];
function test(name, fn) { tests.push({name: name, fn: fn}); }

var CTX = {bundle: {ship: {code: 'HM', name: 'Harmony of the Seas'}}, settings: {}, stars: {}, now: new Date()};

// Reads a packed card back the way ask_window.c does.
function unpack(b) {
  var p = 7;
  function str() { var n = b[p]; var s = Buffer.from(b.slice(p + 1, p + 1 + n)).toString('utf8'); p += 1 + n; return s; }
  var card = {action: b[0], flags: b[1], ref: b[2] | (b[3] << 8) | (b[4] << 16) | (b[5] << 24), rows: []};
  for (var i = 0; i < b[6]; i++) {
    card.rows.push({label: str(), value: str()});
  }
  card.hint = str();
  if (card.action === voicecard.ACT_ROUTE) {
    card.title = str();
    card.header = str();
  }
  assert.strictEqual(p, b.length, 'no bytes left over');
  return card;
}

test('packs a route card and reads back', function() {
  var bytes = voicecard.packCard({action: voicecard.ACT_ROUTE, rest: true, ref: 1234,
                                  rows: [{label: 'HEARD', value: 'x'}, {label: 'TO', value: 'Restroom'}],
                                  hint: 'Select: route', title: 'Restroom', header: 'CLOSEST TO X'});
  var c = unpack(bytes);
  assert.strictEqual(c.flags, voicecard.FLAG_REST);
  assert.strictEqual(c.ref, 1234);
  assert.deepStrictEqual(c.rows[1], {label: 'TO', value: 'Restroom'});
  assert.strictEqual(c.header, 'CLOSEST TO X');
});

test('cuts long texts to the watch buffers and at most 4 rows', function() {
  var long = new Array(200).join('é');  // 2 bytes each
  var rows = [1, 2, 3, 4, 5].map(function(i) { return {label: 'LABEL NUMBER ' + i + ' TOO LONG', value: long}; });
  var c = unpack(voicecard.packCard({action: voicecard.ACT_NONE, rows: rows, hint: long}));
  assert.strictEqual(c.rows.length, 4);
  assert.ok(Buffer.byteLength(c.rows[0].value) <= 63);
  assert.ok(Buffer.byteLength(c.rows[0].label) <= 15);
  assert.ok(Buffer.byteLength(c.hint) <= 47);
  assert.strictEqual(c.rows[0].value.indexOf('�'), -1, 'cut between characters');
});

test('stand-in answers with real data say not yet', function() {
  var c = voicecard.answer('how do I get to the theater', CTX, false);
  assert.strictEqual(c.action, voicecard.ACT_NONE);
  assert.strictEqual(c.rows[0].label, 'HEARD');
});

test('demo stand-in shows each kind of card', function() {
  var theater = voicecard.placeRef('Royal Theater', CTX);
  assert.ok(theater >= directory.REF_PLACE);
  var route = voicecard.answer('how do I get to the Royal Theater', CTX, true);
  assert.strictEqual(route.action, voicecard.ACT_ROUTE);
  assert.strictEqual(route.ref, theater);
  var rest = voicecard.answer('closest restroom', CTX, true);
  assert.strictEqual(rest.action, voicecard.ACT_NONE, 'no cruise data: nothing to route from');
  assert.strictEqual(voicecard.answer("I'm at the Solarium", CTX, true).action, voicecard.ACT_CONFIRM);
  assert.strictEqual(voicecard.answer('play some music', CTX, true).action, voicecard.ACT_NONE);
  // Every one packs.
  [route, rest].forEach(function(card) { unpack(voicecard.packCard(card)); });
});

test('on board and ashore phrases', function() {
  var yes = ["I'm on board", "i' m back on board", 'we are back on the ship', "we're aboard", 'back on board',
             "I'm onboard now", 'im on board'];
  var no = ["I'm ashore", 'going ashore', "I'm off the ship", 'leaving the ship', "we're back ashore"];
  var neither = ['when is all aboard', 'what time is all aboard', "I'm at the solarium", 'how do I get to the pool',
                 'where do I board the tender', 'the swim on board ship'];
  yes.forEach(function(t) { assert.strictEqual(voicecard.onboardIntent(t.toLowerCase()), true, t); });
  no.concat(["I'm sure.", 'i m sure']).forEach(function(t) {
    assert.strictEqual(voicecard.onboardIntent(t.toLowerCase()), false, t);
  });
  assert.strictEqual(voicecard.onboardIntent("i'm sure it's at seven"), null, 'only on its own');
  neither.forEach(function(t) { assert.strictEqual(voicecard.onboardIntent(t.toLowerCase()), null, t); });
});

test('on board cards follow the day and the watch flag', function() {
  var now = new Date(2027, 2, 8, 13, 0);
  var port = demo.make(now, 0);
  var sea = demo.make(now, 1);
  function ctx(d) { return {bundle: d.bundle, settings: d.settings, stars: d.stars, now: now}; }
  // Port day, flag clear: "I'm on board" sets it, from real data too.
  var set = voicecard.answer("I'm on board", ctx(port), false, 0);
  assert.strictEqual(set.action, voicecard.ACT_ONBOARD);
  assert.ok(set.onboard);
  var c = unpack(voicecard.packCard(set));
  assert.strictEqual(c.flags, voicecard.FLAG_ONBOARD);
  // Already set: nothing to do.
  assert.strictEqual(voicecard.answer("I'm on board", ctx(port), false, voicecard.STATE_ONBOARD).action,
                     voicecard.ACT_NONE);
  // Ashore clears it only when set.
  var clear = voicecard.answer("I'm back ashore", ctx(port), false, voicecard.STATE_ONBOARD);
  assert.strictEqual(clear.action, voicecard.ACT_ONBOARD);
  assert.strictEqual(unpack(voicecard.packCard(clear)).flags, 0);
  assert.strictEqual(voicecard.answer('going ashore', ctx(port), false, 0).action, voicecard.ACT_NONE);
  // Sea day: nothing to change.
  var atSea = voicecard.answer("I'm on board", ctx(sea), false, 0);
  assert.strictEqual(atSea.action, voicecard.ACT_NONE);
  assert.strictEqual(atSea.rows[1].value, 'At sea today');
});

test('clock follows the watch style', function() {
  assert.strictEqual(voicecard.clock(17 * 60, 0), '5:00p');
  assert.strictEqual(voicecard.clock(1440 + 30, 0), '12:30a');
  assert.strictEqual(voicecard.clock(12 * 60 + 5, 0), '12:05p');
  assert.strictEqual(voicecard.clock(17 * 60, voicecard.STATE_24H), '17:00');
});

test('departure, tomorrow and muster cards', function() {
  var now = new Date(2027, 2, 8, 13, 0);
  var port = demo.make(now, 0);
  var sea = demo.make(now, 1);
  function ctx(d) { return {bundle: d.bundle, settings: d.settings, stars: d.stars, now: now}; }
  var leave = voicecard.answer('When do we leave?', ctx(port), false, 0);
  assert.deepStrictEqual(leave.rows.map(function(r) { return r.label; }), ['HEARD', 'TODAY', 'DEPARTS', 'ALL ABOARD']);
  assert.ok(/[ap]$/.test(leave.rows[2].value));
  assert.ok(/:/.test(voicecard.answer('what time does the ship sail', ctx(port), false, 0).rows[2].value));
  assert.strictEqual(voicecard.answer('when do we leave', ctx(sea), false, 0).rows[1].value, 'At sea today');
  var tmr = voicecard.answer("where are we tomorrow", ctx(sea), false, voicecard.STATE_24H);
  assert.strictEqual(tmr.rows[1].label, 'TOMORROW');
  assert.ok(!/[ap]$/.test(tmr.rows[2].value), '24-hour');
  // Muster: a place name in it gives a route; a bare code doesn't.
  var m = voicecard.answer("where's my muster station", ctx(port), false, 0);
  assert.strictEqual(m.rows[1].label, 'MUSTER STATION');
  var c = ctx(port);
  c.settings = JSON.parse(JSON.stringify(c.settings));
  c.settings.me.muster = 'B4';
  c.settings.me.src = {muster: 'edited'};
  var bare = voicecard.answer('take me to my mustard station', c, false, 0);
  assert.strictEqual(bare.action, voicecard.ACT_NONE);
  assert.strictEqual(bare.rows[1].value, 'B4');
  c.settings.me.muster = 'A2 Royal Theater';
  var routed = voicecard.answer('muster station', c, false, 0);
  assert.strictEqual(routed.action, voicecard.ACT_ROUTE);
  assert.strictEqual(routed.ref, voicecard.placeRef('Royal Theater', c));
  unpack(voicecard.packCard(routed));
  // Real data without these words still says not yet.
  assert.strictEqual(voicecard.answer('play some music', ctx(port), false, 0).rows[1].value, 'Not yet');
});

test('take me to my cabin', function() {
  var now = new Date(2027, 2, 8, 13, 0);
  var port = demo.make(now, 0);
  var c = {bundle: port.bundle, settings: port.settings, stars: port.stars, now: now};
  ['take me to my cabin', 'take me back to my room', 'how do I get back to my stateroom'].forEach(function(t) {
    var card = voicecard.answer(t, c, false, 0);
    assert.strictEqual(card.rows[1].value, 'Your cabin', t);
  });
  // With no starred event on now, the route would start at the cabin itself.
  assert.strictEqual(voicecard.answer('take me to my cabin', c, false, 0).action, voicecard.ACT_NONE);
  // During a starred show (the demo sea day's 14:00 at Studio B), it routes from there.
  var sea = demo.make(now, 1);
  var during = {bundle: sea.bundle, settings: sea.settings, stars: sea.stars, now: new Date(2027, 2, 8, 14, 0)};
  var route = voicecard.answer('take me to my cabin', during, false, 0);
  assert.strictEqual(route.action, voicecard.ACT_ROUTE);
  assert.strictEqual(route.ref, directory.REF_CABIN);
  assert.strictEqual(route.rows[1].value, 'Studio B');
  var page = directory.routePage(directory.REF_CABIN, false, during);
  assert.ok(page.steps.length > 1);
  assert.strictEqual(page.steps[page.steps.length - 1].glyph, 4, 'ends with the arrival');
  // "my cabin to the theater" isn't a cabin route.
  assert.notStrictEqual(voicecard.answer('from my cabin to the theater', c, false, 0).rows[1].value, 'Your cabin');
});

test('nearest bathroom routes from where you are', function() {
  var sea = demo.make(new Date(2027, 2, 8, 13, 0), 1);
  var c = {bundle: sea.bundle, settings: sea.settings, stars: sea.stars, now: new Date(2027, 2, 8, 14, 0)};
  ['nearest bathroom', 'where is the closest restroom', 'I need a toilet'].forEach(function(t) {
    var card = voicecard.answer(t, c, false, 0);
    assert.strictEqual(card.action, voicecard.ACT_ROUTE, t);
    assert.strictEqual(card.ref, directory.REF_REST_HERE);
    assert.strictEqual(card.rows[1].value, 'Studio B', 'from the starred show on now');
  });
  unpack(voicecard.packCard(voicecard.answer('nearest bathroom', c, false, 0)));
  var page = directory.routePage(directory.REF_REST_HERE, false, c);
  assert.strictEqual(page.header, 'CLOSEST TO STUDIO B');
  assert.strictEqual(page.steps[page.steps.length - 1].glyph, 4);
  // With nothing on, from the cabin.
  c.now = new Date(2027, 2, 8, 11, 0);
  var home = directory.routePage(directory.REF_REST_HERE, false, c);
  assert.strictEqual(home.header, 'CLOSEST TO YOUR CABIN');
  assert.ok(/your cabin$/.test(home.small.text) || home.small.text === '', home.small.text);
  assert.strictEqual(voicecard.answer('nearest bathroom', c, false, 0).rows[1].value, 'Your cabin');
});

var failed = 0;
tests.forEach(function(t) {
  try {
    t.fn();
    console.log('ok   ' + t.name);
  } catch (e) {
    failed++;
    console.log('FAIL ' + t.name + '\n     ' + e.message);
  }
});
if (failed) {
  process.exit(1);
}
console.log('All ' + tests.length + ' voice card tests passed.');
