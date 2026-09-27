// Unit tests for the phone's schedule producer. Run: node test/pkjs/royal.test.js
// test/fixtures holds public products trimmed from a live Harmony pull
// (2026-10-01 sailing); tools/cruise-sync/test_cruise_sync.py checks the sync
// tool against the same expected schedule, so the two producers can't drift.
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var royal = require('../../src/pkjs/royal');

var FIXTURES = path.join(__dirname, '..', 'fixtures');
var PRODUCTS = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'products-HM-sample.json'), 'utf8'));
var EXPECTED = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'expected-schedule.json'), 'utf8'));

var tests = [];
function test(name, fn) { tests.push({name: name, fn: fn}); }

function schedule(products, pageSize) {
  var acc = royal.newScheduleAcc();
  for (var i = 0; i < products.length; i += pageSize || products.length) {
    royal.addProducts(acc, {payload: {products: products.slice(i, i + (pageSize || products.length))}});
  }
  return royal.finishSchedule(acc);
}

function product(extra) {
  var p = {productType: {productType: 'NON_REVENUE_SCHEDULABLE'}, productTitle: 'Trivia', productID: 'P1',
           productLocation: {locationCode: 'ONAIR', locationTitle: 'On Air'},
           offering: [{offeringDate: '20261002', offeringTime: '1400', offeringDurationInMinutes: '45'}]};
  Object.keys(extra || {}).forEach(function(k) { p[k] = extra[k]; });
  return p;
}

test('shared fixture gives the expected schedule, in pages too', function() {
  assert.deepStrictEqual(schedule(PRODUCTS), EXPECTED);
  assert.deepStrictEqual(schedule(PRODUCTS, 7), EXPECTED);
});

test('summary line', function() {
  assert.strictEqual(royal.scheduleSummary(EXPECTED),
    '51 events (9 shore excursion sessions): 18 with age limits, 23 arrive early, 25 with notes');
});

test('age restriction wordings', function() {
  assert.deepStrictEqual(royal.restrictionAge('Minimum 18 years old'), [18, null]);
  assert.deepStrictEqual(royal.restrictionAge('Maximum 17 years old'), [null, 17]);
  assert.deepStrictEqual(royal.restrictionAge('13 to 17 years old'), [13, 17]);
  assert.strictEqual(royal.restrictionAge('Guests 16 and under must be accompanied by a parent or guardian'), null);
  assert.strictEqual(royal.restrictionAge('Children 12 years old and under must be  supervised by parent'), null);
});

test('age patterns in titles and venues', function() {
  assert.deepStrictEqual(royal.textAge('After-Party With Resident DJ (18+)'), [18, null]);
  assert.deepStrictEqual(royal.textAge('Karaoke: Teens (13-17)'), [13, 17]);
  assert.deepStrictEqual(royal.textAge('Social100 (Ages 13-17)'), [13, 17]);
  assert.deepStrictEqual(royal.textAge('Junior Cruisers Curfew (17 & Under)'), [null, 17]);
  assert.deepStrictEqual(royal.textAge('Hideaway Beach (Adults-Only) — Day Pass'), [18, null]);
  assert.strictEqual(royal.textAge('Family Movie: "Shrek" (PG)'), null);
  assert.strictEqual(royal.textAge('Adventure Ocean Theater'), null);
  assert.strictEqual(royal.textAge(''), null);
});

test('the tightest age wins; fun for all ages and over-21 advisements set none', function() {
  assert.deepStrictEqual(royal.ageOf(product({
    restrictions: [{restrictionType: 'age', restrictionDisplayText: 'Minimum 13 years old'},
                   {restrictionType: 'age', restrictionDisplayText: 'Maximum 17 years old'}]
  }), 'Teen Open House (13-17)', 'Social100 (Ages 13-17)'), [13, 17]);
  assert.deepStrictEqual(royal.ageOf(product({experiences: [{experienceID: 'ages/age18'}]}), 'Quest', ''),
                         [18, null]);
  assert.deepStrictEqual(royal.ageOf(product({
    restrictions: [{restrictionType: 'age', restrictionDisplayText: 'Minimum 18 years old'}]
  }), 'Show (21+)', ''), [21, null]);
  assert.strictEqual(royal.ageOf(product({
    experiences: [{experienceID: 'ages/funforall'}],
    advisements: [{advisementID: 'kbyg/general/over21', advisementTitle: 'Guests purchasing alcohol must be of legal age'}]
  }), 'Family Bingo', 'Adventure Ocean Theater'), null);
});

test('arrive early: lead time, then advisement text, capped', function() {
  var o = {offeringTime: '2000'};
  var a15 = [{advisementTitle: 'Arrive 15 minutes early'}];
  assert.strictEqual(royal.earlyOf(product({productDuration: {leadTimeInMinutes: 10}, advisements: a15}), o), 10);
  assert.strictEqual(royal.earlyOf(product({productDuration: {leadTimeInMinutes: 0}, advisements: a15}), o), 15);
  assert.strictEqual(royal.earlyOf(product({productDuration: {leadTimeInMinutes: 200}}), o), 120);
  assert.strictEqual(royal.earlyOf(product({advisements: [{advisementTitle: 'Sign up at the venue 15 minutes ' +
    'before the activity starts'}]}), o), 15);
  assert.strictEqual(royal.earlyOf(product({advisements: [{advisementTitle: 'Doors are open for guests with ' +
    'reservations 45 minutes prior to show time.'}, {advisementTitle: 'Early arrival is recommended'}]}), o), null);
  assert.strictEqual(royal.earlyOf(product({productDuration: {leadTimeInMinutes: 10}}), {offeringTime: '0000'}), null);
});

