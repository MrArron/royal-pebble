// Unit tests for the watch's ship directory pages. Run: node test/pkjs/directory.test.js
var assert = require('assert');
var directory = require('../../src/pkjs/directory');
var slice = require('../../src/pkjs/slice');
var pack = require('../../src/pkjs/pack');

var tests = [];
function test(name, fn) { tests.push({name: name, fn: fn}); }

var DOT = ' ' + String.fromCharCode(183) + ' ';

function makeBundle(events) {
  return {
    format: 'cruise-watch', v: 1, generated: '2027-03-07T12:00:00Z',
    ship: {code: 'HM', name: 'Harmony of the Seas'},
    sailDate: '2027-03-06',
    itinerary: [
      {day: 1, date: '2027-03-06', port: 'Orlando (Port Canaveral), Fl', type: 'EMBARK', arrive: null, depart: '16:00'},
      {day: 2, date: '2027-03-07', port: 'Cruising', type: 'CRUISING', arrive: null, depart: null}
    ],
    schedule: {
      published: true,
      cats: [['Entertainment', 'Shows'], ['Shop', 'Retail']],
      venues: ['Studio B', 'Center Ice Rink', 'Promenade Shops', 'Boleros'],
      fields: ['title', 'venue', 'cat', 'date', 'time', 'minutes', 'featured', 'reservation'],
      events: events || []
    }
  };
}

// 2027-03-07 at 14:00 ship time (the watch and phone clocks are ship time).
var NOW = new Date(2027, 2, 7, 14, 0);

function page(ref, opts) {
  opts = opts || {};
  return directory.buildPage(ref, {bundle: opts.bundle || makeBundle(), settings: opts.settings || {me: {deck: 'Deck 6'}},
                                   stars: opts.stars || {}, now: NOW});
}

function find(rows, line1) {
  return rows.filter(function(r) { return r.line1 === line1; })[0];
}

test('first page lists decks with areas and counts, then Ashore', function() {
  var p = page(directory.REF_DECKS);
  assert.strictEqual(p.title, 'Ship');
  assert.strictEqual(p.label, 'by deck');
  assert.strictEqual(p.rel, null);
  assert.deepStrictEqual(p.rows[0], {kind: directory.ROW_ITEM, ref: directory.REF_AREAS, line1: 'Browse by area', line2: ''});
  var decks = p.rows.slice(1, -1).map(function(r) { return +r.line1.split(' ')[1]; });
  assert.deepStrictEqual(decks, decks.slice().sort(function(a, b) { return a - b; }));
  var d5 = find(p.rows, 'Deck 5');
  assert.strictEqual(d5.ref, directory.REF_DECK + 5);
  assert.ok(/^Promenade/.test(d5.line2), d5.line2);
  assert.strictEqual(find(p.rows, 'Deck 2').line2, '1 place');  // Medical Center, no area
  // Multi-entrance venues count on each of their decks (Royal Theater 3-5).
  assert.ok(find(p.rows, 'Deck 3'));
  assert.ok(find(p.rows, 'Deck 6' + DOT + 'your deck'));
  var last = p.rows[p.rows.length - 1];
  assert.strictEqual(last.line1, 'Ashore');
  assert.strictEqual(last.line2, 'Perfect Day at CocoCay');
  assert.strictEqual(last.ref, directory.REF_AREA + directory.AREA_KEYS.indexOf('Ashore'));
});

test('without a cabin deck no deck says "your deck"', function() {
  var p = page(directory.REF_DECKS, {settings: {}});
  assert.ok(find(p.rows, 'Deck 6'));
  assert.ok(!p.rows.some(function(r) { return /your deck/.test(r.line1); }));
  assert.strictEqual(page(directory.REF_DECK + 5, {settings: {}}).rel, null);
});

test('deck page groups by position and knows the decks from the cabin', function() {
  var p = page(directory.REF_DECK + 5);
  assert.strictEqual(p.title, 'Deck 5');
  assert.strictEqual(p.rel, -1);
  var headers = p.rows.filter(function(r) { return r.kind === directory.ROW_HEADER; }).map(function(r) { return r.line1; });
  assert.deepStrictEqual(headers, ['FORE', 'MID', 'AFT', 'FULL LENGTH']);
  assert.ok(find(p.rows, 'Royal Theater'));
  assert.ok(find(p.rows, 'Guest Services'));
  assert.ok(find(p.rows, 'AquaTheater'));
  // Within a position, by name.
  var mid = p.rows.slice(p.rows.indexOf(find(p.rows, 'MID')) + 1, p.rows.indexOf(find(p.rows, 'AFT')));
  var names = mid.map(function(r) { return r.line1; });
  assert.deepStrictEqual(names, names.slice().sort());
  assert.strictEqual(page(directory.REF_DECK + 6).rel, 0);
  assert.strictEqual(page(directory.REF_DECK + 15).rel, 9);
});

