// Unit tests for voice commands (src/pkjs/voice.js + src/pkjs/data/voice-HM.js).
// Run: node test/pkjs/voice.test.js [-v]    (-v prints every corpus case)
//
// Cabin numbers here and in the fixtures are made up (CLAUDE.md): none is on the
// Harmony plans, and the parser is given this list instead of the real one.
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var voice = require('../../src/pkjs/voice');
var cabins = require('../../src/pkjs/cabins');
var buildVoice = require('../../tools/voice/build_voice');

var ROOT = path.join(__dirname, '..', '..');
var VERBOSE = process.argv.indexOf('-v') !== -1;

var FAKE_CABINS = ['8924', '6902', '9850', '10930', '10932', '11844', '14906', '9804', '1792', '7646', '12990'];
var OPTS = {ship: 'HM', isCabin: function(n) { return FAKE_CABINS.indexOf(String(n)) !== -1; }};

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8'));
}
var CORPUS = load('voice-corpus-HM.json');
var HOLDOUT = load('voice-holdout-HM.json');

var tests = [];
function test(name, fn) { tests.push({name: name, fn: fn}); }

// ------------------------------------------------------------------ scoring

// The corpus rules: intent must match, and the cabin; a slot's target when the
// case gives one, else its span (squashed) or token; reason / topic for refusals
// and out-of-scope answers. Slots aren't compared for INCOMPLETE / NO_MATCH.
function check(c) {
  var e = c.expect, g = voice.parse(c.text, OPTS), why = [];
  function slot(k) {
    var t = e[k + '_target'];
    if (t) {
      return t === g[k + '_target'];
    }
    if (e[k] === null || /^@/.test(e[k] || '')) {
      return (e[k] || null) === (g[k] || null);
    }
    return voice.squash(e[k]) === voice.squash(g[k] || '');
  }
  if (e.intent !== g.intent) {
    why.push('intent ' + g.intent);
  } else {
    if ((e.cabin || null) !== (g.cabin || null)) {
      why.push('cabin ' + g.cabin);
    }
    if (e.intent === 'LOCATION_REFUSED' && e.reason && e.reason !== g.reason) {
      why.push('reason ' + g.reason);
    } else if (e.intent === 'OUT_OF_SCOPE_KNOWN' && e.topic && e.topic !== g.topic) {
      why.push('topic ' + g.topic);
    } else if (['LOCATION_REFUSED', 'OUT_OF_SCOPE_KNOWN', 'INCOMPLETE', 'NO_MATCH'].indexOf(e.intent) === -1) {
      ['A', 'B'].forEach(function(k) {
        if (!slot(k)) {
          why.push(k + ' ' + g[k] + '/' + g[k + '_target']);
        }
      });
      if (e.deck && e.deck !== g.deck) {
        why.push('deck ' + g.deck);
      }
    }
  }
  return {ok: !why.length, why: why, got: g};
}

function score(cases, label) {
  var pass = 0, fails = [];
  cases.forEach(function(c) {
    var r = check(c);
    if (r.ok) {
      pass++;
    } else {
      fails.push(c.id + ' ' + JSON.stringify(c.text) + ': ' + r.why.join('; '));
    }
    if (VERBOSE) {
      console.log((r.ok ? '  ok   ' : '  FAIL ') + c.id + ' ' + JSON.stringify(c.text) + ' -> ' + JSON.stringify(r.got));
    }
  });
  console.log('  ' + label + ': ' + pass + '/' + cases.length + ' (' + (100 * pass / cases.length).toFixed(1) + '%)');
  fails.forEach(function(f) { console.log('    miss ' + f); });
  return pass / cases.length;
}

// ------------------------------------------------------------------ tests

test('observed Windjammer mishearings all resolve (airplane-mode test, 2026-09-28)', function() {
  ['Wind Jammer', 'wind jammer', 'windjam', 'windmill', 'Windjammer'].forEach(function(w) {
    var r = voice.parse('How do I get to the ' + w + '?', OPTS);
    assert.strictEqual(r.intent, 'ROUTE', w);
    assert.strictEqual(r.B_target, 'Windjammer Marketplace', w);
  });
  var r = voice.parse('Windmill to my cabin.', OPTS);
  assert.strictEqual(r.A_target, 'Windjammer Marketplace');
  assert.strictEqual(r.B, '@mycabin');
});

test('the other observed phrases', function() {
  var r = voice.parse("I'm at the escape room. How do I get to the Aqua Theater?", OPTS);
  assert.deepStrictEqual([r.intent, r.A_target, r.B_target], ['ROUTE_COMBINED', 'The Puzzle Break', 'AquaTheater']);
  r = voice.parse('Boardwalk to the Solarium', OPTS);
  assert.deepStrictEqual([r.intent, r.A_target, r.B_target], ['ROUTE', 'Boardwalk', 'Solarium']);
});

