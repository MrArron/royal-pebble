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

  assert.deepStrictEqual(slice.categorySummary(b), [
    {name: 'Entertainment', n: 3, subs: [{name: '', n: 1}, {name: 'Shows', n: 2}]},
    {name: 'Shop', n: 1, subs: [{name: 'Retail', n: 1}]}
  ]);
  assert.deepStrictEqual(slice.hiddenCats({}), ['Shop']);
  assert.deepStrictEqual(slice.hiddenCats({hiddenCats: []}), []);
  assert.deepStrictEqual(slice.cleanHiddenCats(['Shop', 'Shop', 7, '', 'Spa / Salon']), ['Shop', 'Spa / Salon']);
  assert.strictEqual(slice.cleanHiddenCats('Shop'), null);
});

test('packing round-trips and respects chunk size', function() {
  var events = [];
  for (var i = 0; i < 90; i++) {
    events.push({title: 'Event number ' + i + ' with a fairly long title for testing', venue: 'Royal Promenade',
                 start: i < 2 ? -1 : 1440 + i * 10, minutes: 45, flags: i % 16,
                 where: {deck: i % 18, deckTo: 0, pos: 2, ashore: false, rel: null}});
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
      var tl = b[p + 11];
      var title = String.fromCharCode.apply(null, b.slice(p + 12, p + 12 + tl));
      var vl = b[p + 12 + tl];
      p += 13 + tl + vl;
      decoded.push({start: start, minutes: minutes, flags: flags, deck: deck, title: title});
    }
  });
  assert.strictEqual(decoded.length, 90);
  assert.strictEqual(decoded[0].start, -1);
  assert.strictEqual(decoded[50].start, 1440 + 500);
  assert.strictEqual(decoded[50].title, events[50].title);
  assert.strictEqual(decoded[15].flags, 15);
  assert.strictEqual(decoded[17].deck, 17);
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
      assert.strictEqual(s.dayIndex, 1, 'demo today is cruise day 2 at ' + hm);
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
  var settings = {reminderLead: 30, days: {'2027-03-08': {offset: 60}},
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
  // 60 and 30 min warnings (23:15, 23:45) have passed; 15 min (00:00) is left.
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
    [slice.ALARM_REMINDER, 2, 17, 'Test reminder'],
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
  assert.deepStrictEqual(bytes, [0xB8, 0x0B, 0, 0, 0xFE, 0xFF, 0xFF, 0xFF, 0xC4, 0xFF, 1, 0, 0, 0, 0, 0,
                                 3, 73, 99, 101, 1, 66, 0]);
  bytes = pack.encodeAlarm({at: 1, ref: 1, kind: 1, title: '', venue: '', from: venues.FROM_ROUTE,
                            fromPos: 1, fromVenue: 'Royal Theater',
                            where: {deck: 4, deckTo: 0, pos: 2, ashore: false, rel: -2}});
  assert.strictEqual(bytes[11], 1 | (venues.FROM_ROUTE << 2));
  assert.deepStrictEqual(bytes.slice(12, 16), [4, 0, 2 | 8, 0xFE]);
  assert.deepStrictEqual(bytes.slice(18), [13].concat(pack.utf8('Royal Theater', 99)));
  // Alerts keep 31 bytes of the title and 17 of each venue name, cut between characters.
  var long = pack.encodeAlarm({at: 1, ref: 1, kind: 1, title: new Array(41).join('x'),
                               venue: 'Boardwalk Dog House', fromVenue: new Array(17).join('y') + String.fromCharCode(233)});
  assert.strictEqual(long[16], 31);
  assert.strictEqual(long[16 + 1 + 31], 17);
  assert.strictEqual(long[16 + 1 + 31 + 1 + 17], 16, 'the two-byte letter is not split');
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
    assert.strictEqual(t.location, 'Nassau');
    assert.strictEqual(t.first, 'Sunrise Pilates');
    assert.deepStrictEqual([t.last, t.lastKind],
                           ['Mamma Mia!', v % 2 === 1 ? slice.FINAL_LAST_CHANCE : slice.FINAL_ONLY_SHOW]);
  }
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
