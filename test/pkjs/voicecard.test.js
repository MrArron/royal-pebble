// Unit tests for voice cards (docs/WATCH_PROTOCOL.md, Voice). Run: node test/pkjs/voicecard.test.js
var assert = require('assert');
var voicecard = require('../../src/pkjs/voicecard');
var directory = require('../../src/pkjs/directory');
var demo = require('../../src/pkjs/demo');

var tests = [];
function test(name, fn) { tests.push({name: name, fn: fn}); }

var CTX = {bundle: {ship: {code: 'HM', name: 'Harmony of the Seas'}}, settings: {}, stars: {}, now: new Date()};

// Reads a packed card back the way ask_window.c does.
function unpack(b) {
  var p = 7;
  function str() { var n = b[p]; var s = Buffer.from(b.slice(p + 1, p + 1 + n)).toString('utf8'); p += 1 + n; return s; }
  var card = {action: b[0], flags: b[1], ref: b[2] | (b[3] << 8) | (b[4] << 16) | (b[5] << 24), rows: []};
  for (var i = 0; i < b[6]; i++) {
    card.rows.push({label: str(), value: str()});
  }
  card.hint = str();
  if (card.action === voicecard.ACT_ROUTE) {
    card.title = str();
    card.header = str();
  }
  assert.strictEqual(p, b.length, 'no bytes left over');
  return card;
}

test('packs a route card and reads back', function() {
  var bytes = voicecard.packCard({action: voicecard.ACT_ROUTE, rest: true, ref: 1234,
                                  rows: [{label: 'HEARD', value: 'x'}, {label: 'TO', value: 'Restroom'}],
                                  hint: 'Select: route', title: 'Restroom', header: 'CLOSEST TO X'});
  var c = unpack(bytes);
  assert.strictEqual(c.flags, voicecard.FLAG_REST);
  assert.strictEqual(c.ref, 1234);
  assert.deepStrictEqual(c.rows[1], {label: 'TO', value: 'Restroom'});
  assert.strictEqual(c.header, 'CLOSEST TO X');
});

test('cuts long texts to the watch buffers and at most 4 rows', function() {
  var long = new Array(200).join('é');  // 2 bytes each
  var rows = [1, 2, 3, 4, 5].map(function(i) { return {label: 'LABEL NUMBER ' + i + ' TOO LONG', value: long}; });
  var c = unpack(voicecard.packCard({action: voicecard.ACT_NONE, rows: rows, hint: long}));
  assert.strictEqual(c.rows.length, 4);
  assert.ok(Buffer.byteLength(c.rows[0].value) <= 63);
  assert.ok(Buffer.byteLength(c.rows[0].label) <= 15);
  assert.ok(Buffer.byteLength(c.hint) <= 47);
  assert.strictEqual(c.rows[0].value.indexOf('�'), -1, 'cut between characters');
});

test('no cruise: matched places have nothing to route from', function() {
  var theater = voicecard.placeRef('Royal Theater', CTX);
  assert.ok(theater >= directory.REF_PLACE);
  var c = voicecard.answer('how do I get to the Royal Theater', CTX, false);
  assert.strictEqual(c.action, voicecard.ACT_NONE);
  assert.strictEqual(c.rows[1].value, 'Royal Theater');
  assert.strictEqual(c.rows[2].value, 'No cruise on the phone yet');
  assert.strictEqual(voicecard.answer('play some music', CTX, true).rows[1].value, 'Not something I know');
});

