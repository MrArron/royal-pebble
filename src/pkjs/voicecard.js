// Voice cards (docs/WATCH_PROTOCOL.md, Voice; docs/DESIGN_V1_1.md §9.6).
//
// The watch sends what dictation heard; the phone answers with a card that the
// watch only draws: up to four label/value rows, a hint line, and what Select
// does. All wording lives here, so it changes without touching the watch.
//
// "I'm on board" and "I'm ashore" (§22.6) are answered here with real data
// too: they need no place names. The watch sends whether today's on-board flag
// is set (`state`, STATE_ONBOARD), so the card can say when there's nothing to
// change; Select sets or clears the flag on the watch.
//
// For everything else, until the voice matcher is in (Phase 5 PR V2/V3), `answer` is a stand-in:
// with demo data it shows each kind of card from a few key words, so the watch
// screens can be tried with `pebble transcribe` on the emulator; with real data
// it says matching isn't built yet.
'use strict';

var pack = require('./pack');
var slice = require('./slice');
var directory = require('./directory');

var ACT_NONE = 0;     // Select asks again
var ACT_ROUTE = 1;    // Select opens the Route screen for place page `ref`
var ACT_CONFIRM = 2;  // Select sends the confirm (e.g. "I'm at ...") and closes
var ACT_ONBOARD = 3;  // Select sets (FLAG_ONBOARD) or clears the watch's on-board flag and closes

var FLAG_REST = 1;    // ACT_ROUTE: the closest restroom from place `ref`
var FLAG_ONBOARD = 2; // ACT_ONBOARD: on board (else back ashore)

var STATE_ONBOARD = 1;  // VOICE voice_state: today's on-board flag is set

// The watch's buffers, less the NUL (ask_window.c).
var ROWS_MAX = 4;
var LABEL_MAX = 15;
var VALUE_MAX = 63;
var HINT_MAX = 47;
var TITLE_MAX = 31;

function str(text, max) {
  var b = pack.utf8(text || '', max);
  return [b.length].concat(b);
}

// {action, rest, ref, rows: [{label, value}], hint, title, header} -> bytes:
// uint8 action, uint8 flags, int32 ref, uint8 row count, per row label and
// value, the hint, then for a route its title and header (strings: uint8
// length, UTF-8).
function packCard(card) {
  var ref = card.ref | 0;
  var rows = (card.rows || []).slice(0, ROWS_MAX);
  var flags = (card.rest ? FLAG_REST : 0) | (card.onboard ? FLAG_ONBOARD : 0);
  var out = [card.action | 0, flags, ref & 255, (ref >> 8) & 255, (ref >> 16) & 255,
             (ref >> 24) & 255, rows.length];
  rows.forEach(function(r) {
    out = out.concat(str(r.label, LABEL_MAX), str(r.value, VALUE_MAX));
  });
  out = out.concat(str(card.hint, HINT_MAX));
  if (card.action === ACT_ROUTE) {
    out = out.concat(str(card.title, TITLE_MAX), str(card.header, TITLE_MAX));
  }
  return out;
}

// Place page ref for a place named `name` on the current ship, or -1.
function placeRef(name, ctx) {
  var ship = (ctx.bundle && ctx.bundle.ship && ctx.bundle.ship.code) || '';
  var list = directory.places(ship, ((ctx.settings || {}).venues || {})[ship]);
  for (var i = 0; i < list.length; i++) {
    if (list[i].name === name) {
      return directory.REF_PLACE + i;
    }
  }
  return -1;
}

// "I'm on board" / "we're back on the ship"; "I'm ashore" / "going ashore" /
// "I'm off the ship". Not "when is all aboard" (no "I'm" or "back" before it).
// Dictation sometimes splits "I'm" ("I' m", "i m").
var I_AM = "\\b(?:i ?'? ?m|i am|we ?'? ?re|we are)";
var ONBOARD = new RegExp('(?:' + I_AM + ' (?:back )?(?:on ?board|aboard|on the ship)|back (?:on ?board|aboard|on the ship))');
var ASHORE = new RegExp('(?:' + I_AM + ' (?:going |back )?(?:ashore|on shore|off the ship)|' +
                        '(?:going|back) ashore|(?:leaving|left|getting off) the ship)');

