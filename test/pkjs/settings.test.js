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
  var acc = royal.newScheduleAcc();
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
     isReservationRequired: true, startingFromPrice: {currency: 'USD', adultPrice: 74.0},
     offering: [{offeringDate: '20270307', offeringTime: '0900'}]},
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
    ['FlowRider Group Lesson', 2, 2, '2027-03-07', '09:00', 0, 0, 1, 1, 74, null, null],   // paid, with its price
    ['Bingo', 0, 2, '2027-03-07', '10:00', 0, 0, 0, 0, null, null, null],
    ['Ice Show', 0, 0, '2027-03-07', '20:00', 60, 1, 1, 0, null, null, null],
    ['The Fine Line', 1, 1, '2027-03-07', '22:00', 50, 1, 1, 0, null, null, null],
    ['Ice Show', 0, 0, '2027-03-08', null, 30, 1, 1, 0, null, null, null]
  ]);
  assert.deepStrictEqual(sched.fields.slice(-4), ['paid', 'price', 'info', 'pid']);
  assert.strictEqual(royal.finishSchedule(royal.newScheduleAcc()).published, false);
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
  assert.ok(html.indexOf('id="testAlerts"') !== -1, 'Test alerts switch');
  assert.ok(html.indexOf('id="shareCard"') !== -1 && html.indexOf('id="plan"') !== -1, 'Share my plan');
  assert.ok(html.indexOf('function shareLib()') !== -1, 'share.js embedded');
  assert.ok(html.indexOf('id="reserveAt"') !== -1, 'reserve reminder time');
  assert.ok(html.indexOf("segment('reserveAt'") !== -1);
  assert.ok(html.indexOf('"oldestSailDate":"2026-09-10"') !== -1);
  // Advanced download: a masked password field that browsers don't autofill.
  assert.ok(html.indexOf('id="downloadLogin"') !== -1, 'Download with login');
  assert.ok(html.indexOf('<input id="rcPassword" type="password" autocomplete="off"') !== -1);
  assert.ok(html.indexOf("r.login = {email: $('rcEmail').value.trim(), password: $('rcPassword').value}") !== -1);
  var url = config.pageUrl(state);
  assert.ok(/^data:text\/html;charset=utf-8,%3C!DOCTYPE/.test(url));
  console.log('    page ' + Math.round(html.length / 1024) + ' KB, data URL ' + Math.round(url.length / 1024) + ' KB');
});

test('Me tab reference: cabin table, decks and the booking (§24.1)', function() {
  var b = {ship: {code: 'HM', name: 'Harmony of the Seas'}, mine: {stateroom: '8226', deck: '8', muster: ' B4 '}};
  var r = config.meRef(b, [3, 4, 5]);
  assert.strictEqual(r.ship, 'HM');
  assert.ok(r.cabins && r.cabins.decks['8'], 'cabin table');
  assert.ok(r.decks.indexOf(5) !== -1 && r.decks.indexOf(17) !== -1, 'map, cabin and venue decks');
  assert.deepStrictEqual(r.decks, r.decks.slice().sort(function(p, q) { return p - q; }));
  assert.deepStrictEqual(r.booking, {stateroom: '8226', deck: 'Deck 8', muster: 'B4'});
  assert.deepStrictEqual(r.dining, ['Main Dining Room 3', 'Main Dining Room 4', 'Main Dining Room 5']);
  r = config.meRef({ship: {code: 'XX', name: 'Test of the Seas'}, mine: {stateroom: 'GTY'}}, []);
  assert.strictEqual(r.cabins, null);
  assert.deepStrictEqual(r.decks, [], 'the page offers 1-18');
  assert.deepStrictEqual(r.booking, {stateroom: '', deck: '', muster: ''});
  assert.deepStrictEqual(r.dining, []);
  assert.strictEqual(r.generic.length, 6);
  r = config.meRef(null, []);
  assert.strictEqual(r.ship, null);
  var state = {ships: [], cruise: null, status: {}, me: {stateroom: '8226', stairs: 'Fwd stairs'},
    meRef: config.meRef(b, []), api: royal.API, appKey: royal.APPKEY};
  var html = config.buildPage(state, new Date(2026, 8, 24));
  new Function(pageScript(html));
  assert.ok(html.indexOf('<select id="deck">') !== -1 && html.indexOf('<select id="stairs">') !== -1);
  assert.ok(html.indexOf('function cabinLib()') !== -1, 'cabin lookups in the page');
});

