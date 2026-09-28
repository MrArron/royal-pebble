// Voice cards (docs/WATCH_PROTOCOL.md, Voice; docs/DESIGN_V1_1.md §9.6).
//
// The watch sends what dictation heard; the phone answers with a card that the
// watch only draws: up to four label/value rows, a hint line, and what Select
// does. All wording lives here, so it changes without touching the watch.
//
// Until the voice matcher is in (Phase 5 PR V2/V3), `answer` is a stand-in:
// with demo data it shows each kind of card from a few key words, so the watch
// screens can be tried with `pebble transcribe` on the emulator; with real data
// it says matching isn't built yet.
'use strict';

var pack = require('./pack');
var directory = require('./directory');

var ACT_NONE = 0;     // Select asks again
var ACT_ROUTE = 1;    // Select opens the Route screen for place page `ref`
var ACT_CONFIRM = 2;  // Select sends the confirm (e.g. "I'm at ...") and closes

var FLAG_REST = 1;    // ACT_ROUTE: the closest restroom from place `ref`

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
  var out = [card.action | 0, card.rest ? FLAG_REST : 0, ref & 255, (ref >> 8) & 255, (ref >> 16) & 255,
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

// The stand-in answer to `text` (see the top of this file).
function answer(text, ctx, isDemo) {
  var heard = {label: 'HEARD', value: '“' + text + '”'};
  var t = (text || '').toLowerCase();
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
  ACT_NONE: ACT_NONE, ACT_ROUTE: ACT_ROUTE, ACT_CONFIRM: ACT_CONFIRM, FLAG_REST: FLAG_REST,
  packCard: packCard, placeRef: placeRef, answer: answer
};
