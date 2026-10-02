// Unit tests for the phone companion's slice logic. Run: node test/pkjs/slice.test.js
var assert = require('assert');
var slice = require('../../src/pkjs/slice');
var pack = require('../../src/pkjs/pack');
var bundleLib = require('../../src/pkjs/bundle');
var demo = require('../../src/pkjs/demo');
var venues = require('../../src/pkjs/venues');

var tests = [];
function test(name, fn) { tests.push({name: name, fn: fn}); }

function makeBundle(events, itinerary) {
  return {
    format: 'cruise-watch', v: 1, generated: '2027-03-07T12:00:00Z',
    ship: {code: 'HM', name: 'Harmony of the Seas'},
    sailDate: '2027-03-06',
    itinerary: itinerary || [
      {day: 1, date: '2027-03-06', port: 'Orlando (Port Canaveral), Fl', type: 'EMBARK', arrive: null, depart: '16:00'},
      {day: 2, date: '2027-03-07', port: 'Cruising', type: 'CRUISING', arrive: null, depart: null},
      {day: 3, date: '2027-03-08', port: 'St. Thomas, U.S. Virgin Islands', type: 'DOCKED', arrive: '08:00', depart: '17:00'},
      {day: 4, date: '2027-03-09', port: 'Orlando (Port Canaveral), Fl', type: 'DEBARK', arrive: '06:00', depart: null}
    ],
    schedule: {
      published: true,
      cats: [['Entertainment', 'Shows'], ['Shop', 'Retail']],
      venues: ['Studio B', 'Boardwalk', 'Promenade'],
      fields: ['title', 'venue', 'cat', 'date', 'time', 'minutes', 'featured', 'reservation'],
      events: events || []
    }
  };
}

function at(iso, hh, mm) {
  var p = iso.split('-');
  return new Date(+p[0], +p[1] - 1, +p[2], hh, mm);
}

test('days_from_civil matches known dates', function() {
  assert.strictEqual(slice.daysFromCivil(1970, 1, 1), 0);
  assert.strictEqual(slice.daysFromCivil(2027, 3, 6), 20883);
  assert.strictEqual(slice.isoFromDays(20883), '2027-03-06');
  assert.strictEqual(slice.daysFromCivil(2028, 3, 1) - slice.daysFromCivil(2028, 2, 28), 2);  // leap year
});

test('cruise minutes and day index', function() {
  var sail = slice.daysFromIso('2027-03-06');
  assert.strictEqual(slice.cruiseMinutes(sail, at('2027-03-06', 0, 0)), 0);
  assert.strictEqual(slice.cruiseMinutes(sail, at('2027-03-07', 1, 30)), 1440 + 90);
  // 00:30 still belongs to the previous watch day (days start at 04:00).
  assert.strictEqual(slice.cruiseDayIndex(1440 + 30), 0);
  assert.strictEqual(slice.cruiseDayIndex(1440 + 240), 1);
  assert.strictEqual(slice.cruiseDayIndex(-1), -1);
  assert.strictEqual(slice.cruiseDayIndex(3 * 60), -1);
});

test('events after midnight stay in the evening they belong to', function() {
  // Royal dates after-midnight events with the evening's date (seen in live data:
  // a 01:00 curfew dated the embark day).
  var b = makeBundle([
    ['Late Show', 1, 0, '2027-03-07', '23:30', 90, 0, 0],
    ['Silent Disco', 1, 0, '2027-03-07', '00:30', 60, 0, 0],
    ['Curfew', 1, 0, '2027-03-08', '01:00', 0, 0, 0],
    ['Morning Yoga', 2, 0, '2027-03-08', '07:00', 30, 0, 0]
  ]);
  var s = slice.buildSlice(b, {}, {}, at('2027-03-08', 0, 45));
  assert.strictEqual(s.dayIndex, 1);
  assert.strictEqual(s.day.location, 'At Sea');
  assert.deepStrictEqual(s.events.map(function(e) { return e.title; }), ['Late Show', 'Silent Disco']);
  var late = s.events[0];
  assert.strictEqual(late.start, 1440 + 23 * 60 + 30);
  // Ends after midnight: still one number, no wraparound.
  assert.strictEqual(late.start + late.minutes, 2 * 1440 + 60);
  assert.strictEqual(s.events[1].start, 2 * 1440 + 30);
});

test('countdown: sail port and stars across the whole cruise', function() {
  var b = makeBundle([
    ['Hairspray', 0, 0, '2027-03-07', '19:00', 90, 1, 0],
    ['Trivia', 1, 0, '2027-03-08', '13:00', 30, 0, 0],
    ['Sale', 2, 1, '2027-03-08', '10:00', 60, 0, 0]  // Shop: hidden, but a star still counts
  ]);
  var stars = {};
  stars[slice.starKey('Hairspray', '2027-03-07', '19:00', 'Studio B')] = true;
  stars[slice.starKey('Sale', '2027-03-08', '10:00', 'Promenade')] = true;
  stars[slice.starKey('Gone', '2027-03-08', '11:00', 'Studio B')] = true;  // no longer listed
  var settings = {personal: [{title: 'Dinner', venue: 'Main Dining', date: '2027-03-07', time: '18:00', minutes: 90}]};
  var s = slice.buildSlice(b, settings, stars, at('2026-12-18', 9, 0));
  assert.strictEqual(s.day.kind, slice.DAY_NONE);
  assert.strictEqual(s.day.status, 'SAILS MAR 6');
  assert.strictEqual(s.sailPort, 'Port Canaveral');
  assert.strictEqual(s.cruiseStarred, 3);

  // An itinerary that doesn't start on the sail date: no port.
  b.itinerary = b.itinerary.slice(1);
  assert.strictEqual(slice.buildSlice(b, {}, {}, at('2026-12-18', 9, 0)).sailPort, '');
});

test('button hints: off unless Always show is on', function() {
  var b = makeBundle([]);
  var now = at('2027-03-08', 9, 0);
  assert.strictEqual(slice.buildSlice(b, {}, {}, now).buttonHints, 0);
  assert.strictEqual(slice.buildSlice(b, {alwaysHints: false}, {}, now).buttonHints, 0);
  assert.strictEqual(slice.buildSlice(b, {alwaysHints: true}, {}, now).buttonHints, 1);
});

test('stateroom: a guarantee booking shows as not assigned', function() {
  var b = makeBundle([]);
  var now = at('2027-03-08', 10, 0);
  b.mine = {stateroom: 'GTY', orders: []};
  assert.strictEqual(slice.buildSlice(b, {}, {}, now).info.stateroom, '-');
  b.mine.stateroom = null;
  assert.strictEqual(slice.buildSlice(b, {}, {}, now).info.stateroom, '-');
  b.mine.stateroom = '9254';
  assert.strictEqual(slice.buildSlice(b, {}, {}, now).info.stateroom, '9254');
  // One typed on the settings page wins.
  b.mine.stateroom = 'GTY';
  assert.strictEqual(slice.buildSlice(b, {me: {stateroom: '10301'}}, {}, now).info.stateroom, '10301');
});

test('My info: booking and cabin table fill empty fields, hand edits win', function() {
  var b = makeBundle([]);
  var now = at('2027-03-08', 10, 0);
  b.mine = {stateroom: '8226', deck: '8', muster: 'B4', orders: []};
  function info(me) { return slice.buildSlice(b, {me: me}, {}, now).info; }
  // Nothing saved yet: booking stateroom and muster, deck and stairs from the cabin table.
  var i = info(undefined);
  assert.deepStrictEqual([i.stateroom, i.deck, i.stairs, i.muster], ['8226', 'Deck 8', 'Aft stairs, port', 'B4']);
  // Settings from before the drop-downs (no src): saved text wins, empty falls back.
  i = info({stateroom: '', deck: '', stairs: 'Fwd stairs', muster: ''});
  assert.deepStrictEqual([i.deck, i.stairs, i.muster], ['Deck 8', 'Fwd stairs', 'B4']);
  // Filled-in values follow a newer sync; hand edits stay.
  i = info({stateroom: '8226', deck: 'Deck 8', stairs: 'Aft stairs, port', muster: 'B2',
            src: {stateroom: 'booking', deck: 'cabin', stairs: 'map', muster: 'booking'}});
  assert.strictEqual(i.muster, 'B4');
  i = info({stateroom: '8226', deck: 'Deck 9', stairs: '', muster: '',
            src: {stateroom: 'booking', deck: 'edited', muster: 'edited'}});
  assert.deepStrictEqual([i.deck, i.stairs, i.muster], ['Deck 9', '', 'Not set']);
  // A typed stateroom that isn't the booking's.
  i = info({stateroom: '8130', deck: 'Deck 8', stairs: 'Forward stairs, port', muster: 'B4',
            src: {stateroom: 'edited', deck: 'cabin', stairs: 'map', muster: 'booking'}});
  assert.deepStrictEqual([i.stateroom, i.deck, i.stairs], ['8130', 'Deck 8', 'Forward stairs, port']);
  // No map for the ship: the booking's deck, no stairs.
  b.ship = {code: 'XX', name: 'Test of the Seas'};
  i = info({});
  assert.deepStrictEqual([i.deck, i.stairs, i.muster], ['Deck 8', '', 'B4']);
  b.mine = {};
  i = info({});
  assert.deepStrictEqual([i.stateroom, i.deck, i.stairs, i.muster], ['-', '', '', 'Not set']);
  // Main dining room: typed in only (no booking source yet); Not set when empty.
  assert.strictEqual(i.dining, 'Not set');
  i = info({dining: 'Main Dining Room 4', src: {dining: 'edited'}});
  assert.strictEqual(i.dining, 'Main Dining Room 4');
});

test('all-aboard uses depart, buffer and ship offset', function() {
  var b = makeBundle([]);
  var s = slice.buildSlice(b, {}, {}, at('2027-03-08', 10, 0));
  assert.strictEqual(s.day.kind, slice.DAY_PORT);
  assert.strictEqual(s.day.location, 'St. Thomas');
  assert.strictEqual(s.day.allAboard, 2 * 1440 + 17 * 60 - 30);

  var settings = {days: {'2027-03-08': {offset: 60, buffer: 45}}};
  s = slice.buildSlice(b, settings, {}, at('2027-03-08', 10, 0));
  // Depart 17:00 local = 16:00 ship, minus 45.
  assert.strictEqual(s.day.allAboard, 2 * 1440 + 16 * 60 - 45);
  assert.strictEqual(s.day.localOffset, 60);

  s = slice.buildSlice(b, {days: {'2027-03-08': {allAboard: '16:15'}}}, {}, at('2027-03-08', 10, 0));
  assert.strictEqual(s.day.allAboard, 2 * 1440 + 16 * 60 + 15);
});

test('late departure and all-aboard after midnight', function() {
  var it = makeBundle().itinerary;
  it[2].depart = '00:45';  // listed on the port day's date, but it means after midnight
  var b = makeBundle([], it);
  var s = slice.buildSlice(b, {}, {}, at('2027-03-08', 22, 0));
  var expected = 3 * 1440 + 15;  // 00:15 on the next date
  assert.strictEqual(s.day.allAboard, expected);
  // The countdown keeps running across midnight: at 23:50 it is 25 minutes...
  assert.strictEqual(s.day.allAboard - slice.cruiseMinutes(slice.daysFromIso(b.sailDate), at('2027-03-08', 23, 50)), 25);
  // ...and at 00:05 the same watch day still has 10 minutes left.
  var s2 = slice.buildSlice(b, {}, {}, at('2027-03-09', 0, 5));
  assert.strictEqual(s2.dayIndex, s.dayIndex);
  assert.strictEqual(s2.day.allAboard - slice.cruiseMinutes(slice.daysFromIso(b.sailDate), at('2027-03-09', 0, 5)), 10);

  // An all-aboard override before 04:00 is after midnight too.
  s = slice.buildSlice(makeBundle([]), {days: {'2027-03-08': {allAboard: '00:30'}}}, {}, at('2027-03-08', 22, 0));
  assert.strictEqual(s.day.allAboard, 3 * 1440 + 30);
});

test('debark day has no all-aboard; embark shows port', function() {
  var b = makeBundle([]);
  assert.strictEqual(slice.buildSlice(b, {}, {}, at('2027-03-09', 9, 0)).day.allAboard, slice.NO_TIME);
  var embark = slice.buildSlice(b, {}, {}, at('2027-03-06', 12, 0)).day;
  assert.strictEqual(embark.location, 'Port Canaveral');
  assert.strictEqual(embark.allAboard, 16 * 60 - 30);
});

test('before and after the cruise', function() {
  var b = makeBundle([]);
  var before = slice.buildSlice(b, {}, {}, at('2027-02-22', 12, 0));
  assert.strictEqual(before.day.kind, slice.DAY_NONE);
  assert.strictEqual(before.day.status, 'SAILS MAR 6');
  // 03:00 on the sail date is still the day before.
  assert.strictEqual(slice.buildSlice(b, {}, {}, at('2027-03-06', 3, 0)).day.kind, slice.DAY_NONE);
  var after = slice.buildSlice(b, {}, {}, at('2027-03-14', 12, 0));
  assert.strictEqual(after.day.status, 'CRUISE ENDED');
});

test('filters, untimed entries, stars and personal entries', function() {
  var b = makeBundle([
    ['Scavenger Hunt', 2, 0, '2027-03-07', null, 0, 0, 0],
    ['Watch Sale', 2, 1, '2027-03-07', '10:00', 60, 0, 0],
    ['Ice Show', 0, 0, '2027-03-07', '20:00', 60, 1, 1]
  ]);
  var stars = {};
  stars[slice.starKey('Ice Show', '2027-03-07', '20:00', 'Studio B')] = true;
  var settings = {personal: [{title: 'Dinner', venue: 'Main Dining', date: '2027-03-07', time: '18:00', minutes: 90}]};
  var s = slice.buildSlice(b, settings, stars, at('2027-03-07', 9, 0));
  assert.deepStrictEqual(s.events.map(function(e) { return e.title; }), ['Scavenger Hunt', 'Dinner', 'Ice Show']);
  assert.strictEqual(s.events[0].start, slice.NO_TIME);
  assert.strictEqual(s.events[1].flags, slice.FLAG_PERSONAL);
  // The featured Ice Show is on only once, so it's also an only show.
  assert.strictEqual(s.events[2].flags,
                     slice.FLAG_STARRED | slice.FLAG_FEATURED | slice.FLAG_RESERVATION | slice.FLAG_ONLY_SHOW);

  s = slice.buildSlice(b, {hiddenCats: []}, {}, at('2027-03-07', 9, 0));
  assert.strictEqual(s.events.length, 3);  // Shop shown when not hidden
});

test('Filters: subcategories, and starred events ignore filters', function() {
  var b = makeBundle([
    ['Scavenger Hunt', 2, 0, '2027-03-07', null, 0, 0, 0],
    ['Watch Sale', 2, 1, '2027-03-07', '10:00', 60, 0, 0],
    ['Ice Show', 0, 0, '2027-03-07', '20:00', 60, 1, 1]
  ]);
  b.schedule.cats.push(['Entertainment', '']);
  b.schedule.events.push(['Parade', 1, 2, '2027-03-07', '14:00', 30, 0, 0]);
  var titles = function(s) { return s.events.map(function(e) { return e.title; }); };

  var s = slice.buildSlice(b, {hiddenCats: ['Entertainment / Shows', 'Entertainment / ']}, {}, at('2027-03-07', 9, 0));
  assert.deepStrictEqual(titles(s), ['Watch Sale']);  // Shop not hidden: the list replaces the default

  var stars = {};
  stars[slice.starKey('Watch Sale', '2027-03-07', '10:00', 'Promenade')] = true;
  s = slice.buildSlice(b, {}, stars, at('2027-03-07', 9, 0));
  assert.deepStrictEqual(titles(s), ['Scavenger Hunt', 'Watch Sale', 'Parade', 'Ice Show']);
  assert.strictEqual(s.alarms.filter(function(a) { return a.title === 'Watch Sale'; }).length, 1);

  // Shore excursions show only once picked, so Filters leaves them out.
  b.schedule.cats.push(['Shore excursions', '']);
  b.schedule.events.push(['Kayak Adventure', 1, 3, '2027-03-07', '09:00', 90, 0, 1]);
  assert.deepStrictEqual(slice.categorySummary(b), [
    {name: 'Entertainment', n: 3, subs: [{name: '', n: 1}, {name: 'Shows', n: 2}]},
    {name: 'Shop', n: 1, subs: [{name: 'Retail', n: 1}]}
  ]);
  assert.deepStrictEqual(slice.hiddenCats({}), ['Shop']);
  assert.deepStrictEqual(slice.hiddenCats({hiddenCats: []}), []);
  assert.deepStrictEqual(slice.cleanHiddenCats(['Shop', 'Shop', 7, '', 'Spa / Salon']), ['Shop', 'Spa / Salon']);
  assert.strictEqual(slice.cleanHiddenCats('Shop'), null);
});

