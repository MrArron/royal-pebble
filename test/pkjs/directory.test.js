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
  assert.deepStrictEqual(p.rows[0], {kind: directory.ROW_ITEM, ref: directory.REF_AREAS, line1: 'Browse by area', line2: '',
                                     flags: 0});
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
  // No stateroom: the GPS hint replaces the old "↓2 decks from cabin" line.
  assert.deepStrictEqual(p.where, {deck: 4, deckTo: 0, pos: 2, ashore: false, rel: null});
  assert.strictEqual(p.gps.flags, directory.GPS_NO_CABIN);
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

// ---- Ship GPS on place pages (docs/DESIGN_V1_1.md §9.1) ----------------------

var CABIN = {me: {deck: 'Deck 9', stateroom: '9254'}};  // deck 9, aft, port

function placeRef(name, settings) {
  var list = directory.places('HM', ((settings || {}).venues || {}).HM);
  var v = list.filter(function(x) { return x.name === name; })[0];
  assert.ok(v, name);
  return directory.REF_PLACE + list.indexOf(v);
}

function gpsPage(name, opts) {
  opts = opts || {};
  return page(placeRef(name, opts.settings || CABIN), {settings: opts.settings || CABIN, bundle: opts.bundle});
}

test('GPS: FROM YOUR CABIN with the deck change and walking distance', function() {
  var p = gpsPage('Royal Theater');
  assert.strictEqual(p.gps.header, 'FROM YOUR CABIN');
  assert.strictEqual(p.gps.flags, 0);
  assert.ok(p.gps.decks < 0, 'theater is below deck 9');
  assert.ok(/^[0-9]+ m fore$/.test(p.gps.text), p.gps.text);
  assert.strictEqual(p.where.rel, null);
  assert.ok(/^[0-9]+ ft fore$/.test(gpsPage('Royal Theater', {settings: {
    me: CABIN.me, units: 'ft'}}).gps.text));
  assert.ok(/^[0-9]+ steps fore$/.test(gpsPage('Royal Theater', {settings: {
    me: CABIN.me, units: 'steps'}}).gps.text));
});

test('GPS: a place on the cabin deck says "Your deck"', function() {
  var d9 = page(directory.REF_DECK + 9, {settings: CABIN});
  var item = d9.rows.filter(function(r) { return r.kind === directory.ROW_ITEM; })[0];
  var p = page(item.ref, {settings: CABIN});
  assert.strictEqual(p.gps.decks, 0);
  assert.ok(new RegExp('^Your deck' + DOT + '[0-9]').test(p.gps.text), p.gps.text);
});

test('GPS: approximate spots, owner-added venues, no GPS ashore or off the map', function() {
  assert.strictEqual(gpsPage('Royal Shops').gps.flags, directory.GPS_APPROX);
  var settings = {me: CABIN.me, venues: {HM: {'Secret Bar': {decks: [14], position: 'Fore',
                                                                neighborhood: 'Central Park'}}}};
  var own = gpsPage('Secret Bar', {settings: settings});
  assert.strictEqual(own.gps.flags, directory.GPS_APPROX);
  assert.ok(own.gps.decks > 0);
  // An edited deck the plans don't show for it: approximate too.
  var moved = gpsPage('Studio B', {settings: {me: CABIN.me, venues: {HM: {'Studio B': {decks: [7]}}}}});
  assert.strictEqual(moved.gps.flags, directory.GPS_APPROX);
  assert.strictEqual(moved.gps.decks, -2);
  assert.strictEqual(gpsPage('Perfect Day at CocoCay').gps, null);
  assert.ok(!('dir_gps' in directory.message(gpsPage('Perfect Day at CocoCay'))));
  var other = makeBundle();
  other.ship.code = 'XX';
  assert.strictEqual(directory.buildPage(directory.REF_PLACE, {bundle: other, settings: CABIN, now: NOW}).gps,
                     undefined);
  // A stateroom the map doesn't know: no FROM block rather than a wrong hint,
  // but the closest restroom (from the venue) still shows.
  var lost = gpsPage('Studio B', {settings: {me: {stateroom: '99999'}}}).gps;
  assert.strictEqual(lost.flags, directory.GPS_NO_FROM);
  assert.ok(lost.rest && lost.rest.text, JSON.stringify(lost));
});

