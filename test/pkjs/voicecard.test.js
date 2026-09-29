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

function withFrom(c, place) {
  var out = {};
  Object.keys(c).forEach(function(k) { out[k] = c[k]; });
  out.from = place;
  return out;
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
  // A start said in the question (1.5.9): that route starts there; "I'm at X, ..." also sets it on Select (D4).
  ['from the solarium to the windjammer', {action: 1, ref: 'Windjammer Marketplace', rows: ['FROM:Solarium', 'TO:Windjammer Marketplace'],
                                           hint: 'Select: route', start: 'Solarium', log: 'ROUTE A=Solarium (exact) B=Windjammer Marketplace (exact)'}],
  ["I'm at the solarium. How do I get to the windjammer", {action: 1, ref: 'Windjammer Marketplace', rows: ['FROM:Solarium', 'TO:Windjammer Marketplace'],
                                                          hint: 'Select: route, and routes start there', start: 'Solarium', set: true, log: 'ROUTE_COMBINED'}],
  ['from cabin 8200 to the solarium', {action: 1, ref: 'Solarium', rows: ['FROM:Cabin 8200', 'TO:Solarium'], start: 'Cabin 8200'}],
  ['from the solarium to my cabin', {action: 1, ref: directory.REF_CABIN, rows: ['FROM:Solarium', 'TO:Your cabin'], start: 'Solarium'}],
  ["I'm at the solarium. Where is the closest bar", {action: 1, rows: ['FROM:Solarium', /^CLOSEST BAR:/], start: 'Solarium', set: true}],
  ["I'm at the solarium, where is the nearest bathroom", {action: 1, ref: 'Solarium', rest: true, rows: ['FROM:Solarium', 'TO:Closest restroom'],
                                                          start: 'Solarium', set: true}],
  ['from the arcade to the solarium', {action: 0, rows: ['Which one?', 'Arcade or Video Arcade']}],
  // "I'm at X": YOU'RE AT, Select sets it (confirm). One-spot big venues are fine (D8).
  ["I'm at the solarium", {action: 2, rows: ["YOU'RE AT:Solarium", 'Routes start here for 90 min'], hint: 'Select: set',
                           start: 'Solarium', set: true, log: 'SET_LOCATION A=Solarium'}],
  ["I'm at the promenade", {action: 2, rows: ["YOU'RE AT:Royal Promenade"], set: true}],
  ["I'm on the boardwalk", {action: 2, rows: ["YOU'RE AT:Boardwalk"], set: true}],
  ["I'm in central park", {action: 2, rows: ["YOU'RE AT:Central Park"], set: true}],
  ["I'm at the pool deck", {action: 2, rows: ["YOU'RE AT:Pool Deck"], set: true}],
  ["I'm in cabin 8200", {action: 2, rows: ["YOU'RE AT:Cabin 8200"], start: 'Cabin 8200', set: true}],
  ["I'm at my cabin", {action: 2, rows: ["YOU'RE AT:Your cabin"], set: true}],
  ["I'm in cabin 1234", {action: 0, rows: ['No cabin 1234 on Harmony']}],
  ["I'm in cabin 820", {action: 0, rows: ["YOU'RE AT:Cabin 820", 'Say all 4 or 5 digits']}],
  // Refused locations: D8 (Running Track), D7 (elevators, even on a deck), D12 (groups), D19 (the bar).
  ["I'm at the running track", {action: 0, rows: ['Running Track is in many spots', /^TRY:/]}],
  ["I'm at the forward elevators on deck 5", {action: 0, rows: ['Elevators stop on many decks', /^TRY:/]}],
  ["I'm at the bar", {action: 0, rows: ['There are many bars', /^TRY:/]}],
  ["I'm at the restroom", {action: 0, rows: ['There are many restrooms', /^TRY:/]}],
  ["I'm by the elevators", {action: 0, rows: ['Elevators stop on many decks', /^TRY:/]}],
  ["I'm at the arcade", {action: 0, rows: ['Which one?', 'Arcade or Video Arcade']}],
  ["I'm at the arcade, how do I get to the solarium", {action: 0, rows: ['Which one?']}],
  ["I'm at cococay", {action: 0, rows: ['CocoCay is ashore']}],
  // D10: the closest restroom on a deck.
  ['closest restroom on deck 5', {action: 1, ref: directory.REF_REST_DECK + 5, rows: ['FROM:Your cabin', 'TO:Closest restroom on Deck 5'],
                                  log: 'fixed restroom deck 5'}],
  // Forget where I am, with nothing said.
  ['forget where I am', {action: 0, rows: ['Nothing to forget', 'ROUTES FROM:Your cabin'], log: 'fixed forget'}],
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
    assert.strictEqual(card.start ? card.start.name : undefined, want.start || (card.start && want.set ? card.start.name : undefined),
                       t + ': start');
    assert.strictEqual(!!(card.start && card.start.set), !!want.set, t + ': sets the start');
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
      // With a start said, index.js hands it to that Route screen (ctx.from).
      var page = directory.routePage(card.ref, !!card.rest, card.start ? withFrom(c, card.start.place) : c);
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


// ---- The spoken start (1.5.9, routestart.js, D22). The demo sea day has a
// starred show at Studio B at 14:00; cabin 8200 is a made-up number on the plans.
var routestart = require('../../src/pkjs/routestart');
var log = require('../../src/pkjs/log');

function at(c, hour, min) {
  var out = withFrom(c, undefined);
  delete out.from;
  out.now = new Date(2027, 2, 8, hour, min || 0);
  return out;
}

function said(place, hour, min) {
  var c = at(seaCtx(13), hour, min);
  return directory.spokenStart(place, c);
}

test('spoken start: set, used by voice, Route screens and place pages', function() {
  var sp = said({venue: 'Solarium', name: 'Solarium'}, 13, 0);
  assert.strictEqual(sp.venue, 'Solarium');
  assert.strictEqual(sp.name, 'Solarium');
  assert.strictEqual(sp.sail, seaCtx(13).bundle.sailDate);
  var c = at(seaCtx(13), 13, 20);
  c.spoken = sp;
  assert.strictEqual(directory.spokenEnded(c), null);
  var card = voicecard.answer('how do I get to the windjammer', c, false, 0);
  assert.strictEqual(card.rows[1].label + ':' + card.rows[1].value, 'FROM:Solarium');
  assert.strictEqual(card.start, undefined, 'nothing said in the question');
  var page = directory.routePage(card.ref, false, c);
  assert.strictEqual(page.header, 'FROM SOLARIUM');
  assert.ok(page.steps.length > 0);
  assert.strictEqual(directory.startReason(c), 'said "I\'m at" Solarium at 13:00');
  // A place page's FROM line too, and the restroom and cabin routes.
  var dir = directory.buildPage(directory.refOf('Windjammer Marketplace', c), c);
  assert.strictEqual(dir.gps.header, 'FROM SOLARIUM');
  assert.strictEqual(voicecard.answer('nearest bathroom', c, false, 0).rows[1].value, 'Solarium');
  assert.strictEqual(directory.routePage(directory.REF_REST_HERE, false, c).header, 'CLOSEST TO SOLARIUM');
  var home = voicecard.answer('take me to my cabin', c, false, 0);
  assert.strictEqual(home.action, voicecard.ACT_ROUTE, 'from the Solarium, not the cabin');
  assert.strictEqual(home.rows[1].value, 'Solarium');
  // Asking for the place you're at.
  assert.strictEqual(voicecard.answer('take me to the solarium', c, false, 0).rows[2].value, 'You\'re already there');
  // Another sailing's start is ignored.
  var other = at(seaCtx(13), 13, 20);
  other.spoken = JSON.parse(JSON.stringify(sp));
  other.spoken.sail = '2020-01-01';
  assert.strictEqual(directory.spokenEnded(other), 'another sailing');
  assert.strictEqual(voicecard.answer('how do I get to the windjammer', other, false, 0).rows[1].value, 'Your cabin');
});

test('spoken start: ends after 90 minutes, at the next starred event and at 04:00 (fake clock)', function() {
  function from(sp, hour, min) {
    var c = at(seaCtx(13), hour, min);
    c.spoken = sp;
    return {end: directory.spokenEnded(c), from: voicecard.answer('how do I get to the windjammer', c, false, 0).rows[1].value};
  }
  var morning = said({venue: 'Solarium', name: 'Solarium'}, 10, 0);
  assert.deepStrictEqual(from(morning, 11, 29), {end: null, from: 'Solarium'});
  assert.deepStrictEqual(from(morning, 11, 30), {end: '90 min', from: 'Your cabin'});
  // The starred show at Studio B starts at 14:00: it ends the start, and routes leave from the show.
  var lunch = said({venue: 'Solarium', name: 'Solarium'}, 13, 0);
  assert.deepStrictEqual(from(lunch, 13, 59), {end: null, from: 'Solarium'});
  assert.deepStrictEqual(from(lunch, 14, 0), {end: 'next stop', from: 'Studio B'});
  // Said during the show: it wins over the show.
  var show = said({venue: 'Solarium', name: 'Solarium'}, 14, 10);
  assert.deepStrictEqual(from(show, 14, 20), {end: null, from: 'Solarium'});
  // 04:00, the watch's day change.
  var late = said({venue: 'Solarium', name: 'Solarium'}, 3, 0);
  assert.deepStrictEqual(from(late, 3, 59), {end: null, from: 'Solarium'});
  assert.strictEqual(from(late, 4, 0).end, '04:00');
  // A clock set back.
  assert.strictEqual(from(lunch, 12, 0).end, 'clock');
  // routestart on its own.
  assert.strictEqual(routestart.spokenEnd(null, [], 0), 'not said');
  assert.deepStrictEqual(routestart.start({now: 600, cabin: '8200', spoken: {at: 590, venue: 'Solarium'},
                                           from: {venue: 'Boardwalk'}}), {kind: 'said', venue: 'Boardwalk'});
});

test('spoken start: a cabin, your cabin, and Forget where I am', function() {
  var c = at(seaCtx(13), 13, 10);
  c.spoken = said({cabin: '8200', name: 'Cabin 8200'}, 13, 0);
  assert.strictEqual(c.spoken.cabin, '8200');
  var card = voicecard.answer('how do I get to the windjammer', c, false, 0);
  assert.strictEqual(card.rows[1].value, 'Cabin 8200');
  assert.strictEqual(directory.routePage(card.ref, false, c).header, 'FROM CABIN 8200');
  assert.strictEqual(voicecard.answer('take me to cabin 8200', c, false, 0).rows[2].value, 'You\'re already there');
  // "I'm at my cabin" during the show: from the cabin, which isn't a route to the cabin.
  var mine = at(seaCtx(13), 14, 20);
  mine.spoken = said({mine: true, name: 'Your cabin'}, 14, 10);
  assert.strictEqual(voicecard.answer('how do I get to the windjammer', mine, false, 0).rows[1].value, 'Your cabin');
  var home = voicecard.answer('take me to my cabin', mine, false, 0);
  assert.strictEqual(home.action, voicecard.ACT_NONE);
  assert.strictEqual(home.hint, 'You\'re at your cabin');
  assert.ok(/^said "I'm at" your cabin/.test(directory.startReason(mine)));
  // Forget where I am: Select clears it (index.js); the card says where routes start then.
  ['forget where I am', 'Forget where I\'m at', 'clear my location'].forEach(function(t) {
    var f = voicecard.answer(t, c, false, 0);
    assert.strictEqual(f.action, voicecard.ACT_CONFIRM, t);
    assert.ok(f.forget, t);
    assert.deepStrictEqual(f.rows.slice(1).map(function(r) { return r.label + ':' + r.value; }),
                           ['YOU\'RE AT:Cabin 8200', 'THEN FROM:Your cabin'], t);
    assert.strictEqual(f.log, 'fixed forget where I am');
  });
  var during = at(seaCtx(13), 14, 20);
  during.spoken = said({venue: 'Solarium', name: 'Solarium'}, 14, 10);
  assert.strictEqual(voicecard.answer('forget where I am', during, false, 0).rows[2].value, 'Studio B', 'then from the show');
  unpack(voicecard.packCard(voicecard.answer('forget where I am', c, false, 0)));
});

test('D10: the closest restroom on a deck', function() {
  var c = seaCtx(13);
  var any = directory.routePage(directory.REF_REST_HERE, false, c);
  [5, 15].forEach(function(deck) {
    var card = voicecard.answer('closest restroom on deck ' + deck, c, false, 0);
    assert.strictEqual(card.ref, directory.REF_REST_DECK + deck);
    var page = directory.routePage(card.ref, false, c);
    assert.strictEqual(page.big.indexOf('Deck ' + deck), 0, page.big);
    assert.strictEqual(page.header, 'DECK ' + deck + ' FROM YOUR CABIN');
    assert.strictEqual(page.steps[page.steps.length - 1].glyph, 4);
  });
  assert.notStrictEqual(any.big.indexOf('Deck 15'), 0, 'without a deck: the closest anywhere');
  // A deck with no restroom on the map (Deck 12, so far) says so.
  var none = voicecard.answer('where is the nearest bathroom on deck 12', c, false, 0);
  assert.strictEqual(none.action, voicecard.ACT_NONE);
  assert.strictEqual(none.hint, 'No restroom on Deck 12 on the map');
});

test('ref widths: voice refs travel as int32 and never meet the 16-bit row refs', function() {
  var c = seaCtx(13);
  var places = directory.places('HM');
  var maxPlace = directory.REF_PLACE + places.length - 1;
  // Directory rows carry uint16 refs: the flag row is the largest.
  assert.ok(directory.REF_FLAG + maxPlace < 65536, 'flag ref fits uint16');
  assert.ok(maxPlace < directory.REF_FLAG, 'places stay under the flag refs');
  assert.ok(directory.REF_BANK + directory.bankRefs(c).length <= directory.REF_CABIN);
  assert.ok(directory.REF_REST_DECK + 99 < directory.REF_PLACE);
  assert.ok(directory.REF_FLAG + maxPlace < directory.REF_TO_CABIN, 'no flag ref reaches the cabin refs');
  // A 5-digit cabin: the card's int32 ref, the ROUTE_PAGE dir_ref and the log.
  var ref = directory.REF_TO_CABIN + 99999;
  assert.ok(ref < 2 * directory.REF_TO_CABIN && ref < 0x7fffffff);
  var back = unpack(voicecard.packCard({action: voicecard.ACT_ROUTE, ref: ref, rows: [], hint: '', title: 'x', header: ''}));
  assert.strictEqual(back.ref, ref);
  var cab = voicecard.answer('take me to cabin 8200', c, false, 0);
  assert.strictEqual(unpack(voicecard.packCard(cab)).ref, 108200);
  var msg = directory.routeMsg(directory.routePage(cab.ref, false, c));
  assert.strictEqual(msg.dir_ref, 108200, 'sent whole: PebbleKit JS sends numbers as int32');
  assert.ok(msg.dir_ref > 65535, 'would not survive a 16-bit field');
  assert.strictEqual(directory.buildPage(108200, c).title !== undefined, true, 'a stray dir page request is harmless');
  var entry = log.watchEntry({at: 0, code: 3, x: 7, a: 0, b: 5, c: 108200}, null);
  assert.ok(/Route to cabin 8200 \(said\)/.test(entry.detail), entry.detail);
  assert.ok(/on deck 5/.test(log.watchEntry({at: 0, code: 3, x: 7, a: 0, b: 5, c: 505}, null).detail));
});

test('settings test box: a card as text lines', function() {
  var c = seaCtx(13);
  var lines = voicecard.cardLines(voicecard.answer('I\'m at the solarium', c, false, 0));
  assert.deepStrictEqual(lines, ['HEARD  “I\'m at the solarium”', 'YOU\'RE AT  Solarium', 'Routes start here for 90 min',
                                 'Hint: Select: set · Hold: ask again', 'Select routes start at Solarium for 90 min',
                                 'Matched: SET_LOCATION A=Solarium (exact)']);
  lines = voicecard.cardLines(voicecard.answer('I\'m at the solarium. How do I get to the windjammer', c, false, 0));
  assert.strictEqual(lines[4], 'Select opens the route to Windjammer Marketplace from Solarium, and routes start at Solarium for 90 min');
  lines = voicecard.cardLines(voicecard.answer('play some music', c, false, 0));
  assert.strictEqual(lines[lines.length - 2], 'Select asks again');
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
