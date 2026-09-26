// Unit tests for Royal parsing and the settings page. Run: node test/pkjs/settings.test.js
var assert = require('assert');
var royal = require('../../src/pkjs/royal');
var config = require('../../src/pkjs/config');
var bundleLib = require('../../src/pkjs/bundle');
var slice = require('../../src/pkjs/slice');

var tests = [];
function test(name, fn) { tests.push({name: name, fn: fn}); }

test('clean() makes watch-friendly ASCII', function() {
  assert.strictEqual(royal.clean('Mamma Mia!® “Live” – Café…'), 'Mamma Mia! "Live" - Cafe...');
  assert.strictEqual(royal.clean('  a \n b '), 'a b');
  assert.strictEqual(royal.clean(null), '');
});

test('ship names and list', function() {
  assert.strictEqual(royal.shipName('HERO OF THE SEAS'), 'Hero of the Seas');
  assert.strictEqual(royal.shipName('Harmony of the Seas'), 'Harmony of the Seas');
  var ships = royal.parseShips({payload: {ships: [
    {brand: 'R', shipCode: 'HM', name: 'Harmony of the Seas'},
    {brand: 'C', shipCode: 'XX', name: 'Celebrity Ship'},
    {brand: 'R', shipCode: 'AD', name: 'Adventure of the Seas'}
  ]}});
  assert.deepStrictEqual(ships, [{code: 'AD', name: 'Adventure of the Seas'}, {code: 'HM', name: 'Harmony of the Seas'}]);
});

test('itinerary parsing drops placeholder times', function() {
  var it = royal.parseItinerary({payload: {sailingInfo: [{itinerary: {events: [
    {day: 1, port: {portType: 'EMBARK', portName: 'Orlando (Port Canaveral), Fl', portCode: 'PCN',
                    arrivalDateTime: '20270306T000000', departureDateTime: '20270306T160000'}},
    {day: 2, port: {portType: 'CRUISING', portName: 'Cruising', portCode: 'CRU',
                    arrivalDateTime: '20270307T000000', departureDateTime: '20270307T235900'}},
    {day: 3, port: {portType: 'DOCKED', portName: 'St. Thomas, U.S. Virgin Islands', portCode: 'STT',
                    arrivalDateTime: '20270308T080000', departureDateTime: '20270308T170000'}},
    {day: 4, port: {portType: 'DEBARK', portName: 'Orlando (Port Canaveral), Fl', portCode: 'PCN',
                    arrivalDateTime: '20270309T060000', departureDateTime: '20270309T235900'}}
  ]}}]}});
  assert.deepStrictEqual(it.map(function(d) { return [d.date, d.type, d.arrive, d.depart]; }), [
    ['2027-03-06', 'EMBARK', null, '16:00'],
    ['2027-03-07', 'CRUISING', null, null],
    ['2027-03-08', 'DOCKED', '08:00', '17:00'],
    ['2027-03-09', 'DEBARK', '06:00', null]
  ]);
});