test('on board and ashore phrases', function() {
  var yes = ["I'm on board", "i' m back on board", 'we are back on the ship', "we're aboard", 'back on board',
             "I'm onboard now", 'im on board'];
  var no = ["I'm ashore", 'going ashore', "I'm off the ship", 'leaving the ship', "we're back ashore"];
  var neither = ['when is all aboard', 'what time is all aboard', "I'm at the solarium", 'how do I get to the pool',
                 'where do I board the tender', 'the swim on board ship'];
  yes.forEach(function(t) { assert.strictEqual(voicecard.onboardIntent(t.toLowerCase()), true, t); });
  no.concat(["I'm sure.", 'i m sure']).forEach(function(t) {
    assert.strictEqual(voicecard.onboardIntent(t.toLowerCase()), false, t);
  });
  assert.strictEqual(voicecard.onboardIntent("i'm sure it's at seven"), null, 'only on its own');
  neither.forEach(function(t) { assert.strictEqual(voicecard.onboardIntent(t.toLowerCase()), null, t); });
});

test('on board cards follow the day and the watch flag', function() {
  var now = new Date(2027, 2, 8, 13, 0);
  var port = demo.make(now, 0);
  var sea = demo.make(now, 1);
  function ctx(d) { return {bundle: d.bundle, settings: d.settings, stars: d.stars, now: now}; }
  // Port day, flag clear: "I'm on board" sets it, from real data too.
  var set = voicecard.answer("I'm on board", ctx(port), false, 0);
  assert.strictEqual(set.action, voicecard.ACT_ONBOARD);
  assert.ok(set.onboard);
  var c = unpack(voicecard.packCard(set));
  assert.strictEqual(c.flags, voicecard.FLAG_ONBOARD);
  // Already set: nothing to do.
  assert.strictEqual(voicecard.answer("I'm on board", ctx(port), false, voicecard.STATE_ONBOARD).action,
                     voicecard.ACT_NONE);
  // Ashore clears it only when set.
  var clear = voicecard.answer("I'm back ashore", ctx(port), false, voicecard.STATE_ONBOARD);
  assert.strictEqual(clear.action, voicecard.ACT_ONBOARD);
  assert.strictEqual(unpack(voicecard.packCard(clear)).flags, 0);
  assert.strictEqual(voicecard.answer('going ashore', ctx(port), false, 0).action, voicecard.ACT_NONE);
  // Sea day: nothing to change.
  var atSea = voicecard.answer("I'm on board", ctx(sea), false, 0);
  assert.strictEqual(atSea.action, voicecard.ACT_NONE);
  assert.strictEqual(atSea.rows[1].value, 'At sea today');
});

test('clock follows the watch style', function() {
  assert.strictEqual(voicecard.clock(17 * 60, 0), '5:00p');
  assert.strictEqual(voicecard.clock(1440 + 30, 0), '12:30a');
  assert.strictEqual(voicecard.clock(12 * 60 + 5, 0), '12:05p');
  assert.strictEqual(voicecard.clock(17 * 60, voicecard.STATE_24H), '17:00');
});

test('departure, tomorrow and muster cards', function() {
  var now = new Date(2027, 2, 8, 13, 0);
  var port = demo.make(now, 0);
  var sea = demo.make(now, 1);
  function ctx(d) { return {bundle: d.bundle, settings: d.settings, stars: d.stars, now: now}; }
  var leave = voicecard.answer('When do we leave?', ctx(port), false, 0);
  assert.deepStrictEqual(leave.rows.map(function(r) { return r.label; }), ['HEARD', 'TODAY', 'DEPARTS', 'ALL ABOARD']);
  assert.ok(/[ap]$/.test(leave.rows[2].value));
  assert.ok(/:/.test(voicecard.answer('what time does the ship sail', ctx(port), false, 0).rows[2].value));
  assert.strictEqual(voicecard.answer('when do we leave', ctx(sea), false, 0).rows[1].value, 'At sea today');
  var tmr = voicecard.answer("where are we tomorrow", ctx(sea), false, voicecard.STATE_24H);
  assert.strictEqual(tmr.rows[1].label, 'TOMORROW');
  assert.ok(!/[ap]$/.test(tmr.rows[2].value), '24-hour');
  // Muster: a place name in it gives a route; a bare code doesn't.
  var m = voicecard.answer("where's my muster station", ctx(port), false, 0);
  assert.strictEqual(m.rows[1].label, 'MUSTER STATION');
  var c = ctx(port);
  c.settings = JSON.parse(JSON.stringify(c.settings));
  c.settings.me.muster = 'B4';
  c.settings.me.src = {muster: 'edited'};
  var bare = voicecard.answer('take me to my mustard station', c, false, 0);
  assert.strictEqual(bare.action, voicecard.ACT_NONE);
  assert.strictEqual(bare.rows[1].value, 'B4');
  c.settings.me.muster = 'A2 Royal Theater';
  var routed = voicecard.answer('muster station', c, false, 0);
  assert.strictEqual(routed.action, voicecard.ACT_ROUTE);
  assert.strictEqual(routed.ref, voicecard.placeRef('Royal Theater', c));
  unpack(voicecard.packCard(routed));
});