test('settings page with booked orders builds the FROM YOUR BOOKING card code', function() {
  var state = {ships: [], cruise: null, status: {}, me: {}, api: royal.API, appKey: royal.APPKEY,
    orders: [{title: 'Island Snorkel', date: '2027-03-08', time: '09:00', minutes: 150, meetBefore: 15,
              guests: 2, excursion: true, port: 'St. Thomas'}]};
  var html = config.buildPage(state, new Date(2026, 8, 24));
  new Function(pageScript(html));
  assert.ok(html.indexOf('id="evOrders"') !== -1);
  assert.ok(html.indexOf('FROM YOUR BOOKING') !== -1);
  assert.ok(html.indexOf('"meetBefore":15') !== -1);
});

test('usage log splits into clipboard-sized parts of whole lines, each with the header', function() {
  var lines = [];
  for (var i = 0; i < 50; i++) {
    lines.push('2027-03-07 14:03:12  D2 14:03  pad  entry ' + i + ' ' + new Array(40).join('x'));
  }
  var parts = config.splitLog('HEAD', lines.join('\n'), 1000);
  assert.ok(parts.length > 3);
  var back = [];
  parts.forEach(function(p, k) {
    assert.ok(p.length <= 1000, 'part ' + k + ' is ' + p.length);
    var head = 'HEAD\nPart ' + (k + 1) + ' of ' + parts.length + '\n\n';
    assert.strictEqual(p.indexOf(head), 0);
    back = back.concat(p.slice(head.length).replace(/\n$/, '').split('\n'));
  });
  assert.deepStrictEqual(back, lines, 'every line once, in order');
  assert.deepStrictEqual(config.splitLog('HEAD', '', 1000), []);
  assert.deepStrictEqual(config.splitLog('HEAD', 'one', 1000), ['HEAD\nPart 1 of 1\n\none\n']);
});

test('settings page has the Usage log card on Me, returning on, label and clear', function() {
  var log = require('../../src/pkjs/log');
  var state = {ships: [], cruise: null, status: {}, me: {}, theme: 'light', reminderLead: 15,
    api: royal.API, appKey: royal.APPKEY,
    usage: {on: true, label: 'Test watch', count: 2, chars: 100, dropped: 0, since: 1, header: 'H', shown: 2,
            text: 'a </script> b\nc'}};
  var html = config.buildPage(state, new Date(2026, 8, 24));
  new Function(pageScript(html));
  var me = html.slice(html.indexOf('<section class="screen" id="me">'));
  me = me.slice(0, me.indexOf('</section>'));
  ['logCard', 'logOn', 'logLabel', 'logParts', 'logClear'].forEach(function(id) {
    assert.ok(me.indexOf('id="' + id + '"') !== -1, id + ' on Me');
  });
  assert.ok(me.indexOf('long-press and choose Paste') !== -1, 'paste tip');
  assert.strictEqual(html.indexOf('a </script> b'), -1, 'log text cannot close the script tag');
  assert.ok(html.indexOf("r.usage = {on: switchOn('logOn'), label: $('logLabel').value.trim(), clear: logClear}") !== -1);
  assert.ok(html.indexOf('"logPartChars":' + log.PART_CHARS) !== -1);
  assert.ok(html.indexOf('"logCapChars":' + log.CAP_CHARS) !== -1);
});

