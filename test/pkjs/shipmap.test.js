// Unit tests for the Ship GPS planner (shipmap.js), its watch text (gpstext.js)
// and where routes start (routestart.js). Run: node test/pkjs/shipmap.test.js
var assert = require('assert');
var map = require('../../src/pkjs/shipmap');
var text = require('../../src/pkjs/gpstext');
var rs = require('../../src/pkjs/routestart');
var P = require('../../src/pkjs/data/places-HM');

var tests = [];
function test(name, fn) { tests.push({name: name, fn: fn}); }

var BANKS = map.banks('HM');
var CABINS = ['8130', '8626', '6604', '9150', '11298', '3178', '14650', '7330', '10458', '12900', '1744', '4660'];

function route(from, to) {
  return map.route('HM', map.cabin('HM', from), map.venue('HM', to));
}

function texts(r, from, opts) {
  return text.steps(r, from, opts).map(function(s) { return s.text; });
}

// --- planner -------------------------------------------------------------

test('every venue spot is reachable from cabins on several decks', function() {
  CABINS.forEach(function(c) {
    var from = map.cabin('HM', c);
    assert.ok(from, 'cabin ' + c);
    Object.keys(P.venues).forEach(function(v) {
      var r = map.route('HM', from, map.venue('HM', v));
      assert.ok(r && r.steps.length, c + ' > ' + v);
    });
  });
});

test('split decks cross only at a lobby: same-deck port to starboard, aft of the park', function() {
  var r = map.route('HM', map.cabin('HM', '9300'), map.cabin('HM', '9700'));
  var cross = r.steps.filter(function(s) { return s.do === 'cross'; });
  assert.strictEqual(cross.length, 1);
  assert.strictEqual(cross[0].at, 'Aft lobby');
  assert.ok(r.metres > 100, 'no straight walk over the Boardwalk: ' + r.metres);
});

test('deck 8 crosses through Central Park; cabin 9150 to Dazzles follows corridors', function() {
  var park = map.route('HM', map.cabin('HM', '8250'), map.cabin('HM', '8650'));
  assert.ok(park.steps.some(function(s) { return s.do === 'cross'; }));
  var d = route('9150', 'Dazzles');
  assert.ok(!d.approx && !d.unsure, JSON.stringify(d.steps));
  assert.ok(d.metres >= 170, 'along the corridor, not across the park: ' + d.metres);
});

test('Main Dining Room: each floor is its own venue and never another floor', function() {
  [3, 4, 5].forEach(function(n) {
    CABINS.forEach(function(c) {
      var r = route(c, 'Main Dining Room ' + n);
      assert.strictEqual(r.to.deck, n, c + ' > MDR ' + n);
    });
  });
});

test('a venue with several spots goes to the cheapest one', function() {
  var r = route('3178', 'Royal Theater');
  assert.strictEqual(r.to.deck, 3);
});

test('closest restroom searches other decks and every venue gets one', function() {
  var sol = map.restroom('HM', map.venue('HM', 'Solarium Bar')[0]);
  assert.strictEqual(sol.deck, 15);
  assert.ok(sol.metres < 80, 'Solarium Bar restroom ' + sol.metres + ' m');
  var dz = map.restroom('HM', map.venue('HM', 'Dazzles').filter(function(p) { return p.deck === 9; })[0]);
  assert.ok(dz && dz.deck !== 9);
  Object.keys(P.venues).forEach(function(v) {
    map.venue('HM', v).forEach(function(p) {
      assert.ok(map.restroom('HM', p), v + ' deck ' + p.deck);
    });
  });
});

test('kids-area restroom only when asked for', function() {
  var p = map.venue('HM', 'Nursery')[0];
  assert.notStrictEqual(map.restroom('HM', p).g.indexOf('kids'), 0);
  var all = map.restroom('HM', p, {all: true});
  assert.ok(all.metres <= map.restroom('HM', p).metres);
});

test('unlabelled venues get a reduced, approximate route', function() {
  var spot = map.approx('HM', 5, 'Mid');
  var r = map.route('HM', map.cabin('HM', '8130'), spot);
  assert.ok(r.approx && text.reduced(r));
});