test('take me to my cabin', function() {
  var now = new Date(2027, 2, 8, 13, 0);
  var port = demo.make(now, 0);
  var c = {bundle: port.bundle, settings: port.settings, stars: port.stars, now: now};
  ['take me to my cabin', 'take me back to my room', 'how do I get back to my stateroom'].forEach(function(t) {
    var card = voicecard.answer(t, c, false, 0);
    assert.strictEqual(card.rows[1].value, 'Your cabin', t);
  });
  // With no starred event on now, the route would start at the cabin itself.
  assert.strictEqual(voicecard.answer('take me to my cabin', c, false, 0).action, voicecard.ACT_NONE);
  // During a starred show (the demo sea day's 14:00 at Studio B), it routes from there.
  var sea = demo.make(now, 1);
  var during = {bundle: sea.bundle, settings: sea.settings, stars: sea.stars, now: new Date(2027, 2, 8, 14, 0)};
  var route = voicecard.answer('take me to my cabin', during, false, 0);
  assert.strictEqual(route.action, voicecard.ACT_ROUTE);
  assert.strictEqual(route.ref, directory.REF_CABIN);
  assert.strictEqual(route.rows[1].value, 'Studio B');
  var page = directory.routePage(directory.REF_CABIN, false, during);
  assert.ok(page.steps.length > 1);
  assert.strictEqual(page.steps[page.steps.length - 1].glyph, 4, 'ends with the arrival');
  // "my cabin to the theater" isn't a cabin route.
  var theater = voicecard.answer('from my cabin to the theater', c, false, 0);
  assert.strictEqual(theater.rows[theater.rows.length - 1].value, 'Royal Theater');
});

test('nearest bathroom routes from where you are', function() {
  var sea = demo.make(new Date(2027, 2, 8, 13, 0), 1);
  var c = {bundle: sea.bundle, settings: sea.settings, stars: sea.stars, now: new Date(2027, 2, 8, 14, 0)};
  ['nearest bathroom', 'where is the closest restroom', 'I need a toilet'].forEach(function(t) {
    var card = voicecard.answer(t, c, false, 0);
    assert.strictEqual(card.action, voicecard.ACT_ROUTE, t);
    assert.strictEqual(card.ref, directory.REF_REST_HERE);
    assert.strictEqual(card.rows[1].value, 'Studio B', 'from the starred show on now');
  });
  unpack(voicecard.packCard(voicecard.answer('nearest bathroom', c, false, 0)));
  var page = directory.routePage(directory.REF_REST_HERE, false, c);
  assert.strictEqual(page.header, 'CLOSEST TO STUDIO B');
  assert.strictEqual(page.steps[page.steps.length - 1].glyph, 4);
  // With nothing on, from the cabin.
  c.now = new Date(2027, 2, 8, 11, 0);
  var home = directory.routePage(directory.REF_REST_HERE, false, c);
  assert.strictEqual(home.header, 'CLOSEST TO YOUR CABIN');
  assert.ok(/your cabin$/.test(home.small.text) || home.small.text === '', home.small.text);
  assert.strictEqual(voicecard.answer('nearest bathroom', c, false, 0).rows[1].value, 'Your cabin');
});

