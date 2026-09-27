// Unit tests for Share my plan (src/pkjs/share.js). Run: node test/pkjs/share.test.js
// Cabin numbers here are made up.
var assert = require('assert');
var share = require('../../src/pkjs/share').lib;

var tests = [];
function test(name, fn) { tests.push({name: name, fn: fn}); }

var HAIRSPRAY = 'Hairspray|2026-10-05|19:00|Royal Theater';
var COMEDY = 'Adults Only Comedy|2026-10-06|21:00|Comedy Live';
var TRIVIA = 'Trivia|2026-10-05|10:00|Schooner Bar';

function mine() {
  return {
    ship: 'HM', sailDate: '2026-10-03',
    stars: {},
    personal: [],
    days: {},
    venues: {},
    cabin: {}
  };
}

test('build: stars sorted, reserved marks only on starred events, cabin only when asked', function() {
  var m = mine();
  m.stars[TRIVIA] = true;
  m.stars[HAIRSPRAY] = true;
  m.stars['R|' + HAIRSPRAY] = true;
  m.stars['R|' + COMEDY] = true;  // mark kept on an unstarred event
  m.personal = [{title: 'Dinner', venue: 'Chops Grille', date: '2026-10-04', time: '19:30', minutes: 90}];
  m.days = {'2026-10-07': {allAboard: '16:00', warn: 60}, '2026-10-08': {edit: {type: 'CRUISING'}}, '2026-10-09': {}};
  m.venues = {'Chops Grille': {decks: [8], position: 'aft'}};
  m.cabin = {stateroom: '9999', deck: 'Deck 9', stairs: '', muster: ' A1 '};
  var p = share.build(m, false);
  assert.deepStrictEqual(p.stars, [HAIRSPRAY, 'R|' + HAIRSPRAY, TRIVIA].sort());
  assert.strictEqual(p.cabin, undefined);
  assert.deepStrictEqual(Object.keys(p.days), ['2026-10-07', '2026-10-08']);
  assert.deepStrictEqual(share.build(m, true).cabin, {stateroom: '9999', deck: 'Deck 9', muster: 'A1'});
  assert.deepStrictEqual(share.counts(p), {stars: 2, personal: 1, daySettings: 1, itinerary: 1, venues: 1, cabin: 0});
});

test('encode/decode round trip, with a readable first line and non-ASCII text', function() {
  var m = mine();
  m.stars[HAIRSPRAY] = true;
  m.personal = [{title: 'Café meet-up “deck 15”', venue: '', date: '2026-10-04', time: null, minutes: 0}];
  var p = share.build(m, false);
  var text = share.encode(p, 'Harmony · sails 3 Oct 2026');
  assert.strictEqual(text.split('\n')[0], 'Royal Pebble plan · Harmony · sails 3 Oct 2026 · 1 star');
  assert.ok(/^[\x20-\x7e]+$/.test(text.split('\n')[2]), 'the code line is plain ASCII');
  var r = share.decode(text);
  assert.ok(!r.error, r.error);
  assert.strictEqual(r.plan.personal[0].title, 'Café meet-up “deck 15”');
  assert.deepStrictEqual(r.plan.stars, [HAIRSPRAY]);
});

test('decode survives chat apps wrapping the code, and reports bad pastes', function() {
  var m = mine();
  for (var i = 0; i < 20; i++) {
    m.stars['Event ' + i + '|2026-10-05|10:00|Venue'] = true;
  }
  var text = share.encode(share.build(m, false), 'Harmony');
  var code = text.split('\n')[2];
  var wrapped = 'Forwarded:\n' + text.split('\n').slice(0, 2).join('\n') + '\n' +
    code.replace(/(.{60})/g, '$1\n ') + '\nsee you!';
  assert.strictEqual(share.decode(wrapped).plan.stars.length, 20);
  assert.ok(/whole message/.test(share.decode('hello').error));
  assert.ok(/cut short/.test(share.decode(code.slice(0, code.length - 20)).error));
  assert.ok(/newer/.test(share.decode('RPPLAN2:abc:END').error));
  assert.ok(/damaged/.test(share.decode('RPPLAN1:bm90IGpzb24=:END').error));
});