test('GPS: no stateroom gives the hint flag; the booking stateroom counts', function() {
  var p = gpsPage('Studio B', {settings: {me: {deck: 'Deck 9'}}});
  assert.deepStrictEqual([p.gps.header, p.gps.decks, p.gps.text, p.gps.flags], ['', 0, '', directory.GPS_NO_CABIN]);
  assert.ok(p.gps.rest, 'the closest restroom shows without a cabin');
  var bundle = makeBundle();
  bundle.mine = {stateroom: '9254'};
  assert.strictEqual(gpsPage('Studio B', {settings: {}, bundle: bundle}).gps.header, 'FROM YOUR CABIN');
  bundle.mine = {stateroom: 'GTY'};
  assert.strictEqual(gpsPage('Studio B', {settings: {}, bundle: bundle}).gps.flags, directory.GPS_NO_CABIN);
});

test('GPS: a stop on now (or just ended) is the start (§9.4)', function() {
  function at(time, minutes) {
    return {me: CABIN.me, personal: [{title: 'Show', venue: 'Studio B', date: '2027-03-07', time: time,
                                      minutes: minutes}]};
  }
  assert.strictEqual(gpsPage('Royal Theater', {settings: at('13:30', 60)}).gps.header, 'FROM STUDIO B');
  assert.strictEqual(gpsPage('Royal Theater', {settings: at('12:50', 60)}).gps.header, 'FROM STUDIO B');
  assert.strictEqual(gpsPage('Royal Theater', {settings: at('12:00', 60)}).gps.header, 'FROM YOUR CABIN');
  assert.strictEqual(gpsPage('Royal Theater', {settings: at('15:00', 60)}).gps.header, 'FROM YOUR CABIN');
  // A stop there works without a stateroom too.
  var noRoom = at('13:30', 60);
  noRoom.me = {};
  assert.strictEqual(gpsPage('Royal Theater', {settings: noRoom}).gps.header, 'FROM STUDIO B');
});

test('GPS: dir_gps packs decks, flags, header and text', function() {
  var g = {header: 'FROM YOUR CABIN', decks: -2, text: '160 m fore', flags: directory.GPS_APPROX};
  var b = directory.encodeGps(g);
  assert.deepStrictEqual(b.slice(0, 3), [254, 1, 15]);
  assert.strictEqual(String.fromCharCode.apply(null, b.slice(3, 18)), 'FROM YOUR CABIN');
  assert.strictEqual(b[18], 10);
  assert.strictEqual(b.length, 29);
  assert.deepStrictEqual(directory.message(gpsPage('Royal Theater')).dir_gps,
                         directory.encodeGps(gpsPage('Royal Theater').gps));
  // The restroom follows: int8 decks, then its text.
  g.rest = {decks: 1, text: '20 m aft'};
  var r = directory.encodeGps(g);
  assert.deepStrictEqual(r.slice(0, 29), b);
  assert.deepStrictEqual(r.slice(29, 31), [1, 8]);
  assert.strictEqual(String.fromCharCode.apply(null, r.slice(31)), '20 m aft');
});

test('GPS: closest restroom from the venue, in the owner units', function() {
  var p = gpsPage('Royal Theater');
  assert.strictEqual(typeof p.gps.rest.decks, 'number');
  assert.ok(/^[0-9]+ m( fore| aft)?$/.test(p.gps.rest.text), p.gps.rest.text);
  var steps = gpsPage('Royal Theater', {settings: {me: CABIN.me, units: 'steps'}});
  assert.ok(/^[0-9]+ steps/.test(steps.gps.rest.text), steps.gps.rest.text);
  // None ashore.
  assert.strictEqual(gpsPage('Perfect Day at CocoCay').gps, null);
});

