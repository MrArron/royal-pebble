// Unit tests for the pages the watch draws line by line (place cards and the
// Route screen). Run: node test/pkjs/pagelines.test.js
var assert = require('assert');
var directory = require('../../src/pkjs/directory');
var pagelines = require('../../src/pkjs/pagelines');

var tests = [];
function test(name, fn) { tests.push({name: name, fn: fn}); }

var DOT = ' ' + String.fromCharCode(183) + ' ';
var H = pagelines.H;

function makeBundle() {
  return {
    format: 'cruise-watch', v: 1, generated: '2027-03-07T12:00:00Z',
    ship: {code: 'HM', name: 'Harmony of the Seas'},
    sailDate: '2027-03-06',
    itinerary: [
      {day: 1, date: '2027-03-06', port: 'Orlando (Port Canaveral), Fl', type: 'EMBARK', arrive: null, depart: '16:00'},
      {day: 2, date: '2027-03-07', port: 'Cruising', type: 'CRUISING', arrive: null, depart: null}
    ],
    schedule: {
      published: true,
      cats: [['Entertainment', 'Shows']],
      venues: ['Studio B', 'Royal Theater'],
      fields: ['title', 'venue', 'cat', 'date', 'time', 'minutes', 'featured', 'reservation'],
      events: [['Ice Show: 1887', 0, 0, '2027-03-07', '20:00', 60, 1, 0]]
    }
  };
}

var NOW = new Date(2027, 2, 7, 14, 0);
var CABIN = {me: {deck: 'Deck 9', stateroom: '9150'}};  // a made-up cabin
var CTX = {bundle: makeBundle(), settings: CABIN, stars: {}, now: NOW};

function placeRef(name) {
  var list = directory.places('HM');
  return directory.REF_PLACE + list.indexOf(list.filter(function(v) { return v.name === name; })[0]);
}

// The watch's reading of the bytes (lines.c): each line's style, glyph,
// space, max_h, text, and its box top with one-line heights.
function decode(bytes) {
  var out = [];
  var i = 0;
  var y = 0;
  while (i + 4 < bytes.length) {
    var l = {style: bytes[i], glyph: bytes[i + 1], space: (bytes[i + 2] << 24) >> 24, maxH: bytes[i + 3]};
    var n = bytes[i + 4];
    l.bytes = bytes.slice(i + 5, i + 5 + n);
    l.text = Buffer.from(l.bytes).toString('utf8');
    l.font = l.style & 3;
    l.center = !!(l.style & pagelines.CENTER);
    l.color = l.style >> 3;
    y += l.space;
    l.top = y;
    if (l.glyph !== pagelines.DIVIDER && l.glyph !== pagelines.CHIPS && n) {
      y += H[l.font];
    }
    if (l.glyph === pagelines.CHIPS) {
      y += Math.ceil((n - 1) / 7) * 23;
    }
    out.push(l);
    i += 5 + n;
  }
  assert.strictEqual(i, bytes.length, 'whole lines');
  return out;
}

function texts(lines) {
  return lines.filter(function(l) { return l.text && l.glyph !== pagelines.CHIPS; })
    .map(function(l) { return l.text; });
}

function placeCard(name, opts) {
  var p = directory.buildPage(placeRef(name), CTX);
  return {page: p, lines: decode(pagelines.encode(pagelines.placeLines(p, opts)))};
}

test('place card on the Time 2: the 1.6.2 layout, line by line', function() {
  var c = placeCard('Royal Theater');
  var g = c.page.gps;
  assert.deepStrictEqual(texts(c.lines), ['Royal Theater', 'Deck 5' + DOT + 'Fore', 'Entertainment Place',
    'Closest restroom' + DOT + g.rest.text, 'Hold Select for its route', 'FROM YOUR CABIN',
    '5 decks' + DOT + g.text, 'Select for route']);
  var by = {};
  c.lines.forEach(function(l) { by[l.text] = l; });
  // Box tops as dir_window.c drew them (one-line name).
  var name = H[2];
  assert.strictEqual(by['Royal Theater'].top, -2);
  assert.strictEqual(by['Deck 5' + DOT + 'Fore'].top, name + 4);
  assert.strictEqual(by['Entertainment Place'].top, name + 26);
  assert.strictEqual(by['Hold Select for its route'].top, name + 62);
  assert.strictEqual(by['FROM YOUR CABIN'].top, name + 89);
  assert.strictEqual(by['Select for route'].top, name + 127);
  assert.strictEqual(by['5 decks' + DOT + g.text].glyph, pagelines.DOWN);
  assert.strictEqual(by['Select for route'].glyph, pagelines.CHEVRON);
  assert.strictEqual(by['Select for route'].color, pagelines.SEA);
  assert.ok(c.lines.every(function(l) { return !l.center; }));
  var dividers = c.lines.filter(function(l) { return l.glyph === pagelines.DIVIDER; });
  assert.deepStrictEqual(dividers.map(function(l) { return [l.top, l.maxH]; }), [[name + 86, 8], [name + 151, 8]]);
  // The card's height: the last (empty) line.
  assert.strictEqual(c.lines[c.lines.length - 1].top, name + 154);
});

