// Scenarios run by probe.js in Node (real require) and inside QuickJS (bundled).
// Each returns a JSON string, so the two engines are compared byte for byte.
// Engine-neutral on purpose: no Node APIs, ES5 like src/pkjs. Dates come from fixed
// epoch values and the probe pins TZ=UTC, since src/pkjs reads local time.
var slice = require('../../src/pkjs/slice');
var pack = require('../../src/pkjs/pack');
var demo = require('../../src/pkjs/demo');
var directory = require('../../src/pkjs/directory');
var voice = require('../../src/pkjs/voice');
var voicecard = require('../../src/pkjs/voicecard');
var schedule = require('../../test/fixtures/expected-schedule.json');
var corpus = require('../../test/fixtures/voice-corpus-HM.json');

// A saved sailing: Royal's public Harmony schedule (test/fixtures) on a made-up
// 3-night itinerary. No personal data.
function fixtureBundle() {
  return {
    format: 'cruise-watch', v: 1, generated: '2026-09-30T12:00:00Z',
    ship: {code: 'HM', name: 'Harmony of the Seas'},
    sailDate: '2026-09-30',
    itinerary: [
      {day: 1, date: '2026-09-30', port: 'Orlando (Port Canaveral), Fl', type: 'EMBARK', arrive: null, depart: '16:00'},
      {day: 2, date: '2026-10-01', port: 'Cruising', type: 'CRUISING', arrive: null, depart: null},
      {day: 3, date: '2026-10-02', port: 'Nassau, Bahamas', type: 'DOCKED', arrive: '08:00', depart: '17:00'},
      {day: 4, date: '2026-10-03', port: 'Orlando (Port Canaveral), Fl', type: 'DEBARK', arrive: '06:00', depart: null}
    ],
    schedule: schedule
  };
}

function when(iso, hh, mm) {
  var p = iso.split('-');
  return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], hh, mm));
}

function packed(sl) {
  return {
    slice: sl,
    events: pack.packEvents(sl.events, 1500),
    alarms: pack.packAlarms(sl.alarms, 1500)
  };
}

function sliceFixture(day, hh, mm, withStars) {
  var b = fixtureBundle();
  var stars = {};
  if (withStars) {
    b.schedule.events.slice(0, 12).forEach(function(e) {
      stars[slice.starKey(e[0], e[3], e[4], b.schedule.venues[e[1]])] = 1;
    });
  }
  var settings = withStars ? {reminderLead: 30, theme: 'dark', me: {muster: 'C', dining: 'Main'}} : {};
  return JSON.stringify(packed(slice.buildSlice(b, settings, stars, when(day, hh, mm), null)));
}

function sliceDemo(variant) {
  var now = when('2027-03-07', 14, 5);
  var d = demo.make(now, variant);
  return JSON.stringify(packed(slice.buildSlice(d.bundle, d.settings, d.stars, now, null)));
}

function notices() {
  var changes = [
    {kind: 'moved', date: '2026-10-01', time: '10:00', title: 'Trivia', venue: 'Boleros', to: {date: '2026-10-01', time: '11:30', venue: 'Studio B'}},
    {kind: 'cancelled', date: '2026-10-02', time: '20:00', title: 'Café Show – Late', venue: 'Royal Theater'},
    {kind: 'check', date: '2026-10-02', time: '21:15', title: 'Comedy Live', venue: 'Comedy Live'}
  ];
  return JSON.stringify(pack.packNotices(slice.buildNotices('2026-09-30', changes)));
}

function directoryPages() {
  var now = when('2027-03-07', 14, 5);
  var d = demo.make(now, 0);
  var ctx = {bundle: d.bundle, settings: d.settings, stars: d.stars, now: now};
  var refs = [directory.REF_DECKS, directory.REF_AREAS, directory.REF_ELEVATORS];
  for (var k = 2; k <= 15; k++) { refs.push(directory.REF_DECK + k); }
  directory.AREA_KEYS.forEach(function(a, i) { refs.push(directory.REF_AREA + i); });
  for (var p = 0; p < 40; p++) { refs.push(directory.REF_PLACE + p); }
  return JSON.stringify(refs.map(function(r) {
    var pg = directory.buildPage(r, ctx);
    return [r, pg, directory.packRows(pg.rows || [], directory.PAGE_MAX_BYTES)];
  }));
}

function voiceCards() {
  var now = when('2027-03-07', 14, 5);
  var d = demo.make(now, 0);
  var ctx = {bundle: d.bundle, settings: d.settings, stars: d.stars, now: now};
  var phrases = ['how do I get to the theater', 'where is the closest restroom', 'when is all aboard',
                 "I'm on board", 'take me to my cabin', 'where is the solarium', 'what time is the next show',
                 'how do I get to Johnny Rockets from the pool', 'find the casino', 'blah blah'];
  return JSON.stringify(phrases.map(function(t) {
    var c = voicecard.answer(t, ctx, true, 0, 'emery');
    return [t, c, voicecard.packCard(c)];
  }));
}

function voiceParse() {
  var items = corpus.slice ? corpus : (corpus.cases || corpus.items || []);
  var out = [];
  for (var i = 0; i < items.length && i < 400; i++) {
    var text = typeof items[i] === 'string' ? items[i] : (items[i].text || items[i].heard || items[i][0]);
    out.push([text, voice.parse(text, {ship: 'HM'})]);
  }
  return JSON.stringify(out);
}

var SCENARIOS = {
  'slice fixture, day 1 18:30': function() { return sliceFixture('2026-09-30', 18, 30, false); },
  'slice fixture, sea day 10:00': function() { return sliceFixture('2026-10-01', 10, 0, false); },
  'slice fixture, sea day 00:30 (night)': function() { return sliceFixture('2026-10-02', 0, 30, true); },
  'slice fixture, port day, stars': function() { return sliceFixture('2026-10-02', 9, 15, true); },
  'slice demo variants 0-4 + pack': function() {
    return [0, 1, 2, 3, 4].map(sliceDemo).join('|');
  },
  'pack notices (moved/cancelled/check, UTF-8)': notices,
  'directory pages (decks, areas, places) + packRows': directoryPages,
  'voice cards (answer + packCard)': voiceCards,
  'voice parse over corpus (400 phrases)': voiceParse
};

function run(name) {
  if (name === '*list') { return JSON.stringify(Object.keys(SCENARIOS)); }
  return SCENARIOS[name]();
}

module.exports = {run: run};