test('arrive early: a shore excursion meets before its start', function() {
  var p = product({productType: {productType: 'SHOREX'}, productDuration: {leadTimeInMinutes: 30}});
  assert.strictEqual(royal.earlyOf(p, {offeringTime: '0900', meetingTime: '0845'}), 15);
  assert.strictEqual(royal.earlyOf(p, {offeringTime: '1400', meetingTime: '0700'}), 240);
  assert.strictEqual(royal.earlyOf(p, {offeringTime: '0900', meetingTime: '0900'}), null);
  assert.strictEqual(royal.earlyOf(p, {offeringTime: '0900', meetingTime: null}), null);
  assert.strictEqual(royal.earlyOf(p, {offeringTime: '0000', meetingTime: '2345'}), null);
});

test('notes: boilerplate, long and repeated text left out; waiver added once', function() {
  var long = new Array(122).join('x');
  var notes = royal.notesOf(product({
    productShortDescription: 'Trivia',
    restrictions: [{restrictionType: 'age', restrictionID: 'age/min', restrictionDisplayText: 'Minimum 18 years old'},
                   {restrictionType: 'age', restrictionID: 'age/13guardian',
                    restrictionDisplayText: 'Children 12 years old and under must be  supervised'}],
    advisements: [{advisementID: 'kbyg/general/IMAGEILLUS', advisementTitle: 'Images are illustrative only'},
                  {advisementID: 'kbyg/general/FEE', advisementTitle: 'This activity has a fee'},
                  {advisementID: 'kbyg/fee-applies', advisementTitle: 'Fee applies'},
                  {advisementID: 'legal', advisementTitle: long},
                  {advisementID: 'kbyg/Children12', advisementTitle: 'Children 12 years old and under must be supervised'},
                  {advisementID: 'kbyg/seapass', advisementTitle: 'Please bring your SeaPass®'}],
    isWaiverRequired: true
  }), 'Trivia');
  assert.deepStrictEqual(notes, [
    ['age/13guardian', 'Children 12 years old and under must be supervised'],
    ['kbyg/seapass', 'Please bring your SeaPass'],
    ['waiver', 'Signed waiver required']]);
  assert.deepStrictEqual(royal.notesOf(product({
    advisements: [{advisementID: 'kbyg/flowrdr/WARNDISCLAIM', advisementTitle: 'Signed warning disclaimer required'}],
    isWaiverRequired: true
  }), 'Trivia'), [['kbyg/flowrdr/WARNDISCLAIM', 'Signed warning disclaimer required']]);
});

test('short descriptions kept only when they say more than the title', function() {
  function short(title, text) {
    return royal.notesOf(product({productShortDescription: text}), title).length === 1;
  }
  assert.ok(short('Dance Fitness', "Dance Fitness with your Cruise Director's Staff (Meet by the Car)"));
  assert.ok(short('Effective Fat Burning', 'Seminar: Burn Fat Fast'));
  assert.ok(short('World’s Sexiest Man Competition: Adults (18+)', "World's Sexiest Man Competition:Sign Ups"));
  assert.ok(!short('Celebrity Heads', 'Game: Celebrity Heads'));
  assert.ok(!short('Game Show: The Crazy Quest- Adults (18+)', 'Adult Game Show: The Quest'));
  assert.ok(!short('Guess the Weight of the Sculpture', 'Guess the Weight of the Sculpture Competition'));
  assert.ok(!short('Knockout Basketball Competition', 'Basketball Knockout Competition'));
  assert.ok(!short('Pure-Form Pilates', 'Pure Form Pilates'));
});

test('a product without the new data gets no info, and null codes and ids', function() {
  var s = schedule([product({productID: null, productLocation: {locationTitle: 'On Air'}})]);
  assert.deepStrictEqual(s.venues, ['On Air']);
  assert.deepStrictEqual(s.venueCodes, [null]);
  assert.deepStrictEqual(s.notes, []);
  assert.deepStrictEqual(s.infos, []);
  assert.deepStrictEqual(s.events[0].slice(10), [null, null]);
});

test('venues are told apart by code; excursions get their own category and are paid', function() {
  var s = schedule([
    product({productLocation: {locationCode: 'VINT', locationTitle: null}}),
    product({productTitle: 'Bingo', productLocation: {locationCode: null, locationTitle: ''}}),
    product({productTitle: 'Kayak', productType: {productType: 'SHOREX'},
             productCategory: [{categoryName: 'shorex', childCategory: [{items: {categoryName: 'PCC'}}]}],
             productLocation: {locationCode: 'PCC', locationTitle: 'Perfect Day CocoCay'},
             offering: [{offeringDate: '20261002', offeringTime: '0900', meetingTime: '0845'}]})]);
  assert.deepStrictEqual(s.venues, ['', '', 'Perfect Day CocoCay']);
  assert.deepStrictEqual(s.venueCodes, ['VINT', null, 'PCC']);
  assert.deepStrictEqual(s.cats[s.events[0][2]], ['Shore excursions', '']);
  assert.deepStrictEqual(s.events[0].slice(8, 11), [1, null, 0]);
  assert.deepStrictEqual(s.infos[0], [null, 15, []]);
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
