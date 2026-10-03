// Pages the watch draws line by line (docs/WATCH_PROTOCOL.md, Page lines):
// a directory place card and the Route screen. The phone lays them out for
// the watch it talks to: the Pebble Time 2 gets today's left-aligned pages,
// the Pebble Round 2 centered, shorter ones (docs/mockups/round/Place, Route).
// The watch only draws them (src/c/lines.c).

var pack = require('./pack');
var gpstext = require('./gpstext');

var DOT = ' · ';

// Fonts, the centered bit and the color tokens (the watch theme's field index).
var FONT_14 = 0;
var FONT_18 = 1;
var FONT_24 = 2;
var CENTER = 4;
var TEXT = 1;
var MUTED = 2;
var PORT = 4;
var SEA = 5;

// Glyphs.
var PLAIN = 0;
var UP = 1;
var DOWN = 2;
var CHEVRON = 3;
var DIVIDER = 4;
var CHIPS = 5;
var STEP = 8;  // + the step's glyph (gpstext GLYPH_*)

// One line's height in each font as the watch measures it (lines.h LINE_H14,
// LINE_H18, LINE_H24). Pages are laid out with them: a line that wraps on
// the watch pushes the rest down by itself.
var H = [14, 18, 24];
var TEXT_MAX = 63;  // the watch's line buffer is 64 bytes with the NUL
var CHIP_ROWS_H = 23;
var CHIPS_PER_ROW = 7;

// Dividers' inset from each side: full width on the Time 2, short on the
// Round 2 (the place card's 150 px, the Route screen's 110 px in a 184 px body).
var INSET = 8;
var ROUND_PLACE_INSET = 17;
var ROUND_ROUTE_INSET = 37;

var NO_CABIN_HINT = 'Add your stateroom on the phone for walking directions';
var GPS_APPROX = 1;
var GPS_NO_CABIN = 2;
var GPS_NO_FROM = 4;

// A page being laid out. Each line is placed by the y of its text box's top,
// as the watch screens laid them out before 1.6.3; `g` is where the watch's
// drawing stands after the last line (its top plus one line's height).
function Page(round) {
  this.round = !!round;
  this.lines = [];
  this.g = 0;
}

Page.prototype.push = function(line, top, next) {
  line.space = top - this.g;
  this.lines.push(line);
  this.g = next;
};

// A text line at `top`. o: {glyph, maxH (wrap limit, px; one line by
// default), center (default: centered on the Round 2), max (bytes)}.
Page.prototype.text = function(top, font, color, text, o) {
  o = o || {};
  var center = o.center === undefined ? this.round : o.center;
  text = text || '';
  this.push({style: font | (center ? CENTER : 0) | (color << 3), glyph: o.glyph || PLAIN, maxH: o.maxH || H[font],
             bytes: pack.utf8(text, o.max || TEXT_MAX)}, top, top + (text ? H[font] : 0));
};

// `text` after a drawn arrow and `1 deck` / `N decks` when decks isn't 0.
Page.prototype.arrow = function(top, font, color, decks, text) {
  if (!decks) {
    this.text(top, font, color, text);
    return;
  }
  this.text(top, font, color, gpstext.deckText(decks) + (text ? DOT + text : ''), {glyph: decks > 0 ? UP : DOWN});
};

Page.prototype.divider = function(y, inset) {
  this.push({style: 0, glyph: DIVIDER, maxH: inset, bytes: []}, y, y);
};

// An elevator bank's deck chips; the cabin's deck is filled.
Page.prototype.chips = function(top, cabin, decks) {
  var rows = Math.ceil(decks.length / CHIPS_PER_ROW);
  this.push({style: 0, glyph: CHIPS, maxH: 0, bytes: [cabin || 255].concat(decks.slice(0, TEXT_MAX - 1))},
            top, top + rows * CHIP_ROWS_H);
};

// Moves to y (the page's height) with an empty line.
Page.prototype.end = function(y) {
  this.push({style: 0, glyph: PLAIN, maxH: 0, bytes: []}, y, y);
};

function clampSpace(n) {
  return Math.max(-128, Math.min(127, n)) & 255;
}

