// Unit tests for voice cards (docs/WATCH_PROTOCOL.md, Voice). Run: node test/pkjs/voicecard.test.js
var assert = require('assert');
var voicecard = require('../../src/pkjs/voicecard');
var directory = require('../../src/pkjs/directory');

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
  assert.ok(rest.rest);
  assert.strictEqual(voicecard.answer("I'm at the Solarium", CTX, true).action, voicecard.ACT_CONFIRM);
  assert.strictEqual(voicecard.answer('play some music', CTX, true).action, voicecard.ACT_NONE);
  // Every one packs.
  [route, rest].forEach(function(card) { unpack(voicecard.packCard(card)); });
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
