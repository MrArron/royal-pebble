// Unit tests for the per-watch text budgets (src/pkjs/textfit.js): the voice
// card's hint and rows, and the place and route pages' lines, for the Pebble
// Time 2 (emery) and the Pebble Round 2 (gabbro). Run: node test/pkjs/textfit.test.js
var assert = require('assert');
var textfit = require('../../src/pkjs/textfit');
var voicecard = require('../../src/pkjs/voicecard');
var directory = require('../../src/pkjs/directory');
var pagelines = require('../../src/pkjs/pagelines');
var pack = require('../../src/pkjs/pack');
var demo = require('../../src/pkjs/demo');

var tests = [];
function test(name, fn) { tests.push({name: name, fn: fn}); }

var DOT = ' · ';
var PLATFORMS = ['emery', 'gabbro'];

test('the platform comes from the watch info; no info is the Time 2', function() {
  assert.strictEqual(textfit.platformOf({platform: 'emery'}), 'emery');
  assert.strictEqual(textfit.platformOf({platform: 'gabbro'}), 'gabbro');
  assert.strictEqual(textfit.platformOf({platform: 'chalk'}), 'gabbro');
  assert.strictEqual(textfit.platformOf({platform: 'basalt'}), 'emery');
  assert.strictEqual(textfit.platformOf({}), 'emery');
  assert.strictEqual(textfit.platformOf(null), 'emery');
  assert.strictEqual(textfit.platformOf(undefined), 'emery');
  // No usable platform: a model naming a round watch is the Round 2 (1.6.8).
  assert.strictEqual(textfit.platformOf({model: 'qemu_platform_gabbro'}), 'gabbro');
  assert.strictEqual(textfit.platformOf({platform: 'unknown', model: 'pebble_round_2_black'}), 'gabbro');
  assert.strictEqual(textfit.platformOf({model: 'pebble_time_round_silver_14mm'}), 'gabbro');
  // A known platform wins over the model; any other model is the Time 2.
  assert.strictEqual(textfit.platformOf({platform: 'emery', model: 'round_test'}), 'emery');
  assert.strictEqual(textfit.platformOf({model: 'qemu_platform_emery'}), 'emery');
  assert.strictEqual(textfit.platformOf({model: 'pebble_time_2_black'}), 'emery');
  assert.strictEqual(textfit.budgetOf('nope'), textfit.PLATFORMS.emery);
});

test('wrap and fit: words, long words, ellipsis at a word', function() {
  assert.deepStrictEqual(textfit.wrap('Select: route to the Royal Theater', 14), ['Select: route', 'to the Royal', 'Theater']);
  assert.deepStrictEqual(textfit.wrap('abcdefghij', 4), ['abcd', 'efgh', 'ij']);
  assert.strictEqual(textfit.fit('Short', 10, 1), 'Short');
  assert.strictEqual(textfit.fit('Select: route to the Royal Theater', 14, 2), 'Select: route to the Royal…');
  var cut = textfit.fit('one two three four five six seven', 10, 2);
  assert.ok(textfit.lineCount(cut, 10) <= 2, cut);
  assert.strictEqual(cut.slice(-1), textfit.ELLIPSIS);
  assert.strictEqual(textfit.fit('', 10, 1), '');
});

// ---- Voice cards ----------------------------------------------------------

var NOW = new Date(2027, 2, 8, 13, 0);
var PORT = demo.make(NOW, 0);
var SEA = demo.make(NOW, 1);

function ctxOf(d) {
  var settings = JSON.parse(JSON.stringify(d.settings || {}));
  settings.me = settings.me || {};
  settings.me.deck = 'Deck 9';
  settings.me.stateroom = '9150';  // a made-up cabin
  return {bundle: d.bundle, settings: settings, stars: d.stars || {}, now: NOW};
}