// uint8 style, uint8 glyph, int8 space, uint8 max_h, then the text as uint8
// length and bytes, line after line.
function encode(page) {
  var out = [];
  page.lines.forEach(function(l) {
    out = out.concat([l.style & 255, l.glyph & 255, clampSpace(l.space), l.maxH & 255, l.bytes.length], l.bytes);
  });
  return out;
}

var POSITIONS = ['', 'Fore', 'Mid', 'Aft'];

// "Deck 4 · Mid", "Decks 3-5 · Fore", "Deck 5" or "Ashore" (ui.c fmt_where).
function whereText(w) {
  if (w.ashore) {
    return 'Ashore';
  }
  if (!(w.deck > 0)) {
    return '';
  }
  var range = w.deckTo > w.deck;
  var pos = POSITIONS[w.pos | 0] || '';
  return (range ? 'Decks ' + w.deck + '-' + w.deckTo : 'Deck ' + w.deck) + (pos ? DOT + pos : '');
}

// What Select and Hold Select do on a place page's heading.
function placeActions(page) {
  var g = page.gps;
  var place = !!(page.where || page.bank);
  return {
    place: place,
    route: place && !!g && !(g.flags & (GPS_NO_CABIN | GPS_NO_FROM)),
    rest: !!page.where && !!g && !!g.rest
  };
}

// The card at the top of a directory page with a heading (docs/DESIGN.md
// §10.2): the name; for an elevator bank its line, STOPS AT and the chips;
// where the place is and, without a FROM block, how far from the cabin; its
// area; the closest restroom; the Ship GPS FROM block. `opts.round`: the
// Round 2's centered card (docs/mockups/round/Place).
function placeLines(page, opts) {
  var round = !!(opts && opts.round);
  var P = new Page(round);
  var head = page.rows[0];
  var inset = round ? ROUND_PLACE_INSET : INSET;
  var acts = placeActions(page);
  var y = 2;
  P.text(y - 4, FONT_24, TEXT, head.line1, {maxH: 58, max: 39});
  y += H[FONT_24] + 4;
  if (page.bank) {
    P.text(y - 2, FONT_18, TEXT, page.bank.text, {max: 31});
    P.text(y + 21, FONT_14, MUTED, 'STOPS AT');
    P.chips(y + 40, page.bank.cabin, page.bank.decks);
    y += 40 + Math.ceil(page.bank.decks.length / CHIPS_PER_ROW) * CHIP_ROWS_H;
  }
  var w = page.where;
  var where = w ? whereText(w) : '';
  if (where) {
    P.text(y - 2, FONT_18, w.ashore ? PORT : TEXT, where);
    y += 22;
    if (w.deck > 0 && typeof w.rel === 'number') {
      if (w.rel === 0) {
        P.text(y - 2, FONT_14, MUTED, 'On your cabin deck');
      } else {
        P.arrow(y - 2, FONT_14, MUTED, w.rel, 'from cabin');
      }
      y += 18;
    }
  }
  if (head.line2) {
    P.text(y - 2, FONT_14, MUTED, head.line2, {max: 31});
    y += 18;
  }
  var g = page.gps;
  if (g && g.rest) {
    if (!g.rest.decks) {
      // One line, or two when it doesn't fit; shorter in the Round 2's narrow column.
      P.text(y - 2, FONT_14, MUTED, (round ? 'Restroom' : 'Closest restroom') + DOT + g.rest.text, {maxH: 40});
      y += 18;
    } else {
      P.text(y - 2, FONT_14, MUTED, 'Closest restroom');
      P.arrow(y + 16, FONT_14, MUTED, g.rest.decks, g.rest.text);
      y += 36;
    }
    // The Round 2 keeps one hint: Select's, when there is one.
    if (!round || !acts.route) {
      P.text(y - 2, FONT_14, SEA, round ? 'Hold Select: restroom route' : 'Hold Select for its route',
             {maxH: round ? 34 : H[FONT_14]});
      y += 18;
    }
  }
  if (g && !(g.flags & GPS_NO_FROM)) {
    if (g.flags & GPS_NO_CABIN) {
      P.text(y - 2, FONT_14, MUTED, NO_CABIN_HINT, {maxH: round ? 54 : 36});
      y += H[FONT_14] + 2;
    } else {
      y += 4;
      P.divider(y, inset);
      P.text(y + 3, FONT_14, MUTED, g.header, {max: 31});
      y += 21;
      P.arrow(y - 2, FONT_18, TEXT, g.decks, g.text);
      y += 22;
      if (g.flags & GPS_APPROX) {
        P.text(y - 2, FONT_14, MUTED, 'Spot approximate');
        y += 18;
      }
      P.text(y - 2, FONT_14, SEA, 'Select for route', {glyph: CHEVRON});
      y += 18;
    }
    y += 4;
    P.divider(y, inset);
    y += 1;
  }
  P.end(y + 2);
  return P;
}