test('Casino category: venue, Royal\'s Casino subcategory and casino game titles (§12.4)', function() {
  var yes = [
    ['Welcome Raffle', 'Casino Royale', ['Entertainment', 'Casino']],   // a raffle at the casino counts
    ['Lucky Draw', 'Casino Royale Non-Smoking', ['Activities', '']],
    ['Big Wheel', 'Expanded Casino', []],
    ['Tournament', '', ['Entertainment', 'Casino']],
    ['Texas Hold\'em Tournament', 'Sky Lounge', ['Activities', 'Games & Competitions']],
    ['Texas Hold\u2019em Cash Game', '', []],
    ['Blackjack Lessons', 'Pub', []],
    ['Slot Tournament', '', []],
    ['Casino Night Party', 'Boleros', ['Activities', 'Events']],
    ['Poker Night', '', []], ['Roulette 101', '', []], ['Craps Class', '', []]
  ];
  var no = [
    ['Cash Prize Bingo, Cards on Sale', 'Royal Theater', ['Activities', 'Games & Competitions']],
    ['Casino Bingo', 'On Air', []],
    ['Spa Tour & Raffle', 'Fitness Center', ['Spa', 'Events']],
    ['Shuffleboard Tournament', 'Sports Court', ['Activities', 'Sports & Recreation']],
    ['Game Show: Millionaire', 'On Air', ['Activities', 'Games & Competitions']],
    ['Book a Time Slot', 'FlowRider', []],
    ['Pokeball Hunt', '', []], ['Crapshoot Comedy', '', []],
    ['Trivia', undefined, undefined]
  ];
  yes.forEach(function(c) { assert.deepStrictEqual(slice.eventCat(c[0], c[1], c[2]), ['Casino', ''], c[0]); });
  no.forEach(function(c) { assert.ok(!slice.isCasino(c[0], c[1], c[2]), c[0]); });
  assert.deepStrictEqual(slice.eventCat('Bingo', 'On Air', ['Activities', 'Games']), ['Activities', 'Games']);

  var b = makeBundle([
    ['Poker Tournament', 1, 0, '2027-03-07', '10:00', 60, 0, 0],
    ['Slot Tournament', 3, 2, '2027-03-07', '11:00', 60, 0, 0],
    ['Hot Seat Drawing', 3, 2, '2027-03-07', '21:00', 15, 0, 0],
    ['Ice Show', 0, 0, '2027-03-07', '20:00', 60, 0, 0],
    ['Bingo', 1, 0, '2027-03-07', '15:00', 60, 0, 0],
    ['Blackjack Class', 1, 3, '2027-03-07', '16:00', 60, 0, 0]
  ]);
  b.schedule.venues.push('Casino Royale');
  b.schedule.cats.push(['Entertainment', 'Casino'], []);
  var titles = function(s) { return s.events.map(function(e) { return e.title; }); };
  var now = at('2027-03-07', 9, 0);
  // Casino takes its events out of Royal's categories (Entertainment / Casino
  // is gone), whatever category Royal gave them.
  assert.deepStrictEqual(slice.categorySummary(b), [
    {name: 'Casino', n: 4, subs: [{name: '', n: 4}]},
    {name: 'Entertainment', n: 2, subs: [{name: 'Shows', n: 2}]}
  ]);
  assert.deepStrictEqual(titles(slice.buildSlice(b, {}, {}, now)),
    ['Poker Tournament', 'Slot Tournament', 'Bingo', 'Blackjack Class', 'Ice Show', 'Hot Seat Drawing']);

  // Hidden: casino events leave Today and the lists; a starred one stays, and
  // so do personal entries.
  var stars = {};
  stars[slice.starKey('Hot Seat Drawing', '2027-03-07', '21:00', 'Casino Royale')] = true;
  var settings = {hiddenCats: ['Casino'], personal: [{title: 'Poker with friends', venue: '', date: '2027-03-07',
                                                      time: '17:00', minutes: 60}]};
  assert.deepStrictEqual(titles(slice.buildSlice(b, settings, stars, now)),
    ['Bingo', 'Poker with friends', 'Ice Show', 'Hot Seat Drawing']);
  var day = slice.dayLoad(b, settings, stars)[1];
  assert.strictEqual(day.fixed, 2);
  assert.deepStrictEqual(day.cats, [['Casino', '', 3], ['Entertainment', 'Shows', 2]]);
});

test('Ready to sail: each day load before the 160 trim, and the days saved (§12.2)', function() {
  var b = makeBundle([
    ['Scavenger Hunt', 2, 0, '2027-03-07', null, 0, 0, 0],
    ['Watch Sale', 2, 1, '2027-03-07', '10:00', 60, 0, 0],
    ['Gem Sale', 2, 1, '2027-03-07', '11:00', 60, 0, 0],
    ['Late Party', 1, 0, '2027-03-07', '01:00', 60, 0, 0],   // after midnight: still day 2's night
    ['Ice Show', 0, 0, '2027-03-08', '20:00', 60, 1, 1]
  ]);
  var stars = {};
  stars[slice.starKey('Gem Sale', '2027-03-07', '11:00', 'Promenade')] = true;
  var settings = {personal: [{title: 'Dinner', venue: '', date: '2027-03-07', time: '18:00', minutes: 90}]};
  var load = slice.dayLoad(b, settings, stars);
  assert.deepStrictEqual(load.map(function(d) { return d.date; }),
                         ['2027-03-06', '2027-03-07', '2027-03-08', '2027-03-09']);
  // Day 2: the starred sale and the personal entry are fixed; Shop is counted
  // although hidden by default, so the page can recount as filters change.
  assert.deepStrictEqual(load[1], {date: '2027-03-07', fixed: 2,
    cats: [['Entertainment', 'Shows', 2], ['Shop', 'Retail', 1]]});
  assert.deepStrictEqual(load[2].cats, [['Entertainment', 'Shows', 1]]);
  assert.strictEqual(load[3].fixed + load[3].cats.length, 0);
  // Embark day has no events yet and debark day counts as saved.
  assert.strictEqual(slice.savedDays(b), 3);
  b.schedule.events.push(['Sail Away', 1, 0, '2027-03-06', '16:00', 60, 0, 0]);
  assert.strictEqual(slice.savedDays(b), 4);

  // A day past the watch's limit counts in full; the watch gets 160.
  var busy = [];
  for (var i = 0; i < 170; i++) {
    busy.push(['Class ' + i, 1, 0, '2027-03-07', '08:' + (i % 60 < 10 ? '0' : '') + (i % 60), 30, 0, 0]);
  }
  b = makeBundle(busy);
  var day = slice.dayLoad(b, {}, {})[1];
  assert.strictEqual(day.cats[0][2], 170);
  var sailDays = slice.daysFromIso(b.sailDate);
  assert.strictEqual(slice.buildEvents(b, {}, {}, 1, sailDays).length, slice.MAX_EVENTS);
});

test('packing round-trips and respects chunk size', function() {
  var events = [];
  for (var i = 0; i < 90; i++) {
    events.push({title: 'Event number ' + i + ' with a fairly long title for testing', venue: 'Royal Promenade',
                 start: i < 2 ? -1 : 1440 + i * 10, minutes: 45, flags: i % 16,
                 where: {deck: i % 18, deckTo: 0, pos: 2, ashore: false, rel: null},
                 ageMin: i % 3 ? 0 : 18, ageMax: i % 5 ? 0 : 17, early: i % 7 ? 0 : 15, tags: i});
  }
  var chunks = pack.packEvents(events, 700);
  var decoded = [];
  chunks.forEach(function(c) {
    assert.ok(c.bytes.length <= 700);
    assert.strictEqual(c.first, decoded.length);
    var p = 0, b = c.bytes;
    while (p < b.length) {
      var start = (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24));
      var minutes = b[p + 4] | (b[p + 5] << 8);
      var flags = b[p + 6];
      var deck = b[p + 7];
      var info = b.slice(p + 11, p + 15);
      var tl = b[p + 15];
      var title = String.fromCharCode.apply(null, b.slice(p + 16, p + 16 + tl));
      var vl = b[p + 16 + tl];
      p += 17 + tl + vl;
      decoded.push({start: start, minutes: minutes, flags: flags, deck: deck, info: info, title: title});
    }
  });
  assert.strictEqual(decoded.length, 90);
  assert.strictEqual(decoded[0].start, -1);
  assert.strictEqual(decoded[50].start, 1440 + 500);
  assert.strictEqual(decoded[50].title, events[50].title);
  assert.strictEqual(decoded[15].flags, 15);
  assert.strictEqual(decoded[17].deck, 17);
  assert.deepStrictEqual(decoded[0].info, [18, 17, 15, 0]);
  assert.deepStrictEqual(decoded[16].info, [0, 0, 0, 16]);
  assert.deepStrictEqual(decoded[21].info, [18, 0, 15, 21]);
  console.log('    90 events -> ' + chunks.length + ' chunks');
});

test('UTF-8 truncation keeps whole characters', function() {
  assert.deepStrictEqual(pack.utf8('abc', 2), [97, 98]);
  assert.deepStrictEqual(pack.utf8('aé', 2), [97]);  // é is 2 bytes; doesn't fit
  assert.strictEqual(pack.utf8('Café', 63).length, 5);
});

test('bundle validation', function() {
  assert.strictEqual(bundleLib.validate(makeBundle([])), null);
  assert.ok(bundleLib.parse('not json').error);
  var b = makeBundle([]);
  b.v = 2;
  assert.ok(/version/.test(bundleLib.validate(b)));
});

test('demo builds valid bundles for every variant, around midnight too', function() {
  [[10, 0], [23, 50], [0, 30], [3, 59], [4, 0]].forEach(function(hm) {
    for (var v = 0; v < demo.VARIANTS; v++) {
      var now = at('2026-09-23', hm[0], hm[1]);
      var d = demo.make(now, v);
      assert.strictEqual(bundleLib.validate(d.bundle), null);
      var s = slice.buildSlice(d.bundle, d.settings, d.stars, now);
      var nowMin = slice.cruiseMinutes(slice.daysFromIso(d.bundle.sailDate), now);
      if (v === 4) {
        // Embark: today is the sail date, the arrival under an hour out.
        assert.strictEqual(s.dayIndex, 0, 'demo embark is cruise day 1 at ' + hm);
        assert.strictEqual(s.day.status, 'EMBARK');
        if (hm[0] >= 4 && hm[0] !== 23) {
          assert.ok(s.day.terminal > nowMin && s.day.terminal <= nowMin + 50, 'arrival at ' + hm);
        }
      } else {
        assert.strictEqual(s.dayIndex, 1, 'demo today is cruise day 2 at ' + hm);
        assert.strictEqual(s.day.terminal, slice.NO_TIME);
      }
      assert.strictEqual(s.day.kind, v % 2 === 0 ? slice.DAY_PORT : slice.DAY_SEA);
      if (v === 2 && hm[0] !== 3) {
        // Alert test: reminder in 2 minutes, all-aboard warning in 3 (not near
        // 04:00, where they'd fall into the next watch day).
        var nowC = slice.cruiseMinutes(slice.daysFromIso(d.bundle.sailDate), now);
        var alarms = slice.buildAlarms(d.bundle, d.settings, d.stars, now);
        assert.deepStrictEqual(alarms.slice(0, 2).map(function(a) { return [a.kind, a.at - nowC]; }),
                               [[slice.ALARM_REMINDER, 2], [slice.ALARM_ALL_ABOARD, 3]]);
      } else if (v === 0 && hm[0] !== 3) {
        // Demo all-aboard is 2:13 away, even across midnight...
        assert.strictEqual(s.day.allAboard - slice.cruiseMinutes(slice.daysFromIso(d.bundle.sailDate), now), 133);
      } else if (v === 0) {
        // ...unless that is past the end of the watch day.
        assert.strictEqual(s.day.allAboard, slice.NO_TIME);
      }
      assert.ok(s.events.length >= 4);
      assert.ok(!s.events.some(function(e) { return /Sale|Blowout/.test(e.title); }), 'Shop hidden');
    }
  });
});

test('terminal arrival: embark day only, a time in ship time or Royal text', function() {
  var b = makeBundle();
  b.mine = {stateroom: '1234', arrival: '11:30', orders: []};
  var s = slice.buildSlice(b, {}, {}, at('2027-03-06', 9, 12));
  assert.strictEqual(s.day.terminal, 11 * 60 + 30);
  assert.strictEqual(s.day.terminalText, '');
  // Port time to ship time, like the itinerary.
  s = slice.buildSlice(b, {days: {'2027-03-06': {offset: 60}}}, {}, at('2027-03-06', 9, 12));
  assert.strictEqual(s.day.terminal, 10 * 60 + 30);
  // Not on other days.
  s = slice.buildSlice(b, {}, {}, at('2027-03-08', 9, 0));
  assert.strictEqual(s.day.terminal, slice.NO_TIME);
  assert.strictEqual(s.day.terminalText, '');
  // Royal's text when it isn't a time.
  b.mine.arrival = ' Between 11 and noon ';
  s = slice.buildSlice(b, {}, {}, at('2027-03-06', 9, 12));
  assert.strictEqual(s.day.terminal, slice.NO_TIME);
  assert.strictEqual(s.day.terminalText, 'Between 11 and noon');
  // None before check-in, or without login data.
  [null, '', undefined].forEach(function(v) {
    b.mine.arrival = v;
    s = slice.buildSlice(b, {}, {}, at('2027-03-06', 9, 12));
    assert.deepStrictEqual([s.day.terminal, s.day.terminalText], [slice.NO_TIME, '']);
  });
  delete b.mine;
  s = slice.buildSlice(b, {}, {}, at('2027-03-06', 9, 12));
  assert.deepStrictEqual([s.day.terminal, s.day.terminalText], [slice.NO_TIME, '']);
});

test('alert plan: all-aboard warnings and reminders for today and tomorrow', function() {
  var b = makeBundle([
    ['Ice Show', 0, 0, '2027-03-07', '20:00', 60, 1, 1],
    ['Morning Yoga', 2, 0, '2027-03-08', '09:00', 30, 0, 0],
    ['Late Show', 1, 0, '2027-03-08', '00:30', 45, 0, 0]  // after midnight, night of the -2th
  ]);
  var stars = {};
  stars[slice.starKey('Ice Show', '2027-03-07', '20:00', 'Studio B')] = true;
  stars[slice.starKey('Morning Yoga', '2027-03-08', '09:00', 'Promenade')] = true;
  stars[slice.starKey('Late Show', '2027-03-08', '00:30', 'Boardwalk')] = true;
  // A 60-minute warning period: all-aboard alerts at 60, 30 and 15 minutes.
  var settings = {reminderLead: 30, days: {'2027-03-08': {offset: 60, warn: 60}},
                  personal: [{title: 'Dinner', venue: 'Main Dining', date: '2027-03-07', time: '18:00', minutes: 90}]};
  // Sea day (day 2), 17:00. Tomorrow is St. Thomas: depart 17:00 local = 16:00 ship, all-aboard 15:30.
  var alarms = slice.buildAlarms(b, settings, stars, at('2027-03-07', 17, 0));
  var list = alarms.map(function(a) { return [a.kind, a.at, a.ref, a.title]; });
  var day2 = 1440, day3 = 2 * 1440;
  assert.deepStrictEqual(list, [
    [slice.ALARM_REMINDER, day2 + 17 * 60 + 30, day2 + 18 * 60, 'Dinner'],
    [slice.ALARM_REMINDER, day2 + 19 * 60 + 30, day2 + 20 * 60, 'Ice Show'],
    [slice.ALARM_REMINDER, day3 + 8 * 60 + 30, day3 + 9 * 60, 'Morning Yoga'],
    [slice.ALARM_ALL_ABOARD, day3 + 14 * 60 + 30, day3 + 15 * 60 + 30, 'St. Thomas'],
    [slice.ALARM_ALL_ABOARD, day3 + 15 * 60, day3 + 15 * 60 + 30, 'St. Thomas'],
    [slice.ALARM_ALL_ABOARD, day3 + 15 * 60 + 15, day3 + 15 * 60 + 30, 'St. Thomas'],
    // Listed 00:30 on the -2th = just after midnight that night (tomorrow's watch day).
    [slice.ALARM_REMINDER, 3 * 1440, 3 * 1440 + 30, 'Late Show']
  ]);
  assert.strictEqual(alarms[3].extra, 60, 'all-aboard carries the local offset');
  assert.strictEqual(alarms[1].extra, 60, 'reminder carries the duration');
  assert.strictEqual(alarms[1].venue, 'Studio B');
});

test('alert plan skips past alerts and crosses midnight', function() {
  var it = makeBundle().itinerary;
  it[2].depart = '00:45';  // after midnight: all-aboard 00:15 on the -1th
  var b = makeBundle([], it);
  var alarms = slice.buildAlarms(b, {}, {}, at('2027-03-08', 23, 50));
  // The 30 min warning (23:45) has passed; 15 min (00:00) is left.
  assert.deepStrictEqual(alarms.map(function(a) { return a.at; }), [3 * 1440]);
  assert.strictEqual(alarms[0].ref, 3 * 1440 + 15);
});

test('alert plan defaults and cap', function() {
  var events = [];
  for (var i = 0; i < 40; i++) {
    events.push(['Show ' + i, 0, 0, '2027-03-07', (10 + Math.floor(i / 4)) + ':' + ['00', '15', '30', '45'][i % 4], 30, 0, 0]);
  }
  var b = makeBundle(events);
  var stars = {};
  events.forEach(function(e) { stars[slice.starKey(e[0], e[3], e[4], 'Studio B')] = true; });
  var alarms = slice.buildAlarms(b, {}, stars, at('2027-03-07', 8, 0));
  assert.strictEqual(alarms.length, 24, 'capped at what the watch stores');
  assert.strictEqual(alarms[0].ref - alarms[0].at, 15, 'default lead is 15 minutes');
  var p = pack.packAlarms(alarms, 1500);
  var bytes = p.reduce(function(n, c) { return n + c.bytes.length; }, 0);
  assert.ok(p.every(function(c) { return c.bytes.length <= 1500; }));
  console.log('    24 alerts -> ' + p.length + ' chunks, ' + bytes + ' bytes');
});