test('flip: whole ship mirrors sides, not distances; one deck flips alone', function() {
  var before = route('8130', 'Chops Grille');
  assert.strictEqual(map.cabin('HM', '8130').side, 'Port');
  map.setFlip('HM', {all: true});
  try {
    assert.strictEqual(map.cabin('HM', '8130').side, 'Starboard');
    var after = route('8130', 'Chops Grille');
    assert.strictEqual(after.metres, before.metres);
    assert.strictEqual(after.to.side, before.to.side === 'Port' ? 'Starboard' : 'Port');
    map.setFlip('HM', {decks: [8]});
    assert.strictEqual(map.cabin('HM', '8130').side, 'Starboard');
    assert.strictEqual(map.cabin('HM', '9150').side, 'Port');
    assert.ok(route('9150', 'Chops Grille'), 'routes still join a flipped deck');
  } finally {
    map.setFlip('HM', null);
  }
  assert.strictEqual(map.cabin('HM', '8130').side, 'Port');
});

test('a route is quick enough for the phone', function() {
  var t0 = Date.now();
  for (var i = 0; i < 10; i++) {
    route(CABINS[i % CABINS.length], 'Windjammer Marketplace');
  }
  var ms = (Date.now() - t0) / 10;
  assert.ok(ms < 200, ms + ' ms per route');
});

// --- watch text ----------------------------------------------------------

test('distances round and convert', function() {
  assert.strictEqual(text.distance(2, 'm'), '5 m');
  assert.strictEqual(text.distance(31, 'm'), '30 m');
  assert.strictEqual(text.distance(158, 'm'), '160 m');
  assert.strictEqual(text.distance(161.5, 'ft'), '530 ft');
  assert.strictEqual(text.distance(157.5, 'steps'), '210 steps');
  assert.strictEqual(text.distance(40, 'bogus'), '40 m');
});

test('steps use the design wording, with no side words until confirmed', function() {
  var r = route('6604', 'Royal Theater');
  var from = map.cabin('HM', '6604');
  var t = texts(r, from, {banks: BANKS});
  assert.strictEqual(t[t.length - 1], 'Royal Theater');
  assert.ok(t.some(function(s) { return /^(Fore|Mid|Aft) stairs to Deck \d+$|^(Fore|Aft) elev to Deck \d+$/.test(s); }), t.join(' / '));
  var cross = map.route('HM', map.cabin('HM', '9300'), map.cabin('HM', '9700'));
  var ct = texts(cross, map.cabin('HM', '9300'), {name: 'Cabin 9700'});
  assert.ok(ct.indexOf('Cross the ship') !== -1, ct.join(' / '));
  var sided = texts(cross, map.cabin('HM', '9300'), {name: 'Cabin 9700', sides: true});
  assert.ok(sided.indexOf('Cross to stbd') !== -1, sided.join(' / '));
  assert.ok(/stbd side$/.test(sided[sided.length - 1]));
});

test('no side word anywhere before confirmation; every step line fits', function() {
  ['m', 'ft', 'steps'].forEach(function(units) {
    CABINS.forEach(function(c) {
      var from = map.cabin('HM', c);
      Object.keys(P.venues).forEach(function(v) {
        var r = map.route('HM', from, map.venue('HM', v));
        text.steps(r, from, {units: units, banks: BANKS, name: v}).forEach(function(s, i, all) {
          assert.ok(!/\b(port|stbd|starboard)\b/.test(s.text), s.text);
          // Longest real step, "Fore stairs to Deck 17", is 22 characters: 296 of the
          // 334 px a step line has in the WatchRoute mockups (2x, Gothic stand-in).
          if (i < all.length - 1) {
            assert.ok(s.text.length <= 22, c + ' > ' + v + ': ' + s.text);
          }
        });
      });
    });
  });
});

test('FROM line and summary', function() {
  var from = map.cabin('HM', '8130');
  var same = text.fromLine(route('8130', 'Chops Grille'), from, {fromCabin: true});
  assert.strictEqual(same.decks, 0);
  assert.ok(/^Your deck · \d+ m aft$/.test(same.text), same.text);
  var down = text.fromLine(route('8130', 'Royal Theater'), from, {});
  assert.ok(down.decks < 0);
  assert.ok(/^↓\d decks? · \d+ m (fore|aft)$/.test(text.plain(down)), text.plain(down));
  var sum = text.summary(route('8130', 'Royal Theater'), from, {units: 'ft'});
  assert.ok(/^\d+ ft in all$/.test(sum.text), sum.text);
});