// ---- Route screen (docs/DESIGN_V1_1.md §9.2) --------------------------------

function route(name, rest, opts) {
  opts = opts || {};
  var settings = opts.settings || CABIN;
  var ref = typeof name === 'number' ? name : placeRef(name, settings);
  return directory.routePage(ref, rest, {bundle: opts.bundle || makeBundle(), settings: settings, stars: {},
                                         now: NOW});
}

test('route: steps with glyphs, the arrival last, and the summary', function() {
  var p = route('Royal Theater');
  assert.strictEqual(p.title, 'Royal Theater');
  assert.strictEqual(p.header, 'FROM YOUR CABIN');
  assert.strictEqual(p.lead, '');
  assert.strictEqual(p.flags, 0);
  var last = p.steps[p.steps.length - 1];
  assert.deepStrictEqual(last, {glyph: 4, text: 'Royal Theater'});
  assert.ok(p.steps.some(function(s) { return s.glyph === 2 || s.glyph === 3; }), 'changes deck');
  assert.ok(/^(Fore|Mid|Aft) (elev|stairs) to Deck [0-9]+$/.test(p.steps[1].text), p.steps[1].text);
  assert.ok(p.small.decks < 0);
  assert.ok(/^[0-9]+ m in all$/.test(p.small.text), p.small.text);
  assert.strictEqual(p.big, '');
  assert.ok(/^[0-9]+ ft/.test(route('Royal Theater', false, {settings: {me: CABIN.me, units: 'ft'}}).steps[0].text));
});

test('route: shown less for an approximate spot, same area on the cabin deck', function() {
  var shops = route('Royal Shops');
  assert.strictEqual(shops.flags, directory.ROUTE_REDUCED);
  assert.ok(!/in all/.test(shops.small.text), shops.small.text);
  var near = route(directory.REF_BANK + 1);  // the aft bank, near cabin 9254
  assert.strictEqual(near.title, 'Aft elevators');
  assert.strictEqual(near.lead, 'Same area' + DOT + 'your deck');
  assert.strictEqual(near.steps.length, 2);
  assert.strictEqual(near.small.text, '');
});

test('route: from a stop on now, and messages when there is none', function() {
  var settings = {me: CABIN.me, personal: [{title: 'Show', venue: 'Studio B', date: '2027-03-07', time: '13:30',
                                            minutes: 60}]};
  assert.strictEqual(route('Royal Theater', false, {settings: settings}).header, 'FROM STUDIO B');
  var none = route('Studio B', false, {settings: {me: {deck: 'Deck 9'}}});
  assert.deepStrictEqual([none.title, none.steps.length], ['Studio B', 0]);
  assert.ok(/stateroom/.test(none.lead));
  assert.strictEqual(route('Studio B', false, {settings: {me: {stateroom: '99999'}}}).lead, 'No route found');
  assert.strictEqual(route(directory.REF_PLACE + 9999).title, 'Not found');
  assert.strictEqual(route('Perfect Day at CocoCay').title, 'Not found');
  // Elevator banks have no restroom route.
  assert.strictEqual(route(directory.REF_BANK, true).title, 'Not found');
});

test('route: to the closest restroom from the venue, as on the place page', function() {
  var p = route('Royal Theater', true);
  assert.strictEqual(p.title, 'Restroom');
  assert.strictEqual(p.header, 'CLOSEST TO ROYAL THEATER');
  assert.deepStrictEqual(p.steps[p.steps.length - 1], {glyph: 4, text: 'Restroom'});
  assert.ok(/^Deck [0-9]+ · (Fore|Mid|Aft)$/.test(p.big), p.big);
  assert.ok(/^(Same deck as|[0-9]+ decks? (above|below)) Royal Theater$/.test(p.small.text), p.small.text);
  // The same restroom as the place page's line (one walk there).
  assert.strictEqual(p.steps.length, 2);
  assert.strictEqual(p.steps[0].text, gpsPage('Royal Theater').gps.rest.text);
  // Without a stateroom it still works: it starts at the venue.
  assert.strictEqual(route('Royal Theater', true, {settings: {me: {deck: 'Deck 9'}}}).title, 'Restroom');
});