// What a person might say, covering every kind of card.
var SAYINGS = [
  'how do I get to the theater', 'how do I get to the Royal Theater', 'take me to my cabin', 'nearest bathroom',
  'closest restroom from studio b', 'from my cabin to the windjammer', "I'm at the solarium. How do I get to the windjammer",
  "I'm at the solarium", 'forget where I am', 'where is the pool', 'where is the arcade', 'take me to the dining room',
  'take me to the elevator', 'take me to the stairs on deck 5', 'take me to deck 15', 'where is playmakers',
  "I'm on board", "I'm back ashore", 'going ashore', 'when is all aboard', 'when do we leave', "where are we tomorrow",
  "where's my muster station", 'take me to my mustard station', 'play some music', 'Solarim',
  'how do I get to the library', 'how do I get to the perfect storm waterslides', 'giovanni\'s italian kitchen',
  'what is the capital of france and why is the sky blue and what time is it in tokyo right now please',
  'take me to cabin 8200', 'how do I get to the boardwalk dog house', 'perfect day at cocoCay'
];

function ctxes() {
  return [ctxOf(PORT), ctxOf(SEA), {bundle: null, settings: {}, stars: {}, now: NOW}];
}

function allCards(platform) {
  var out = [];
  ctxes().forEach(function(c) {
    [0, voicecard.STATE_ONBOARD, voicecard.STATE_24H].forEach(function(state) {
      SAYINGS.forEach(function(t) {
        out.push({text: t, card: voicecard.answer(t, c, false, state, platform)});
      });
    });
  });
  return out;
}

test('voice cards on the Time 2 are the cards the phone built before', function() {
  var base = allCards(undefined);
  assert.ok(base.length > 100);
  allCards('emery').forEach(function(x, i) {
    assert.deepStrictEqual(x.card, base[i].card, x.text);
  });
  assert.strictEqual(voicecard.answer('how do I get to the theater', ctxOf(PORT), false, 0, 'emery').hint,
                     'Select: route · Hold: ask again');
});

test('voice cards: no hint or row over its watch budget, both platforms', function() {
  var kinds = {};
  PLATFORMS.forEach(function(platform) {
    var b = textfit.budgetOf(platform);
    allCards(platform).forEach(function(x) {
      var c = x.card;
      var tag = platform + ' "' + x.text + '"';
      kinds[c.action + ':' + (c.hint || '')] = true;
      assert.ok(c.rows.length <= 4, tag);
      // (packCard cuts the Time 2's hint at 47 bytes, as before.)
      assert.ok(!b.round || Buffer.byteLength(c.hint || '') <= 47, tag + ' hint bytes: ' + c.hint);
      // The hint: a line (the Time 2 wraps in its 184 px column), two on the Round 2.
      var parts = (c.hint || '').split(DOT);
      if (b.round) {
        assert.ok(parts.length <= 2, tag + ' ' + c.hint);
        parts.forEach(function(p) {
          assert.ok(textfit.lineCount(p, b.col[14]) <= (parts.length === 2 ? 1 : b.hintLines), tag + ' hint "' + c.hint + '"');
        });
      } else {
        assert.ok(textfit.lineCount((c.hint || '').slice(0, 47), b.col[14]) <= 2, tag + ' hint "' + c.hint + '"');
      }
      c.rows.forEach(function(r) {
        assert.ok(Buffer.byteLength(r.label) <= 15, tag + ' label ' + r.label);
        assert.ok(textfit.lineCount(r.label, b.col[14]) <= 1, tag + ' label ' + r.label);
        // The Time 2's heard sentence is cut at 63 bytes; the watch ends it with an ellipsis.
        if (b.round || r.label !== 'HEARD') {
          assert.ok(textfit.lineCount(r.value, b.col[18]) <= 3, tag + ' value "' + r.value + '"');
        }
      });
      // And it packs for the watch without loss of the card's kind.
      var packed = voicecard.packCard(c);
      assert.strictEqual(packed[0], c.action);
    });
  });
  assert.ok(Object.keys(kinds).length > 12, 'the sayings cover many hints');
});