test('matcher: exact, part and fuzzy, and when it refuses', function() {
  var m = voice.matcher('HM');
  assert.strictEqual(m('the wind jam are').how, 'part');
  assert.strictEqual(m('the Cartier store').t, 'Cartier');
  assert.strictEqual(m('solarim').how, 'fuzzy');
  assert.strictEqual(m('solarim').t, 'Solarium');
  assert.strictEqual(m('main dining room', 5).t, 'Main Dining Room 5');
  assert.strictEqual(m('the arcade').t, 'Arcade|Video Arcade', 'a group: route to the nearest');
  assert.strictEqual(m('solar'), null, 'prefix of Solarium, Solarium Bar and Solarium Bistro');
  assert.strictEqual(m('bar'), null);
  assert.strictEqual(m('wine bar'), null);
  assert.strictEqual(m('play some music'), null);
  assert.notStrictEqual((m('150 central') || {}).t, 'Central Park', 'digits are never noise');
});

test('squash: the same normalisation for transcripts and the lexicon', function() {
  assert.strictEqual(voice.squash("The Lime & Coconut"), 'limeandcoconut');
  assert.strictEqual(voice.squash('Aqua Theatre'), 'aquatheater');
  assert.strictEqual(voice.squash('Social100 (Ages 13-17)'), 'social100');
  assert.strictEqual(voice.squash('one fifty Central Park'), '150centralpark');
});

test('cabins: to/two decided by the (fake) cabin list, never stored', function() {
  var r = voice.parse('Cabin 8924 two the Solarium', OPTS);
  assert.deepStrictEqual([r.A, r.B_target], ['@cabin:8924', 'Solarium']);
  r = voice.parse("I'm in cabin eight nine to four.", OPTS);
  assert.strictEqual(r.cabin, '8924');
  r = voice.parse("I'm in cabin 8923.", OPTS);
  assert.strictEqual(r.cabin, '8923', 'kept for "No cabin 8923 on Harmony"');
  // With no cabin list at all, a number that isn't said with "cabin" stays a number.
  r = voice.parse('8924 to 6902', {ship: 'HM'});
  assert.notStrictEqual(r.intent, 'SET_LOCATION');
});

test('fixture cabin numbers are made up (not on the Harmony plans)', function() {
  var seen = {};
  CORPUS.cases.concat(HOLDOUT.cases).forEach(function(c) {
    (c.text + JSON.stringify(c.expect)).replace(/\d{4,5}/g, function(n) { seen[n] = true; });
  });
  FAKE_CABINS.forEach(function(n) { seen[n] = true; });
  Object.keys(seen).forEach(function(n) {
    assert.strictEqual(cabins.find('HM', n), null, n + ' is a real HM cabin: use a made-up number');
  });
});

test('closest bar: voice only, any bar or a drink, the nearest like restrooms (owner, 2026-09-28)', function() {
  var ask = ['Where is the bar?', 'Closest place to get a drink', 'Where can I get a drink?', 'Nearest bar',
    'Take me to the closest bar', 'I need a drink', 'Where can I get a beer', 'bar near me', 'Take me to a bar',
    'Where can I grab a cocktail', 'where can we get drinks', 'I could use a beer', "Hey, where's the closest bar?",
    'closest place for a drink'];
  ask.forEach(function(t) {
    var r = voice.parse(t, OPTS);
    assert.deepStrictEqual([r.intent, r.A, r.B], ['CLOSEST_BAR', null, null], t);
  });
  // From a named place, said or set in the same breath.
  var r = voice.parse('Where is the nearest bar from the Solarium?', OPTS);
  assert.deepStrictEqual([r.intent, r.A_target], ['CLOSEST_BAR', 'Solarium']);
  r = voice.parse("I'm at the Solarium. Where can I get a drink?", OPTS);
  assert.deepStrictEqual([r.intent, r.A_target], ['CLOSEST_BAR', 'Solarium']);
  // A named bar is a venue, not "closest bar"; "the pub" is the one pub.
  assert.strictEqual(voice.parse('Where is Schooner Bar?', OPTS).B_target, 'Schooner Bar');
  assert.strictEqual(voice.parse('How do I get to the sand bar', OPTS).B_target, 'Sand Bar');
  assert.strictEqual(voice.parse('Closest pub', OPTS).B_target, 'Boot & Bonnet Pub');
  // "drink" used to fuzzy-match Studio B.
  assert.strictEqual(voice.parse('drink', OPTS).intent, 'CLOSEST_BAR');
  // "The bar" is many places, so it can't be where you are.
  r = voice.parse("I'm at the bar", OPTS);
  assert.deepStrictEqual([r.intent, r.reason], ['LOCATION_REFUSED', 'bar']);
  // The candidates: bars open to everyone (no Casino Royale, Crown or Suite Lounge).
  var bars = voice.bars('HM');
  assert.ok(bars.length >= 10 && bars.indexOf('Schooner Bar') !== -1 && bars.indexOf('Solarium Bar') !== -1);
  ['Casino Royale', 'Crown Lounge', 'Suite Lounge', 'Teen Lounge', 'Starbucks'].forEach(function(n) {
    assert.strictEqual(bars.indexOf(n), -1, n);
  });
});