test('Test alerts: reminder in 2 min, all-aboard in 3, to reserve in 4, even before the cruise', function() {
  var b = makeBundle([]);  // sails 2027-03-06
  var tapped = at('2027-02-22', 20, 10);
  var s = slice.buildSlice(b, {}, {}, at('2027-02-22', 20, 11), tapped);
  var nowC = slice.cruiseMinutes(slice.daysFromIso(b.sailDate), at('2027-02-22', 20, 10));
  assert.deepStrictEqual(s.alarms.map(function(a) { return [a.kind, a.at - nowC, a.ref - nowC, a.title]; }), [
    [slice.ALARM_REMINDER, 2, 22, 'Test reminder'],
    [slice.ALARM_ALL_ABOARD, 3, 18, 'Test all-aboard'],
    [slice.ALARM_TO_RESERVE, 4, 1440, 'Test show'],
    [slice.ALARM_TO_RESERVE, 4, 1530, 'Test show 2']
  ]);
  assert.ok(s.alarms.slice(2).every(function(a) { return a.extra === 2 && a.notReserved; }));
  // Anchored to the tap: a later launch doesn't move them, and they expire.
  var later = slice.buildSlice(b, {}, {}, at('2027-02-22', 20, 12), tapped).alarms;
  assert.deepStrictEqual(later.map(function(a) { return a.at - nowC; }), [3, 4, 4]);
  assert.strictEqual(slice.buildSlice(b, {}, {}, at('2027-02-22', 20, 15), tapped).alarms.length, 0);
});

test('packed alarm layout', function() {
  var bytes = pack.encodeAlarm({at: 3000, ref: -2, extra: -60, kind: 1, title: 'Ice', venue: 'B'});
  assert.deepStrictEqual(bytes, [0xB8, 0x0B, 0, 0, 0xFE, 0xFF, 0xFF, 0xFF, 0xC4, 0xFF, 1, 0, 0, 0, 0, 0, 0,
                                 3, 73, 99, 101, 1, 66, 0]);
  // The arrive-early byte follows `where` (Phase 4).
  assert.strictEqual(pack.encodeAlarm({at: 1, ref: 1, kind: 1, title: '', venue: '', early: 15})[16], 15);
  bytes = pack.encodeAlarm({at: 1, ref: 1, kind: 1, title: '', venue: '', from: venues.FROM_ROUTE,
                            fromPos: 1, fromVenue: 'Royal Theater',
                            where: {deck: 4, deckTo: 0, pos: 2, ashore: false, rel: -2}});
  assert.strictEqual(bytes[11], 1 | (venues.FROM_ROUTE << 2));
  assert.deepStrictEqual(bytes.slice(12, 16), [4, 0, 2 | 8, 0xFE]);
  assert.deepStrictEqual(bytes.slice(19), [13].concat(pack.utf8('Royal Theater', 99)));
  // Alerts keep 31 bytes of the title and 17 of each venue name, cut between characters.
  var long = pack.encodeAlarm({at: 1, ref: 1, kind: 1, title: new Array(41).join('x'),
                               venue: 'Boardwalk Dog House', fromVenue: new Array(17).join('y') + String.fromCharCode(233)});
  assert.strictEqual(long[17], 31);
  assert.strictEqual(long[17 + 1 + 31], 17);
  assert.strictEqual(long[17 + 1 + 31 + 1 + 17], 16, 'the two-byte letter is not split');
});

// Stops on the sea day (2027-03-07) for the "From" tests: [title, venue, time, minutes].
function routeBundle(stops) {
  var names = [];
  var events = stops.map(function(s) {
    if (names.indexOf(s[1]) === -1) {
      names.push(s[1]);
    }
    return [s[0], names.indexOf(s[1]), 0, s[4] || '2027-03-07', s[2], s[3], 0, 0];
  });
  var b = makeBundle(events);
  b.schedule.venues = names;
  var stars = {};
  events.forEach(function(e) { stars[slice.starKey(e[0], e[3], e[4], names[e[1]])] = true; });
  return {bundle: b, stars: stars};
}

function reminders(r, settings, now) {
  var out = {};
  slice.buildAlarms(r.bundle, settings, r.stars, now).forEach(function(a) {
    if (a.kind === slice.ALARM_REMINDER) {
      out[a.title] = a;
    }
  });
  return out;
}

test('"From" directions start at the previous stop when it ends less than 15 min before', function() {
  var r = routeBundle([
    ['Matinee', 'Royal Theater', '14:00', 60],
    ['Pool Party', 'Pool Deck', '15:10', 30],         // 10 min after the Matinee ends
    ['Ice Show', 'Studio B', '17:00', 60],            // 80 min after the party: from the cabin
    ['Parade', 'Royal Promenade', '19:45', 60],
    ['Salsa', 'Boleros', '20:50', 0],                 // overlaps the Parade, same area
    ['Salsa Encore', 'Boleros', '21:30', 30],         // no length before: ends 21:20
    ['Dinner Show', 'Main Dining Room 5', '22:30', 60]
  ]);
  var settings = {me: {deck: 'Deck 9'}, personal: [
    {title: 'Photos', venue: 'Focus Photo Gallery', date: '2027-03-07', time: '23:05', minutes: 20}
  ]};
  var a = reminders(r, settings, at('2027-03-07', 8, 0));

  assert.strictEqual(a['Matinee'].from, venues.FROM_NONE, 'nothing before it');
  assert.strictEqual(a['Matinee'].where.rel, 5 - 9, 'cabin-relative, nearest entrance to deck 9');

  var p = a['Pool Party'];
  assert.deepStrictEqual([p.from, p.fromPos, p.fromVenue], [venues.FROM_ROUTE, 1, 'Royal Theater']);
  assert.deepStrictEqual(p.where, {deck: 15, deckTo: 0, pos: 2, ashore: false, rel: 10},
                         'deck 15 from the theater entrance nearest to it (5)');

  assert.strictEqual(a['Ice Show'].from, venues.FROM_NONE);
  assert.strictEqual(a['Ice Show'].where.rel, 4 - 9);

  assert.deepStrictEqual([a['Salsa'].from, a['Salsa'].fromVenue], [venues.FROM_SAME_AREA, '']);
  assert.strictEqual(a['Salsa'].where.deck, 5);
  assert.strictEqual(a['Salsa Encore'].from, venues.FROM_SAME_VENUE);
  assert.strictEqual(a['Dinner Show'].from, venues.FROM_NONE, '30 min after the encore ends');
  assert.strictEqual(a['Dinner Show'].venue, 'Main Dining 5', 'short name');

  var photos = a['Photos'];
  assert.deepStrictEqual([photos.from, photos.fromVenue, photos.venue],
                         [venues.FROM_ROUTE, 'Main Dining 5', 'Focus Photo'], 'personal entries count too');
  assert.strictEqual(photos.where.rel, 6 - 5);
});

test('"From" directions around midnight and the 04:00 day start', function() {
  var r = routeBundle([
    ['Late Show', 'Royal Theater', '23:30', 90],
    ['Silent Disco', 'Studio B', '00:30', 60],   // after midnight, dated the evening before
    ['Night Owl Trivia', 'On Air', '03:30', 60],
    ['Sunrise Walk', 'Pool Deck', '04:40', 30, '2027-03-08']
  ]);
  var evening = reminders(r, {}, at('2027-03-07', 22, 0));
  var disco = evening['Silent Disco'];
  assert.strictEqual(disco.ref, 2 * 1440 + 30);
  assert.deepStrictEqual([disco.from, disco.fromPos, disco.fromVenue], [venues.FROM_ROUTE, 1, 'Royal Theater']);
  assert.deepStrictEqual(disco.where, {deck: 4, deckTo: 0, pos: 2, ashore: false, rel: 0},
                         'the theater entrance on deck 4, even with no cabin deck');

  // After 04:00 the first stop of the new watch day starts from last night's.
  var morning = reminders(r, {}, at('2027-03-08', 4, 10));
  var walk = morning['Sunrise Walk'];
  assert.deepStrictEqual([walk.from, walk.fromVenue, walk.where.rel], [venues.FROM_ROUTE, 'On Air', 10]);
});

test('no "From" directions ashore or for venues not in the table', function() {
  var r = routeBundle([
    ['Beach Day', 'Perfect Day at CocoCay', '10:00', 60],
    ['Lunch', 'Studio B', '11:05', 30],
    ['Mystery Tour', 'Somewhere New', '11:40', 30],
    ['Karaoke', 'On Air', '12:15', 30]
  ]);
  var a = reminders(r, {me: {deck: '9'}}, at('2027-03-07', 8, 0));
  assert.strictEqual(a['Beach Day'].venue, 'CocoCay');
  assert.strictEqual(a['Lunch'].from, venues.FROM_NONE);
  assert.strictEqual(a['Lunch'].where.rel, -5, 'back to cabin-relative');
  assert.strictEqual(a['Mystery Tour'].from, venues.FROM_NONE);
  assert.strictEqual(a['Karaoke'].from, venues.FROM_NONE);
});

test('venue codes: a blank title takes the venue of its code, and the code wins', function() {
  var b = makeBundle([
    ['Wine Tasting', 3, 0, '2027-03-07', '13:00', 60, 0, 0],   // blank title, VINT: Giovanni's Wine Bar, deck 8 mid
    ['Escape', 4, 0, '2027-03-07', '14:00', 60, 0, 0],         // Royal Escape Room, deck 14 fore
    ['Mixer', 5, 0, '2027-03-07', '15:00', 60, 0, 0]           // blank, no code
  ]);
  b.schedule.venues = b.schedule.venues.concat(['', 'Royal Escape Room', '']);
  b.schedule.venueCodes = [null, null, null, 'VINT', 'royal-escape-room', null];
  var now = at('2027-03-07', 8, 0);
  var ev = {};
  slice.buildSlice(b, {me: {deck: 'Deck 9'}}, {}, now, null).events.forEach(function(e) { ev[e.title] = e; });
  assert.strictEqual(ev['Wine Tasting'].venue, "Giovanni's Wine Bar");
  assert.deepStrictEqual(ev['Wine Tasting'].where, {deck: 8, deckTo: 0, pos: 2, ashore: false, rel: -1});
  assert.deepStrictEqual(pack.encodeWhere(ev['Wine Tasting'].where), [8, 0, 2 | 8, 255]);
  assert.strictEqual(ev['Escape'].venue, 'Royal Escape Room', 'the title stays; the table is found by code');
  assert.deepStrictEqual(ev['Escape'].where, {deck: 14, deckTo: 0, pos: 1, ashore: false, rel: 5});
  assert.deepStrictEqual([ev['Mixer'].venue, ev['Mixer'].where], ['', venues.NOWHERE]);

  // Star keys use the filled name, the same as the settings page.
  var key = slice.starKey('Wine Tasting', '2027-03-07', '13:00', "Giovanni's Wine Bar");
  var stars = {};
  stars[key] = 1;
  var starred = slice.buildSlice(b, {}, stars, now, null).events.filter(function(e) { return e.title === 'Wine Tasting'; })[0];
  assert.ok(starred.flags & slice.FLAG_STARRED);
});

test('packed where: deck, range, position, ashore, decks from cabin', function() {
  assert.deepStrictEqual(pack.encodeWhere(null), [0, 0, 0, 0]);
  assert.deepStrictEqual(pack.encodeWhere({deck: 3, deckTo: 5, pos: 1, ashore: false, rel: null}), [3, 5, 1, 0]);
  assert.deepStrictEqual(pack.encodeWhere({deck: 0, deckTo: 0, pos: 0, ashore: true, rel: null}), [0, 0, 4, 0]);
  assert.deepStrictEqual(pack.encodeWhere({deck: 9, deckTo: 0, pos: 3, ashore: false, rel: 0}), [9, 0, 3 | 8, 0]);
  assert.deepStrictEqual(pack.encodeWhere({deck: 17, deckTo: 0, pos: 3, ashore: false, rel: 11}), [17, 0, 3 | 8, 11]);
});

test('venue lines: each event and reminder says where it is', function() {
  var b = makeBundle([
    ['Trivia', 0, 0, '2027-03-07', '13:00', 60, 0, 0],       // Studio B: deck 4 mid
    ['Walk', 2, 0, '2027-03-07', '14:00', 30, 0, 0],         // Promenade: not in the table
    ['Aqua Show', 3, 0, '2027-03-07', '20:00', 60, 0, 0],    // AquaTheater: decks 5-6 aft
    ['Beach Day', 4, 0, '2027-03-07', '09:00', 0, 0, 0],     // CocoCay alias: ashore
    ['Ice Show', 5, 0, '2027-03-07', '15:00', 60, 0, 0],     // Royal Theater: decks 3-5 fore
    ['Late Disco', 1, 0, '2027-03-07', '00:30', 60, 0, 0]    // Boardwalk: deck 6 aft, after midnight
  ]);
  b.schedule.venues = b.schedule.venues.concat(['AquaTheater', 'Perfect Day CocoCay', 'Royal Theater']);
  var now = at('2027-03-07', 8, 0);
  function whereOf(settings, title) {
    var e = slice.buildSlice(b, settings, {}, now, null).events.filter(function(x) { return x.title === title; })[0];
    return e.where;
  }
  var none = {};
  // No cabin deck: no rel, and multi-entrance venues show their range.
  assert.deepStrictEqual(whereOf(none, 'Trivia'), {deck: 4, deckTo: 0, pos: 2, ashore: false, rel: null});
  assert.deepStrictEqual(whereOf(none, 'Aqua Show'), {deck: 5, deckTo: 6, pos: 3, ashore: false, rel: null});
  assert.deepStrictEqual(whereOf(none, 'Walk'), venues.NOWHERE);
  assert.deepStrictEqual(whereOf(none, 'Beach Day'), {deck: 0, deckTo: 0, pos: 0, ashore: true, rel: null});
  assert.deepStrictEqual(whereOf(none, 'Late Disco'), {deck: 6, deckTo: 0, pos: 3, ashore: false, rel: null});

  // Cabin on deck 9: the nearest entrance, and how far.
  var cabin9 = {me: {deck: 'Deck 9'}};
  assert.deepStrictEqual(whereOf(cabin9, 'Trivia'), {deck: 4, deckTo: 0, pos: 2, ashore: false, rel: -5});
  assert.deepStrictEqual(whereOf(cabin9, 'Aqua Show'), {deck: 6, deckTo: 0, pos: 3, ashore: false, rel: -3});
  assert.deepStrictEqual(whereOf(cabin9, 'Ice Show'), {deck: 5, deckTo: 0, pos: 1, ashore: false, rel: -4});
  assert.strictEqual(whereOf(cabin9, 'Beach Day').rel, null);
  // Cabin on deck 4: same deck; a tie between entrances goes to the lower deck.
  assert.strictEqual(whereOf({me: {deck: '4'}}, 'Trivia').rel, 0);
  assert.strictEqual(whereOf({me: {deck: '4'}}, 'Ice Show').deck, 4);
  assert.strictEqual(whereOf({me: {deck: 'Deck 1'}}, 'Ice Show').deck, 3);
  assert.strictEqual(whereOf({me: {deck: 'Deck 2'}}, 'Ice Show').rel, 1);
  // No digits in the Deck field: no relative lines.
  assert.strictEqual(whereOf({me: {deck: 'Fwd'}}, 'Trivia').rel, null);

  // The owner's edits win, and a venue they added gets a place too.
  var edited = {me: {deck: 'Deck 9'}, venues: {HM: {'Studio B': {decks: [12], position: 'Fore'},
                                                    'Promenade': {decks: [5], neighborhood: 'Royal Promenade'}}}};
  assert.deepStrictEqual(whereOf(edited, 'Trivia'), {deck: 12, deckTo: 0, pos: 1, ashore: false, rel: 3});
  assert.deepStrictEqual(whereOf(edited, 'Walk'), {deck: 5, deckTo: 0, pos: 0, ashore: false, rel: -4});
  // Edits for another ship don't apply.
  assert.strictEqual(whereOf({venues: {OA: {'Studio B': {decks: [12]}}}}, 'Trivia').deck, 4);

  // Personal entries are looked up by their venue text; reminders carry the same place.
  var withPersonal = {me: {deck: 'Deck 9'}, personal: [
    {title: 'Meet up', venue: 'studio b', date: '2027-03-07', time: '16:00', minutes: 0}]};
  assert.deepStrictEqual(whereOf(withPersonal, 'Meet up'), {deck: 4, deckTo: 0, pos: 2, ashore: false, rel: -5});
  var reminder = slice.buildSlice(b, withPersonal, {}, now, null).alarms.filter(function(a) {
    return a.title === 'Meet up';
  })[0];
  assert.deepStrictEqual(reminder.where, {deck: 4, deckTo: 0, pos: 2, ashore: false, rel: -5});

  // A ship with no table: every place is unknown.
  b.ship.code = 'XX';
  assert.deepStrictEqual(whereOf(cabin9, 'Trivia'), venues.NOWHERE);
});

test('itinerary edits: skipped port, added port, changed times', function() {
  var b = makeBundle([]);
  // St. Thomas skipped: a sea day with no all-aboard and no all-aboard alerts.
  var skip = {days: {'2027-03-08': {buffer: 45, edit: {type: 'CRUISING'}}}};
  var s = slice.buildSlice(b, skip, {}, at('2027-03-08', 10, 0));
  assert.strictEqual(s.day.kind, slice.DAY_SEA);
  assert.strictEqual(s.day.location, 'At Sea');
  assert.strictEqual(s.day.allAboard, slice.NO_TIME);
  assert.strictEqual(s.alarms.filter(function(a) { return a.kind === slice.ALARM_ALL_ABOARD; }).length, 0);

  // A port added on the sea day.
  var add = {days: {'2027-03-07': {offset: 60, edit: {type: 'DOCKED', port: 'Labadee', arrive: '08:00', depart: '16:00'}}}};
  s = slice.buildSlice(b, add, {}, at('2027-03-07', 10, 0));
  assert.strictEqual(s.day.kind, slice.DAY_PORT);
  assert.strictEqual(s.day.location, 'Labadee');
  assert.strictEqual(s.day.allAboard, 1440 + 15 * 60 - 30);  // 16:00 local = 15:00 ship

  // Added port without a name yet.
  s = slice.buildSlice(b, {days: {'2027-03-07': {edit: {type: 'DOCKED', port: ''}}}}, {}, at('2027-03-07', 10, 0));
  assert.strictEqual(s.day.location, 'Port');
  assert.strictEqual(s.day.allAboard, slice.NO_TIME);

  // Only the departure changed, to after midnight.
  s = slice.buildSlice(b, {days: {'2027-03-08': {edit: {depart: '01:00'}}}}, {}, at('2027-03-08', 22, 0));
  assert.strictEqual(s.day.location, 'St. Thomas');
  assert.strictEqual(s.day.allAboard, 3 * 1440 + 30);
});

