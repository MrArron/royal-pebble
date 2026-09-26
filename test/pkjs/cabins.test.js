// Unit tests for cabin locations. Run: node test/pkjs/cabins.test.js
var assert = require('assert');
var cabins = require('../../src/pkjs/cabins');
var data = require('../../src/pkjs/data/cabins-HM');

var tests = [];
function test(name, fn) { tests.push({name: name, fn: fn}); }

test('every run is well formed and runs never overlap', function() {
  var seen = {};
  Object.keys(data.decks).forEach(function(d) {
    data.decks[d].runs.forEach(function(r) {
      assert.ok(r[1] >= 1 && (r[1] === 1) === (r[2] === 0), 'run ' + r[0]);
      for (var i = 0; i < r[1]; i++) {
        var n = r[0] + i * r[2];
        assert.ok(!seen[n], 'cabin ' + n + ' listed twice');
        seen[n] = true;
      }
    });
  });
  assert.ok(Object.keys(seen).length > 2800);
});

test('find: deck, side and zone', function() {
  var c = cabins.find('HM', 8130);
  assert.strictEqual(c.deck, 8);
  assert.strictEqual(c.side, 'Port');
  assert.strictEqual(c.zone, 'Fore');
  assert.strictEqual(cabins.find('HM', '8530').side, 'Starboard');
  assert.strictEqual(cabins.find('HM', 8226).zone, 'Mid');
  assert.strictEqual(cabins.find('HM', 8330).zone, 'Aft');
  assert.strictEqual(cabins.find('HM', 1744).deck, 17, 'loft suites use their entry deck');
  assert.strictEqual(cabins.find('HM', 'Stateroom 9244').deck, 9);
  // Cabins stacked above each other line up.
  assert.ok(Math.abs(cabins.find('HM', 7130).a - cabins.find('HM', 9130).a) < 2);
});

test('find: unknown cabins and ships', function() {
  assert.strictEqual(cabins.find('HM', 8999), null);
  assert.strictEqual(cabins.find('HM', ''), null);
  assert.strictEqual(cabins.find('XX', 8130), null);
});

test('fromElevators: nearest bank and the walk from it', function() {
  var w = cabins.fromElevators('HM', cabins.find('HM', 8130));
  assert.strictEqual(w.bank, 'Forward');
  assert.strictEqual(w.toward, 'forward');
  assert.ok(w.metres > 40 && w.metres < 60, String(w.metres));
  assert.strictEqual(cabins.fromElevators('HM', cabins.find('HM', 8330)).toward, 'aft');
  assert.strictEqual(cabins.fromElevators('HM', null), null);
});

test('stairs: nearest main stairwell on the deck', function() {
  var s = cabins.stairs('HM', cabins.find('HM', 8226));
  assert.ok(s.length >= 2);
  assert.ok(s[0].metres <= s[1].metres);
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
console.log(failed ? failed + ' failed' : 'all ' + tests.length + ' passed');
process.exitCode = failed ? 1 : 0;
