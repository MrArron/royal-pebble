// Checks the generated ship map data for the Ship GPS (src/pkjs/data/*-HM.js)
// against itself and the venue table. Run: node test/pkjs/shipmap-data.test.js
var assert = require('assert');
var venues = require('../../src/pkjs/venues');
var C = require('../../src/pkjs/data/cabins-HM');
var P = require('../../src/pkjs/data/places-HM');
var W = require('../../src/pkjs/data/walkways-HM');

var tests = [];
function test(name, fn) { tests.push({name: name, fn: fn}); }

var TABLE = venues.builtIn('HM');
var DECKS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18];   // no deck 13
var LENGTH = 362.1;
var HALF_BEAM = 33;   // generous: widest point with the overhangs

function onShip(a, x) {
  return a >= 0 && a <= LENGTH && Math.abs(x) <= HALF_BEAM;
}

// Every cabin number from the runs: {number: [deck, a, x]}.
function allCabins() {
  var out = {};
  Object.keys(C.decks).forEach(function(d) {
    C.decks[d].runs.forEach(function(r) {
      for (var k = 0; k < r[1]; k++) {
        var n = r[0] + k * r[2];
        assert.ok(!out[n], 'cabin ' + n + ' twice');
        out[n] = [Number(d), r[1] > 1 ? r[3] + (r[4] - r[3]) * k / (r[1] - 1) : r[3], r[5]];
      }
    });
  });
  return out;
}

test('cabins: 2,855 numbers, each on its own deck and on the ship', function() {
  var cabins = allCabins();
  var numbers = Object.keys(cabins);
  assert.strictEqual(numbers.length, 2855);
  numbers.forEach(function(n) {
    var c = cabins[n];
    assert.strictEqual(n.indexOf(String(c[0])), 0, 'cabin ' + n + ' on deck ' + c[0]);
    assert.ok(onShip(c[1], c[2]), 'cabin ' + n + ' off the ship');
  });
});

test('banks: same spot in cabins and places, no deck 13', function() {
  assert.strictEqual(C.banks.fwd, P.banks.fwd.a);
  assert.strictEqual(C.banks.aft, P.banks.aft.a);
  ['fwd', 'aft'].forEach(function(k) {
    var b = P.banks[k];
    assert.ok(b.decks.indexOf(13) === -1);
    assert.ok(b.port < 0 && b.starboard > 0, k + ' lobby doors');
    assert.deepStrictEqual(b.decks.slice().sort(function(p, q) { return p - q; }), b.decks);
  });
});

test('venue spots: every name is in the venue table, on a real deck', function() {
  Object.keys(P.venues).forEach(function(name) {
    var v = TABLE.venues[name];
    assert.ok(v, name + ' is not in the venue table');
    P.venues[name].forEach(function(p) {
      assert.ok(DECKS.indexOf(p[0]) !== -1, name + ' deck ' + p[0]);
      assert.ok(onShip(p[1], p[2]), name + ' off the ship');
      // The Perfect Storm's launch area is on 18; its deck 15 spot is the slide run.
      if (v.decks.length && name !== 'The Perfect Storm Waterslides') {
        assert.ok(v.decks.indexOf(p[0]) !== -1, name + ' spot on deck ' + p[0] + ', table says ' + v.decks);
      }
    });
  });
});

test('venue spots: the 19 without one are the known approximate list', function() {
  var missing = Object.keys(TABLE.venues).filter(function(n) { return !P.venues[n]; }).sort();
  assert.deepStrictEqual(missing, [
    'AO Workshop', 'Arena & Hangouts (Ages 6-12)', 'Breitling', "Giovanni's Wine Bar",
    'Kids Shop', 'Medical Center', 'Messika Boutique', 'Pandora', 'Perfect Day at CocoCay',
    'Picture This', 'Port Merchants', 'Prince & Greene', 'Regalia Fine Jewelry',
    'Regalia Watches', 'Roberto Coin Boutique', 'Royal Shops', 'Social100 (Ages 13-17)',
    'Solera', 'Teen Center'
  ].sort());
});

test('stairs: sorted deck lists on real decks', function() {
  P.stairs.forEach(function(s) {
    assert.ok(onShip(s[0], s[1]));
    assert.ok(s[2].length >= 1);
    s[2].forEach(function(d, i) {
      assert.ok(DECKS.indexOf(d) !== -1, 'stair deck ' + d);
      assert.ok(!i || d > s[2][i - 1]);
    });
    assert.ok(s[3] === 'core' || s[3] === 'stair');
  });
});

// Walkway graph: {deck: {nodes: [[id, a, x, kind]], edges: [[from, to(, '?')]], ...}}
function deckGraph(d) {
  var g = W.decks[String(d)];
  var ids = {};
  g.nodes.forEach(function(n) {
    assert.ok(!ids[n[0]], 'deck ' + d + ' node ' + n[0] + ' twice');
    ids[n[0]] = n;
  });
  return {g: g, ids: ids};
}