test('route: ROUTE_PAGE packs flags, decks, texts and steps', function() {
  var p = {ref: 1074, rest: true, title: 'Restroom', header: 'CLOSEST TO X', lead: '', big: 'Deck 4',
           small: {decks: -1, text: 'ab'}, flags: 1, steps: [{glyph: 0, text: '5 m'}, {glyph: 4, text: 'Restroom'}]};
  var b = directory.encodeRoute(p);
  assert.deepStrictEqual(b.slice(0, 3), [1, 255, 8]);
  var i = 3 + 8;
  assert.strictEqual(b[i], 12);
  i += 13;
  assert.strictEqual(b[i], 0);  // lead
  i += 1;
  assert.strictEqual(b[i], 6);  // big
  i += 7;
  assert.deepStrictEqual(b.slice(i, i + 3), [2, 97, 98]);
  i += 3;
  assert.deepStrictEqual(b.slice(i, i + 5), [2, 0, 3, 53, 32]);
  assert.strictEqual(b.length, i + 1 + 5 + 10);
  var m = directory.routeMsg(p);
  assert.deepStrictEqual([m.dir_ref, m.route_rest], [1074, 1]);
  // A route with a crossing: every step and the arrival fit.
  var boleros = route('Boleros').steps;
  assert.ok(boleros.some(function(s) { return s.glyph === 1 && s.text === 'Cross the ship'; }));
  assert.ok(boleros.length <= directory.ROUTE_STEPS_MAX);
});

// Home's NEXT (§9.5): the route to an event, from where you'll be before it.
function eventRoute(venue, start, settings) {
  return directory.eventRoutePage({start: start, venue: venue},
                                  {bundle: makeBundle(), settings: settings || CABIN, stars: {}, now: NOW});
}
var AT_3PM = 1440 + 15 * 60;  // cruise minutes, 2027-03-07 15:00

test('event route: steps without the summary, and route_start echoed', function() {
  var p = eventRoute('Royal Theater', AT_3PM);
  assert.strictEqual(p.title, 'Royal Theater');
  assert.strictEqual(p.header, 'FROM YOUR CABIN');
  assert.deepStrictEqual(p.steps[p.steps.length - 1], {glyph: 4, text: 'Royal Theater'});
  assert.deepStrictEqual(p.steps, route('Royal Theater').steps);
  assert.deepStrictEqual([p.big, p.small.text], ['', '']);
  var m = directory.routeMsg(p);
  assert.deepStrictEqual([m.dir_ref, m.route_rest, m.route_start], [0, 0, AT_3PM]);
  assert.strictEqual(directory.routeMsg(route('Royal Theater')).route_start, undefined);
});

test('event route: starts at a stop ending just before the event, not one on now', function() {
  function stop(time, minutes) {
    return {me: CABIN.me, personal: [{title: 'Show', venue: 'Studio B', date: '2027-03-07', time: time,
                                      minutes: minutes}]};
  }
  // Ends 14:50, ten minutes before the 15:00 event.
  assert.strictEqual(eventRoute('Royal Theater', AT_3PM, stop('14:00', 50)).header, 'FROM STUDIO B');
  // On now (13:30-14:30), but it ends 90 minutes before a 16:00 event.
  assert.strictEqual(eventRoute('Royal Theater', AT_3PM + 60, stop('13:30', 60)).header, 'FROM YOUR CABIN');
  // After midnight: a 00:30 event is still the evening's (cruise minutes past 24:00).
  var late = {me: CABIN.me, personal: [{title: 'Late', venue: 'Studio B', date: '2027-03-07', time: '23:30',
                                        minutes: 50}]};
  assert.strictEqual(eventRoute('Royal Theater', 2 * 1440 + 30, late).header, 'FROM STUDIO B');
});

