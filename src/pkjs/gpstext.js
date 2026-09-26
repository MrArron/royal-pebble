// Ship GPS text for the watch (docs/DESIGN_V1_1.md §9.1-9.2): distances in the
// owner's units, route steps and the FROM / summary lines, from shipmap.js routes.
// Phone only. The watch draws the arrows and step glyphs itself, so deck changes
// come back as numbers and each step has a glyph code.
'use strict';

var UNITS = ['m', 'ft', 'steps'];
var FEET_PER_METRE = 3.2808;
var DOT = ' ' + String.fromCharCode(183) + ' ';
var UP = String.fromCharCode(0x2191);
var DOWN = String.fromCharCode(0x2193);
var STRIDE = 0.75;          // metres per step; to check on board (§9.8)
var LOBBY_NEAR = 12;        // stairs this close to a bank are that bank's stairs

// Step glyphs (drawn on the watch, §9.2).
var GLYPH_WALK = 0;
var GLYPH_CROSS = 1;
var GLYPH_ELEVATOR = 2;
var GLYPH_STAIRS = 3;
var GLYPH_ARRIVE = 4;

function unitOf(opts) {
  return UNITS.indexOf(opts && opts.units) !== -1 ? opts.units : 'm';
}

// "50 m", "160 ft", "210 steps": rounded to 5 under 50, else to 10.
function distance(metres, units) {
  var n = units === 'ft' ? metres * FEET_PER_METRE : units === 'steps' ? metres / STRIDE : metres;
  n = n < 50 ? Math.max(5, Math.round(n / 5) * 5) : Math.round(n / 10) * 10;
  return n + ' ' + (units === 'ft' ? 'ft' : units === 'steps' ? 'steps' : 'm');
}

function towardWord(toward) {
  return toward === 'forward' ? 'fore' : toward === 'aft' ? 'aft' : '';
}

function walkText(metres, toward, units) {
  var t = towardWord(toward);
  return distance(metres, units) + (t ? ' ' + t : '');
}

function sideWord(side) {
  return side === 'Port' ? 'port' : side === 'Starboard' ? 'stbd' : '';
}

// "1 deck", "2 decks".
function deckText(n) {
  n = Math.abs(n);
  return n + (n === 1 ? ' deck' : ' decks');
}

// Fore / Mid / Aft for a spot, split at the elevator banks ({fwd, aft}).
function zone(a, banks) {
  if (a < banks.fwd + LOBBY_NEAR) {
    return 'Fore';
  }
  return a > banks.aft - LOBBY_NEAR ? 'Aft' : 'Mid';
}

// Is this route too unsure to give step by step? Then show less (§9.2).
function reduced(r) {
  return !!(r && (r.approx || r.unsure));
}

function toDeck(r) {
  return r.to ? r.to.deck : r.steps[r.steps.length - 1].deck;
}

// Overall fore/aft from the start to the destination.
function overallToward(from, to) {
  if (!from || !to || Math.abs(to.a - from.a) < 3) {
    return null;
  }
  return to.a > from.a ? 'aft' : 'forward';
}

// Route steps for the Route screen: [{glyph, text}], ending with the arrival.
// opts: {units, sides (port/starboard confirmed on board), banks ({fwd, aft}),
// name (destination as shown)}. A reduced route gives the deck ("To Deck 5") and
// the overall fore/aft distance only.
function steps(r, from, opts) {
  opts = opts || {};
  var units = unitOf(opts);
  var dest = opts.name || (r.to && r.to.name) || '';
  var out = [];
  if (reduced(r)) {
    var decks = toDeck(r) - (from ? from.deck : toDeck(r));
    var line = walkText(r.metres, overallToward(from, r.to || null) || (r.steps[0] && r.steps[0].toward), units);
    if (decks) {
      out.push({glyph: GLYPH_STAIRS, text: 'To Deck ' + toDeck(r)});
    }
    out.push({glyph: GLYPH_WALK, text: line});
  } else {
    r.steps.forEach(function(s) {
      if (s.do === 'walk') {
        out.push({glyph: GLYPH_WALK, text: walkText(s.metres, s.toward, units)});
      } else if (s.do === 'cross') {
        out.push({glyph: GLYPH_CROSS, text: opts.sides ? 'Cross to ' + sideWord(s.to) : 'Cross the ship'});
      } else if (s.do === 'elevator') {
        out.push({glyph: GLYPH_ELEVATOR, text: (s.bank === 'Forward' ? 'Fore' : 'Aft') + ' elev to Deck ' + s.to});
      } else if (s.do === 'stairs') {
        var where = opts.banks && s.a !== undefined ? zone(s.a, opts.banks) + ' stairs' : 'Stairs';
        out.push({glyph: GLYPH_STAIRS, text: where + ' to Deck ' + s.to});
      }
    });
  }
  var side = opts.sides && r.to && !reduced(r) ? sideWord(r.to.side) : '';
  out.push({glyph: GLYPH_ARRIVE, text: dest + (side ? DOT + side + ' side' : '')});
  return out;
}

// The line under the steps: {decks (signed, + = up), text: "100 m in all"}.
function summary(r, from, opts) {
  var decks = from ? toDeck(r) - from.deck : 0;
  return {decks: decks, text: distance(r.metres, unitOf(opts)) + (reduced(r) ? '' : ' in all')};
}

// A place page's FROM line (§9.1): {decks, text}. On the same deck the text
// starts "Your deck · " when the start is the cabin, "Same deck · " otherwise;
// with a deck change the watch draws the arrow and deckText() before the text.
function fromLine(r, from, opts) {
  opts = opts || {};
  var decks = from ? toDeck(r) - from.deck : 0;
  // A reduced answer (shipmap's approxRoute) has no `to`, but knows its toward.
  var text = walkText(r.metres, r.to ? overallToward(from, r.to) : r.toward, unitOf(opts));
  if (!decks) {
    text = (opts.fromCabin ? 'Your deck' : 'Same deck') + DOT + text;
  }
  return {decks: decks, text: text};
}

// Plain text of a {decks, text} line with arrows, for tests and the phone.
function plain(line) {
  if (!line.decks) {
    return line.text;
  }
  return (line.decks > 0 ? UP : DOWN) + deckText(line.decks) + DOT + line.text;
}

// "Closest restroom · 30 m aft", or with a deck change the second line alone:
// {decks, text}. From shipmap.restroom() (the route from the venue).
function restroomLine(rest, from, opts) {
  var decks = from ? rest.deck - from.deck : 0;
  return {decks: decks, text: walkText(rest.metres, overallToward(from, rest), unitOf(opts))};
}

// The start header: "FROM YOUR CABIN", "FROM SOLARIUM" (short venue name).
function fromHeader(start, shortName) {
  if (start.kind === 'cabin') {
    return 'FROM YOUR CABIN';
  }
  if (start.cabin) {
    return 'FROM CABIN ' + start.cabin;
  }
  return 'FROM ' + String(shortName || start.venue || '').toUpperCase();
}

module.exports = {
  UNITS: UNITS,
  STRIDE: STRIDE,
  GLYPH_WALK: GLYPH_WALK,
  GLYPH_CROSS: GLYPH_CROSS,
  GLYPH_ELEVATOR: GLYPH_ELEVATOR,
  GLYPH_STAIRS: GLYPH_STAIRS,
  GLYPH_ARRIVE: GLYPH_ARRIVE,
  distance: distance,
  deckText: deckText,
  zone: zone,
  reduced: reduced,
  steps: steps,
  summary: summary,
  fromLine: fromLine,
  restroomLine: restroomLine,
  fromHeader: fromHeader,
  plain: plain
};