test('tender ports default to 60 minutes before departure', function() {
  var it = makeBundle().itinerary;
  it[2].type = 'TENDERED';
  var b = makeBundle([], it);
  var s = slice.buildSlice(b, {}, {}, at('2027-03-08', 10, 0));
  assert.strictEqual(s.day.allAboard, 2 * 1440 + 17 * 60 - 60);
  // A buffer picked for the day still wins, 30 included.
  s = slice.buildSlice(b, {days: {'2027-03-08': {buffer: 30}}}, {}, at('2027-03-08', 10, 0));
  assert.strictEqual(s.day.allAboard, 2 * 1440 + 17 * 60 - 30);
  // A docked day changed to a tender in Settings > Days gets 60 too.
  s = slice.buildSlice(makeBundle([]), {days: {'2027-03-08': {edit: {type: 'TENDERED'}}}}, {}, at('2027-03-08', 10, 0));
  assert.strictEqual(s.day.allAboard, 2 * 1440 + 17 * 60 - 60);
});

test("Royal's gangway time is the all-aboard, moved in 5-minute steps", function() {
  var b = makeBundle([]);
  b.mine = {ports: [{day: 3, code: 'STT', gangwayDown: '07:30', gangwayUp: '16:20'}]};
  var s = slice.buildSlice(b, {}, {}, at('2027-03-08', 10, 0));
  assert.strictEqual(s.day.allAboard, 2 * 1440 + 16 * 60 + 20);
  // Port-local like the itinerary: an hour ahead of the ship is 15:20 ship.
  s = slice.buildSlice(b, {days: {'2027-03-08': {offset: 60}}}, {}, at('2027-03-08', 10, 0));
  assert.strictEqual(s.day.allAboard, 2 * 1440 + 15 * 60 + 20);
  // Moved 15 minutes earlier; the buffer doesn't apply to Royal's time.
  s = slice.buildSlice(b, {days: {'2027-03-08': {shift: -15, buffer: 60}}}, {}, at('2027-03-08', 10, 0));
  assert.strictEqual(s.day.allAboard, 2 * 1440 + 16 * 60 + 5);
  // An exact time still wins.
  s = slice.buildSlice(b, {days: {'2027-03-08': {allAboard: '16:45', shift: -15}}}, {}, at('2027-03-08', 10, 0));
  assert.strictEqual(s.day.allAboard, 2 * 1440 + 16 * 60 + 45);
  // Royal's text (not a time), or no entry for the day: departure minus the buffer.
  b.mine.ports[0].gangwayUp = 'See daily planner';
  assert.strictEqual(slice.buildSlice(b, {}, {}, at('2027-03-08', 10, 0)).day.allAboard, 2 * 1440 + 17 * 60 - 30);
  b.mine.ports[0] = {day: 2, gangwayUp: '16:00'};
  assert.strictEqual(slice.buildSlice(b, {}, {}, at('2027-03-08', 10, 0)).day.allAboard, 2 * 1440 + 17 * 60 - 30);
  // A port skipped in Settings > Days has none.
  b.mine.ports[0] = {day: 3, gangwayUp: '16:20'};
  s = slice.buildSlice(b, {days: {'2027-03-08': {edit: {type: 'CRUISING'}}}}, {}, at('2027-03-08', 10, 0));
  assert.strictEqual(s.day.allAboard, slice.NO_TIME);
});

test("Royal's gangway time after midnight", function() {
  var it = makeBundle().itinerary;
  it[2].arrive = '18:00';
  it[2].depart = '02:00';
  var b = makeBundle([], it);
  b.mine = {ports: [{day: 3, gangwayUp: '01:30'}]};
  var s = slice.buildSlice(b, {}, {}, at('2027-03-08', 22, 0));
  assert.strictEqual(s.day.allAboard, 3 * 1440 + 90);
  // Moved back across midnight.
  s = slice.buildSlice(b, {days: {'2027-03-08': {shift: -120}}}, {}, at('2027-03-08', 22, 0));
  assert.strictEqual(s.day.allAboard, 2 * 1440 + 23 * 60 + 30);
});

test('warning period: the first all-aboard alert', function() {
  var b = makeBundle([]);
  var aboard = function(settings) {
    return slice.buildAlarms(b, settings, {}, at('2027-03-08', 6, 0))
      .filter(function(a) { return a.kind === slice.ALARM_ALL_ABOARD; })
      .map(function(a) { return a.ref - a.at; });
  };
  // All-aboard 16:30. 30 by default: one buzz at 30, then 15.
  assert.deepStrictEqual(aboard({}), [30, 15]);
  assert.strictEqual(slice.buildSlice(b, {}, {}, at('2027-03-08', 6, 0)).day.warnPeriod, 30);
  assert.deepStrictEqual(aboard({days: {'2027-03-08': {warn: 120}}}), [120, 30, 15]);
  assert.deepStrictEqual(aboard({days: {'2027-03-08': {warn: 90}}}), [90, 30, 15]);
  // Tender ports: 60 unless set.
  var tender = {days: {'2027-03-08': {edit: {type: 'TENDERED'}}}};
  assert.deepStrictEqual(aboard(tender), [60, 30, 15]);
  assert.strictEqual(slice.buildSlice(b, tender, {}, at('2027-03-08', 6, 0)).day.warnPeriod, 60);
  tender.days['2027-03-08'].warn = 30;
  assert.deepStrictEqual(aboard(tender), [30, 15]);
  // Sea days keep the default (they have no all-aboard).
  assert.strictEqual(slice.buildSlice(b, {}, {}, at('2027-03-07', 6, 0)).day.warnPeriod, 30);
});

test('Events page results: personal entries and star changes', function() {
  var clean = slice.cleanPersonal;
  assert.strictEqual(clean(null), null);
  assert.deepStrictEqual(clean([
    {title: ' Dinner ', venue: 'Main Dining Room', date: '2027-03-07', time: '17:30', minutes: 90},
    {title: 'Late snack', date: '2027-03-07', time: '00:30', minutes: '20'},
    {title: '', date: '2027-03-07'},
    {title: 'No date'},
    {title: 'x'.repeat(80), venue: 'y'.repeat(40), date: '2027-03-08', time: '25:00', minutes: 5000}
  ]), [
    {title: 'Dinner', venue: 'Main Dining Room', date: '2027-03-07', time: '17:30', minutes: 90},
    {title: 'Late snack', venue: '', date: '2027-03-07', time: '00:30', minutes: 0},
    {title: 'x'.repeat(63), venue: 'y'.repeat(31), date: '2027-03-08', time: null, minutes: 0}
  ]);

  // A 00:30 entry on the -3th is after midnight that night, on the -3th's watch day.
  var b = makeBundle([]);
  var s = slice.buildSlice(b, {personal: clean([{title: 'Late snack', date: '2027-03-07', time: '00:30'}])}, {},
                           at('2027-03-07', 22, 0));
  assert.strictEqual(s.events[0].start, 2 * 1440 + 30);

  var stars = {a: true, b: true};
  slice.applyStarChanges(stars, {b: false, c: true, d: 'yes'});
  assert.deepStrictEqual(stars, {a: true, c: true});
  assert.deepStrictEqual(slice.applyStarChanges({a: true}, null), {a: true});
});

test('day settings from the page are checked', function() {
  var clean = slice.cleanDaySettings;
  assert.strictEqual(clean(null), null);
  assert.strictEqual(clean({}), null);
  assert.strictEqual(clean({offset: 0, buffer: 30, allAboard: ''}).buffer, 30);
  assert.deepStrictEqual(clean({offset: 60, buffer: 45, allAboard: '16:15', junk: 1}),
                         {offset: 60, buffer: 45, allAboard: '16:15'});
  assert.deepStrictEqual(clean({offset: 7, buffer: 20, allAboard: '25:00'}), null);
  assert.deepStrictEqual(clean({offset: 60 * 13}), null);
  assert.deepStrictEqual(clean({edit: {type: 'CRUISING', port: 7, arrive: 'soon', depart: null}}),
                         {edit: {type: 'CRUISING', depart: null}});
  assert.deepStrictEqual(clean({edit: {type: '<b>', port: 'Labadee', arrive: '08:00'}}),
                         {edit: {port: 'Labadee', arrive: '08:00'}});
  assert.strictEqual(clean({edit: {}}), null);
  // Royal's time moved in 5-minute steps, and the warning period.
  assert.deepStrictEqual(clean({shift: -15, warn: 90}), {shift: -15, warn: 90});
  assert.deepStrictEqual(clean({shift: 120, warn: 60}), {shift: 120, warn: 60});
  assert.strictEqual(clean({shift: 7, warn: 45}), null);
  assert.strictEqual(clean({shift: 125, warn: '60'}), null);
  assert.strictEqual(clean({shift: 0}), null);
});

function keyOf(row) {
  return slice.starKey(row[0], row[3], row[4], ['Studio B', 'Boardwalk', 'Promenade'][row[1]]);
}

test('re-sync: moved, re-venued, cancelled and ambiguous stars', function() {
  var ice = ['Ice Show', 0, 0, '2027-03-07', '20:00', 60, 0, 0];
  var comedy = ['Comedy', 0, 0, '2027-03-07', '21:00', 45, 0, 0];
  var towels = ['Towel Folding', 2, 0, '2027-03-07', '15:00', 30, 0, 0];
  var aqua1 = ['Aqua Show', 1, 0, '2027-03-07', '19:00', 60, 0, 0];
  var aqua2 = ['Aqua Show', 1, 0, '2027-03-07', '21:00', 60, 0, 0];
  var trivia = ['Trivia', 2, 0, '2027-03-07', '14:00', 30, 0, 0];
  var old = makeBundle([trivia, towels, aqua1, ice, aqua2, comedy]);
  var stars = {};
  [ice, comedy, towels, aqua1, trivia].forEach(function(r) { stars[keyOf(r)] = true; });
  stars['Dinner|2027-03-07|18:00|MDR'] = true;  // a personal entry
  stars['Gone|2027-03-06|10:00|'] = true;        // not in the old schedule either
  var settings = {personal: [{title: 'Dinner', venue: 'MDR', date: '2027-03-07', time: '18:00', minutes: 90}]};

  var iceLate = ['ICE SHOW ', 0, 0, '2027-03-07', '21:30', 60, 0, 0];
  var comedyMoved = ['Comedy', 2, 0, '2027-03-07', '21:00', 45, 0, 0];
  var aquaA = ['Aqua Show', 1, 0, '2027-03-07', '19:30', 60, 0, 0];
  var aquaB = ['Aqua Show', 1, 0, '2027-03-07', '21:30', 60, 0, 0];
  var fresh = makeBundle([aquaA, comedyMoved, iceLate, aquaB]);
  var now = at('2027-03-07', 16, 0);  // Trivia (14:00) is over; Towel Folding too

  var r = slice.reconcileStars(old, fresh, stars, settings, now);
  var byTitle = {};
  r.changes.forEach(function(c) { byTitle[c.title] = c; });
  assert.deepStrictEqual(r.changes.map(function(c) { return c.title; }), ['Aqua Show', 'Ice Show', 'Comedy']);
  assert.strictEqual(byTitle['Ice Show'].kind, 'moved');  // title case and spaces ignored
  assert.deepStrictEqual(byTitle['Ice Show'].to, {date: '2027-03-07', time: '21:30', venue: 'Studio B'});
  assert.strictEqual(byTitle.Comedy.kind, 'moved');
  assert.strictEqual(byTitle.Comedy.to.venue, 'Promenade');
  assert.strictEqual(byTitle['Aqua Show'].kind, 'check');
  assert.strictEqual(byTitle['Aqua Show'].options, 2);
  assert.ok(r.stars[keyOf(iceLate)] && r.stars[keyOf(comedyMoved)]);
  assert.ok(!r.stars[keyOf(ice)] && !r.stars[keyOf(comedy)] && !r.stars[keyOf(aqua1)]);
  assert.ok(!r.stars[keyOf(aquaA)] && !r.stars[keyOf(aquaB)]);  // no guessing
  assert.ok(r.stars[keyOf(trivia)] && r.stars[keyOf(towels)]);   // finished: left alone
  assert.ok(r.stars['Dinner|2027-03-07|18:00|MDR'] && r.stars['Gone|2027-03-06|10:00|']);
  assert.ok(stars[keyOf(ice)], 'input stars are not changed');

  // Earlier in the day Trivia and Towel Folding are upcoming, so they show as cancelled.
  r = slice.reconcileStars(old, fresh, stars, settings, at('2027-03-07', 9, 0));
  assert.deepStrictEqual(r.changes.slice(0, 2).map(function(c) { return c.title + ' ' + c.kind; }),
                         ['Trivia cancelled', 'Towel Folding cancelled']);
  assert.ok(!r.stars[keyOf(towels)] && !r.stars[keyOf(trivia)]);

  // A show that runs twice: one showing cancelled is not "moved" to the other.
  var one = slice.reconcileStars(makeBundle([aqua1, aqua2]), makeBundle([aqua2]),
                                 (function() { var s = {}; s[keyOf(aqua1)] = true; return s; })(), {}, now);
  assert.strictEqual(one.changes[0].kind, 'cancelled');
  assert.ok(!one.stars[keyOf(aqua2)]);
});

test('re-sync: nothing checked for another sailing, an empty schedule or no change', function() {
  var ice = ['Ice Show', 0, 0, '2027-03-07', '20:00', 60, 0, 0];
  var stars = {};
  stars[keyOf(ice)] = true;
  var now = at('2027-03-07', 12, 0);
  var old = makeBundle([ice]);
  var other = makeBundle([]);
  other.schedule.events = [['Other', 0, 0, '2027-03-07', '20:00', 60, 0, 0]];
  other.sailDate = '2027-03-13';
  assert.deepStrictEqual(slice.reconcileStars(old, other, stars, {}, now).changes, []);
  var ship = makeBundle([['Other', 0, 0, '2027-03-07', '20:00', 60, 0, 0]]);
  ship.ship = {code: 'OA', name: 'Oasis of the Seas'};
  assert.deepStrictEqual(slice.reconcileStars(old, ship, stars, {}, now).changes, []);
  assert.deepStrictEqual(slice.reconcileStars(old, makeBundle([]), stars, {}, now).changes, []);
  assert.deepStrictEqual(slice.reconcileStars(null, old, stars, {}, now).changes, []);
  var same = slice.reconcileStars(old, makeBundle([ice]), stars, {}, now);
  assert.deepStrictEqual(same.changes, []);
  assert.deepStrictEqual(same.stars, stars);
});

test('re-sync around midnight', function() {
  // Royal dates after-midnight events with the evening's date.
  var disco = ['Silent Disco', 1, 0, '2027-03-07', '23:30', 90, 0, 0];
  var stars = {};
  stars[keyOf(disco)] = true;
  var old = makeBundle([disco]);

  // Moved to 00:30, still listed under the -3th: same night, so it follows.
  var later = ['Silent Disco', 1, 0, '2027-03-07', '00:30', 60, 0, 0];
  var r = slice.reconcileStars(old, makeBundle([later]), stars, {}, at('2027-03-07', 20, 0));
  assert.strictEqual(r.changes[0].kind, 'moved');
  assert.ok(r.stars[keyOf(later)]);
  var n = slice.buildNotices('2027-03-06', r.changes)[0];
  assert.strictEqual(n.from, 1440 + 23 * 60 + 30);
  assert.strictEqual(n.to, 2 * 1440 + 30);  // after midnight, not the morning of the -3th

  // 00:30 listed under the -2th is the next night: a different watch day.
  var nextNight = ['Silent Disco', 1, 0, '2027-03-08', '00:30', 60, 0, 0];
  r = slice.reconcileStars(old, makeBundle([nextNight]), stars, {}, at('2027-03-07', 20, 0));
  assert.strictEqual(r.changes[0].kind, 'cancelled');

  // Synced at 00:15: the 23:30 disco (90 min) is still on, so it is checked.
  r = slice.reconcileStars(old, makeBundle([later]), stars, {}, at('2027-03-08', 0, 15));
  assert.strictEqual(r.changes.length, 1);
  // At 01:15 it's over and left alone.
  r = slice.reconcileStars(old, makeBundle([later]), stars, {}, at('2027-03-08', 1, 15));
  assert.strictEqual(r.changes.length, 0);
});

// A bundle whose schedule has Royal's product id (`pid`) as a 9th field.
function pidBundle(events) {
  var b = makeBundle(events);
  b.schedule.fields = b.schedule.fields.concat(['pid']);
  return b;
}