// Whether `t` (lower case) asks to set or clear the on-board flag: true, false, or null.
function onboardIntent(t) {
  return ASHORE.test(t) ? false : ONBOARD.test(t) ? true : null;
}

// The card for "I'm on board" (on true) or "I'm ashore" (§22.6). The flag
// only means something on a port or embark day with an all-aboard time.
function onboardCard(on, heard, ctx, state) {
  var today = ctx.bundle && ctx.bundle.sailDate ? slice.today(ctx.bundle, ctx.settings, ctx.now || new Date()) : null;
  var isSet = !!(state & STATE_ONBOARD);
  if (!today || today.day.kind !== slice.DAY_PORT || today.day.allAboard === slice.NO_TIME) {
    return {action: ACT_NONE, rows: [heard, {label: '', value: today && today.day.kind === slice.DAY_SEA ?
      'At sea today' : 'No all-aboard today'}], hint: 'On board only counts on port days'};
  }
  if (on === isSet) {
    return {action: ACT_NONE, rows: [heard, {label: 'YOU\'RE', value: on ? 'Already on board' : 'Already ashore'}],
            hint: 'Nothing to change. Hold Select to ask again'};
  }
  return on ? {action: ACT_ONBOARD, onboard: true, rows: [heard, {label: 'YOU\'RE', value: 'On board'}],
               hint: 'Select: all-aboard alerts off for today'}
            : {action: ACT_ONBOARD, onboard: false, rows: [heard, {label: 'YOU\'RE', value: 'Back ashore'}],
               hint: 'Select: all-aboard alerts back on'};
}

// The answer to `text` (see the top of this file). `state`: the watch's
// voice_state bits.
function answer(text, ctx, isDemo, state) {
  var heard = {label: 'HEARD', value: '“' + text + '”'};
  var t = (text || '').toLowerCase();
  var on = onboardIntent(t);
  if (on !== null) {
    return onboardCard(on, heard, ctx, state | 0);
  }
  if (!isDemo) {
    return {action: ACT_NONE, rows: [heard, {label: '', value: 'Not yet'}],
            hint: 'Voice matching comes in the next update'};
  }
  var theater = placeRef('Royal Theater', ctx);
  if (/restroom|bathroom|toilet/.test(t) && theater >= 0) {
    return {action: ACT_ROUTE, rest: true, ref: theater,
            rows: [heard, {label: 'FROM', value: 'Royal Theater'}, {label: 'TO', value: 'Closest restroom'}],
            hint: 'Select: route · Hold: ask again', title: 'Restroom', header: 'CLOSEST TO ROYAL THEATER'};
  }
  if (/i ?'? ?m at|i am at/.test(t)) {
    return {action: ACT_CONFIRM,
            rows: [heard, {label: 'YOU\'RE AT', value: 'Solarium'}],
            hint: 'Select: start routes here for 90 min'};
  }
  if (/theater|theatre|get to|where/.test(t) && theater >= 0) {
    return {action: ACT_ROUTE, ref: theater,
            rows: [heard, {label: 'FROM', value: 'Your cabin'}, {label: 'TO', value: 'Royal Theater'}],
            hint: 'Select: route · Hold: ask again', title: 'Royal Theater', header: 'FROM YOUR CABIN'};
  }
  return {action: ACT_NONE, rows: [heard, {label: 'TRY', value: 'How do I get to the Windjammer?'}],
          hint: 'No place matched. Select to ask again'};
}

module.exports = {
  ACT_NONE: ACT_NONE, ACT_ROUTE: ACT_ROUTE, ACT_CONFIRM: ACT_CONFIRM, ACT_ONBOARD: ACT_ONBOARD,
  FLAG_REST: FLAG_REST, FLAG_ONBOARD: FLAG_ONBOARD, STATE_ONBOARD: STATE_ONBOARD,
  packCard: packCard, placeRef: placeRef, answer: answer, onboardIntent: onboardIntent
};