test('a reduced route shows the deck and fore/aft only', function() {
  var from = map.cabin('HM', '8130');
  var r = map.route('HM', from, map.approx('HM', 5, 'Aft'));
  var t = texts(r, from, {name: 'Kids Shop'});
  assert.deepStrictEqual([t.length, t[0], t[2]], [3, 'To Deck 5', 'Kids Shop']);
  assert.ok(/^\d+ m aft$/.test(t[1]), t[1]);
});

test('restroom line and headers', function() {
  var p = map.venue('HM', 'Royal Theater')[0];
  var line = text.restroomLine(map.restroom('HM', p), p, {});
  assert.ok(line.decks === 1 || line.decks === 0, JSON.stringify(line));
  assert.strictEqual(text.fromHeader({kind: 'cabin', cabin: '8130'}), 'FROM YOUR CABIN');
  assert.strictEqual(text.fromHeader({kind: 'stop', venue: 'Royal Theater'}), 'FROM ROYAL THEATER');
  assert.strictEqual(text.fromHeader({kind: 'spoken', venue: 'Solarium'}, 'Solarium'), 'FROM SOLARIUM');
});

// --- where routes start --------------------------------------------------

var SHOW = {start: 20 * 60, minutes: 60, venue: 'Royal Theater'};        // 8:00-9:00p
var LATE = {start: 23 * 60, minutes: 45, venue: 'Dazzles'};              // 11:00p
var CLOSE = {start: 21 * 60 + 10, minutes: 30, venue: 'Boleros'};         // 9:10p

test('start: the cabin by default; a stop hours earlier does not count', function() {
  assert.deepStrictEqual(rs.start({stops: [], now: 600, cabin: 8130}), {kind: 'cabin', cabin: '8130'});
  assert.strictEqual(rs.start({stops: [SHOW, LATE], now: 22 * 60, target: LATE, cabin: '8130'}).kind, 'cabin');
  assert.strictEqual(rs.start({stops: [], now: 600}).kind, 'none');
});

test('start: the previous stop when it ends less than 15 minutes before', function() {
  var s = rs.start({stops: [SHOW, CLOSE], now: 19 * 60, target: CLOSE, cabin: '8130'});
  assert.strictEqual(s.kind, 'stop');
  assert.strictEqual(s.venue, 'Royal Theater');
});

test('start now (place pages): the stop you are at or just left', function() {
  assert.strictEqual(rs.start({stops: [SHOW], now: 20 * 60 + 30, cabin: '1'}).venue, 'Royal Theater');
  assert.strictEqual(rs.start({stops: [SHOW], now: 21 * 60 + 10, cabin: '1'}).venue, 'Royal Theater');
  assert.strictEqual(rs.start({stops: [SHOW], now: 21 * 60 + 20, cabin: '1'}).kind, 'cabin');
});

test('start: a spoken place lasts 1.5 h, until a stop starts, and not past 04:00', function() {
  var spoken = {at: 18 * 60, venue: 'Solarium'};
  assert.strictEqual(rs.start({stops: [SHOW], now: 19 * 60, spoken: spoken, cabin: '1'}).venue, 'Solarium');
  assert.strictEqual(rs.start({stops: [], now: 19 * 60 + 31, spoken: spoken, cabin: '1'}).kind, 'cabin');
  assert.strictEqual(rs.start({stops: [SHOW], now: 20 * 60 + 5, spoken: {at: 19 * 60, venue: 'Solarium'}, cabin: '1'}).venue,
                     'Royal Theater');
  var late = {at: 24 * 60 + 3 * 60 + 30, venue: 'Solarium'};   // 3:30a
  assert.strictEqual(rs.start({stops: [], now: 24 * 60 + 4 * 60 + 5, spoken: late, cabin: '1'}).kind, 'cabin');
  assert.deepStrictEqual(rs.start({stops: [], now: 600, spoken: {at: 590, cabin: 9150}, cabin: '1'}),
                         {kind: 'spoken', cabin: '9150'});
});

test('start: a stop just before the target beats an older spoken place', function() {
  var s = rs.start({stops: [SHOW, CLOSE], now: 19 * 60 + 30, target: CLOSE,
                    spoken: {at: 19 * 60, venue: 'Solarium'}, cabin: '1'});
  assert.strictEqual(s.venue, 'Royal Theater');
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