test('re-sync by product id', function() {
  var now = at('2027-03-07', 12, 0);
  function starred(row) {
    var s = {};
    s[keyOf(row)] = true;
    return s;
  }

  // A reworded title still follows its star when the product id matches.
  var trivia = ['80s Trivia', 1, 0, '2027-03-07', '15:00', 45, 0, 0, 'P-TRIV'];
  var renamed = ['Totally 80s Trivia', 1, 0, '2027-03-07', '16:00', 45, 0, 0, 'P-TRIV'];
  var r = slice.reconcileStars(pidBundle([trivia]), pidBundle([renamed]), starred(trivia), {}, now);
  assert.strictEqual(r.changes.length, 1);
  assert.strictEqual(r.changes[0].kind, 'moved');
  assert.deepStrictEqual(r.changes[0].to, {date: '2027-03-07', time: '16:00', venue: 'Boardwalk'});
  assert.ok(r.stars[keyOf(renamed)] && !r.stars[keyOf(trivia)]);

  // Two products share a title: the star follows its own product, not the other.
  var guitarA = ['Guitar Melodies', 2, 0, '2027-03-07', '18:00', 60, 0, 0, 'P-GA'];
  var guitarAMoved = ['Guitar Melodies', 2, 0, '2027-03-07', '19:00', 60, 0, 0, 'P-GA'];
  var guitarB = ['Guitar Melodies', 2, 0, '2027-03-07', '21:00', 60, 0, 0, 'P-GB'];
  r = slice.reconcileStars(pidBundle([guitarA]), pidBundle([guitarAMoved, guitarB]), starred(guitarA), {}, now);
  assert.strictEqual(r.changes[0].kind, 'moved');
  assert.strictEqual(r.changes[0].to.time, '19:00');
  assert.ok(r.stars[keyOf(guitarAMoved)] && !r.stars[keyOf(guitarB)]);
  // By title alone the same pull is ambiguous.
  var noPid = function(row) { return row.slice(0, 8); };
  r = slice.reconcileStars(makeBundle([noPid(guitarA)]), makeBundle([noPid(guitarAMoved), noPid(guitarB)]),
                           starred(guitarA), {}, now);
  assert.strictEqual(r.changes[0].kind, 'check');

  // Same title, different product id: not a move.
  var otherProduct = ['80s Trivia', 1, 0, '2027-03-07', '16:00', 45, 0, 0, 'P-OTHER'];
  r = slice.reconcileStars(pidBundle([trivia]), pidBundle([otherProduct]), starred(trivia), {}, now);
  assert.strictEqual(r.changes[0].kind, 'cancelled');

  // A show that runs twice under one product id is still ambiguous.
  var show = ['Ice Show', 0, 0, '2027-03-07', '20:00', 60, 0, 0, 'P-ICE'];
  var early = ['Ice Show', 0, 0, '2027-03-07', '19:00', 60, 0, 0, 'P-ICE'];
  var late = ['Ice Show', 0, 0, '2027-03-07', '21:30', 60, 0, 0, 'P-ICE'];
  r = slice.reconcileStars(pidBundle([show]), pidBundle([early, late]), starred(show), {}, now);
  assert.strictEqual(r.changes[0].kind, 'check');
  assert.strictEqual(r.changes[0].options, 2);

  // Fallback to the title rule: either bundle without pid, or an old event with no id.
  r = slice.reconcileStars(makeBundle([noPid(trivia)]), pidBundle([renamed]), starred(trivia), {}, now);
  assert.strictEqual(r.changes[0].kind, 'cancelled');  // title changed, no id to follow
  var triviaLate = ['80s Trivia', 1, 0, '2027-03-07', '17:00', 45, 0, 0, 'P-TRIV'];
  r = slice.reconcileStars(pidBundle([trivia]), makeBundle([noPid(triviaLate)]), starred(trivia), {}, now);
  assert.strictEqual(r.changes[0].kind, 'moved');
  var untagged = ['80s Trivia', 1, 0, '2027-03-07', '15:00', 45, 0, 0, null];
  r = slice.reconcileStars(pidBundle([untagged]), pidBundle([triviaLate]), starred(untagged), {}, now);
  assert.strictEqual(r.changes[0].kind, 'moved');

  // A reserved mark follows a star moved by product id.
  var stars = starred(trivia);
  stars['R|' + keyOf(trivia)] = true;
  r = slice.reconcileStars(pidBundle([trivia]), pidBundle([renamed]), stars, {}, now);
  assert.ok(r.stars['R|' + keyOf(renamed)] && !r.stars['R|' + keyOf(trivia)]);
});

test('re-sync: a moved star keeps its change time; stale times are pruned', function() {
  var ice = ['Ice Show', 0, 0, '2027-03-07', '20:00', 60, 0, 0];
  var comedy = ['Comedy', 0, 0, '2027-03-07', '21:00', 45, 0, 0];
  var iceLate = ['Ice Show', 0, 0, '2027-03-07', '21:30', 60, 0, 0];
  var stars = {};
  stars[keyOf(ice)] = true;
  var times = {};
  times[keyOf(ice)] = 1000;
  times[keyOf(comedy)] = 2000;  // unstarred, so its time still matters
  var r = slice.reconcileStars(makeBundle([ice, comedy]), makeBundle([iceLate, comedy]), stars, {},
                               at('2027-03-07', 12, 0), times);
  assert.strictEqual(r.changes[0].kind, 'moved');
  assert.strictEqual(r.times[keyOf(iceLate)], 1000);
  assert.strictEqual(times[keyOf(iceLate)], undefined, 'input times are not changed');
  // Without times nothing breaks.
  assert.deepStrictEqual(slice.reconcileStars(makeBundle([ice]), makeBundle([iceLate]), stars, {},
                                              at('2027-03-07', 12, 0)).times, {});

  var settings = {personal: [{title: 'Dinner', venue: 'MDR', date: '2027-03-07', time: '18:00', minutes: 90}]};
  var dinner = 'Dinner|2027-03-07|18:00|MDR';
  var oldTrip = 'Gone|2027-01-24|10:00|';
  var fresh = makeBundle([iceLate, comedy]);
  r.times[dinner] = 3000;
  r.times[oldTrip] = 4000;
  r.stars[oldTrip] = true;
  var pruned = slice.pruneStarTimes(r.times, fresh, settings, r.stars);
  var want = {};
  want[keyOf(iceLate)] = 1000;
  want[keyOf(comedy)] = 2000;
  want[dinner] = 3000;
  want[oldTrip] = 4000;  // still starred
  assert.deepStrictEqual(pruned, want);  // the old Ice Show time is gone
  delete r.stars[oldTrip];
  assert.strictEqual(slice.pruneStarTimes(r.times, fresh, settings, r.stars)[oldTrip], undefined);
  assert.deepStrictEqual(slice.pruneStarTimes(null, fresh, settings, {}), {});
});

test('notices for the watch', function() {
  var changes = [
    {kind: 'moved', title: 'Ice Show', date: '2027-03-07', time: '20:00', venue: 'Studio B', minutes: 60,
     to: {date: '2027-03-07', time: '21:30', venue: 'Studio B'}},
    {kind: 'moved', title: 'Comedy', date: '2027-03-07', time: '21:00', venue: 'Studio B', minutes: 45,
     to: {date: '2027-03-07', time: '21:00', venue: 'Promenade'}},
    {kind: 'cancelled', title: 'Towel Folding', date: '2027-03-07', time: '15:00', venue: 'Promenade'},
    {kind: 'check', title: 'Aqua Show', date: '2027-03-07', time: null, venue: 'Boardwalk', options: 2}
  ];
  var n = slice.buildNotices('2027-03-06', changes);
  assert.deepStrictEqual(n[0], {kind: slice.NOTICE_MOVED, from: 1440 + 1200, to: 1440 + 1290, title: 'Ice Show',
                                venue: 'Studio B', oldVenue: ''});
  assert.strictEqual(n[1].venue, 'Promenade');
  assert.strictEqual(n[1].oldVenue, 'Studio B');
  assert.deepStrictEqual([n[2].kind, n[2].from, n[2].to, n[2].venue], [slice.NOTICE_CANCELLED, 1440 + 900, 1440 + 900,
                                                                       'Promenade']);
  assert.deepStrictEqual([n[3].kind, n[3].from], [slice.NOTICE_CHECK, slice.NO_TIME]);
  var many = [];
  for (var i = 0; i < 12; i++) {
    many.push(changes[2]);
  }
  assert.strictEqual(slice.buildNotices('2027-03-06', many).length, 8);

  var bytes = pack.encodeNotice(n[1]);
  assert.deepStrictEqual(bytes.slice(0, 9), [0, 0x8C, 0x0A, 0, 0, 0x8C, 0x0A, 0, 0]);  // 21:00 on day 2 = 2700
  assert.strictEqual(bytes[9], 6);  // "Comedy"
  assert.strictEqual(bytes.length, 9 + 1 + 6 + 1 + 9 + 1 + 8);
  assert.strictEqual(pack.packNotices(n).length, n.reduce(function(sum, x) {
    return sum + pack.encodeNotice(x).length;
  }, 0));
});

// A star change as the watch sends it, for an event of a slice built by buildSlice.
function watchChange(e, on, at, seq, day) {
  return pack.decodeStarChanges(pack.encodeStarChange({
    seq: seq || 1, at: at || 1800000000, sail: 20883, start: e.start, day: day || 0, on: on,
    title: e.title, venue: e.venue
  }))[0];
}

function sliceEvent(b, settings, now, title) {
  return slice.buildSlice(b, settings, {}, now).events.filter(function(e) { return e.title === title; })[0];
}

test('star changes from the watch round-trip through packing', function() {
  var bytes = pack.encodeStarChange({seq: 70000, at: 1800000000, sail: 20883, start: -1, day: -2, on: true,
                                     title: 'Café night', venue: 'Promenade'});
  var c = pack.decodeStarChanges(bytes.concat(bytes))[1];
  assert.strictEqual(c.seq, 70000);
  assert.strictEqual(c.at, 1800000000);
  assert.strictEqual(c.sail, 20883);
  assert.strictEqual(c.start, -1);
  assert.strictEqual(c.day, -2);
  assert.strictEqual(c.on, true);
  assert.deepStrictEqual(c.title, pack.utf8('Café night', 63));
  assert.strictEqual(pack.decodeStarChanges(bytes.slice(0, bytes.length - 1)).length, 0);
  // Long titles and venues are cut like the watch cuts them: 39 and 23 bytes.
  var long = pack.encodeStarChange({seq: 1, at: 0, sail: 0, start: 0, day: 0, on: false,
                                    title: new Array(70).join('x'), venue: new Array(40).join('y')});
  assert.strictEqual(long.length, 19 + 1 + 39 + 1 + 23);
});

test('watch star changes find their events, around midnight too', function() {
  var longTitle = 'Adventure Ocean Open House: Families Welcome Aboard Tonight';
  var b = makeBundle([
    ['Comedy Night', 0, 0, '2027-03-07', '21:00', 60, 0, 0],
    ['Late Night Comedy', 0, 0, '2027-03-07', '00:30', 45, 0, 0],   // after midnight, on the -3th's night
    ['Early Riser Yoga', 0, 0, '2027-03-07', '04:00', 30, 0, 0],    // the -3th's own morning
    ['Night Owl Trivia', 1, 0, '2027-03-07', '03:59', 30, 0, 0],    // still the -3th's night
    ['Night Owl Trivia', 1, 0, '2027-03-08', '03:59', 30, 0, 0],    // a night later
    ['Deck Party', 2, 0, '2027-03-07', null, 0, 0, 0],               // untimed
    [longTitle, 2, 0, '2027-03-07', '15:00', 60, 0, 0],
    [longTitle + ' (Part 2)', 2, 0, '2027-03-07', '15:00', 60, 0, 0],
    ['Comedy', 0, 0, '2027-03-07', '21:00', 60, 0, 0]
  ]);
  var settings = {personal: [{title: 'Dinner', venue: 'Chops', date: '2027-03-07', time: '19:30', minutes: 90}]};
  var now = at('2027-03-07', 12, 0);

  function apply(title, on, day) {
    var e = sliceEvent(b, settings, now, title);
    var stars = {};
    var r = slice.applyWatchStarChanges(b, settings, stars, null, [watchChange(e, on, 0, 1, day)]);
    return {stars: Object.keys(stars), r: r, e: e};
  }

  assert.deepStrictEqual(apply('Comedy Night', true).stars, ['Comedy Night|2027-03-07|21:00|Studio B']);
  // "Comedy" at the same time and venue is its own event, not a prefix of "Comedy Night".
  assert.deepStrictEqual(apply('Comedy', true).stars, ['Comedy|2027-03-07|21:00|Studio B']);

  // After midnight: listed under the evening's date, starred on that evening's watch day.
  var late = apply('Late Night Comedy', true);
  assert.strictEqual(late.e.start, 2 * 1440 + 30);
  assert.deepStrictEqual(late.stars, ['Late Night Comedy|2027-03-07|00:30|Studio B']);
  var owl = apply('Night Owl Trivia', true);
  assert.strictEqual(owl.e.start, 2 * 1440 + 239);
  assert.deepStrictEqual(owl.stars, ['Night Owl Trivia|2027-03-07|03:59|Boardwalk']);

  // 04:00 on the -3th is the -3th's morning, the day before 03:59 "on the -3th".
  var yoga = apply('Early Riser Yoga', true);
  assert.strictEqual(yoga.e.start, 1440 + 240);
  assert.deepStrictEqual(yoga.stars, ['Early Riser Yoga|2027-03-07|04:00|Studio B']);

  // Untimed entries are matched by the watch day they were starred on.
  assert.deepStrictEqual(apply('Deck Party', true, 1).stars, ['Deck Party|2027-03-07||Promenade']);
  assert.deepStrictEqual(apply('Deck Party', true, 2).stars, []);

  // A title the watch cut short matches every event it is the start of.
  assert.strictEqual(apply(longTitle, true).stars.length, 2);

  // Personal entries can be starred too.
  assert.deepStrictEqual(apply('Dinner', true).stars, ['Dinner|2027-03-07|19:30|Chops']);

  // Another cruise's change, or one for an event that's gone, is left alone.
  var e = sliceEvent(b, settings, now, 'Comedy Night');
  var other = watchChange(e, true);
  other.sail = 20000;
  var r = slice.applyWatchStarChanges(b, settings, {}, null, [other]);
  assert.strictEqual(r.unmatched.length, 1);
  r = slice.applyWatchStarChanges(makeBundle([]), {}, {}, null, [watchChange(e, true)]);
  assert.deepStrictEqual([r.applied.length, r.unmatched.length], [0, 1]);
});

test('the latest star change wins between the watch and the settings page', function() {
  var b = makeBundle([['Comedy Night', 0, 0, '2027-03-07', '21:00', 60, 0, 0]]);
  var key = 'Comedy Night|2027-03-07|21:00|Studio B';
  var e = sliceEvent(b, {}, at('2027-03-07', 12, 0), 'Comedy Night');

  // Unstarred on the page at 2000 s; starred on the watch before that (1000 s): ignored.
  var stars = {};
  var times = {};
  times[key] = 2000 * 1000;
  var r = slice.applyWatchStarChanges(b, {}, stars, times, [watchChange(e, true, 1000)]);
  assert.deepStrictEqual([r.applied.length, r.ignored.length, stars[key]], [0, 1, undefined]);
  // Starred on the watch after it (3000 s): applied, and its time saved.
  r = slice.applyWatchStarChanges(b, {}, stars, times, [watchChange(e, true, 3000)]);
  assert.deepStrictEqual([r.applied.length, stars[key], times[key]], [1, true, 3000 * 1000]);
  // The same change sent again (its ack didn't reach the watch) changes nothing.
  r = slice.applyWatchStarChanges(b, {}, stars, times, [watchChange(e, true, 3000)]);
  assert.deepStrictEqual([r.applied.length, stars[key]], [1, true]);
  // Unstarred on the watch.
  slice.applyWatchStarChanges(b, {}, stars, times, [watchChange(e, false, 4000)]);
  assert.strictEqual(stars[key], undefined);

  // A page change made before the watch's latest one: skipped.
  var changes = {};
  changes[key] = true;
  var pageTimes = {};
  pageTimes[key] = 3500 * 1000;
  slice.applyStarChanges(stars, changes, times, pageTimes, 5000 * 1000);
  assert.strictEqual(stars[key], undefined);
  // Made after it: applied.
  pageTimes[key] = 4500 * 1000;
  slice.applyStarChanges(stars, changes, times, pageTimes, 5000 * 1000);
  assert.deepStrictEqual([stars[key], times[key]], [true, 4500 * 1000]);
  // Without a time, it counts as made when the page closed.
  changes[key] = false;
  slice.applyStarChanges(stars, changes, times, null, 6000 * 1000);
  assert.deepStrictEqual([stars[key], times[key]], [undefined, 6000 * 1000]);
  // A time in the future isn't trusted.
  changes[key] = true;
  pageTimes[key] = 9e12;
  slice.applyStarChanges(stars, changes, times, pageTimes, 7000 * 1000);
  assert.strictEqual(times[key], 7000 * 1000);
});

