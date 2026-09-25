// Unit tests for the venue table and the owner's edits. Run: node test/pkjs/venues.test.js
var assert = require('assert');
var venues = require('../../src/pkjs/venues');
var L = venues.lib;

var tests = [];
function test(name, fn) { tests.push({name: name, fn: fn}); }

var DOT = ' ' + String.fromCharCode(183) + ' ';
var HM = venues.builtIn('HM');

function find(list, name) {
  return list.filter(function(v) { return v.name === name; })[0];
}

test('built-in table is well formed', function() {
  var names = Object.keys(HM.venues);
  assert.ok(names.length > 40);
  names.forEach(function(n) {
    var v = HM.venues[n];
    assert.ok(v.neighborhood === null || v.neighborhood === venues.ASHORE || venues.AREAS.indexOf(v.neighborhood) !== -1, n);
    assert.ok(v.position === null || L.POSITIONS.indexOf(v.position) !== -1, n);
    assert.deepStrictEqual(v.decks, v.decks.slice().sort(function(a, b) { return a - b; }), n);
  });
  Object.keys(HM.aliases).forEach(function(a) {
    assert.ok(HM.venues[HM.aliases[a]], 'alias target ' + HM.aliases[a]);
  });
  assert.deepStrictEqual(HM.venues['Royal Theater'].decks, [3, 4, 5]);
  assert.deepStrictEqual(venues.builtIn('XX'), {venues: {}, aliases: {}});
});

test('lookup ignores case, marks and spaces and follows aliases', function() {
  assert.strictEqual(L.lookup(HM, 'Studio B'), 'Studio B');
  assert.strictEqual(L.lookup(HM, '  studio   b '), 'Studio B');
  assert.strictEqual(L.lookup(HM, 'STUDIO-B'), 'Studio B');
  assert.strictEqual(L.lookup(HM, 'Giovannis Wine Bar'), "Giovanni's Wine Bar");
  assert.strictEqual(L.lookup(HM, 'Boot and Bonnet Pub'), 'Boot & Bonnet Pub');
  assert.strictEqual(L.lookup(HM, 'Casino Royale Non-Smoking'), 'Casino Royale');
  assert.strictEqual(L.lookup(HM, 'casino royale non smoking'), 'Casino Royale');
  assert.strictEqual(L.lookup(HM, 'Perfect Day CocoCay'), 'Perfect Day at CocoCay');
  assert.strictEqual(L.lookup(HM, 'Adventure Ocean'), 'Adventure Ocean Theater');
  assert.strictEqual(L.lookup(HM, 'Caf' + String.fromCharCode(233) + ' Promenade'), 'Cafe Promenade');
  assert.strictEqual(L.lookup(HM, 'Nowhere'), null);
  assert.strictEqual(L.lookup(HM, ''), null);
  assert.strictEqual(L.norm('Caf' + String.fromCharCode(233)), 'cafe');
});

test('resolve: built-in, flagged, edited and confirmed fields', function() {
  var base = HM.venues['Rock Climbing Wall'];  // deck flagged
  var v = L.resolve('Rock Climbing Wall', base, null);
  assert.deepStrictEqual(v.decks, [7]);
  assert.deepStrictEqual(v.check, {deck: true, position: false, neighborhood: false});
  assert.strictEqual(v.toCheck, true);
  assert.strictEqual(v.isEdited, false);
  assert.strictEqual(v.blank, false);

  var over = L.setField({}, base, 'deck', [6]);
  v = L.resolve('Rock Climbing Wall', base, over);
  assert.deepStrictEqual(v.decks, [6]);
  assert.strictEqual(v.edited.deck, true);
  assert.strictEqual(v.check.deck, false, 'an edited field is never flagged');
  assert.strictEqual(v.toCheck, false);
  assert.strictEqual(v.isEdited, true);

  over = L.confirm({}, 'deck');
  v = L.resolve('Rock Climbing Wall', base, over);
  assert.strictEqual(v.check.deck, false);
  assert.strictEqual(v.isEdited, false, 'confirming is not editing');
  assert.strictEqual(v.toCheck, false);
});