test('event route: a venue cut short on the watch, and messages', function() {
  var settings = {me: CABIN.me, personal: [{title: 'Party', venue: 'Royal Theater', date: '2027-03-07',
                                            time: '15:00', minutes: 60}]};
  assert.strictEqual(eventRoute('Royal Thea', AT_3PM, settings).title, 'Royal Theater');
  var none = eventRoute('Royal Theater', AT_3PM, {me: {deck: 'Deck 9'}});
  assert.strictEqual(none.steps.length, 0);
  assert.ok(/stateroom/.test(none.lead));
  assert.strictEqual(eventRoute('Nowhere Lounge', AT_3PM).lead, 'No route found');
  assert.strictEqual(eventRoute('Perfect Day at CocoCay', AT_3PM).lead, 'No route found');
});

test('elevator banks: deck rows, the Elevators area and bank pages', function() {
  var d5 = page(directory.REF_DECK + 5, {settings: CABIN});
  var names = d5.rows.map(function(r) { return r.line1; });
  var fore = find(d5.rows, 'Fore elevators');
  assert.deepStrictEqual([fore.ref, fore.flags], [directory.REF_BANK, directory.ROW_MUTED]);
  // Last in its group: FORE ... Fore elevators, MID.
  assert.strictEqual(names[names.indexOf('Fore elevators') + 1], 'MID');
  assert.strictEqual(names[names.indexOf('Aft elevators') + 1], 'FULL LENGTH');
  // Deck 17: only the aft bank stops there.
  var d17 = page(directory.REF_DECK + 17, {settings: CABIN});
  assert.ok(find(d17.rows, 'Aft elevators'));
  assert.ok(!find(d17.rows, 'Fore elevators'));

  var areas = page(directory.REF_AREAS);
  var n = areas.rows.length;
  assert.deepStrictEqual([areas.rows[n - 2].line1, areas.rows[n - 2].line2, areas.rows[n - 1].line1],
                         ['Elevators', 'Fore' + DOT + 'Aft', 'Ashore']);
  var lifts = page(directory.REF_ELEVATORS);
  assert.deepStrictEqual(lifts.rows.map(function(r) { return [r.line1, r.line2]; }),
                         [['Elevators', ''], ['Fore elevators', 'Decks 3-16'], ['Aft elevators', 'Decks 3-17']]);

  var aft = page(directory.REF_BANK + 1, {settings: CABIN});
  assert.strictEqual(aft.title, 'Place');
  assert.deepStrictEqual(aft.rows, [{kind: directory.ROW_PLACE, ref: 0, line1: 'Aft elevators', line2: ''}]);
  assert.strictEqual(aft.bank.text, 'Aft' + DOT + 'Decks 3-17');
  assert.deepStrictEqual(aft.bank.decks, [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17]);
  assert.strictEqual(aft.bank.cabin, 9);
  // The cabin (9254, aft) is on a deck the bank stops at: the lobby on this deck.
  assert.strictEqual(aft.gps.header, 'FROM YOUR CABIN');
  assert.ok(new RegExp('^Your deck' + DOT + '[0-9]+ m').test(aft.gps.text), aft.gps.text);
  assert.ok(!aft.gps.rest);
  var m = directory.message(aft);
  assert.deepStrictEqual(m.dir_bank.slice(0, 16), [9, 14, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17]);
  assert.strictEqual(m.dir_bank[16], m.dir_bank.length - 17);
  assert.ok(!('dir_where' in m));

  // No banks on a ship with no map.
  assert.strictEqual(directory.bankDecksText([3, 4, 5], [3, 4, 5]), 'all decks');
  assert.strictEqual(directory.bankDecksText([3, 5, 6], [2, 3, 4, 5, 6]), 'Decks 3, 5-6');
  var other = makeBundle();
  other.ship.code = 'XX';
  var none = directory.buildPage(directory.REF_AREAS, {bundle: other, settings: {}, now: NOW});
  assert.ok(!find(none.rows, 'Elevators'));
  assert.strictEqual(directory.buildPage(directory.REF_BANK, {bundle: other, settings: {}, now: NOW}).rows[0].line1,
                     'Not found');
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