test('voice cards on the Round 2: short hints, two lines', function() {
  var c = ctxOf(PORT);
  var route = voicecard.answer('how do I get to the theater', c, false, 0, 'gabbro');
  assert.strictEqual(route.action, voicecard.ACT_ROUTE);
  assert.strictEqual(route.hint, 'Select: route' + DOT + 'Hold: ask again');
  // "Select: route to X" (the muster station) loses the name: the TO row has it.
  var muster = voicecard.answer("where's my muster station", c, false, 0, 'gabbro');
  if (muster.action === voicecard.ACT_ROUTE) {
    assert.strictEqual(muster.hint, 'Select: route');
  }
  var ob = voicecard.answer("I'm on board", c, false, 0, 'gabbro');
  assert.strictEqual(ob.hint, 'Select: alerts off today');
  assert.strictEqual(voicecard.answer("I'm back ashore", c, false, voicecard.STATE_ONBOARD, 'gabbro').hint,
                     'Select: alerts back on');
  assert.strictEqual(voicecard.answer("I'm on board", c, false, voicecard.STATE_ONBOARD, 'gabbro').hint,
                     'Nothing to change' + DOT + 'Hold: ask again');
  var at = voicecard.answer("I'm at the solarium. How do I get to the windjammer", c, false, 0, 'gabbro');
  assert.strictEqual(at.hint, 'Select: route' + DOT + 'Undo: “Forget where I am”');
  var set = voicecard.answer("I'm at the solarium", c, false, 0, 'gabbro');
  assert.strictEqual(set.hint, 'Saved' + DOT + 'Undo: “Forget where I am”');
  // A long heard sentence is cut to the card's three lines.
  var long = voicecard.answer('what is the capital of france and why is the sky blue and what time is it in tokyo right now please',
                              c, false, 0, 'gabbro');
  assert.ok(textfit.lineCount(long.rows[0].value, 23) <= 3, long.rows[0].value);
  assert.strictEqual(long.rows[0].value.slice(-1), textfit.ELLIPSIS);
});

test('a missing platform words the Time 2 card', function() {
  var c = ctxOf(PORT);
  var a = voicecard.answer("I'm on board", c, false, 0);
  var b = voicecard.answer("I'm on board", c, false, 0, textfit.platformOf(null));
  assert.deepStrictEqual(a, b);
  assert.strictEqual(a.hint, 'Select: all-aboard alerts off for today');
});

// ---- Place and route pages ------------------------------------------------

function pageBundle() {
  return {
    format: 'cruise-watch', v: 1, generated: '2027-03-07T12:00:00Z',
    ship: {code: 'HM', name: 'Harmony of the Seas'}, sailDate: '2027-03-06',
    itinerary: [{day: 1, date: '2027-03-06', port: 'Orlando (Port Canaveral), Fl', type: 'EMBARK', arrive: null, depart: '16:00'}],
    schedule: {published: true, cats: [['Entertainment', 'Shows']], venues: ['Studio B', 'Royal Theater'],
               fields: ['title', 'venue', 'cat', 'date', 'time', 'minutes', 'featured', 'reservation'],
               events: [['Ice Show: 1887', 0, 0, '2027-03-07', '20:00', 60, 1, 0]]}
  };
}

var PCTX = {bundle: pageBundle(), settings: {me: {deck: 'Deck 9', stateroom: '9150'}}, stars: {}, now: new Date(2027, 2, 7, 14, 0)};

// Every line of a page as {text, font (px), maxLines, glyph}.
function lineInfo(page) {
  return page.lines.filter(function(l) { return l.bytes.length && l.glyph !== pagelines.CHIPS; }).map(function(l) {
    var font = [14, 18, 24][l.style & 3];
    return {text: Buffer.from(l.bytes).toString('utf8'), font: font, glyph: l.glyph, bytes: l.bytes.length,
            maxLines: Math.max(1, Math.floor(l.maxH / pagelines.H[l.style & 3]))};
  });
}