test('setting a field back to the built-in value drops the edit', function() {
  var base = HM.venues['Studio B'];
  var over = L.setField({}, base, 'deck', [5, 5, 3]);
  assert.deepStrictEqual(over, {decks: [3, 5]});
  L.setField(over, base, 'deck', [4]);
  assert.deepStrictEqual(over, {});
  L.setField(over, base, 'position', null);
  assert.deepStrictEqual(over, {position: null}, 'no position is a real edit');
  L.setField(over, base, 'position', 'Mid');
  assert.deepStrictEqual(over, {});
});

test('Reset puts back the value and its flag, unless confirmed', function() {
  var base = HM.venues['Kids Shop'];  // every field flagged
  var over = {};
  L.setField(over, base, 'deck', [6]);
  L.setField(over, base, 'position', 'Aft');
  L.confirm(over, 'position');
  L.resetField(over, base, 'deck');
  L.resetField(over, base, 'position');
  var v = L.resolve('Kids Shop', base, over);
  assert.deepStrictEqual(v.decks, [5]);
  assert.strictEqual(v.position, 'Mid');
  assert.strictEqual(v.check.deck, true, 'flag comes back');
  assert.strictEqual(v.check.position, false, 'confirmed stays confirmed');
  assert.strictEqual(v.check.neighborhood, true);
  // Reset all = no override at all, which also drops the confirmation.
  v = L.resolve('Kids Shop', base, {});
  assert.strictEqual(v.check.position, true);
});

test('Ashore clears deck and position; leaving Ashore restores them', function() {
  var base = HM.venues['Studio B'];
  var over = L.setField({}, base, 'neighborhood', 'Ashore');
  assert.deepStrictEqual(over, {neighborhood: 'Ashore', decks: [], position: null});
  var v = L.resolve('Studio B', base, over);
  assert.strictEqual(L.watchLines(v, 6).loc, 'Ashore');
  L.setField(over, base, 'neighborhood', 'Boardwalk');
  assert.deepStrictEqual(over, {neighborhood: 'Boardwalk'});
  L.setField(over, base, 'neighborhood', 'Ashore');
  L.resetField(over, base, 'neighborhood');
  assert.deepStrictEqual(over, {});
  // The built-in Ashore venue stays unedited.
  var cay = HM.venues['Perfect Day at CocoCay'];
  assert.deepStrictEqual(L.setField({}, cay, 'neighborhood', 'Ashore'), {});
});

test('entries: table, missing schedule venues and venues the owner added', function() {
  var list = L.entries(HM, {'Harbor Cafe': {decks: [5], neighborhood: 'Royal Promenade'}},
                       ['Studio B', 'studio b', 'Casino Royale Non-Smoking', 'Mystery Lounge', 'MYSTERY LOUNGE', '']);
  assert.strictEqual(list.length, Object.keys(HM.venues).length + 2);
  var mystery = find(list, 'Mystery Lounge');
  assert.strictEqual(mystery.blank, true);
  assert.strictEqual(mystery.toCheck, true);
  assert.strictEqual(L.subLine(mystery, 'area'), 'Not in the table yet');
  var cafe = find(list, 'Harbor Cafe');
  assert.strictEqual(cafe.blank, false);
  assert.strictEqual(cafe.isEdited, true);
  assert.strictEqual(cafe.toCheck, false);
  assert.ok(!find(list, 'Casino Royale Non-Smoking'), 'aliases are not separate venues');
  // Once the owner fills in a missing venue it counts as edited, not to check.
  list = L.entries(HM, {'Mystery Lounge': {decks: [4]}}, ['Mystery Lounge']);
  mystery = find(list, 'Mystery Lounge');
  assert.strictEqual(mystery.blank, false);
  assert.strictEqual(mystery.isEdited, true);
  assert.strictEqual(L.subLine(mystery, 'area'), 'Deck 4');
});