test('Reserved: flag, alert mark, watch changes and the latest change wins', function() {
  var ice = ['Ice Show', 0, 0, '2027-03-07', '20:00', 60, 1, 1];   // needs a reservation
  var comedy = ['Comedy', 0, 0, '2027-03-07', '21:30', 45, 0, 0];  // doesn't
  var b = makeBundle([ice, comedy]);
  var iceKey = keyOf(ice);
  var comedyKey = keyOf(comedy);
  var now = at('2027-03-07', 12, 0);
  var stars = {};
  stars[iceKey] = true;
  stars[comedyKey] = true;

  function flagsOf(st, title) {
    return slice.buildSlice(b, {}, st, now).events.filter(function(e) { return e.title === title; })[0].flags;
  }
  function reminder(st, title) {
    return slice.buildAlarms(b, {}, st, now).filter(function(a) { return a.title === title; })[0];
  }

  // Starred, not reserved: no flag, and its reminder says so.
  assert.strictEqual(flagsOf(stars, 'Ice Show') & slice.FLAG_RESERVED, 0);
  assert.strictEqual(reminder(stars, 'Ice Show').notReserved, true);
  assert.strictEqual(reminder(stars, 'Comedy').notReserved, false);
  assert.strictEqual(pack.encodeAlarm(reminder(stars, 'Ice Show'))[11] & 16, 16);
  assert.strictEqual(pack.encodeAlarm(reminder(stars, 'Comedy'))[11] & 16, 0);

  // Reserved: the flag, and no alert mark.
  stars[slice.reservedKey(iceKey)] = true;
  assert.strictEqual(flagsOf(stars, 'Ice Show') & slice.FLAG_RESERVED, slice.FLAG_RESERVED);
  assert.strictEqual(reminder(stars, 'Ice Show').notReserved, false);
  // Unstarred, the mark is kept (and sent) but the star is gone.
  delete stars[iceKey];
  var flags = flagsOf(stars, 'Ice Show');
  assert.deepStrictEqual([flags & slice.FLAG_STARRED, flags & slice.FLAG_RESERVED], [0, slice.FLAG_RESERVED]);
  // Only events that need a reservation get the flag.
  stars[slice.reservedKey(comedyKey)] = true;
  assert.strictEqual(flagsOf(stars, 'Comedy') & slice.FLAG_RESERVED, 0);
  // Reserved keys don't count as stars.
  assert.strictEqual(slice.buildSlice(b, {}, stars, now).cruiseStarred, 1);

  // From the watch: a Reserved change round-trips and lands on the reserved key.
  var e = sliceEvent(b, {}, now, 'Ice Show');
  var bytes = pack.encodeStarChange({seq: 5, at: 1000, sail: 20883, start: e.start, day: 0, on: true, reserved: true,
                                     title: 'Ice Show', venue: 'Studio B'});
  assert.strictEqual(bytes[18], 3);
  var c = pack.decodeStarChanges(bytes)[0];
  assert.deepStrictEqual([c.on, c.reserved], [true, true]);
  var st = {};
  st[iceKey] = true;
  var times = {};
  var r = slice.applyWatchStarChanges(b, {}, st, times, [c]);
  assert.deepStrictEqual(r.applied, [{key: slice.reservedKey(iceKey), on: true, reserved: true}]);
  assert.deepStrictEqual([st[iceKey], st[slice.reservedKey(iceKey)]], [true, true]);
  assert.strictEqual(times[slice.reservedKey(iceKey)], 1000 * 1000);
  assert.strictEqual(times[iceKey], undefined, 'the star keeps its own time');
  // An older Reserved change from the watch loses to a newer one from the page.
  times[slice.reservedKey(iceKey)] = 2000 * 1000;
  c.on = false;
  r = slice.applyWatchStarChanges(b, {}, st, times, [c]);
  assert.deepStrictEqual([r.ignored.length, st[slice.reservedKey(iceKey)]], [1, true]);
  // The page's changes use the same keys.
  var changes = {};
  changes[slice.reservedKey(iceKey)] = false;
  slice.applyStarChanges(st, changes, times, null, 3000 * 1000);
  assert.strictEqual(st[slice.reservedKey(iceKey)], undefined);
});

test('Reserved: marks follow a rescheduled star, and their times are pruned like stars', function() {
  var ice = ['Ice Show', 0, 0, '2027-03-07', '20:00', 60, 1, 1];
  var iceLate = ['Ice Show', 0, 0, '2027-03-07', '21:30', 60, 1, 1];
  var gone = ['Gone Show', 0, 0, '2027-03-07', '18:00', 60, 1, 1];
  var stars = {};
  stars[keyOf(ice)] = true;
  stars[slice.reservedKey(keyOf(ice))] = true;
  stars[keyOf(gone)] = true;
  stars[slice.reservedKey(keyOf(gone))] = true;
  var times = {};
  times[slice.reservedKey(keyOf(ice))] = 1000;
  var fresh = makeBundle([iceLate]);
  var r = slice.reconcileStars(makeBundle([ice, gone]), fresh, stars, {}, at('2027-03-07', 12, 0), times);
  assert.deepStrictEqual(r.changes.map(function(x) { return x.kind; }), ['cancelled', 'moved']);
  var want = {};
  want[keyOf(iceLate)] = true;
  want[slice.reservedKey(keyOf(iceLate))] = true;
  assert.deepStrictEqual(r.stars, want);
  assert.strictEqual(r.times[slice.reservedKey(keyOf(iceLate))], 1000);

  var pruned = slice.pruneStarTimes(r.times, fresh, {}, {});
  assert.deepStrictEqual(Object.keys(pruned), [slice.reservedKey(keyOf(iceLate))]);
  var old = {};
  old[slice.reservedKey(keyOf(gone))] = 5;
  assert.deepStrictEqual(slice.pruneStarTimes(old, fresh, {}, {}), {});
});

test('paid sessions reach the watch only when booked, and never get show tags', function() {
  var b = makeBundle([
    ['Escape Room', 1, 0, '2027-03-07', '13:00', 60, 1, 1, 1, 40],
    ['Escape Room', 1, 0, '2027-03-07', '14:30', 60, 1, 1, 1, 40],
    ['Escape Room', 1, 0, '2027-03-07', '16:00', 60, 1, 1, 1, 40],
    ['The Fine Line', 0, 0, '2027-03-07', '22:00', 50, 1, 1, 0, null]
  ]);
  b.schedule.fields = b.schedule.fields.concat(['paid', 'price']);
  var now = at('2027-03-07', 9, 0);
  function titles(st) {
    return slice.buildSlice(b, {}, st, now).events.map(function(e) { return e.title + ' ' + e.start % 1440; });
  }
  // Nothing booked: only the show.
  assert.deepStrictEqual(titles({}), ['The Fine Line 1320']);
  // One session booked (starred and reserved): that one only, reserved.
  var key = slice.starKey('Escape Room', '2027-03-07', '14:30', 'Boardwalk');
  var st = {};
  st[key] = true;
  st[slice.reservedKey(key)] = true;
  assert.deepStrictEqual(titles(st), ['Escape Room 870', 'The Fine Line 1320']);
  var room = slice.buildSlice(b, {}, st, now).events[0];
  assert.strictEqual(room.flags & slice.FLAG_RESERVED, slice.FLAG_RESERVED);
  // Featured paid sessions don't get Last chance / Only show; the show does.
  assert.strictEqual(room.flags & (slice.FLAG_LAST_CHANCE | slice.FLAG_ONLY_SHOW), 0);
  var finals = slice.finalShows(b);
  assert.deepStrictEqual(Object.keys(finals), [slice.starKey('The Fine Line', '2027-03-07', '22:00', 'Studio B')]);
  // Unbooked sessions don't count in tomorrow's featured count either.
  assert.strictEqual(slice.buildTomorrow(b, {}, {}, 0, slice.daysFromIso('2027-03-06')).featured, 1);
  // Bundles from before the paid field still show everything.
  var old = makeBundle([['Escape Room', 1, 0, '2027-03-07', '13:00', 60, 1, 1]]);
  assert.strictEqual(slice.buildSlice(old, {}, {}, now).events.length, 1);
});

test('cutoffWhen gives the ship-time date and clock of what the watch could not save', function() {
  var now = at('2027-03-07', 10, 0);
  assert.strictEqual(slice.cutoffWhen('2027-03-06', slice.NO_TIME, now), null);
  assert.strictEqual(slice.cutoffWhen('2027-03-06', undefined, now), null);
  // Day 1 at 15:40 is cruise minute 1440 + 940.
  assert.deepStrictEqual(slice.cutoffWhen('2027-03-06', 2380, now), {date: '2027-03-07', time: '15:40'});
  // Past or right now: nothing to warn about.
  assert.strictEqual(slice.cutoffWhen('2027-03-06', 1440 + 600, now), null);
  assert.strictEqual(slice.cutoffWhen('2027-03-06', 1440 + 300, now), null);
  // After midnight it is the next calendar date.
  assert.deepStrictEqual(slice.cutoffWhen('2027-03-06', 1440 + 1500, now), {date: '2027-03-08', time: '01:00'});
});

test('summary: arrive and depart in ship time, after midnight too', function() {
  var b = makeBundle([]);
  var settings = {days: {'2027-03-08': {offset: 60}}};
  var d = slice.buildSlice(b, settings, {}, at('2027-03-08', 10, 0)).day;
  // Port-local 08:00-17:00 with the port an hour ahead: 07:00-16:00 ship time.
  assert.strictEqual(d.arrive, 2 * 1440 + 7 * 60);
  assert.strictEqual(d.depart, 2 * 1440 + 16 * 60);
  // Embark: sails only; debark: arrives only; sea: neither.
  var embark = slice.buildSlice(b, {}, {}, at('2027-03-06', 12, 0)).day;
  assert.deepStrictEqual([embark.arrive, embark.depart], [slice.NO_TIME, 16 * 60]);
  var sea = slice.buildSlice(b, {}, {}, at('2027-03-07', 12, 0)).day;
  assert.deepStrictEqual([sea.arrive, sea.depart], [slice.NO_TIME, slice.NO_TIME]);
  var debark = slice.buildSlice(b, {}, {}, at('2027-03-09', 7, 0)).day;
  assert.deepStrictEqual([debark.arrive, debark.depart], [3 * 1440 + 6 * 60, slice.NO_TIME]);
  // A 01:30 departure is after midnight: 25:30 on the port day.
  var late = makeBundle([], [
    {day: 1, date: '2027-03-06', port: 'Galveston, TX', type: 'EMBARK', arrive: null, depart: '16:00'},
    {day: 2, date: '2027-03-07', port: 'Cozumel, Mexico', type: 'DOCKED', arrive: '10:30', depart: '01:30'}
  ]);
  var l = slice.buildSlice(late, {}, {}, at('2027-03-07', 12, 0)).day;
  assert.strictEqual(l.arrive, 1440 + 10 * 60 + 30);
  assert.strictEqual(l.depart, 1440 + 25 * 60 + 30);
  // Outside the cruise there are none.
  var none = slice.buildSlice(b, {}, {}, at('2027-02-22', 12, 0)).day;
  assert.deepStrictEqual([none.arrive, none.depart], [slice.NO_TIME, slice.NO_TIME]);
});

test('final shows: last chance by title across days, only show, never unfeatured', function() {
  var b = makeBundle([
    ['Hairspray', 0, 0, '2027-03-07', '19:00', 90, 1, 0],
    ['hairspray ', 0, 0, '2027-03-08', '21:00', 90, 1, 0],
    ['Hairspray', 0, 0, '2027-03-08', '18:00', 90, 1, 0],
    ['Ice Show', 0, 0, '2027-03-07', '14:00', 60, 1, 0],
    ['Trivia', 1, 0, '2027-03-07', '15:00', 45, 0, 0],
    ['Trivia', 1, 0, '2027-03-08', '15:00', 45, 0, 0]
  ]);
  var f = slice.finalShows(b);
  assert.deepStrictEqual(f, {
    'hairspray |2027-03-08|21:00|Studio B': slice.FINAL_LAST_CHANCE,
    'Ice Show|2027-03-07|14:00|Studio B': slice.FINAL_ONLY_SHOW
  });
  // A 00:30 show listed on the evening's date is after that midnight, so it's the last.
  var m = makeBundle([
    ['Late Comedy', 0, 0, '2027-03-07', '00:30', 60, 1, 0],
    ['Late Comedy', 0, 0, '2027-03-07', '22:00', 60, 1, 0]
  ]);
  assert.deepStrictEqual(slice.finalShows(m), {'Late Comedy|2027-03-07|00:30|Studio B': slice.FINAL_LAST_CHANCE});
});

test('final shows: events carry last chance and only show flags', function() {
  var b = makeBundle([
    ['Hairspray', 0, 0, '2027-03-07', '19:00', 90, 1, 0],
    ['Hairspray', 0, 0, '2027-03-08', '21:00', 90, 1, 0],
    ['Ice Show', 0, 0, '2027-03-08', '14:00', 60, 1, 1],
    ['Trivia', 1, 0, '2027-03-08', '15:00', 45, 0, 0]
  ]);
  var TAGS = slice.FLAG_LAST_CHANCE | slice.FLAG_ONLY_SHOW;
  function tags(events) {
    var out = {};
    events.forEach(function(e) { out[e.title] = e.flags & TAGS; });
    return out;
  }
  // Day 2: the first Hairspray isn't the last one.
  assert.deepStrictEqual(tags(slice.buildSlice(b, {}, {}, at('2027-03-07', 12, 0)).events), {Hairspray: 0});
  // Day 3: its last chance; the Ice Show (on once) keeps its other flags; Trivia isn't featured.
  var events = slice.buildSlice(b, {}, {}, at('2027-03-08', 12, 0)).events;
  assert.deepStrictEqual(tags(events),
                         {Hairspray: slice.FLAG_LAST_CHANCE, 'Ice Show': slice.FLAG_ONLY_SHOW, Trivia: 0});
  var ice = events.filter(function(e) { return e.title === 'Ice Show'; })[0];
  assert.strictEqual(ice.flags, slice.FLAG_FEATURED | slice.FLAG_RESERVATION | slice.FLAG_ONLY_SHOW);
  // Personal entries never get a tag, even with a featured show's title.
  var settings = {personal: [{title: 'Hairspray', venue: 'Studio B', date: '2027-03-08', time: '21:00', minutes: 90}]};
  var mine = slice.buildSlice(b, settings, {}, at('2027-03-08', 12, 0)).events.filter(function(e) {
    return e.flags & slice.FLAG_PERSONAL;
  });
  assert.strictEqual(mine.length, 1);
  assert.strictEqual(mine[0].flags & TAGS, 0);
});

test('tomorrow card: counts, first starred, last chance before only show', function() {
  var b = makeBundle([
    ['Ice Show', 0, 0, '2027-03-07', '14:00', 60, 1, 0],
    ['Ice Show', 0, 0, '2027-03-08', '20:00', 60, 1, 0],
    ['Magic', 0, 0, '2027-03-08', '11:00', 60, 1, 0],
    ['Pilates', 1, 0, '2027-03-08', '08:30', 45, 0, 0],
    ['Sale', 2, 1, '2027-03-08', '09:00', 60, 1, 0],
    ['Late Party', 1, 0, '2027-03-08', '01:00', 60, 0, 0]
  ]);
  var stars = {};
  stars[slice.starKey('Pilates', '2027-03-08', '08:30', 'Boardwalk')] = true;
  stars[slice.starKey('Late Party', '2027-03-08', '01:00', 'Boardwalk')] = true;
  var settings = {personal: [{title: 'Spa', venue: '', date: '2027-03-08', time: null, minutes: 0}]};
  // In the evening of day 2 (index 1), tomorrow is St. Thomas.
  var t = slice.buildSlice(b, settings, stars, at('2027-03-07', 21, 0)).tomorrow;
  assert.strictEqual(t.kind, slice.DAY_PORT);
  assert.strictEqual(t.status, 'DOCKED');
  assert.strictEqual(t.location, 'St. Thomas');
  assert.deepStrictEqual([t.arrive, t.depart, t.allAboard], [2 * 1440 + 480, 2 * 1440 + 1020, 2 * 1440 + 990]);
  // Pilates, the untimed Spa and the 01:00 party (after midnight, still tomorrow's day).
  assert.strictEqual(t.starred, 3);
  assert.deepStrictEqual([t.first, t.firstStart], ['Pilates', 2 * 1440 + 510]);
  // Shop is hidden, so the featured Sale doesn't count.
  assert.strictEqual(t.featured, 2);
  // Magic is an only show at 11:00, but the Ice Show's last chance comes first.
  assert.deepStrictEqual([t.last, t.lastKind], ['Ice Show', slice.FINAL_LAST_CHANCE]);
  // Without the repeat, Magic (the earlier only show) is picked.
  b.schedule.events.splice(0, 1);
  t = slice.buildSlice(b, settings, stars, at('2027-03-07', 21, 0)).tomorrow;
  assert.deepStrictEqual([t.last, t.lastKind], ['Magic', slice.FINAL_ONLY_SHOW]);
  // At 00:30 it is still day 2's evening, so tomorrow is still St. Thomas.
  assert.strictEqual(slice.buildSlice(b, settings, stars, at('2027-03-08', 0, 30)).tomorrow.location, 'St. Thomas');
  // On the last day, tomorrow is outside the cruise.
  t = slice.buildSlice(b, {}, {}, at('2027-03-09', 21, 0)).tomorrow;
  assert.deepStrictEqual([t.kind, t.location, t.starred, t.firstStart, t.lastKind],
                         [slice.DAY_NONE, '', 0, slice.NO_TIME, 0]);
  // The ship name comes along for the countdown.
  assert.strictEqual(slice.buildSlice(b, {}, {}, at('2027-02-22', 12, 0)).shipName, 'Harmony of the Seas');
});