test('areas page and an area page', function() {
  var p = page(directory.REF_AREAS);
  assert.strictEqual(p.label, 'by area');
  assert.strictEqual(p.rows[0].line1, 'Central Park');
  assert.strictEqual(p.rows[0].line2, 'Decks 8-9' + DOT + '16');
  assert.ok(find(p.rows, 'Other places'));
  assert.strictEqual(p.rows[p.rows.length - 1].line1, 'Ashore');

  var cp = page(find(p.rows, 'Central Park').ref);
  assert.strictEqual(cp.title, 'Area');
  assert.deepStrictEqual(cp.rows[0], {kind: directory.ROW_PLACE, ref: 0, line1: 'Central Park', line2: ''});
  assert.deepStrictEqual(cp.rows.filter(function(r) { return r.kind === directory.ROW_HEADER; })
    .map(function(r) { return r.line1; }), ['DECK 8' + DOT + 'MID', 'DECK 8' + DOT + 'AFT']);
  var ep = page(find(p.rows, 'Entertainment Place').ref);
  assert.strictEqual(ep.rows[0].line1, 'Entertainment Place');
  // Royal Theater (3-5) shows once, under the entrance nearest the cabin (6).
  assert.strictEqual(ep.rows.filter(function(r) { return r.line1 === 'Royal Theater'; }).length, 1);
  var rt = ep.rows.indexOf(find(ep.rows, 'Royal Theater'));
  var above = ep.rows.slice(0, rt).filter(function(r) { return r.kind === directory.ROW_HEADER; }).pop();
  assert.strictEqual(above.line1, 'DECK 5' + DOT + 'FORE');
  var ashore = page(directory.REF_AREA + directory.AREA_KEYS.indexOf('Ashore'));
  assert.deepStrictEqual(ashore.rows.map(function(r) { return r.line1; }), ['Ashore', 'Perfect Day at CocoCay']);
});

test('place page: where it is and the rest of today there, aliases included', function() {
  var bundle = makeBundle([
    ['Morning Skate', 0, 0, '2027-03-07', '09:00', 60, false, false],       // over
    ['Ice Show', 1, 0, '2027-03-07', '13:30', 60, true, true],               // on now, alias venue
    ['Late Trivia', 0, 0, '2027-03-07', '01:00', 30, false, false],          // after midnight (listed under the evening)
    ['Tomorrow Skate', 0, 0, '2027-03-08', '10:00', 60, false, false],       // tomorrow
    ['Salsa', 3, 0, '2027-03-07', '20:00', 60, false, false]                 // elsewhere
  ]);
  var d4 = page(directory.REF_DECK + 4, {bundle: bundle});
  var ref = find(d4.rows, 'Studio B').ref;
  var p = page(ref, {bundle: bundle, stars: {}});
  assert.strictEqual(p.title, 'Place');
  assert.deepStrictEqual(p.where, {deck: 4, deckTo: 0, pos: 2, ashore: false, rel: -2});
  assert.strictEqual(p.rows[0].kind, directory.ROW_PLACE);
  assert.strictEqual(p.rows[0].line1, 'Studio B');
  assert.strictEqual(p.rows[0].line2, 'Entertainment Place');
  assert.strictEqual(p.rows[1].line1, 'LATER TODAY');
  var events = p.rows.filter(function(r) { return r.kind === directory.ROW_EVENT; });
  assert.deepStrictEqual(events.map(function(r) { return r.line1; }), ['Ice Show', 'Late Trivia']);
  assert.strictEqual(events[0].start, 1440 + 13 * 60 + 30);
  assert.strictEqual(events[0].minutes, 60);
  assert.strictEqual(events[0].flags & slice.FLAG_FEATURED, slice.FLAG_FEATURED);
  assert.strictEqual(events[1].start, 2 * 1440 + 60);

  var gs = page(find(page(directory.REF_DECK + 5).rows, 'Guest Services').ref);
  assert.strictEqual(gs.rows[1].line1, 'TODAY');
  assert.strictEqual(gs.rows[2].line1, 'Nothing more today');
  assert.strictEqual(gs.rows[2].ref, 0);
});

test('place page: several entrances without a cabin deck send the range', function() {
  var d4 = page(directory.REF_DECK + 4, {settings: {}});
  var p = page(find(d4.rows, 'Royal Theater').ref, {settings: {}});
  assert.deepStrictEqual(p.where, {deck: 3, deckTo: 5, pos: 1, ashore: false, rel: null});
});