function pages(round) {
  var out = [];
  var n = directory.places('HM').length;
  for (var i = 0; i < n; i++) {
    var ref = directory.REF_PLACE + i;
    out.push({tag: 'place ' + i, page: pagelines.placeLines(directory.buildPage(ref, PCTX), {round: round})});
    [false, true].forEach(function(rest) {
      out.push({tag: 'route ' + i + (rest ? ' restroom' : ''), page: pagelines.routeLines(directory.routePage(ref, rest, PCTX), {round: round})});
    });
  }
  [1, 2].forEach(function(b) {
    out.push({tag: 'bank ' + b, page: pagelines.placeLines(directory.buildPage(directory.REF_BANK + b, PCTX), {round: round})});
  });
  out.push({tag: 'event route', page: pagelines.routeLines(directory.eventRoutePage({start: 1440 + 20 * 60, venue: 'Studio B'}, PCTX),
                                                           {round: round})});
  return out;
}

test('pages: no line over its buffer or box, both platforms', function() {
  PLATFORMS.forEach(function(platform) {
    var round = textfit.budgetOf(platform).round;
    var b = textfit.budgetOf(platform);
    var all = pages(round);
    assert.ok(all.length > 250, 'every place on the ship, place page and routes');
    var cut = 0;
    all.forEach(function(p) {
      lineInfo(p.page).forEach(function(l) {
        var tag = platform + ' ' + p.tag + ' "' + l.text + '"';
        assert.ok(l.bytes <= pagelines.TEXT_MAX, tag);
        var indent = l.glyph >= pagelines.STEP ? 2 : 0;
        assert.ok(textfit.lineCount(l.text, b.col[l.font] - indent) <= l.maxLines,
                  tag + ' needs ' + textfit.lineCount(l.text, b.col[l.font] - indent) + ' lines, has ' + l.maxLines);
        if (l.text.slice(-1) === textfit.ELLIPSIS) {
          cut++;
        }
      });
    });
    if (!round) {
      assert.strictEqual(cut, 0, 'the Time 2 pages are never cut by the phone');
    }
  });
});

test('pages on the Time 2 are the pages the phone built before', function() {
  // The Round 2's fitting stays out of the Time 2's text: no ellipsis, and
  // the Time 2 lines equal the unfitted text, including the longest arrival.
  var text = 'Playmakers Sports Bar & Arcade' + DOT + 'stbd side';
  var p = {title: 'Playmakers Sports Bar & Arcade', header: 'FROM YOUR CABIN', steps: [{glyph: 4, text: text}]};
  var emery = lineInfo(pagelines.routeLines(p, {round: false}));
  assert.deepStrictEqual(emery.map(function(l) { return l.text; }), ['Playmakers Sports Bar & Arcade', 'FROM YOUR CABIN', text]);
  var gabbro = lineInfo(pagelines.routeLines(p, {round: true}));
  assert.strictEqual(gabbro[gabbro.length - 1].text, text, 'three lines hold the longest arrival');
});

test('pages on the Round 2: shorter wording where a line is too long', function() {
  var rp = {title: 'Boardwalk Dog House', header: '', steps: [], big: '', small: {decks: 0, text: 'Same deck as Boardwalk Dog House'}};
  var t = lineInfo(pagelines.routeLines(rp, {round: true})).map(function(l) { return l.text; });
  assert.ok(t.some(function(x) { return /^Same deck: Boardwalk/.test(x); }), t.join('|'));
  t = lineInfo(pagelines.routeLines(rp, {round: false})).map(function(l) { return l.text; });
  assert.ok(t.indexOf('Same deck as Boardwalk Dog House') >= 0, t.join('|'));
});

var failed = 0;
tests.forEach(function(t) {
  try {
    t.fn();
    console.log('ok   ' + t.name);
  } catch (e) {
    failed++;
    console.log('FAIL ' + t.name + '\n     ' + (e && e.stack || e));
  }
});
console.log((tests.length - failed) + '/' + tests.length + ' passed');
if (failed) {
  process.exit(1);
}