test('to-reserve alerts: the evening before, starred and not reserved only', function() {
  var b = makeBundle([
    ['Hairspray', 0, 0, '2027-03-08', '19:00', 90, 1, 1],
    ['Ice Show', 0, 0, '2027-03-08', '14:00', 60, 1, 1],
    ['Aqua Show', 1, 0, '2027-03-07', '01:30', 60, 1, 1],   // after midnight: the 7th's night, today's
    ['Comedy', 1, 0, '2027-03-08', '00:30', 45, 0, 1],      // after midnight on the 8th's night
    ['Magic', 0, 0, '2027-03-08', '16:00', 60, 1, 1],       // not starred
    ['Laser Tag', 1, 0, '2027-03-08', '10:00', 30, 0, 0],   // starred, no reservation needed
    ['Late Show', 0, 0, '2027-03-09', '21:00', 60, 1, 1]    // debark day: listed on the 8th's evening
  ]);
  var stars = {};
  [['Hairspray', '2027-03-08', '19:00', 'Studio B'], ['Ice Show', '2027-03-08', '14:00', 'Studio B'],
   ['Aqua Show', '2027-03-07', '01:30', 'Boardwalk'], ['Comedy', '2027-03-08', '00:30', 'Boardwalk'],
   ['Laser Tag', '2027-03-08', '10:00', 'Boardwalk'], ['Late Show', '2027-03-09', '21:00', 'Studio B']
  ].forEach(function(k) { stars[slice.starKey(k[0], k[1], k[2], k[3])] = true; });
  // Ice Show is already reserved.
  stars[slice.reservedKey(slice.starKey('Ice Show', '2027-03-08', '14:00', 'Studio B'))] = true;

  function toReserve(settings, now) {
    return slice.buildAlarms(b, settings, stars, now).filter(function(a) {
      return a.kind === slice.ALARM_TO_RESERVE;
    }).map(function(a) { return [a.at, a.ref, a.title, a.extra, a.venue, a.notReserved]; });
  }
  var day2 = 1440, day3 = 2 * 1440;
  // Day 2 (sea day) at noon: 20:00 tonight lists the 8th's Hairspray and the
  // 00:30 Comedy; 20:00 tomorrow lists the 9th's Late Show.
  assert.deepStrictEqual(toReserve({}, at('2027-03-07', 12, 0)), [
    [day2 + 1200, day3 + 1140, 'Hairspray', 2, 'Studio B', true],
    [day2 + 1200, day3 + 1440 + 30, 'Comedy', 2, 'Boardwalk', true],
    [day3 + 1200, 3 * 1440 + 1260, 'Late Show', 1, 'Studio B', true]
  ]);
  // The Me tab's time; after it has passed tonight's is gone.
  var nine = toReserve({reserveAlertAt: 21 * 60}, at('2027-03-07', 12, 0));
  assert.deepStrictEqual(nine.map(function(a) { return a[0]; }), [day2 + 1260, day2 + 1260, day3 + 1260]);
  assert.deepStrictEqual(toReserve({}, at('2027-03-07', 20, 0)).map(function(a) { return a[2]; }), ['Late Show']);
  // Marking reserved removes it; unstarring too.
  stars[slice.reservedKey(slice.starKey('Hairspray', '2027-03-08', '19:00', 'Studio B'))] = true;
  delete stars[slice.starKey('Comedy', '2027-03-08', '00:30', 'Boardwalk')];
  assert.deepStrictEqual(toReserve({}, at('2027-03-07', 12, 0)).map(function(a) { return a[2]; }), ['Late Show']);
});

test('to-reserve alerts: at most 5 an evening, with the full count', function() {
  var events = [];
  var stars = {};
  for (var i = 0; i < 7; i++) {
    events.push(['Show ' + i, 0, 0, '2027-03-08', (12 + i) + ':00', 60, 1, 1]);
    stars[slice.starKey('Show ' + i, '2027-03-08', (12 + i) + ':00', 'Studio B')] = true;
  }
  var alarms = slice.buildAlarms(makeBundle(events), {}, stars, at('2027-03-07', 12, 0)).filter(function(a) {
    return a.kind === slice.ALARM_TO_RESERVE;
  });
  assert.deepStrictEqual(alarms.map(function(a) { return a.title; }),
                         ['Show 0', 'Show 1', 'Show 2', 'Show 3', 'Show 4']);
  assert.ok(alarms.every(function(a) { return a.extra === 7; }));
  // They pack like other alerts.
  assert.strictEqual(pack.packAlarms(alarms, 1500).length, 1);
});

test('reserve alert time: a Me tab choice, else 20:00', function() {
  assert.strictEqual(slice.reserveAlertAt({}), 1200);
  assert.strictEqual(slice.reserveAlertAt(null), 1200);
  assert.strictEqual(slice.reserveAlertAt({reserveAlertAt: 1080}), 1080);
  assert.strictEqual(slice.reserveAlertAt({reserveAlertAt: 1320}), 1320);
  assert.strictEqual(slice.reserveAlertAt({reserveAlertAt: 1230}), 1200);
  assert.strictEqual(slice.reserveAlertAt({reserveAlertAt: '1080'}), 1200);
});

test('tomorrow card: to reserve counts starred events not marked reserved', function() {
  var b = makeBundle([
    ['Hairspray', 0, 0, '2027-03-08', '19:00', 90, 1, 1],
    ['Ice Show', 0, 0, '2027-03-08', '14:00', 60, 1, 1],
    ['Magic', 0, 0, '2027-03-08', '16:00', 60, 1, 1]
  ]);
  var stars = {};
  stars[slice.starKey('Hairspray', '2027-03-08', '19:00', 'Studio B')] = true;
  stars[slice.starKey('Ice Show', '2027-03-08', '14:00', 'Studio B')] = true;
  var now = at('2027-03-07', 21, 0);
  assert.strictEqual(slice.buildSlice(b, {}, stars, now).tomorrow.toReserve, 2);
  stars[slice.reservedKey(slice.starKey('Ice Show', '2027-03-08', '14:00', 'Studio B'))] = true;
  assert.strictEqual(slice.buildSlice(b, {}, stars, now).tomorrow.toReserve, 1);
  assert.strictEqual(slice.buildSlice(b, {}, {}, now).tomorrow.toReserve, 0);
  assert.strictEqual(slice.buildSlice(b, {}, stars, at('2027-03-09', 21, 0)).tomorrow.toReserve, 0);
});

test('demo: tomorrow has a starred class and a last chance or only show', function() {
  for (var v = 0; v < demo.VARIANTS; v++) {
    var now = at('2026-09-23', 21, 0);
    var d = demo.make(now, v);
    var t = slice.buildSlice(d.bundle, d.settings, d.stars, now).tomorrow;
    assert.strictEqual(t.location, v === 4 ? 'At Sea' : 'Nassau');  // 4: embark, then a sea day
    assert.strictEqual(t.first, 'Sunrise Pilates');
    assert.deepStrictEqual([t.last, t.lastKind],
                           ['Mamma Mia!', v % 2 === 1 ? slice.FINAL_LAST_CHANCE : slice.FINAL_ONLY_SHOW]);
  }
});

// Login data with a booked excursion on the St. Thomas day (made-up stateroom).
function bookedBundle(order) {
  var b = makeBundle([['Pool Party', 1, 0, '2027-03-08', '13:00', 60, 0, 0]]);
  b.mine = {stateroom: '1234', orders: [
    order || {title: 'Island Snorkel', category: 'pt_shoreX', guests: 2, date: '2027-03-08', time: '09:00',
              day: 3, port: 'STT', meet: '08:45', end: '11:30', minutes: 150},
    {title: 'Deluxe Beverage Package', category: 'pt_beverage', guests: 2},
    {title: 'Outside the cruise', category: 'pt_shoreX', date: '2027-04-01', time: '09:00'}
  ]};
  return b;
}

test('booked orders: timed ones in the cruise, with meet, guests and length', function() {
  var list = slice.bookedOrders(bookedBundle());
  assert.strictEqual(list.length, 1);
  assert.deepStrictEqual(list[0], {title: 'Island Snorkel', date: '2027-03-08', time: '09:00', minutes: 150,
                                   meetBefore: 15, guests: 2, excursion: true});
  // No end: minutes; neither: no length. Not an excursion; no meet.
  var other = slice.bookedOrders(bookedBundle({title: 'Chef Table', category: 'pt_dining', date: '2027-03-08',
                                               time: '19:00', minutes: 120}))[0];
  assert.strictEqual(other.minutes, 120);
  assert.strictEqual(other.meetBefore, 0);
  assert.strictEqual(other.guests, 0);
  assert.strictEqual(other.excursion, false);
  // An end after midnight.
  assert.strictEqual(slice.bookedOrders(bookedBundle({title: 'Night Tour', date: '2027-03-08', time: '22:00',
                                                      end: '01:00'}))[0].minutes, 180);
  assert.deepStrictEqual(slice.bookedOrders(makeBundle([])), []);
});

test('booked orders: starred, booked and Ashore at the day port, never filtered', function() {
  var b = bookedBundle();
  var sail = slice.daysFromIso(b.sailDate);
  var events = slice.buildEvents(b, {hiddenCats: ['Entertainment']}, {}, 2, sail);
  assert.strictEqual(events.length, 1);  // the pool party is hidden
  var e = events[0];
  assert.strictEqual(e.title, 'Island Snorkel');
  assert.strictEqual(e.venue, 'St. Thomas');
  assert.strictEqual(e.start, 2 * 1440 + 540);
  assert.strictEqual(e.minutes, 150);
  assert.strictEqual(e.flags, slice.FLAG_STARRED | slice.FLAG_BOOKED);
  assert.deepStrictEqual(e.booked, {meetBefore: 15, guests: 2, excursion: true});
  assert.deepStrictEqual(pack.encodeWhere(e.where), [0, 0, 4, 0]);
  // Other days don't have it.
  assert.strictEqual(slice.buildEvents(b, {}, {}, 1, sail).length, 0);
  // Counts as starred for the cruise and tomorrow; never to reserve.
  assert.strictEqual(slice.buildSlice(b, {}, {}, at('2027-03-05', 12, 0)).cruiseStarred, 1);
  var t = slice.buildTomorrow(b, {}, {}, 1, sail);
  assert.strictEqual(t.starred, 1);
  assert.strictEqual(t.first, 'Island Snorkel');
  assert.strictEqual(t.toReserve, 0);
});

test('booked list for the settings page: the port as the watch shows it, edits included', function() {
  var b = bookedBundle();
  assert.strictEqual(slice.bookedList(b, {})[0].port, 'St. Thomas');
  var edited = {days: {'2027-03-08': {edit: {port: 'Tortola, BVI'}}}};
  assert.strictEqual(slice.bookedList(b, edited)[0].port, 'Tortola');
});

test('booked orders: the reminder is before the meeting time, with no directions', function() {
  var b = bookedBundle();
  var alarms = slice.buildAlarms(b, {reminderLead: 15}, {}, at('2027-03-08', 6, 0));
  var r = alarms.filter(function(a) { return a.kind === slice.ALARM_REMINDER; })[0];
  assert.strictEqual(r.at, 2 * 1440 + 510);  // 8:30 = meet 8:45 - 15
  assert.strictEqual(r.ref, 2 * 1440 + 540);
  assert.strictEqual(r.extra, 150);
  assert.strictEqual(r.venue, 'St. Thomas');
  assert.strictEqual(r.from, venues.FROM_NONE);
  assert.deepStrictEqual(r.booked, {meetBefore: 15, guests: 2, excursion: true});
});

// Shore excursions (docs/DESIGN.md §7.7): a snorkel (meet 30 min early,
// ages 6+), an all-day cabana and the booked order's own session.
function excursionBundle() {
  var b = bookedBundle();
  b.schedule.cats.push(['Shore excursions', '']);
  b.schedule.venues.push('');
  b.schedule.fields = b.schedule.fields.concat(['paid', 'price', 'info']);
  b.schedule.notes = [];
  b.schedule.infos = [[[6, null], 30, []]];
  b.schedule.events = b.schedule.events.map(function(r) { return r.concat([0, null, null]); }).concat([
    ['Snorkel and Beach Break', 3, 2, '2027-03-08', '09:30', 150, 0, 0, 1, 89, 0],
    ['Beach Cabana', 3, 2, '2027-03-08', '09:00', 0, 0, 0, 1, 400, 0],
    ['Behind the Scenes Tour', 3, 2, '2027-03-07', '09:00', 120, 0, 0, 1, 224, 0],
    ['Island Snorkel', 3, 2, '2027-03-08', '09:00', 150, 0, 0, 1, 70, 0]
  ]);
  return b;
}

function picked(titleTimes) {
  var st = {};
  titleTimes.forEach(function(tt) {
    var k = slice.starKey(tt[0], '2027-03-08', tt[1], '');
    st[k] = true;
    st[slice.reservedKey(k)] = true;
  });
  return st;
}

test('shore excursions: only picked ones, at the day port, Ashore and reserved', function() {
  var b = excursionBundle();
  var sail = slice.daysFromIso(b.sailDate);
  function titles(st) {
    return slice.buildEvents(b, {}, st, 2, sail).map(function(e) { return e.title; });
  }
  // Unpicked sessions stay off the watch; the booked order is there.
  assert.deepStrictEqual(titles({}), ['Island Snorkel', 'Pool Party']);
  var st = picked([['Snorkel and Beach Break', '09:30'], ['Beach Cabana', '09:00']]);
  var events = slice.buildEvents(b, {}, st, 2, sail);
  var e = events.filter(function(x) { return x.title === 'Snorkel and Beach Break'; })[0];
  assert.strictEqual(e.venue, 'St. Thomas');
  assert.deepStrictEqual(pack.encodeWhere(e.where), [0, 0, 4, 0]);
  assert.strictEqual(e.flags, slice.FLAG_STARRED | slice.FLAG_RESERVATION | slice.FLAG_RESERVED);
  assert.strictEqual(e.early, 30);
  assert.strictEqual(e.ageMin, 6);
  assert.strictEqual(e.key, slice.starKey('Snorkel and Beach Break', '2027-03-08', '09:30', ''));
  // An all-day rental: at its listed time with no length, meeting then too.
  var cabana = events.filter(function(x) { return x.title === 'Beach Cabana'; })[0];
  assert.strictEqual(cabana.start, 2 * 1440 + 540);
  assert.strictEqual(cabana.minutes, 0);
  assert.strictEqual(cabana.early, 0);
  // Picked but not marked reserved: the evening before asks to reserve it.
  var unres = {};
  unres[slice.starKey('Snorkel and Beach Break', '2027-03-08', '09:30', '')] = true;
  assert.strictEqual(slice.buildTomorrow(b, {}, unres, 1, sail).toReserve, 1);
});

test('shore excursions on a sea day: on board, no venue, arrive-by wording', function() {
  var b = excursionBundle();
  var sail = slice.daysFromIso(b.sailDate);
  var k = slice.starKey('Behind the Scenes Tour', '2027-03-07', '09:00', '');
  var st = {};
  st[k] = true;
  var e = slice.buildEvents(b, {}, st, 1, sail)[0];
  assert.strictEqual(e.title, 'Behind the Scenes Tour');
  assert.strictEqual(e.venue, '');
  assert.strictEqual(e.where.ashore, false);
  assert.strictEqual(e.early, 30);
  var r = slice.buildAlarms(b, {reminderLead: 15}, st, at('2027-03-07', 6, 0)).filter(function(a) {
    return a.kind === slice.ALARM_REMINDER && a.title === 'Behind the Scenes Tour';
  })[0];
  assert.strictEqual(r.at, 1440 + 495);  // 8:15 = arrive by 8:30 - 15
  assert.strictEqual(r.where.ashore, false);
  // Unstarring on the watch finds it with no venue.
  var ch = slice.applyWatchStarChanges(b, {}, st, {}, [watchChange(e, false)]);
  assert.deepStrictEqual(ch.applied, [{key: k, on: false, reserved: false}]);
});

test('shore excursions: one in login data shows once, as the booked order', function() {
  var b = excursionBundle();
  var sail = slice.daysFromIso(b.sailDate);
  var st = picked([['Island Snorkel', '09:00']]);
  var snorkels = slice.buildEvents(b, {}, st, 2, sail).filter(function(e) { return e.title === 'Island Snorkel'; });
  assert.strictEqual(snorkels.length, 1);
  assert.strictEqual(snorkels[0].flags, slice.FLAG_STARRED | slice.FLAG_BOOKED);
  // Titles match without case or spaces around; another time doesn't.
  b.mine.orders[0].title = ' island snorkel ';
  assert.strictEqual(slice.buildEvents(b, {}, st, 2, sail).filter(function(e) {
    return e.title === 'Island Snorkel' && !e.booked;
  }).length, 0);
  b.mine.orders[0].time = '13:00';
  assert.strictEqual(slice.buildEvents(b, {}, st, 2, sail).filter(function(e) {
    return e.title === 'Island Snorkel' && !e.booked;
  }).length, 1);
});

test('shore excursions: the reminder counts down to the meeting time, with no directions', function() {
  var b = excursionBundle();
  var st = picked([['Snorkel and Beach Break', '09:30']]);
  var r = slice.buildAlarms(b, {reminderLead: 15}, st, at('2027-03-08', 6, 0)).filter(function(a) {
    return a.kind === slice.ALARM_REMINDER && a.title === 'Snorkel and Beach Break';
  })[0];
  assert.strictEqual(r.at, 2 * 1440 + 525);  // 8:45 = meet 9:00 - 15
  assert.strictEqual(r.ref, 2 * 1440 + 570);
  assert.strictEqual(r.early, 30);
  assert.strictEqual(r.venue, 'St. Thomas');
  assert.strictEqual(r.where.ashore, true);
  assert.strictEqual(r.from, venues.FROM_NONE);
  assert.strictEqual(r.booked, undefined);
});

test('shore excursions: unstarring on the watch finds the session by its port', function() {
  var b = excursionBundle();
  var st = picked([['Snorkel and Beach Break', '09:30']]);
  var e = slice.buildSlice(b, {}, st, at('2027-03-08', 6, 0)).events.filter(function(x) {
    return x.title === 'Snorkel and Beach Break';
  })[0];
  var r = slice.applyWatchStarChanges(b, {}, st, {}, [watchChange(e, false)]);
  var key = slice.starKey('Snorkel and Beach Break', '2027-03-08', '09:30', '');
  assert.deepStrictEqual(r.applied, [{key: key, on: false, reserved: false}]);
  assert.strictEqual(st[key], undefined);
});

test('booked orders: packed with three trailing bytes (event and alarm)', function() {
  var e = {title: 'Tour', venue: 'Port', start: 600, minutes: 90, flags: slice.FLAG_STARRED | slice.FLAG_BOOKED,
           where: {ashore: true}, booked: {meetBefore: 15, guests: 2, excursion: true}};
  var bytes = pack.encodeEvent(e);
  assert.strictEqual(bytes[6], 129);
  assert.deepStrictEqual(bytes.slice(-3), [15, 2, 1]);
  assert.strictEqual(bytes.length, 15 + 1 + 4 + 1 + 4 + 3);
  // Without booked, nothing extra.
  assert.strictEqual(pack.encodeEvent({title: 'Tour', venue: 'Port', start: 600, flags: 1}).length, 15 + 10);
  var a = pack.encodeAlarm({at: 570, ref: 600, kind: 1, extra: 90, title: 'Tour', venue: 'Port',
                            booked: {meetBefore: 0, guests: 3, excursion: false}});
  assert.strictEqual(a[11], 32);
  assert.deepStrictEqual(a.slice(-3), [0, 3, 0]);
});