test('settings page has the Map check card on Me, hidden without a mapped ship', function() {
  var conflicts = require('../../src/pkjs/data/conflicts-HM').conflicts;
  var base = {ships: [], cruise: null, status: {}, me: {}, theme: 'light', reminderLead: 15,
    api: royal.API, appKey: royal.APPKEY};
  var html = config.buildPage(base, new Date(2026, 8, 24));
  new Function(pageScript(html));
  assert.ok(html.indexOf('id="mapCard" hidden') !== -1);
  var state = JSON.parse(JSON.stringify(base));
  state.mapCheck = {ship: 'HM', name: 'Harmony of the Seas', decks: [3, 4, 5], conflicts: conflicts,
                    notes: [{id: 'f1', type: 'flag', ship: 'HM', place: '</script>Test Place', ms: 1}]};
  html = config.buildPage(state, new Date(2026, 8, 24));
  new Function(pageScript(html));
  var me = html.slice(html.indexOf('<section class="screen" id="me">'));
  me = me.slice(0, me.indexOf('</section>'));
  ['mapCard', 'mapList', 'mapAdd', 'mapCopy', 'mapClear'].forEach(function(id) {
    assert.ok(me.indexOf('id="' + id + '"') !== -1, id + ' on Me');
  });
  assert.ok(me.indexOf('id="mapCard"') < me.indexOf('id="logCard"'), 'above the Usage log');
  assert.strictEqual(html.indexOf('</script>Test Place'), -1, 'notes cannot close the script tag');
  assert.ok(html.indexOf('r.mapCheck = mapResult();') !== -1);
});

test('map check export: answers keyed by conflict id, then flags, problems found and added', function() {
  var mc = {ship: 'HM', conflicts: [{id: 'one', check: 'Which deck?'}, {id: 'two', check: 'Where?'}]};
  var t0 = new Date(2027, 2, 7, 14, 3).getTime();
  var notes = [
    {id: 'c:one', type: 'answer', conflict: 'one', answer: 'app right', deck: 5, pos: 'fore', note: 'By the stairs',
     ms: t0},
    {id: 'c:gone', type: 'answer', conflict: 'gone', answer: 'neither', ms: t0},
    {id: 'f1', type: 'flag', place: 'Test Place', decks: [4], shown: 'FROM YOUR CABIN 2 decks', start: 'stateroom',
     ms: t0, note: 'Wrong side'},
    {id: 'a:HM:no-route:X', type: 'found', place: 'X', problem: 'no route found to it', count: 3, ms: t0,
     last: t0 + 3600000},
    {type: 'added', place: 'Test Stairs', side: 'port'}
  ];
  var out = JSON.parse(config.mapExport(mc, notes, 'Test watch', new Date(2027, 2, 8, 9, 0)));
  assert.deepStrictEqual([out.format, out.v, out.ship, out.device, out.copied],
                         ['royal-pebble-map-notes', 1, 'HM', 'Test watch', '2027-03-08 09:00']);
  assert.deepStrictEqual(Object.keys(out.conflicts), ['one', 'two', 'gone']);
  assert.deepStrictEqual(out.conflicts.one, {check: 'Which deck?', answer: 'app right',
                                             where: {deck: 5, pos: 'fore'}, note: 'By the stairs',
                                             at: '2027-03-07 14:03'});
  assert.deepStrictEqual(out.conflicts.two, {check: 'Where?', answer: 'not checked'});
  assert.strictEqual(out.conflicts.gone.answer, 'neither');
  assert.deepStrictEqual(out.flags, [{at: '2027-03-07 14:03', place: 'Test Place', decks: [4],
                                      page: 'FROM YOUR CABIN 2 decks', start: 'stateroom', note: 'Wrong side'}]);
  assert.deepStrictEqual(out.found, [{first: '2027-03-07 14:03', last: '2027-03-07 15:03', times: 3, place: 'X',
                                      problem: 'no route found to it'}]);
  assert.deepStrictEqual(out.added, [{place: 'Test Stairs', where: {side: 'port'}}]);
});