test('diff: stars both ways, reserved marks, personal entries once', function() {
  var m = mine();
  m.stars[COMEDY] = true;
  m.stars[TRIVIA] = true;
  m.personal = [{title: 'Dinner', venue: '', date: '2026-10-04', time: '19:30', minutes: 0}];
  var t = mine();
  t.stars[HAIRSPRAY] = true;
  t.stars['R|' + HAIRSPRAY] = true;
  t.stars[TRIVIA] = true;
  t.personal = [m.personal[0], {title: 'Spa', venue: 'Vitality', date: '2026-10-05', time: '15:00', minutes: 50},
                {title: 'Spa', venue: 'Vitality', date: '2026-10-05', time: '15:00', minutes: 50}];
  var items = share.diff(share.build(m, true), share.build(t, false));
  var stars = items.filter(function(it) { return it.group === 'stars'; });
  assert.deepStrictEqual(stars.map(function(it) { return [it.key, it.theirsOnly, it.def]; }), [
    [HAIRSPRAY, true, 'theirs'], ['R|' + HAIRSPRAY, true, 'theirs'], [COMEDY, false, 'mine']]);
  assert.strictEqual(stars[1].event, HAIRSPRAY);
  assert.strictEqual(items.filter(function(it) { return it.group === 'personal'; }).length, 1);
});

test('diff: day settings, venue fixes and cabin details only where theirs are set and differ', function() {
  var m = mine();
  m.days = {'2026-10-07': {allAboard: '16:30', warn: 60}, '2026-10-08': {shift: 10}};
  m.venues = {'Chops Grille': {decks: [8]}, 'Mine only': {position: 'fore'}};
  m.cabin = {stateroom: '9999', muster: 'A1'};
  var t = mine();
  t.days = {'2026-10-07': {allAboard: '16:00', warn: 60, edit: {port: 'Cozumel'}}};
  t.venues = {'Chops Grille': {decks: [8]}, 'Solarium Bistro': {decks: [15], position: 'fore'}};
  t.cabin = {stateroom: '8888', muster: 'A1'};
  var items = share.diff(share.build(m, true), share.build(t, true));
  assert.deepStrictEqual(items.map(function(it) { return [it.group, it.field || it.name, it.mine, it.def]; }), [
    ['days', 'allAboard', '16:30', 'theirs'],
    ['days', 'edit', null, 'theirs'],
    ['venues', 'Solarium Bistro', null, 'theirs'],
    ['cabin', 'stateroom', '9999', 'theirs']]);
});

test('changes: Accept all never unstars or removes; Review each choices are followed', function() {
  var m = mine();
  m.stars[COMEDY] = true;
  m.days = {'2026-10-07': {allAboard: '16:30'}};
  var t = mine();
  t.stars[HAIRSPRAY] = true;
  t.days = {'2026-10-07': {allAboard: '16:00'}};
  t.personal = [{title: 'Spa', venue: '', date: '2026-10-05', time: '15:00', minutes: 50}];
  t.cabin = {deck: 'Deck 9'};
  var items = share.diff(share.build(m, true), share.build(t, true));
  var all = share.changes(items);
  assert.strictEqual(all.stars[HAIRSPRAY], true);
  assert.strictEqual(all.stars[COMEDY], undefined, 'Accept all keeps my star');
  assert.deepStrictEqual(all.days, {'2026-10-07': {allAboard: '16:00'}});
  assert.strictEqual(all.personal.length, 1);
  assert.deepStrictEqual(all.cabin, {deck: 'Deck 9'});
  var picked = items.map(function(it) {
    return it.group === 'stars' && !it.theirsOnly ? 'theirs' : 'mine';  // unstar mine, skip the rest
  });
  var unstar = {};
  unstar[COMEDY] = false;
  assert.deepStrictEqual(share.changes(items, picked), {stars: unstar, personal: [], days: {}, venues: {}, cabin: {}});
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