test('owner edits move venues and add new ones', function() {
  var settings = {me: {deck: '6'}, venues: {HM: {
    'Studio B': {decks: [7]},
    'Secret Bar': {decks: [9], position: 'Fore', neighborhood: 'Central Park'},
    'Unknown Venue': {confirmed: {deck: true}}
  }}};
  assert.ok(!find(page(directory.REF_DECK + 4, {settings: settings}).rows, 'Studio B'));
  assert.ok(find(page(directory.REF_DECK + 7, {settings: settings}).rows, 'Studio B'));
  var d9 = page(directory.REF_DECK + 9, {settings: settings});
  assert.ok(find(d9.rows, 'Secret Bar'));
  var list = directory.places('HM', settings.venues.HM);
  assert.ok(!list.some(function(v) { return v.name === 'Unknown Venue'; }));
});

test('unknown ship and stale refs', function() {
  var bundle = makeBundle();
  bundle.ship.code = 'XX';
  var p = page(directory.REF_DECKS, {bundle: bundle});
  assert.strictEqual(p.rows.length, 2);
  assert.strictEqual(p.rows[1].line1, 'No venues for this ship');
  assert.strictEqual(page(directory.REF_PLACE + 5000).rows[0].line1, 'Not found');
  assert.strictEqual(page(directory.REF_DECK + 2, {}).rows[1].line1, 'Medical Center');
});

test('rows pack little-endian and stay inside one message', function() {
  var b = directory.encodeRow({kind: 2, ref: 1234, start: 3000, minutes: 90, flags: 5, line1: 'Ab', line2: ''});
  assert.deepStrictEqual(b, [2, 1234 & 255, 1234 >> 8, 3000 & 255, 3000 >> 8, 0, 0, 90, 0, 5, 2, 65, 98, 0]);
  var headerRow = directory.encodeRow({kind: 0, ref: 0, line1: 'X', line2: ''});
  assert.deepStrictEqual(headerRow.slice(3, 7), [255, 255, 255, 255]);  // no start: -1

  var many = [];
  for (var i = 0; i < 80; i++) {
    many.push({kind: 1, ref: 1000 + i, line1: 'A long venue name number ' + i, line2: 'with a sub-line too'});
  }
  var bytes = directory.packRows(many);
  assert.ok(bytes.length <= directory.ROWS_MAX_BYTES, bytes.length);
  // Decode and check the last row says how many were left out.
  var rows = [];
  var at = 0;
  while (at < bytes.length) {
    var n1 = bytes[at + 10];
    var n2 = bytes[at + 11 + n1];
    rows.push(String.fromCharCode.apply(null, bytes.slice(at + 11, at + 11 + n1)));
    at += 12 + n1 + n2;
  }
  assert.strictEqual(at, bytes.length);
  assert.ok(rows.length <= directory.MAX_ROWS);
  assert.strictEqual(rows[rows.length - 1], (80 - rows.length + 1) + ' more');

  // Every real page fits without cutting.
  var all = [directory.REF_DECKS, directory.REF_AREAS];
  for (var d = 1; d <= 18; d++) { all.push(directory.REF_DECK + d); }
  directory.AREA_KEYS.forEach(function(k, j) { all.push(directory.REF_AREA + j); });
  all.forEach(function(ref) {
    var p = page(ref);
    var m = directory.message(p);
    assert.ok(p.rows.length <= directory.MAX_ROWS, ref + ': ' + p.rows.length + ' rows');
    assert.strictEqual(m.dir_rows.length, p.rows.reduce(function(s, r) { return s + directory.encodeRow(r).length; }, 0), 'cut: ' + ref);
  });
});

test('message carries rel and where only when known', function() {
  var m = directory.message(page(directory.REF_DECK + 5));
  assert.strictEqual(m.dir_title, 'Deck 5');
  assert.strictEqual(m.dir_rel, -1);
  assert.ok(!('dir_where' in m));
  var p = page(find(page(directory.REF_DECK + 5).rows, 'Boleros').ref);
  var pm = directory.message(p);
  assert.ok(!('dir_rel' in pm));
  assert.deepStrictEqual(pm.dir_where, pack.encodeWhere(p.where));
  assert.ok(!('dir_rel' in directory.message(page(directory.REF_DECKS))));
});

var failed = 0;
tests.forEach(function(t) {
  try {
    t.fn();
    console.log('ok   ' + t.name);
  } catch (e) {
    failed++;
    console.log('FAIL ' + t.name + '\n     ' + (e && e.stack || e));
  }
});
console.log((tests.length - failed) + '/' + tests.length + ' passed');
if (failed) {
  process.exit(1);
}