test('counts for the Cruise card', function() {
  var base = L.counts(L.entries(HM, {}, []));
  var flagged = Object.keys(HM.venues).filter(function(n) {
    var f = HM.venues[n].flags;
    return f.deck || f.position || f.neighborhood;
  }).length;
  assert.deepStrictEqual(base, {venues: Object.keys(HM.venues).length, toCheck: flagged, edited: 0});
  var c = L.counts(L.entries(HM, {
    'Studio B': {position: 'Fore'},                   // edited, wasn't flagged
    'Pandora': {decks: [6]},                          // edited, clears its only flag
    'Kids Shop': {confirmed: {deck: true}},           // still flagged: position, neighborhood
    'Rock Climbing Wall': {confirmed: {deck: true}}   // confirmed its only flag
  }, ['New Bar']));
  assert.deepStrictEqual(c, {venues: base.venues + 1, toCheck: flagged - 2 + 1, edited: 2});
});

test('cabin deck comes from the digits of the Deck field', function() {
  assert.strictEqual(L.cabinDeck('Deck 9'), 9);
  assert.strictEqual(L.cabinDeck('9'), 9);
  assert.strictEqual(L.cabinDeck(' deck 12, aft'), 12);
  assert.strictEqual(L.cabinDeck('Deck nine'), null);
  assert.strictEqual(L.cabinDeck(''), null);
  assert.strictEqual(L.cabinDeck(null), null);
  assert.strictEqual(L.cabinDeck('Deck 0'), null);
  assert.strictEqual(L.cabinDeck('9254'), null);
});

test('nearestDeck: nearest entrance, ties go to the lower deck', function() {
  assert.strictEqual(venues.nearestDeck([3, 4, 5], 9), 5);
  assert.strictEqual(venues.nearestDeck([3, 4, 5], 1), 3);
  assert.strictEqual(venues.nearestDeck([3, 4, 5], 4), 4);
  assert.strictEqual(venues.nearestDeck([5, 7], 6), 5);
  assert.strictEqual(venues.nearestDeck([8, 9], null), null);
  assert.strictEqual(venues.nearestDeck([8], null), 8);
  assert.strictEqual(venues.nearestDeck([], 6), null);
  assert.strictEqual(venues.nearestDeck(null, 6), null);
});

test('watch lines: deck, range, relative line and missing details', function() {
  var e = L.entries(HM, {}, ['Mystery Lounge']);
  assert.deepStrictEqual(L.watchLines(find(e, 'Studio B'), 6),
                         {loc: 'Deck 4' + DOT + 'Mid', rel: {dir: -1, text: '2 decks from cabin'}});
  assert.deepStrictEqual(L.watchLines(find(e, 'Royal Theater'), null), {loc: 'Decks 3-5' + DOT + 'Fore', rel: null});
  assert.deepStrictEqual(L.watchLines(find(e, 'Royal Theater'), 9).loc, 'Deck 5' + DOT + 'Fore');
  assert.deepStrictEqual(L.watchLines(find(e, 'Dazzles'), 9).rel, {dir: 0, text: 'On your cabin deck'});
  assert.deepStrictEqual(L.watchLines(find(e, 'Rock Climbing Wall'), 6).rel, {dir: 1, text: '1 deck from cabin'});
  assert.deepStrictEqual(L.watchLines(find(e, 'Royal Promenade'), 5), {loc: 'Deck 5', rel: {dir: 0, text: 'On your cabin deck'}});
  assert.deepStrictEqual(L.watchLines(find(e, 'Perfect Day at CocoCay'), 6), {loc: 'Ashore', rel: null});
  assert.deepStrictEqual(L.watchLines(find(e, 'Mystery Lounge'), 6), {loc: null, rel: null});
  assert.strictEqual(L.deckText([3, 5]), 'Decks 3, 5');
});