test('schedule parsing matches the sync tool rules', function() {
  var acc = {cats: [], venues: [], events: [], seen: {}};
  var n = royal.addProducts(acc, {payload: {products: [
    {productType: {productType: 'NON_REVENUE_SCHEDULABLE'}, productTitle: 'Ice Show®',
     productCategory: [{categoryName: 'ENTERTAINMENT', childCategory: [{items: [{categoryName: 'Shows'}]}]}],
     productLocation: {locationTitle: 'Studio B'}, productDuration: {durationInMinutes: 60},
     isFeatured: true, isReservationRequired: true,
     offering: [{offeringDate: '20270307', offeringTime: '2000'},
                {offeringDate: '20270307', offeringTime: '2000'},  // duplicate
                {offeringDate: '20270308', offeringTime: '0000', offeringDurationInMinutes: 30}]},
    {productType: {productType: 'SHORE_EXCURSION'}, productTitle: 'Snorkel', offering: []},
    // Reserved shows and paid classes are their own product types.
    {productType: {productType: 'ENTERTAINMENT'}, productTitle: 'The Fine Line',
     productCategory: [{categoryName: 'entertainment'}], productLocation: {locationTitle: 'AquaTheater'},
     productDuration: {durationInMinutes: 50}, isFeatured: true, isReservationRequired: true,
     offering: [{offeringDate: '20270307', offeringTime: '2200', offeringDurationInMinutes: '50'}]},
    {productType: {productType: 'ACTIVITIES'}, productTitle: 'FlowRider Group Lesson',
     productCategory: [{categoryName: 'activities'}], productLocation: {locationTitle: 'FlowRider'},
     isReservationRequired: true, offering: [{offeringDate: '20270307', offeringTime: '0900'}]},
    {productType: {productType: 'ACTIVITIES'}, productTitle: 'NextCruise Consultation Appointment',
     isReservationRequired: true, offering: [{offeringDate: '20270307', offeringTime: '1100'}]},
    {productType: {productType: 'DINING'}, productTitle: 'Chops Grille', isReservationRequired: true,
     offering: [{offeringDate: '20270307', offeringTime: '1800'}]},
    {productType: {productType: 'SPA'}, productTitle: 'Massage', isReservationRequired: true,
     offering: [{offeringDate: '20270307', offeringTime: '1000'}]},
    {productType: {productType: 'NON_REVENUE_SCHEDULABLE'}, productTitle: 'Bingo',
     productCategory: [{categoryName: 'activities'}], productLocation: {locationTitle: 'Studio B'},
     offering: [{offeringDate: '20270307', offeringTime: '1000'}]}
  ]}});
  assert.strictEqual(n, 8);
  var sched = royal.finishSchedule(acc);
  assert.strictEqual(sched.published, true);
  assert.deepStrictEqual(sched.cats, [['Entertainment', 'Shows'], ['Entertainment', ''], ['Activities', '']]);
  assert.deepStrictEqual(sched.venues, ['Studio B', 'AquaTheater', 'FlowRider']);
  assert.deepStrictEqual(sched.events, [
    ['FlowRider Group Lesson', 2, 2, '2027-03-07', '09:00', 0, 0, 1],
    ['Bingo', 0, 2, '2027-03-07', '10:00', 0, 0, 0],
    ['Ice Show', 0, 0, '2027-03-07', '20:00', 60, 1, 1],
    ['The Fine Line', 1, 1, '2027-03-07', '22:00', 50, 1, 1],
    ['Ice Show', 0, 0, '2027-03-08', null, 30, 1, 1]
  ]);
  assert.strictEqual(royal.finishSchedule({cats: [], venues: [], events: [], seen: {}}).published, false);
});

test('a downloaded bundle validates and slices', function() {
  var acc = {cats: [], venues: [], events: [], seen: {}};
  royal.addProducts(acc, {payload: {products: [
    {productType: {productType: 'NON_REVENUE_SCHEDULABLE'}, productTitle: 'Late Show',
     productCategory: [{categoryName: 'ENTERTAINMENT'}], productLocation: {locationTitle: 'Studio B'},
     offering: [{offeringDate: '20270307', offeringTime: '2330', offeringDurationInMinutes: 90}]}
  ]}});
  var bundle = {format: 'cruise-watch', v: 1, generated: '2027-02-23T12:00:00Z', ship: {code: 'HM', name: 'Harmony'},
    sailDate: '2027-03-06', itinerary: [{day: 1, date: '2027-03-06', type: 'EMBARK', depart: '16:00'},
      {day: 2, date: '2027-03-07', type: 'CRUISING', port: 'Cruising'}], schedule: royal.finishSchedule(acc)};
  assert.strictEqual(bundleLib.validate(bundle), null);
  var s = slice.buildSlice(bundle, {}, {}, new Date(2027, 2, 7, 22, 0));
  assert.strictEqual(s.events.length, 1);
  assert.strictEqual(s.events[0].start, 1440 + 23 * 60 + 30);
});

function pageScript(html) {
  var m = /<script>([\s\S]*)<\/script>/.exec(html);
  return m[1];
}

test('settings page builds, embeds state safely and its script parses', function() {
  var state = {ships: [{code: 'HM', name: 'Harmony of the Seas'}], cruise: null, status: {},
    me: {stateroom: '</script><script>alert(1)</script>', muster: 'B4'}, theme: 'dark', reminderLead: 30,
    api: royal.API, appKey: royal.APPKEY};
  var html = config.buildPage(state, new Date(2026, 8, 24));
  assert.ok(/^<!DOCTYPE html>/.test(html));
  assert.strictEqual(html.indexOf('</script><script>alert'), -1, 'state cannot close the script tag');
  assert.strictEqual((html.match(/<\/script>/g) || []).length, 1);
  new Function(pageScript(html));  // throws on a syntax error
  assert.ok(html.indexOf('id="testAlerts"') !== -1, 'Test alerts button');
  assert.ok(html.indexOf('"oldestSailDate":"2026-09-10"') !== -1);
  var url = config.pageUrl(state);
  assert.ok(/^data:text\/html;charset=utf-8,%3C!DOCTYPE/.test(url));
  console.log('    page ' + Math.round(html.length / 1024) + ' KB, data URL ' + Math.round(url.length / 1024) + ' KB');
});