// Cruise minutes as the watch shows a time: "5:00p" or "17:00" (ui.c fmt_clock).
function clock(min, h24) {
  var m = ((min % 1440) + 1440) % 1440;
  var h = Math.floor(m / 60);
  var mm = (m % 60 < 10 ? '0' : '') + (m % 60);
  return h24 ? h + ':' + mm : (h % 12 === 0 ? 12 : h % 12) + ':' + mm + (h < 12 ? 'a' : 'p');
}

// The Route screen (docs/DESIGN.md §10.3): the destination, the header (on
// the Round 2 it goes in the top bar instead), a divider, the lead line, the
// steps with their glyphs, then under a divider the restroom's deck, the
// summary with its deck arrow and, for Home's NEXT, the event's time and title.
// opts: {round, h24 (the watch shows 24-hour time)}.
function routeLines(page, opts) {
  opts = opts || {};
  var round = !!opts.round;
  var P = new Page(round);
  var inset = round ? ROUND_ROUTE_INSET : INSET;
  var y = 2;
  P.text(y - 4, FONT_24, TEXT, page.title, {maxH: 58, max: 39});
  y += H[FONT_24] + 2;
  if (page.header && !round) {
    P.text(y - 2, FONT_14, MUTED, page.header, {max: 31});
    y += 18;
  }
  y += 2;
  P.divider(y, inset);
  y += 5;
  if (page.lead) {
    P.text(y - 4, FONT_18, TEXT, page.lead, {maxH: 66});
    y += H[FONT_18] + 2;
  }
  page.steps.forEach(function(st) {
    P.text(y - 4, FONT_18, TEXT, st.text, {glyph: STEP + (st.glyph & 7), maxH: 44, center: false, max: 39});
    y += H[FONT_18] + 2;
  });
  var small = page.small || {decks: 0, text: ''};
  var ev = page.event;
  if (page.big || small.text || ev) {
    y += 2;
    P.divider(y, inset);
    y += 5;
    if (page.big) {
      P.text(y - 4, FONT_18, TEXT, page.big, {max: 31});
      y += 20;
    }
    if (small.text) {
      P.arrow(y - 2, FONT_14, MUTED, small.decks, small.text);
      y += 18;
    }
    if (ev) {
      var time = ev.start === undefined || ev.start < 0 ? '' : clock(ev.start, opts.h24);
      if (round) {
        P.text(y - 2, FONT_14, MUTED, time);
        y += 18;
        P.text(y - 2, FONT_14, MUTED, ev.title, {maxH: 34});
      } else {
        P.text(y - 2, FONT_14, MUTED, (time ? time + ' ' : '') + ev.title, {maxH: 34});
      }
      y += H[FONT_14];
    }
  }
  // The watch's scroll page adds 6 px below; the screen had 4.
  P.end(y - 2);
  return P;
}

module.exports = {
  FONT_14: FONT_14, FONT_18: FONT_18, FONT_24: FONT_24, CENTER: CENTER, TEXT: TEXT, MUTED: MUTED, PORT: PORT,
  SEA: SEA, PLAIN: PLAIN, UP: UP, DOWN: DOWN, CHEVRON: CHEVRON, DIVIDER: DIVIDER, CHIPS: CHIPS, STEP: STEP, H: H,
  TEXT_MAX: TEXT_MAX, ROUND_ROUTE_INSET: ROUND_ROUTE_INSET,
  Page: Page, encode: encode, whereText: whereText, placeActions: placeActions, placeLines: placeLines,
  routeLines: routeLines, clock: clock
};
