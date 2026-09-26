#!/usr/bin/env node
// Turn the OCR'd deck-plan labels (tools/shipmap/extract_places.py) into the ship map data.
//
// Usage: node tools/shipmap/build_places.js <labels.json> <overrides.json> <out.js>
// Matches each label to the venue table (src/pkjs/venues.js: names and aliases),
// applies the hand-checked overrides, groups stair steps into stairwells and
// links them deck to deck, and finds the elevator lobbies and restrooms.
// Prints what it couldn't match, so a new ship can be checked in one pass.
'use strict';
var fs = require('fs');
var path = require('path');
var venues = require(path.join(__dirname, '../src/pkjs/venues'));

var labelsFile = process.argv[2];
var overridesFile = process.argv[3];
var outFile = process.argv[4];
var src = JSON.parse(fs.readFileSync(labelsFile, 'utf8'));
var ov = JSON.parse(fs.readFileSync(overridesFile, 'utf8'));
var table = venues.builtIn(src.ship);
var lookup = function(name) { return venues.lib.lookup(table, name); };
var banks = src.banks;

var r1 = function(n) { return Math.round(n * 10) / 10; };
var dist = function(p, q) { return Math.hypot(p.a - q.a, p.x - q.x); };
var decksOnPlan = Array.from(new Set(src.labels.map(function(l) { return l.deck; }))).sort(function(a, b) { return a - b; });

var out = {venues: {}, kinds: {}, restrooms: {}, lobbies: {}, unmatched: []};
function addVenue(name, deck, a, x) {
  if (!table.venues[name]) {
    throw new Error('not in the venue table: ' + name);
  }
  var pts = out.venues[name] = out.venues[name] || [];
  if (!pts.some(function(p) { return p[0] === deck && Math.hypot(p[1] - a, p[2] - x) < 3; })) {
    pts.push([deck, r1(a), r1(x)]);
  }
}
function addTo(bucket, key, a, x) {
  (bucket[key] = bucket[key] || []).push([r1(a), r1(x)]);
}

var labels = src.labels.filter(function(l) { return l.text !== '(icon)'; });
var used = {};

// 1. Elevator lobby labels and restroom symbols.
labels.forEach(function(l) {
  var bank = Math.abs(l.a - banks.fwd) < 6 ? 'fwd' : Math.abs(l.a - banks.aft) < 6 ? 'aft' : null;
  if (/ELEV/.test(l.text) || (bank && l.parts >= 5 && Math.abs(Math.abs(l.x) - 9) < 3 && !lookup(l.text))) {
    used[l.id] = true;
    if (bank) {
      var lob = out.lobbies[bank] = out.lobbies[bank] || {};
      (lob[l.deck] = lob[l.deck] || []).push(r1(l.x));
    }
  } else if (l.parts === 1 && (l.conf < 90 || !/[A-Z]{3}/.test(l.text))) {
    used[l.id] = true;
    addTo(out.restrooms, l.deck, l.a, l.x);
  }
});

// 2. Hand-checked splits, renames and generic kinds.
labels.forEach(function(l) {
  if (used[l.id]) { return; }
  ov.split.forEach(function(s) {
    if (s.deck === l.deck && s.text === l.text) {
      used[l.id] = true;
      s.points.forEach(function(p) { addVenue(p.venue, l.deck, p.a, p.x); });
    }
  });
  if (used[l.id]) { return; }
  ov.rename.forEach(function(r) {
    if (!used[l.id] && r.text === l.text && (r.deck === undefined || r.deck === l.deck)) {
      used[l.id] = true;
      [].concat(r.venue).forEach(function(v) { addVenue(v.replace('{deck}', l.deck), l.deck, l.a, l.x); });
    }
  });
});

// 3. Labels split over two lines ("MAIN" / "POOL"): try each pair on a deck first.
labels.forEach(function(l) {
  if (used[l.id]) { return; }
  labels.forEach(function(m) {
    if (used[l.id] || used[m.id] || m.id === l.id || m.deck !== l.deck || dist(l, m) > 4) { return; }
    var name = lookup(l.text + ' ' + m.text);
    if (name) {
      used[l.id] = used[m.id] = true;
      addVenue(name, l.deck, (l.a + m.a) / 2, (l.x + m.x) / 2);
    }
  });
});