test('walkways: every deck has a graph with no dangling edges', function() {
  DECKS.forEach(function(d) {
    var dg = deckGraph(d);
    dg.g.nodes.forEach(function(n) {
      assert.ok(W.kinds[n[3]], 'deck ' + d + ' node kind ' + n[3]);
      assert.ok(onShip(n[1], n[2]), 'deck ' + d + ' node ' + n[0] + ' off the ship');
    });
    dg.g.edges.forEach(function(e) {
      assert.ok(dg.ids[e[0]] && dg.ids[e[1]], 'deck ' + d + ' edge ' + e);
      assert.ok(e.length === 2 || e[2] === '?', 'deck ' + d + ' edge flag ' + e);
    });
  });
});

test('walkways: lobbies, stairs and restrooms point at real nodes', function() {
  ['fwd', 'aft'].forEach(function(k) {
    P.banks[k].decks.forEach(function(d) {
      var pair = W.lobbies[k][String(d)];
      assert.ok(pair, k + ' lobby on deck ' + d);
      var ids = deckGraph(d).ids;
      assert.ok(ids[pair[0]] && ids[pair[1]], k + ' lobby nodes on deck ' + d);
    });
  });
  W.stairs.forEach(function(s) {
    s[2].forEach(function(d, i) {
      assert.ok(deckGraph(d).ids[s[3][i]], 'stair at ' + s[0] + ' deck ' + d);
    });
  });
  var count = 0;
  Object.keys(W.restrooms).forEach(function(d) {
    W.restrooms[d].forEach(function(r) {
      count++;
      assert.ok(deckGraph(Number(d)).ids[r[2]], 'restroom deck ' + d);
      assert.ok(['m', 'w', 'mw'].indexOf(r[3]) !== -1, 'restroom kind ' + r[3]);
    });
  });
  assert.strictEqual(count, 23);
});

// Nodes reachable from a deck's lobbies and stairs.
function reachable(d, certainOnly) {
  var dg = deckGraph(d);
  var adj = {};
  dg.g.edges.forEach(function(e) {
    if (certainOnly && e[2] === '?') {
      return;
    }
    (adj[e[0]] = adj[e[0]] || []).push(e[1]);
    (adj[e[1]] = adj[e[1]] || []).push(e[0]);
  });
  var seen = {};
  var todo = [];
  ['fwd', 'aft'].forEach(function(k) {
    (W.lobbies[k][String(d)] || []).forEach(function(id) { todo.push(id); });
  });
  W.stairs.forEach(function(s) {
    var i = s[2].indexOf(d);
    if (i !== -1 && s[2].length > 1) {
      todo.push(s[3][i]);
    }
  });
  while (todo.length) {
    var id = todo.pop();
    if (!seen[id]) {
      seen[id] = true;
      (adj[id] || []).forEach(function(n) { todo.push(n); });
    }
  }
  return {seen: seen, dg: dg};
}

test('walkways: every node can reach a lobby or a stair (uncertain edges allowed)', function() {
  DECKS.forEach(function(d) {
    var r = reachable(d, false);
    var cut = r.dg.g.nodes.filter(function(n) { return !r.seen[n[0]]; });
    assert.strictEqual(cut.length, 0, 'deck ' + d + ': ' + cut.length + ' nodes cut off, e.g. ' + JSON.stringify(cut[0]));
  });
});

// Distance from (a, x) to the segment p-q.
function segDist(a, x, p, q) {
  var da = q[1] - p[1], dx = q[2] - p[2];
  var len = da * da + dx * dx;
  var t = len ? Math.max(0, Math.min(1, ((a - p[1]) * da + (x - p[2]) * dx) / len)) : 0;
  var ea = p[1] + t * da - a, ex = p[2] + t * dx - x;
  return Math.sqrt(ea * ea + ex * ex);
}

test('walkways: every cabin is within 7.5 m of a certain corridor', function() {
  var cabins = allCabins();
  var far = [];
  Object.keys(cabins).forEach(function(n) {
    var c = cabins[n];
    var r = reachable(c[0], true);
    var best = Infinity;
    r.dg.g.edges.forEach(function(e) {
      if (e[2] !== '?' && r.seen[e[0]]) {
        best = Math.min(best, segDist(c[1], c[2], r.dg.ids[e[0]], r.dg.ids[e[1]]));
      }
    });
    if (best > 7.5) {
      far.push(n + ' (' + best.toFixed(1) + ' m)');
    }
  });
  assert.strictEqual(far.length, 0, far.slice(0, 10).join(', '));
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