test('closest coffee: voice only, the nearest coffee place (owner, 2026-09-28)', function() {
  ['closest coffee', 'Where can I get a coffee?', 'I need coffee', 'closest place to get coffee',
   'Where can I get a latte', 'I could use a cup of coffee', 'nearest coffee shop'].forEach(function(t) {
    var r = voice.parse(t, OPTS);
    assert.deepStrictEqual([r.intent, r.A, r.B], ['CLOSEST_COFFEE', null, null], t);
  });
  var r = voice.parse('Where can I get a latte from the Boardwalk', OPTS);
  assert.deepStrictEqual([r.intent, r.A_target], ['CLOSEST_COFFEE', 'Boardwalk']);
  assert.strictEqual(voice.parse('Where is Starbucks', OPTS).B_target, 'Starbucks');
  r = voice.parse("I'm at the coffee shop", OPTS);
  assert.deepStrictEqual([r.intent, r.reason], ['LOCATION_REFUSED', 'coffee']);
  assert.deepStrictEqual(voice.coffee('HM').slice().sort(), ['Cafe Promenade', 'Park Cafe', 'Starbucks']);
});

test('a snack or a bite outside dining hours: Cafe Promenade, open 24 hours (owner, 2026-09-28)', function() {
  ['Where can I get a snack?', "I'm hungry", 'Where can I get something to eat', 'late night food',
   'Where can I grab a bite to eat', 'midnight snack', 'Where can I eat'].forEach(function(t) {
    var r = voice.parse(t, OPTS);
    assert.deepStrictEqual([r.intent, r.B_target, r.via], ['ROUTE', 'Cafe Promenade', 'snack'], t);
  });
  var r = voice.parse("I'm at the Solarium. I'm hungry.", OPTS);
  assert.deepStrictEqual([r.intent, r.A_target, r.B_target, r.via], ['ROUTE_COMBINED', 'Solarium', 'Cafe Promenade', 'snack']);
  // Named food places stay themselves.
  assert.strictEqual(voice.parse('where can I get pizza', OPTS).B_target, "Sorrento's");
  assert.strictEqual(voice.parse('Where is Cafe Promenade', OPTS).via, undefined);
});

test('flags: multi-spot, ashore and group places are refused as a location, hot tubs have no route yet', function() {
  assert.strictEqual(voice.parse("I'm on the running track.", OPTS).reason, 'multi_spot');
  assert.strictEqual(voice.parse("I'm at CocoCay.", OPTS).reason, 'ashore');
  assert.strictEqual(voice.parse("I'm at the arcade.", OPTS).reason, 'group', 'which arcade?');
  var r = voice.parse('How do I get to the hot tub?', OPTS);
  assert.deepStrictEqual([r.intent, r.reason], ['NO_MATCH', 'not_mapped']);
});

test('the generated lexicon is up to date and within budget', function() {
  var data = fs.readFileSync(path.join(ROOT, 'src', 'pkjs', 'data', 'voice-HM.js'), 'utf8');
  assert.ok(data.length <= 16 * 1024, 'voice-HM.js is ' + data.length + ' bytes (budget 16 KB)');
  var src = fs.readFileSync(path.join(ROOT, 'src', 'pkjs', 'voice.js'), 'utf8');
  assert.ok(src.length <= 48 * 1024, 'voice.js is ' + src.length + ' bytes (budget 48 KB raw, about 28 KB minified)');
  var build = buildVoice.build('HM');
  assert.strictEqual(build.src, data, 'run node tools/voice/build_voice.js');
  assert.deepStrictEqual(build.bad, [], 'every source phrase resolves to its place');
});

test('negative and gibberish utterances never match a place', function() {
  var neg = CORPUS.cases.concat(HOLDOUT.cases).filter(function(c) {
    return c.expect.intent === 'NO_MATCH';
  });
  var wrong = neg.filter(function(c) {
    var g = voice.parse(c.text, OPTS);
    return g.A_target || g.B_target || ['ROUTE', 'ROUTE_COMBINED', 'SET_LOCATION'].indexOf(g.intent) !== -1;
  }).map(function(c) { return c.text; });
  console.log('    ' + (neg.length - wrong.length) + '/' + neg.length + ' negatives stay unmatched');
  assert.deepStrictEqual(wrong, []);
});

test('corpus scores (fixed corpus, its held-out part, the new held-out set)', function() {
  var all = score(CORPUS.cases, 'corpus, all ' + CORPUS.cases.length);
  var held = score(CORPUS.cases.filter(function(c) { return c.tags.indexOf('holdout') !== -1; }), 'corpus, held out');
  var fresh = score(HOLDOUT.cases, 'new held-out set, written before tuning');
  assert.ok(all >= 0.97, 'corpus pass rate ' + all);
  assert.ok(held >= 0.9, 'held-out pass rate ' + held);
  assert.ok(fresh >= 0.8, 'new held-out pass rate ' + fresh);
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