// Phase 5 V3: the voice matcher behind the fixed commands. The demo sea day at
// 13:00 has nothing starred on, so routes start at the (demo) stateroom; at 14:00
// the starred show at Studio B is on. Cabin 8200 is a made-up number on the plans.
function seaCtx(hour) {
  var sea = demo.make(new Date(2027, 2, 8, 13, 0), 1);
  return {bundle: sea.bundle, settings: sea.settings, stars: sea.stars, now: new Date(2027, 2, 8, hour, 0)};
}

// Transcript -> {action, ref (a number, or a place / bank name), rows: [label:value, ...] after HEARD,
// hint (a prefix), log (a prefix), rest}.
var TABLE = [
  // Fixed commands keep precedence (and the matcher's own CLOSEST_RESTROOM / @mycabin answers match them).
  ['nearest bathroom', {action: 1, ref: directory.REF_REST_HERE, rows: ['FROM:Your cabin', 'TO:Closest restroom'], log: 'fixed restroom'}],
  ['take me to my cabin', {action: 0, rows: ['TO:Your cabin'], log: 'fixed my cabin'}],
  ["I'm on board", {log: 'fixed on board'}],
  ['when do we leave', {log: 'fixed departure'}],
  // "Restroom near the theater": the restroom route from that place page.
  ['restroom near the theater', {action: 1, ref: 'Royal Theater', rest: true, rows: ['FROM:Royal Theater', 'TO:Closest restroom'],
                                 log: 'fixed restroom from A=Royal Theater'}],
  // D15: "closest restaurant" means restroom.
  ['closest restaurant', {action: 1, ref: directory.REF_REST_HERE, rows: ['FROM:Your cabin', 'TO:Closest restroom'], log: 'CLOSEST_RESTROOM'}],
  // D1, D2: routes to a venue; a bare place only on an exact match.
  ['how do I get to the windjammer', {action: 1, ref: 'Windjammer Marketplace', rows: ['FROM:Your cabin', 'TO:Windjammer Marketplace'],
                                      hint: 'Select: route', log: 'ROUTE B=Windjammer Marketplace (exact)'}],
  ['where is the wind jam', {action: 1, ref: 'Windjammer Marketplace', log: 'ROUTE B=Windjammer Marketplace'}],
  ['Solarium', {action: 1, ref: 'Solarium', rows: ['FROM:Your cabin', 'TO:Solarium']}],
  ['Solarim', {action: 0, rows: ['Not something I know', 'TRY:“Closest restroom”'], log: 'NO_MATCH no_command'}],
  // D3: generic names; the dining room is yours (Me tab), a group the nearest member (D12).
  ['where is the pool', {action: 1, ref: 'Pool Deck'}],
  ['where is the theater', {action: 1, ref: 'Royal Theater'}],
  ['take me to the dining room', {action: 1, ref: 'Main Dining Room 4', rows: ['FROM:Your cabin', 'TO:Main Dining Room 4 (yours)']}],
  ['where is the arcade', {action: 1, rows: ['FROM:Your cabin', /^TO:(Arcade|Video Arcade) \(nearest\)$/]}],
  // D5: elevators go to the nearest bank; stairs and decks aren't one spot.
  ['take me to the elevator', {action: 1, rows: ['FROM:Your cabin', /^TO:(Fore|Aft) elevators \(nearest\)$/]}],
  ['how do I get to the fore elevators', {action: 1, ref: 'Fore elevators', rows: ['FROM:Your cabin', 'TO:Fore elevators']}],
  ['take me to the stairs on deck 5', {action: 0, rows: ['Stairs are in many spots', /^TRY:/], hint: 'Say a place on Deck 5'}],
  ['take me to deck 15', {action: 0, rows: ['A deck is not one spot', /^TRY:“How do I get to .+\?”$/], hint: 'Say a place on Deck 15'}],
  // D19, D20, D21.
  ['where can I get a drink', {action: 1, rows: ['FROM:Your cabin', /^CLOSEST BAR:/], log: 'CLOSEST_BAR'}],
  ['I need coffee', {action: 1, rows: ['FROM:Your cabin', /^CLOSEST COFFEE:(Starbucks|Cafe Promenade|Park Cafe)$/], log: 'CLOSEST_COFFEE'}],
  ["I'm hungry", {action: 1, ref: 'Cafe Promenade', rows: ['FROM:Your cabin', 'TO:Cafe Promenade', 'Open 24 hours'], log: 'ROUTE via snack'}],
  // D6: take me back is your cabin (from the cabin: nothing to walk).
  ['take me back', {action: 0, rows: ['TO:Your cabin'], log: 'ROUTE B=@mycabin'}],
  // Cabins: on the plans (D13), too short, the stateroom; spoken ones only in the ref (D11).
  ['how do I get to cabin 8200', {action: 1, ref: directory.REF_TO_CABIN + 8200, rows: ['FROM:Your cabin', 'TO:Cabin 8200']}],
  ['how do I get to cabin 1234', {action: 0, rows: ['No cabin 1234 on Harmony']}],
  ['how do I get to cabin 892', {action: 0, rows: ['TO:Cabin 892', 'Say all 4 or 5 digits']}],
  ['my cabin is 8200', {action: 0, rows: ['Set your stateroom on the phone'], hint: 'Me tab'}],
  // Ashore (flag A), not on the map yet (flag N, D14), same place.
  ['how do I get to cococay', {action: 0, rows: ['CocoCay is ashore'], hint: 'No ship route'}],
  ['take me to the hot tub', {action: 0, rows: ['TO:Hot tub', 'Not on the map yet'], log: 'NO_MATCH not_mapped'}],
  ['solarium to the solarium', {action: 0, rows: ["You're already there"]}],
  // A spoken start isn't used yet (V3b): the route starts where routes start now and says so.
  ['from the solarium to the windjammer', {action: 1, ref: 'Windjammer Marketplace', rows: ['FROM:Your cabin', 'TO:Windjammer Marketplace'],
                                           hint: 'Starts where you are now', log: 'ROUTE A=Solarium (exact) B=Windjammer Marketplace (exact)'}],
  ["I'm at the solarium. How do I get to the windjammer", {action: 1, ref: 'Windjammer Marketplace', log: 'ROUTE_COMBINED'}],
  ["I'm at the solarium", {action: 0, rows: ["YOU'RE AT:Solarium", 'Not yet'], log: 'SET_LOCATION A=Solarium'}],
  // Refused locations.
  ["I'm at the bar", {action: 0, rows: ['There are many bars', /^TRY:/]}],
  ["I'm by the elevators", {action: 0, rows: ['Elevators stop on many decks', /^TRY:/]}],
  ["I'm at the arcade", {action: 0, rows: ['Which one?', 'Arcade or Video Arcade']}],
  ["I'm at cococay", {action: 0, rows: ['CocoCay is ashore']}],
  // Out of scope, incomplete, no match (D17: the library isn't on Harmony).
  ["what's next", {action: 0, rows: [/^NOT YET:Voice can't read the schedule/, /^TRY:/]}],
  ['when does the windjammer open', {action: 0, rows: [/^NOT YET:Opening times/, 'TRY:“Where is the Windjammer?”']}],
  ['how do I get to', {action: 0, rows: ['Which place?', /^TRY:/], log: 'INCOMPLETE'}],
  ['How do I get to the library?', {action: 0, rows: ['No place matched', 'TRY:“How do I get to the Windjammer?”'],
                                    log: 'NO_MATCH no_place B=library'}],
  ['uh', {action: 0, rows: ['Nothing heard']}]
];

test('voice matcher cards (table)', function() {
  var c = seaCtx(13);
  TABLE.forEach(function(row) {
    var t = row[0], want = row[1];
    var card = voicecard.answer(t, c, false, 0);
    var got = card.rows.slice(1).map(function(r) { return (r.label ? r.label + ':' : '') + r.value; });
    assert.strictEqual(card.rows[0].value, '“' + t + '”', t);
    if (want.action !== undefined) {
      assert.strictEqual(card.action, want.action, t + ': action ' + card.action + ' ' + JSON.stringify(got));
    }
    if (want.ref !== undefined) {
      var ref = typeof want.ref === 'number' ? want.ref : directory.refOf(want.ref, c);
      assert.ok(ref > 0, t + ': ' + want.ref);
      assert.strictEqual(card.ref, ref, t + ': ref ' + card.ref);
    }
    assert.strictEqual(!!card.rest, !!want.rest, t + ': rest');
    (want.rows || []).forEach(function(w, i) {
      assert.ok(w instanceof RegExp ? w.test(got[i]) : got[i] === w, t + ': row ' + (i + 1) + ' ' + JSON.stringify(got));
    });
    if (want.hint) {
      assert.strictEqual(card.hint.indexOf(want.hint), 0, t + ': hint ' + card.hint);
    }
    if (want.log) {
      assert.strictEqual(card.log.indexOf(want.log), 0, t + ': log ' + card.log);
    }
    // Every card fits the watch's buffers.
    var back = unpack(voicecard.packCard(card));
    assert.ok(back.rows.length <= 4);
    back.rows.slice(1).forEach(function(r, i) { assert.strictEqual(r.value, card.rows[i + 1].value, t + ': cut'); });
    assert.strictEqual(back.hint, card.hint, t + ': hint cut');
    if (card.action === voicecard.ACT_ROUTE) {
      // Select opens a Route screen the phone can answer.
      var page = directory.routePage(card.ref, !!card.rest, c);
      assert.ok(page.steps.length > 0, t + ': route ' + page.lead);
      assert.strictEqual(page.steps[page.steps.length - 1].glyph, 4, t + ': ends with the arrival');
      assert.strictEqual(back.title, card.title, t + ': title cut');
    }
  });
});

test('voice: nearest from the current start, and your stateroom', function() {
  var c = seaCtx(14);  // the starred show at Studio B is on
  var route = voicecard.answer('how do I get to the windjammer', c, false, 0);
  assert.strictEqual(route.rows[1].value, 'Studio B');
  var room = c.settings.me.stateroom;
  var mine = voicecard.answer('take me to cabin ' + room, c, false, 0);
  assert.strictEqual(mine.ref, directory.REF_CABIN, 'your own number is your cabin');
  // The nearest member of a group is the planner's choice from the start.
  var n = directory.nearestRef(directory.bankRefs(c), c);
  var card = voicecard.answer('take me to the elevator', c, false, 0);
  assert.strictEqual(card.ref, n.ref);
  // No stateroom and nothing on: nowhere to start.
  var none = seaCtx(13);
  none.settings = JSON.parse(JSON.stringify(none.settings));
  none.settings.me.stateroom = '';
  none.bundle = JSON.parse(JSON.stringify(none.bundle));
  (none.bundle.mine || {}).stateroom = '';
  var where = voicecard.answer('how do I get to the windjammer', none, false, 0);
  assert.strictEqual(where.action, voicecard.ACT_NONE);
  assert.strictEqual(where.rows[2].value, 'Where are you?');
  // A spoken cabin route: only the ref carries the number.
  var page = directory.routePage(directory.REF_TO_CABIN + 8200, false, c);
  assert.strictEqual(page.title, 'Cabin 8200');
  assert.strictEqual(directory.routePage(directory.REF_TO_CABIN + 8200, true, c).title, 'Not found', 'no restroom route');
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
if (failed) {
  process.exit(1);
}
console.log('All ' + tests.length + ' voice card tests passed.');