test('list groups by area and by deck, Needs details first', function() {
  var list = L.entries(HM, {}, ['Mystery Lounge']);
  var area = L.groups(list, 'area');
  assert.deepStrictEqual(area.map(function(g) { return g.title; }), ['Needs details'].concat(
    venues.AREAS, ['Other places', 'Ashore']));
  var ent = area.filter(function(g) { return g.title === 'Entertainment Place'; })[0];
  assert.strictEqual(ent.rows[0].name, 'Royal Theater', 'lowest deck first');
  assert.strictEqual(L.subLine(ent.rows[0], 'area'), 'Decks 3-5' + DOT + 'Fore');

  var deck = L.groups(list, 'deck');
  var titles = deck.map(function(g) { return g.title; });
  assert.strictEqual(titles[0], 'Needs details');
  assert.strictEqual(titles[1], 'Deck 2');
  assert.strictEqual(titles[titles.length - 1], 'Ashore');
  ['Deck 3', 'Deck 4', 'Deck 5'].forEach(function(t) {
    var g = deck.filter(function(x) { return x.title === t; })[0];
    assert.ok(g.rows.some(function(v) { return v.name === 'Royal Theater'; }), 'Royal Theater under ' + t);
  });
  var d5 = deck.filter(function(x) { return x.title === 'Deck 5'; })[0].rows;
  assert.strictEqual(d5[0].position, 'Fore');
  assert.strictEqual(d5[d5.length - 1].position, null, 'no position last');
  assert.strictEqual(L.subLine(d5[1], 'deck'), d5[1].position + DOT + d5[1].neighborhood);
});

test('short names fit the reminder alert', function() {
  var pack = require('../../src/pkjs/pack');
  var shortened = 0;
  Object.keys(HM.venues).forEach(function(n) {
    var v = HM.venues[n];
    if (v.short) {
      shortened++;
      assert.ok(pack.utf8(n, 99).length > pack.ALARM_VENUE_MAX, n + ' fits without a short name');
      assert.ok(pack.utf8(v.short, 99).length <= pack.ALARM_VENUE_MAX, v.short);
    }
  });
  assert.strictEqual(shortened, 18);
  var f = venues.venueFinder('HM', {}, '');
  assert.strictEqual(f.short('Main Dining Room 5'), 'Main Dining 5');
  assert.strictEqual(f.short('Adventure Ocean'), 'Ocean Theater', 'through an alias');
  assert.strictEqual(f.short('Boardwalk Dog House'), 'Boardwalk Dog House', 'cut on the watch instead');
  assert.strictEqual(f.short('Somewhere New'), 'Somewhere New');
});

test('review queue follows the list order', function() {
  var q = L.reviewQueue(L.entries(HM, {}, ['Mystery Lounge']));
  assert.strictEqual(q[0], 'Mystery Lounge');
  assert.ok(q.indexOf('Pandora') !== -1);
  assert.deepStrictEqual(q.slice(-3), ['Medical Center', 'Running Track', 'Card Room'],
                         'Other places come last, by deck');
  assert.ok(q.indexOf('Studio B') === -1);
});

test('cleanOverrides keeps valid edits only', function() {
  assert.strictEqual(venues.cleanOverrides(null), null);
  assert.strictEqual(venues.cleanOverrides([1]), null);
  var raw = JSON.parse('{"__proto__": {"decks": [4]}, "Studio B": {"decks": [5, 4, 4, 0, 21, 3.5, "6"], ' +
    '"position": "Middle", "neighborhood": "Boardwalk", "confirmed": {"deck": true, "position": "yes"}}, ' +
    '"Cafe": {"position": null, "neighborhood": null}, "Empty": {}, "": {"decks": [4]}}');
  assert.deepStrictEqual(venues.cleanOverrides(raw), {
    'Studio B': {decks: [4, 5], neighborhood: 'Boardwalk', confirmed: {deck: true}},
    'Cafe': {position: null, neighborhood: null}
  });
});

test('the page copy of the rules parses on its own', function() {
  var copy = new Function('return (' + venues.venueLib.toString() + ')();')();
  assert.strictEqual(copy.lookup(HM, 'casino royale non-smoking'), 'Casino Royale');
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