test('settings page has the walking distance units, feet, metres or steps', function() {
  var state = {ships: [], cruise: null, status: {}, me: {}, theme: 'light', reminderLead: 15, units: 'ft',
    api: royal.API, appKey: royal.APPKEY};
  var html = config.buildPage(state, new Date(2026, 8, 24));
  new Function(pageScript(html));
  assert.ok(html.indexOf('id="units"') !== -1);
  ['ft', 'm', 'steps'].forEach(function(u) {
    assert.ok(html.indexOf('data-v="' + u + '"') !== -1, u);
  });
  assert.ok(html.indexOf("segment('units', S.units || 'm')") !== -1);
  assert.ok(html.indexOf('units: getUnits()') !== -1, 'sent back with the rest');
  assert.ok(html.indexOf('"units":"ft"') !== -1, 'saved choice embedded');
});

test('settings page has the Always show button hints switch in Help, off by default', function() {
  var state = {ships: [], cruise: null, status: {}, me: {}, theme: 'light', reminderLead: 15,
    api: royal.API, appKey: royal.APPKEY};
  var html = config.buildPage(state, new Date(2026, 8, 24));
  new Function(pageScript(html));
  var help = html.slice(html.indexOf('<section class="screen" id="help">'));
  help = help.slice(0, help.indexOf('</section>'));
  assert.ok(help.indexOf('id="hints"') !== -1, 'the switch is in Help');
  assert.strictEqual(html.split('id="hints"').length, 2, 'and only there');
  assert.ok(html.indexOf('Always show button hints') !== -1);
  assert.ok(html.indexOf("makeSwitch('hints', S.alwaysHints === true)") !== -1, 'off unless saved on');
  assert.ok(html.indexOf('r.alwaysHints = hintsOn()') !== -1, 'sent back with the rest');
  state.alwaysHints = true;
  assert.ok(config.buildPage(state, new Date(2026, 8, 24)).indexOf('"alwaysHints":true') !== -1,
    'saved choice embedded');
});

test('Help: opened from Me, lists controls, notes and the ships with Ship GPS', function() {
  var state = {ships: [], cruise: null, status: {}, me: {}, theme: 'light', reminderLead: 15,
    gpsShips: ['Harmony of the Seas'], shipSides: null, api: royal.API, appKey: royal.APPKEY};
  var html = config.buildPage(state, new Date(2026, 8, 24));
  new Function(pageScript(html));
  var me = html.slice(html.indexOf('<section class="screen" id="me">'), html.indexOf('<section class="screen" id="help">'));
  assert.ok(me.indexOf('id="openHelp"') !== -1, 'Help card on Me');
  ['Watch buttons', 'Hold Select', 'Route to the next event', 'closest restroom', 'Good to know',
   '4:00 am', 'approximate', 'Spot approximate', 'Cross the ship', 'no internet', 'Ships with Ship GPS']
    .forEach(function(t) { assert.ok(html.indexOf(t) !== -1, t); });
  assert.ok(html.indexOf('"gpsShips":["Harmony of the Seas"]') !== -1);
  assert.ok(html.indexOf('id="sidesCard" hidden') !== -1, 'port/starboard hidden without a mapped ship');
});