test('settings page with an itinerary includes the Days screen', function() {
  var state = {ships: [], cruise: null, status: {}, me: {}, theme: 'light', reminderLead: 15,
    itinerary: [{date: '2027-03-08', type: 'DOCKED', port: '</script>St. Thomas', arrive: '08:00', depart: '17:00'}],
    days: {'2027-03-08': {offset: 60, buffer: 45}}, api: royal.API, appKey: royal.APPKEY};
  var html = config.buildPage(state, new Date(2026, 8, 24));
  assert.strictEqual((html.match(/<\/script>/g) || []).length, 1);
  new Function(pageScript(html));
  assert.ok(html.indexOf('id="dayList"') !== -1);
  assert.ok(html.indexOf('data-screen="days"') !== -1);
  assert.ok(html.indexOf('id="catList"') !== -1);
});

test('settings page with ship venues embeds the table, edits and venue rules', function() {
  var venues = require('../../src/pkjs/venues');
  var state = {ships: [], status: {}, me: {deck: 'Deck 6'}, theme: 'light', reminderLead: 15,
    cruise: {shipCode: 'HM', shipName: 'Harmony of the Seas', sailDate: '2027-03-06', days: 4, nights: 3,
             published: true, events: 1, lastSync: 'today'},
    schedule: {venues: ['Studio B', '</script>Mystery'], cats: [['Shows', '']],
               fields: ['title', 'venue', 'cat', 'date', 'time', 'minutes', 'featured', 'reservation'],
               events: [['Ice Show', 0, 0, '2027-03-07', '20:00', 60, 0, 0]]},
    venues: {ship: 'HM', table: venues.builtIn('HM'), overrides: {'Studio B': {decks: [5]}}},
    api: royal.API, appKey: royal.APPKEY};
  var html = config.buildPage(state, new Date(2026, 8, 24));
  assert.strictEqual((html.match(/<\/script>/g) || []).length, 1);
  new Function(pageScript(html));
  assert.ok(html.indexOf('id="venueCard"') !== -1);
  assert.ok(html.indexOf('id="vEdit"') !== -1);
  assert.ok(html.indexOf('"Royal Theater"') !== -1, 'built-in table embedded');
  assert.ok(html.indexOf('function venueLib()') !== -1, 'venue rules embedded');
  console.log('    page with venues ' + Math.round(html.length / 1024) + ' KB');
});

test('clashes: overlaps count, back-to-back and untimed do not', function() {
  var c = config.findClashes([
    {at: 780, minutes: 60},    // 0: 1:00p-2:00p
    {at: 810, minutes: 60},    // 1: 1:30p-2:30p, overlaps 0 and 2
    {at: 840, minutes: 30},    // 2: 2:00p, back-to-back with 0
    {at: 900, minutes: 0},     // 3: 3:00p, no length: 30 minutes
    {at: 925, minutes: 45},    // 4: 3:25p, inside 3's 30 minutes
    {at: 930, minutes: 0},     // 5: 3:30p, back-to-back with 3
    {at: null, minutes: 0}     // 6: untimed
  ]);
  assert.deepStrictEqual(c, [[1], [0, 2], [1], [4], [3, 5], [4], []]);
});

test('clashes: across midnight on one clock', function() {
  // 11:30p-12:30a on the evening's date and 12:15a (after midnight, same date).
  assert.deepStrictEqual(config.findClashes([{at: 1410, minutes: 60}, {at: 1455, minutes: 30}]), [[1], [0]]);
  assert.deepStrictEqual(config.findClashes([{at: 1410, minutes: 60}, {at: 1470, minutes: 30}]), [[], []]);
});

test('settings page with starred overlaps builds with the clash filter code', function() {
  var state = {ships: [], status: {}, me: {}, theme: 'light', reminderLead: 15,
    cruise: {shipCode: 'HM', shipName: 'Harmony of the Seas', sailDate: '2027-03-06', days: 4, nights: 3,
             published: true, events: 2, lastSync: 'today'},
    schedule: {venues: ['Studio B', 'On Air'], cats: [['Shows', '']],
               fields: ['title', 'venue', 'cat', 'date', 'time', 'minutes', 'featured', 'reservation'],
               events: [['Ice Show', 0, 0, '2027-03-07', '13:30', 60, 0, 0],
                        ['Trivia', 1, 0, '2027-03-07', '13:00', 45, 0, 0]]},
    personal: [{title: 'Lunch', venue: '', date: '2027-03-07', time: '13:15', minutes: 30}],
    api: royal.API, appKey: royal.APPKEY};
  var html = config.buildPage(state, new Date(2026, 8, 24));
  new Function(pageScript(html));
  assert.ok(html.indexOf('function findClashes(') !== -1, 'clash rule embedded');
  assert.ok(html.indexOf("'clashes'") !== -1, 'Clashes filter');
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