// 4. Everything else: straight match, then generic kinds, then report.
labels.forEach(function(l) {
  if (used[l.id]) { return; }
  var name = lookup(l.text);
  if (name) {
    addVenue(name, l.deck, l.a, l.x);
  } else if (ov.kinds[l.text]) {
    addTo(out.kinds, ov.kinds[l.text] + ':' + l.deck, l.a, l.x);
  } else {
    out.unmatched.push({deck: l.deck, text: l.text, a: l.a, x: l.x});
  }
});
ov.add.forEach(function(p) { addVenue(p.venue, p.deck, p.a, p.x); });

// 5. Stairwells: steps within 4 m on a deck form one; the same spot on the next deck continues it.
var wells = [];
decksOnPlan.forEach(function(deck) {
  var steps = src.stairSteps.filter(function(s) { return s.deck === deck; });
  var groups = [];
  steps.forEach(function(s) {
    var hit = groups.filter(function(g) { return g.some(function(t) { return dist(s, t) <= 4; }); });
    var merged = [s];
    hit.forEach(function(g) { merged = merged.concat(g); groups.splice(groups.indexOf(g), 1); });
    groups.push(merged);
  });
  // A flight of steps is many small shapes; a spiral or a stair pod is one or two
  // bigger ones. Keep anything that covers at least 1.5 m.
  var span = function(g) {
    var lo = Math.min.apply(null, g.map(function(s) { return s.a - (s.len_m || 0) / 2; }));
    var hi = Math.max.apply(null, g.map(function(s) { return s.a + (s.len_m || 0) / 2; }));
    var l2 = Math.min.apply(null, g.map(function(s) { return s.x - (s.wide_m || 0) / 2; }));
    var h2 = Math.max.apply(null, g.map(function(s) { return s.x + (s.wide_m || 0) / 2; }));
    return Math.max(hi - lo, h2 - l2);
  };
  groups.filter(function(g) { return span(g) >= 1.5; }).forEach(function(g) {
    var p = {deck: deck, a: g.reduce(function(t, s) { return t + s.a; }, 0) / g.length,
             x: g.reduce(function(t, s) { return t + s.x; }, 0) / g.length};
    var idx = decksOnPlan.indexOf(deck);
    var below = idx > 0 ? decksOnPlan[idx - 1] : null;
    var w = wells.filter(function(v) { return v.decks[v.decks.length - 1] === below && dist(v, p) <= 3; })[0];
    if (w) {
      w.decks.push(deck);
      w.a = (w.a + p.a) / 2;
      w.x = (w.x + p.x) / 2;
    } else {
      wells.push({a: p.a, x: p.x, decks: [deck]});
    }
  });
});
var stairs = wells.map(function(w) {
  var core = Math.min(Math.abs(w.a - banks.fwd), Math.abs(w.a - banks.aft)) < 8;
  return [r1(w.a), r1(w.x), w.decks, core ? 'core' : 'stair'];
}).sort(function(p, q) { return p[0] - q[0] || p[1] - q[1]; });

// 6. Elevator banks: which decks each stops at, and where the lobby doors are each side.
var bankOut = {};
Object.keys(banks).forEach(function(b) {
  var lob = out.lobbies[b] || {};
  var xs = [].concat.apply([], Object.keys(lob).map(function(d) { return lob[d]; }));
  var med = function(v) { v = v.slice().sort(function(p, q) { return p - q; }); return v.length ? r1(v[v.length >> 1]) : null; };
  bankOut[b] = {a: banks[b], decks: Object.keys(lob).map(Number).sort(function(p, q) { return p - q; }),
                port: med(xs.filter(function(x) { return x < 0; })), starboard: med(xs.filter(function(x) { return x > 0; }))};
});

var result = {
  ship: src.ship, unit: 'm',
  banks: bankOut,
  stairs: stairs,
  venues: out.venues,
  restrooms: out.restrooms,
  other: out.kinds
};
fs.writeFileSync(outFile, '// Generated by tools/shipmap/build_places.js from Royal\'s deck-plan SVGs. Do not edit by hand.\n' +
  'module.exports = ' + JSON.stringify(result) + ';\n');

var missing = Object.keys(table.venues).filter(function(n) { return !out.venues[n]; });
console.log('venues placed ' + Object.keys(out.venues).length + ' of ' + Object.keys(table.venues).length +
            ', stairwells ' + stairs.length + ', restroom spots ' +
            Object.keys(out.restrooms).reduce(function(t, d) { return t + out.restrooms[d].length; }, 0) +
            ', file ' + fs.statSync(outFile).size + ' bytes');
console.log('labels not matched: ' + JSON.stringify(out.unmatched));
console.log('venues with no spot on the plans: ' + missing.join(', '));