test('Help: port and starboard settings for a mapped ship go back per ship', function() {
  var state = {ships: [], cruise: null, status: {}, me: {}, theme: 'light', reminderLead: 15,
    shipSides: {ship: 'HM', name: 'Harmony of the Seas', decks: [2, 3, 4], all: false, flipDecks: [3],
                confirmed: false},
    api: royal.API, appKey: royal.APPKEY};
  var html = config.buildPage(state, new Date(2026, 8, 24));
  new Function(pageScript(html));
  assert.ok(html.indexOf('"flipDecks":[3]') !== -1);
  ['id="sidesOk"', 'id="flipAll"', 'id="flipDecks"', 'Sides checked on board', 'Flip the whole ship']
    .forEach(function(t) { assert.ok(html.indexOf(t) !== -1, t); });
  assert.ok(html.indexOf("r.shipSides = {ship: SD.ship, all: switchOn('flipAll'), decks: flipDecks.slice(), " +
    "confirmed: switchOn('sidesOk')}") !== -1, 'sent back with the rest');
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

test('Days screen: Royal\'s time, the warning period and the tender notice', function() {
  var state = {ships: [], cruise: null, status: {}, me: {}, theme: 'light', reminderLead: 15,
    itinerary: [{date: '2027-03-08', type: 'TENDERED', port: 'Grand Cayman', arrive: '07:00', depart: '15:00',
                 royal: 900}],
    days: {'2027-03-08': {shift: -15, warn: 90}}, api: royal.API, appKey: royal.APPKEY};
  var html = config.buildPage(state, new Date(2026, 8, 24));
  new Function(pageScript(html));
  assert.ok(html.indexOf('"royal":900') !== -1);
  assert.ok(html.indexOf('"shift":-15') !== -1 && html.indexOf('"warn":90') !== -1);
  ['From Royal', 'Warning period', 'Tender port. Boats', 'data-act="shift"'].forEach(function(s) {
    assert.ok(html.indexOf(s) !== -1, s);
  });
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

test('Ready to sail card replaces the All set line, with the load and the page time (§24.2)', function() {
  var state = {ships: [], status: {}, me: {}, theme: 'light', reminderLead: 15,
    cruise: {shipCode: 'HM', shipName: 'Harmony of the Seas', sailDate: '2027-03-06', days: 4, nights: 3,
             published: true, events: 2, savedDays: 4, lastSync: 'today'},
    dayLoad: [{date: '2027-03-07', fixed: 2, cats: [['Shop', 'Retail', 1]]}], maxEvents: 160,
    api: royal.API, appKey: royal.APPKEY};
  var html = config.buildPage(state, new Date(2027, 2, 6, 12, 0));
  new Function(pageScript(html));
  assert.ok(html.indexOf('READY TO SAIL?') !== -1, 'card code');
  assert.ok(html.indexOf('All set: Royal Pebble works at sea') === -1, 'old line gone');
  assert.ok(html.indexOf('"pageNow":' + new Date(2027, 2, 6, 12, 0).getTime()) !== -1, 'page time');
  assert.ok(html.indexOf('"dayLoad":[{"date":"2027-03-07"') !== -1, 'load embedded');
});

test('Filters: the Casino category uses the shared matcher (§27)', function() {
  var state = {ships: [], cruise: null, status: {}, me: {}, api: royal.API, appKey: royal.APPKEY,
    categories: [{name: 'Casino', n: 18, subs: [{name: '', n: 18}]}], hiddenCats: ['Casino']};
  var html = config.buildPage(state, new Date(2027, 2, 6, 12, 0));
  new Function(pageScript(html));
  assert.ok(html.indexOf('function isCasino(') !== -1, 'matcher embedded');
  assert.ok(html.indexOf('function eventCat(') !== -1, 'category embedded');
  assert.ok(html.indexOf('bingo and raffles') !== -1, 'Filters note');
});

test('Filters: the AGES switches above categories, sent back as ageFilters (Phase 4 §2.4)', function() {
  var state = {ships: [], cruise: null, status: {}, me: {}, api: royal.API, appKey: royal.APPKEY,
    categories: [], hiddenCats: [], ageFilters: ['young']};
  var html = config.buildPage(state, new Date(2027, 2, 6, 12, 0));
  var script = pageScript(html);
  new Function(script);
  assert.ok(html.indexOf('function isFamily(') !== -1, 'family matcher embedded');
  assert.ok(html.indexOf('function ageMask(') !== -1, 'age matcher embedded');
  assert.ok(html.indexOf('"ageFilters":["young"]') !== -1, 'state embedded');
  assert.ok(html.indexOf('>AGES</div>') < html.indexOf('>CATEGORIES</div>'), 'AGES first');
  ['Hide Adult only events', 'Hide Teen and Kid only events', 'Hide Family events'].forEach(function(t) {
    assert.ok(script.indexOf(t) !== -1, t);
  });
  assert.ok(html.indexOf('never hide an event with no age listed') !== -1, 'note');
  assert.ok(script.indexOf('r.ageFilters = ageOn.slice();') !== -1, 'sent back');
  assert.ok(script.indexOf('(e.ages & ageHideMask()) !== 0') !== -1, 'Hidden on watch');
});

test('Events rows: age, arrive-early and a Notes toggle (Phase 4 §2.3, §3.3, §4.2)', function() {
  var state = {ships: [], cruise: null, status: {}, me: {}, api: royal.API, appKey: royal.APPKEY};
  var html = config.buildPage(state, new Date(2027, 2, 6, 12, 0));
  var script = pageScript(html);
  new Function(script);
  assert.ok(html.indexOf('function ageText(') !== -1, 'age wording embedded');
  assert.ok(script.indexOf("'Arrive ' + e.early + ' min early'") !== -1, 'arrive-early text');
  assert.ok(script.indexOf('data-act="notes" aria-expanded="false">Notes &middot; ') !== -1, 'notes toggle');
  assert.ok(script.indexOf('<ul class="notes" hidden>') !== -1, 'notes collapsed');
});

test('Events search: count line, day headers, My entries and Hidden on watch (§24.3)', function() {
  var state = {ships: [], cruise: null, status: {}, me: {}, api: royal.API, appKey: royal.APPKEY,
    personal: [{title: 'Trivia with friends', venue: 'Pub', date: '2027-03-07', time: '15:00', minutes: 0}]};
  var html = config.buildPage(state, new Date(2027, 2, 6, 12, 0));
  new Function(pageScript(html));
  assert.ok(html.indexOf('id="evClear"') !== -1, 'clear button');
  assert.ok(html.indexOf('&middot; all days') !== -1, 'count line');
  assert.ok(html.indexOf('class="dhead"') !== -1, 'day headers');
  assert.ok(html.indexOf('Hidden on watch') !== -1, 'hidden chip');
  assert.ok(html.indexOf('>My entry<') !== -1, 'entry chip');
});

test('Booked activities and excursions: a card per port day with Pick buttons (Phase 4 §6.1)', function() {
  var state = {ships: [], cruise: null, status: {}, me: {}, api: royal.API, appKey: royal.APPKEY};
  var html = config.buildPage(state, new Date(2027, 2, 6, 12, 0));
  var script = pageScript(html);
  new Function(script);
  assert.ok(script.indexOf("port ? 'Shore excursions' : 'Tours']") !== -1, 'day card head, sea days too');
  assert.ok(script.indexOf('data-act="xPick"') !== -1, 'Pick button');
  assert.ok(script.indexOf("'All day from '") !== -1, 'all-day rental line');
  assert.ok(script.indexOf('function inOrders(e)') !== -1, 'booked ones show once');
  assert.ok(script.indexOf('Pick the sessions you booked in the Royal app.') !== -1, 'intro');
});

test('Test alerts is a switch, sent back only when flipped', function() {
  var state = {ships: [], cruise: null, status: {}, me: {}, api: royal.API, appKey: royal.APPKEY, testAlerts: true};
  var html = config.buildPage(state, new Date(2027, 2, 6, 12, 0));
  var script = pageScript(html);
  assert.ok(html.indexOf('role="switch" id="testAlerts"') !== -1, 'switch');
  assert.ok(script.indexOf("makeSwitch('testAlerts', S.testAlerts === true)") !== -1, 'starts as saved');
  assert.ok(script.indexOf("switchOn('testAlerts') !== (S.testAlerts === true)") !== -1, 'only when flipped');
  assert.strictEqual(script.indexOf("close('test')"), -1, 'no longer closes the page');
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