test('place card on the Round 2: centered, one hint, short dividers', function() {
  var c = placeCard('Royal Theater', {round: true});
  assert.ok(c.lines.filter(function(l) { return l.text; }).every(function(l) { return l.center; }));
  assert.ok(texts(c.lines).indexOf('Hold Select for its route') < 0);
  assert.ok(texts(c.lines).indexOf('Select for route') >= 0);
  c.lines.filter(function(l) { return l.glyph === pagelines.DIVIDER; }).forEach(function(l) {
    assert.strictEqual(l.maxH, 17);
  });
  // Without a route (no stateroom), the restroom's hint stays.
  var p = directory.buildPage(placeRef('Studio B'), {bundle: makeBundle(), settings: {me: {deck: 'Deck 9'}}, now: NOW});
  var none = decode(pagelines.encode(pagelines.placeLines(p, {round: true})));
  assert.ok(texts(none).indexOf('Hold Select: restroom route') >= 0);
  assert.ok(texts(none).indexOf('Add your stateroom on the phone for walking directions') >= 0);
});

test('place card: ashore in the port accent, banks with their chips', function() {
  var ashore = placeCard('Perfect Day at CocoCay');
  assert.strictEqual(ashore.lines[1].text, 'Ashore');
  assert.strictEqual(ashore.lines[1].color, pagelines.PORT);
  var bank = directory.buildPage(directory.REF_BANK + 1, CTX);
  var lines = decode(pagelines.encode(pagelines.placeLines(bank)));
  var chips = lines.filter(function(l) { return l.glyph === pagelines.CHIPS; })[0];
  assert.deepStrictEqual(chips.bytes, [9].concat(bank.bank.decks));
  assert.deepStrictEqual(texts(lines).slice(0, 3), ['Aft elevators', 'Aft' + DOT + 'Decks 3-17', 'STOPS AT']);
});

test('whereText follows the watch: ranges, positions, ashore', function() {
  assert.strictEqual(pagelines.whereText({deck: 4, deckTo: 0, pos: 2}), 'Deck 4' + DOT + 'Mid');
  assert.strictEqual(pagelines.whereText({deck: 3, deckTo: 5, pos: 1}), 'Decks 3-5' + DOT + 'Fore');
  assert.strictEqual(pagelines.whereText({deck: 5, deckTo: 0, pos: 0}), 'Deck 5');
  assert.strictEqual(pagelines.whereText({ashore: true}), 'Ashore');
  assert.strictEqual(pagelines.whereText({deck: 0}), '');
});

function routeLines(page, opts) {
  return decode(pagelines.encode(pagelines.routeLines(page, opts)));
}

test('route on the Time 2: title, header, steps with glyphs, summary', function() {
  var p = directory.routePage(placeRef('Royal Theater'), false, CTX);
  var lines = routeLines(p);
  var t = texts(lines);
  assert.deepStrictEqual(t.slice(0, 2), ['Royal Theater', 'FROM YOUR CABIN']);
  var steps = lines.filter(function(l) { return l.glyph >= pagelines.STEP; });
  assert.deepStrictEqual(steps.map(function(l) { return [l.glyph - pagelines.STEP, l.text]; }),
                         p.steps.map(function(s) { return [s.glyph, s.text]; }));
  assert.strictEqual(steps[0].top, H[2] + 25);
  assert.ok(steps.every(function(l) { return !l.center && l.maxH === 44; }));
  var last = lines[lines.length - 2];
  assert.strictEqual(last.glyph, p.small.decks < 0 ? pagelines.DOWN : pagelines.UP);
  assert.strictEqual(last.text, '5 decks' + DOT + p.small.text);
});

test('route on the Round 2: header in the top bar, centered lines, steps left', function() {
  var p = directory.routePage(placeRef('Royal Theater'), true, CTX);
  var lines = routeLines(p, {round: true});
  assert.ok(texts(lines).indexOf(p.header) < 0);
  lines.forEach(function(l) {
    if (l.glyph === pagelines.DIVIDER) {
      assert.strictEqual(l.maxH, pagelines.ROUND_ROUTE_INSET);
    } else if (l.text) {
      assert.strictEqual(l.center, l.glyph < pagelines.STEP, l.text);
    }
  });
});

test('event route: the time follows the watch clock, two lines on the Round 2', function() {
  var start = 1440 + 20 * 60;
  var p = directory.eventRoutePage({start: start, venue: 'Studio B'}, CTX);
  assert.strictEqual(p.event.title, 'Ice Show: 1887');
  var t = texts(routeLines(p));
  assert.strictEqual(t[t.length - 1], '8:00p Ice Show: 1887');
  t = texts(routeLines(p, {h24: true}));
  assert.strictEqual(t[t.length - 1], '20:00 Ice Show: 1887');
  t = texts(routeLines(p, {round: true}));
  assert.deepStrictEqual(t.slice(-2), ['8:00p', 'Ice Show: 1887']);
});

test('messages: a "No route found" route keeps its lead', function() {
  var p = directory.routePage(placeRef('Perfect Day at CocoCay'), false, CTX);
  assert.ok(texts(routeLines(p)).indexOf(p.lead) > 0);
});

test('every real place page and route fits the watch on both watches', function() {
  directory.places('HM').forEach(function(v, i) {
    var ref = directory.REF_PLACE + i;
    var page = directory.buildPage(ref, CTX);
    [false, true].forEach(function(round) {
      var m = directory.message(page, {round: round});
      assert.ok(m.dir_lines.length + m.dir_rows.length <= directory.PAGE_MAX_BYTES, v.name);
      decode(m.dir_lines).forEach(function(l) {
        assert.ok(l.bytes.length <= pagelines.TEXT_MAX, v.name + ': ' + l.text);
        assert.ok(l.space > -128 && l.space < 127, v.name);
      });
      [false, true].forEach(function(rest) {
        var r = directory.routeMsg(directory.routePage(ref, rest, CTX), {round: round});
        assert.ok(r.route.length < 900, v.name + ' route ' + r.route.length);
        decode(r.route);
      });
    });
  });
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