test('demo: port days have a booked excursion; sea days none', function() {
  var now = new Date(2027, 2, 7, 9, 0);
  var port = demo.make(now, 0);
  var sail = slice.daysFromIso(port.bundle.sailDate);
  var booked = slice.buildEvents(port.bundle, port.settings, port.stars, 1, sail).filter(function(e) {
    return e.flags & slice.FLAG_BOOKED;
  });
  assert.strictEqual(booked.length, 1);
  assert.strictEqual(booked[0].venue, 'St. Thomas');
  assert.strictEqual(demo.make(now, 1).bundle.mine, undefined);
});

// Phase 4 details (docs/WATCH_PROTOCOL.md, Packed events).
test('note tags: by Royal id, then keywords; short descriptions only give the meeting spot', function() {
  function tags(id, text) { return slice.noteTags(id, text || ''); }
  assert.strictEqual(tags('kbyg/general/seapass'), 1);
  assert.strictEqual(tags('kbyg/seapass'), 1);
  assert.strictEqual(tags('kbyg/general/WEATHER'), 2);
  assert.strictEqual(tags('kbyg/general/signups'), 4);
  assert.strictEqual(tags('kbyg/sign-ups-close-once-competition-starts-'), 4);
  assert.strictEqual(tags('legal/waiver'), 8);
  assert.strictEqual(tags('kbyg/flowrdr/WARNDISCLAIM'), 8);
  assert.strictEqual(tags('waiver', 'Signed waiver required'), 8);
  assert.strictEqual(tags('kbyg/general/ATHLSHOES'), 16);
  assert.strictEqual(tags('kbyg/general/wcts'), 16);
  assert.strictEqual(tags('kbyg/general/crocs-not-allowed'), 16);
  assert.strictEqual(tags('attire/bathing'), 32);
  assert.strictEqual(tags('kbyg/general/Activeattire'), 32);
  assert.strictEqual(tags('kbyg/limited-spots-per-session'), 64);
  assert.strictEqual(tags('kbyg/general/LIMSEAT'), 64);
  assert.strictEqual(tags('kbyg/general/fcfs'), 64);
  assert.strictEqual(tags('kbyg/general/early', 'Early arrival is recommended'), 64);
  // Keywords when the id is new.
  assert.strictEqual(tags('kbyg/x1', 'Bring your SeaPass card'), 1);
  assert.strictEqual(tags('kbyg/x2', 'Sign up at the pool bar'), 4);
  assert.strictEqual(tags('kbyg/x3', 'Closed-toe shoes required'), 16);
  assert.strictEqual(tags('kbyg/x4', 'Bring dry clothes'), 32);
  assert.strictEqual(tags('kbyg/x5', 'Limited seating'), 64);
  // Not tags.
  ['kbyg/general/a15', 'kbyg/Atleast58', 'kbyg/general/over21', 'kbyg/general/sunglasses',
   'age/16-accompanied-parent-guardian', 'kbyg/theater/doors45'].forEach(function(id) {
    assert.strictEqual(tags(id), 0, id);
  });
  assert.strictEqual(tags('short', "Dance Fitness with your Cruise Director's Staff Lais (Meet by the Car)"), 128);
  assert.strictEqual(tags('short', "World's Sexiest Man Competition:Sign Ups"), 0);
  assert.strictEqual(tags('short', 'Seminar: Burn Fat Fast'), 0);
  assert.strictEqual(tags(null, null), 0);
});

test('event details: ages, arrive-early, tags; limited spots left off with an arrive-by time', function() {
  var fixture = require('../fixtures/expected-schedule.json');
  var d = slice.eventDetails(fixture.schedule || fixture);
  assert.deepStrictEqual(d.map(function(x) { return x.tags; }),
                         [0, 1, 0, 0, 22, 21, 0, 65, 0, 0, 64, 0, 0, 41, 32, 0, 64, 176, 1, 4, 0, 0, 4, 11, 40, 1, 41]);
  assert.deepStrictEqual(d[4], {ageMin: 18, ageMax: 0, early: 15, tags: 2 | 4 | 16});
  assert.deepStrictEqual(d[8], {ageMin: 0, ageMax: 17, early: 0, tags: 0});
  assert.deepStrictEqual(d[11], {ageMin: 18, ageMax: 25, early: 0, tags: 0});
  var sched = {notes: [['short', 'Zumba (Meet at the pool)'], ['kbyg/general/fcfs', 'First-come, first-served']],
               infos: [[null, 20, [0, 1]], [null, null, [1, 7]], 'junk', [[0, 300], -5, 'x']]};
  assert.deepStrictEqual(slice.eventDetails(sched), [
    {ageMin: 0, ageMax: 0, early: 20, tags: 128},
    {ageMin: 0, ageMax: 0, early: 0, tags: 64},
    {ageMin: 0, ageMax: 0, early: 0, tags: 0},
    {ageMin: 0, ageMax: 255, early: 0, tags: 0}
  ]);
  assert.deepStrictEqual(slice.eventDetails({}), []);
  assert.deepStrictEqual(slice.eventDetails(undefined), []);
});

test('age text', function() {
  assert.strictEqual(slice.ageText(18, 0), 'Ages 18+');
  assert.strictEqual(slice.ageText(null, 17), 'Ages 17 & under');
  assert.strictEqual(slice.ageText(13, 17), 'Ages 13-17');
  assert.strictEqual(slice.ageText(null, null), '');
});

test('event details reach the packed events; untimed events never arrive early', function() {
  var b = {
    ship: {code: 'HM'}, sailDate: '2027-03-06',
    itinerary: [{day: 1, date: '2027-03-06', type: 'EMBARK', port: 'Miami', depart: '16:00'},
                {day: 2, date: '2027-03-07', type: 'CRUISING', port: 'Cruising'}],
    schedule: {
      published: true, cats: [['Entertainment', 'Comedy']], venues: ['Comedy Live'],
      notes: [['kbyg/general/seapass', 'Please bring your SeaPass'], ['kbyg/general/LIMSEAT', 'Limited seating']],
      infos: [[[18, null], 15, [0, 1]], [null, 10, [1]]],
      fields: ['title', 'venue', 'cat', 'date', 'time', 'minutes', 'featured', 'reservation', 'info'],
      events: [['Adult Comedy', 0, 0, '2027-03-07', '22:00', 60, 0, 0, 0],
               ['Joke Sheets', 0, 0, '2027-03-07', null, 0, 0, 0, 1],
               ['Open Mic', 0, 0, '2027-03-07', '20:00', 60, 0, 0, null]]
    }
  };
  var sail = slice.daysFromIso(b.sailDate);
  var ev = {};
  slice.buildEvents(b, {}, {}, 1, sail).forEach(function(e) { ev[e.title] = e; });
  assert.deepStrictEqual(pack.encodeEvent(ev['Adult Comedy']).slice(11, 15), [18, 0, 15, 1]);
  assert.deepStrictEqual(pack.encodeEvent(ev['Joke Sheets']).slice(11, 15), [0, 0, 0, 0]);
  assert.deepStrictEqual(pack.encodeEvent(ev['Open Mic']).slice(11, 15), [0, 0, 0, 0]);
  // Older bundles (no `info` field) send four zeros.
  b.schedule.fields.pop();
  b.schedule.events.forEach(function(r) { r.pop(); });
  slice.buildEvents(b, {}, {}, 1, sail).forEach(function(e) {
    assert.deepStrictEqual(pack.encodeEvent(e).slice(11, 15), [0, 0, 0, 0]);
  });
});

test('arrive-early reminders fire before the arrive-by time, across midnight too (§8.1)', function() {
  var b = {
    ship: {code: 'HM'}, sailDate: '2027-03-06',
    itinerary: [{day: 1, date: '2027-03-06', type: 'EMBARK', port: 'Miami', depart: '16:00'},
                {day: 2, date: '2027-03-07', type: 'CRUISING', port: 'Cruising'},
                {day: 3, date: '2027-03-08', type: 'CRUISING', port: 'Cruising'}],
    schedule: {
      published: true, cats: [['Entertainment', 'Comedy']], venues: ['Comedy Live'], notes: [],
      infos: [[null, 15, []], [null, 20, []]],
      fields: ['title', 'venue', 'cat', 'date', 'time', 'minutes', 'featured', 'reservation', 'info'],
      events: [['Adult Comedy', 0, 0, '2027-03-07', '22:00', 60, 0, 0, 0],
               // Listed 00:10 on the 7th = just after midnight that night.
               ['Late Jazz', 0, 0, '2027-03-07', '00:10', 45, 0, 0, 1],
               ['Open Mic', 0, 0, '2027-03-07', '20:00', 60, 0, 0, null]]
    }
  };
  var stars = {};
  b.schedule.events.forEach(function(r) { stars[slice.starKey(r[0], r[3], r[4], 'Comedy Live')] = true; });
  var settings = {reminderLead: 15,
                  personal: [{title: 'Dinner', venue: 'Main Dining', date: '2027-03-07', time: '18:00', minutes: 90}]};
  var day2 = 1440;
  var list = slice.buildAlarms(b, settings, stars, at('2027-03-07', 12, 0)).map(function(a) {
    return [a.title, a.at, a.ref, a.early || 0];
  });
  assert.deepStrictEqual(list, [
    ['Dinner', day2 + 17 * 60 + 45, day2 + 18 * 60, 0],
    ['Open Mic', day2 + 19 * 60 + 45, day2 + 20 * 60, 0],
    ['Adult Comedy', day2 + 21 * 60 + 30, day2 + 22 * 60, 15],  // arrive by 21:45
    ['Late Jazz', day2 + 23 * 60 + 35, 2 * 1440 + 10, 20]        // arrive by 23:50, before midnight
  ]);
  var jazz = slice.buildAlarms(b, settings, stars, at('2027-03-07', 12, 0))[3];
  assert.strictEqual(pack.encodeAlarm(jazz)[16], 20, 'the alarm carries the early byte');
  // Starred after its reminder time has passed: no reminder, even before the start.
  assert.ok(slice.buildAlarms(b, settings, stars, at('2027-03-07', 23, 40)).every(function(a) {
    return a.title !== 'Late Jazz';
  }));
});

test('age filters: which events each one matches (§12.4)', function() {
  assert.strictEqual(slice.ageMask(18, 0, 'Adult Comedy', 'Comedy Live'), 1);
  assert.strictEqual(slice.ageMask(21, 0, 'Wine Tasting', ''), 1);
  assert.strictEqual(slice.ageMask(18, 25, 'Hyperlink Mixer', ''), 1);
  assert.strictEqual(slice.ageMask(0, 17, 'Teen Hangout', ''), 2);
  assert.strictEqual(slice.ageMask(13, 17, 'Social100', ''), 2);
  assert.strictEqual(slice.ageMask(7, 0, 'Zip Line', ''), 0, 'a low minimum hides nothing');
  assert.strictEqual(slice.ageMask(null, undefined, 'Trivia', ''), 0);
  // Family: the 2026-10-01 titles, by title or by Adventure Ocean Theater.
  ['Family Movies', 'Family Bingo', 'Family Paper Plane Competition', 'Family SHUSH! Silent Party',
   'Family Mini Golf', 'family karaoke', 'All Ages Karaoke'].forEach(function(t) {
    assert.strictEqual(slice.ageMask(0, 0, t, 'On Air'), 4, t);
  });
  assert.strictEqual(slice.ageMask(0, 0, 'Blacklight Puppet Show', 'Adventure Ocean Theater'), 4);
  assert.strictEqual(slice.ageMask(0, 0, 'Perfect Day Farewell with our Entertainment Family', 'Studio B'), 0,
                     'the crew farewell');
  assert.strictEqual(slice.ageMask(0, 0, 'Familiar Tunes', ''), 0);
  assert.strictEqual(slice.ageMask(18, 0, 'Family Feud Live', ''), 5);

  assert.deepStrictEqual(slice.ageFilters({}), []);
  assert.deepStrictEqual(slice.cleanAgeFilters(['family', 'adult', 'x', 'adult', 3]), ['adult', 'family']);
  assert.deepStrictEqual(slice.cleanAgeFilters([]), []);
  assert.strictEqual(slice.cleanAgeFilters('adult'), null);
});

test('age filters hide events on the watch; starred, personal and no-age events stay', function() {
  var b = {
    ship: {code: 'HM'}, sailDate: '2027-03-06',
    itinerary: [{day: 1, date: '2027-03-06', type: 'EMBARK', port: 'Miami', depart: '16:00'},
                {day: 2, date: '2027-03-07', type: 'CRUISING', port: 'Cruising'},
                {day: 3, date: '2027-03-08', type: 'DEBARK', port: 'Miami', arrive: '06:00'}],
    schedule: {
      published: true, cats: [['Entertainment', 'Comedy'], ['Activities', '']],
      venues: ['Comedy Live', 'Studio B', 'Adventure Ocean', '', 'On Air'],
      venueCodes: [null, null, null, 'KIDSTHTER', null],
      infos: [[[18, null], null, []], [[13, 17], null, []], [[null, 17], null, []], [[7, null], null, []]],
      fields: ['title', 'venue', 'cat', 'date', 'time', 'minutes', 'featured', 'reservation', 'info'],
      events: [['Adult Comedy', 0, 0, '2027-03-07', '22:00', 60, 1, 0, 0],
               ['Teen Hangout', 1, 1, '2027-03-07', '20:00', 60, 0, 0, 1],
               ['Kids Crafts', 1, 1, '2027-03-07', '10:00', 60, 0, 0, 2],
               ['Zip Line', 1, 1, '2027-03-07', '11:00', 60, 0, 0, 3],
               ['Family Bingo', 1, 1, '2027-03-07', '14:00', 60, 0, 0, null],
               ['Puppet Show', 2, 1, '2027-03-07', '15:00', 30, 0, 0, null],   // an alias of the theater
               ['Movie Time', 3, 1, '2027-03-07', '16:00', 90, 0, 0, null],    // blank venue, KIDSTHTER code
               ['All Ages Karaoke', 4, 1, '2027-03-07', '17:00', 60, 0, 0, null],
               ['Perfect Day Farewell with our Entertainment Family', 1, 0, '2027-03-07', '18:00', 30, 0, 0, null],
               ['Open Mic', 0, 0, '2027-03-07', '21:00', 60, 0, 0, null]]
    }
  };
  var sail = slice.daysFromIso(b.sailDate);
  function titles(settings, stars) {
    return slice.buildEvents(b, settings, stars || {}, 1, sail).map(function(e) { return e.title; });
  }
  var all = titles({});
  assert.strictEqual(all.length, 10, 'all off by default');
  var farewell = 'Perfect Day Farewell with our Entertainment Family';
  assert.deepStrictEqual(titles({ageFilters: ['adult']}).indexOf('Adult Comedy'), -1);
  assert.deepStrictEqual(titles({ageFilters: ['young']}),
    all.filter(function(t) { return t !== 'Teen Hangout' && t !== 'Kids Crafts'; }));
  assert.deepStrictEqual(titles({ageFilters: ['family']}),
    ['Kids Crafts', 'Zip Line', farewell, 'Teen Hangout', 'Open Mic', 'Adult Comedy']);
  assert.deepStrictEqual(titles({ageFilters: ['adult', 'young', 'family']}),
    ['Zip Line', farewell, 'Open Mic']);

  // A starred event always goes, and so does a personal entry with a family title.
  var stars = {};
  stars[slice.starKey('Teen Hangout', '2027-03-07', '20:00', 'Studio B')] = true;
  var settings = {ageFilters: ['young', 'family'],
                  personal: [{title: 'Family dinner', venue: '', date: '2027-03-07', time: '19:00', minutes: 60}]};
  var kept = titles(settings, stars);
  assert.ok(kept.indexOf('Teen Hangout') !== -1, 'starred');
  assert.ok(kept.indexOf('Family dinner') !== -1, 'personal');
  assert.strictEqual(kept.indexOf('Kids Crafts'), -1);

  // The morning summary counts what the watch gets: Adult Comedy is featured.
  assert.strictEqual(slice.buildTomorrow(b, {}, {}, 0, sail).featured, 1);
  assert.strictEqual(slice.buildTomorrow(b, {ageFilters: ['adult']}, {}, 0, sail).featured, 0);

  // Ready to sail: events an age filter could hide carry their bits.
  var day = slice.dayLoad(b, settings, stars)[1];
  assert.strictEqual(day.fixed, 2, 'the starred event and the personal entry');
  assert.deepStrictEqual(day.cats, [
    ['Activities', '', 1, 2], ['Activities', '', 1], ['Activities', '', 4, 4],
    ['Entertainment', 'Comedy', 2], ['Entertainment', 'Comedy', 1, 1]]);
});

test('demo: some events carry Phase 4 details', function() {
  var now = new Date(2027, 2, 7, 9, 0);
  [0, 1].forEach(function(v) {
    var d = demo.make(now, v);
    var evs = slice.buildEvents(d.bundle, d.settings, d.stars, 1, slice.daysFromIso(d.bundle.sailDate));
    assert.ok(evs.some(function(e) { return e.ageMin; }), 'an age, variant ' + v);
    assert.ok(evs.some(function(e) { return e.early; }), 'an arrive-by, variant ' + v);
    assert.ok(evs.some(function(e) { return e.tags; }), 'tags, variant ' + v);
  });
});

test('cutText keeps whole characters', function() {
  assert.strictEqual(pack.cutText('Broadway Nights', 8), 'Broadway');
  assert.strictEqual(pack.cutText('Café au lait', 4), 'Caf');
  assert.strictEqual(pack.cutText('Café', 5), 'Café');
  assert.strictEqual(pack.cutText('🎉 Party', 3), '');
  assert.strictEqual(pack.cutText(null, 5), '');
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
