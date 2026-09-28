// Voice cards (docs/WATCH_PROTOCOL.md, Voice; docs/DESIGN_V1_1.md §9.6).
//
// The watch sends what dictation heard; the phone answers with a card that the
// watch only draws: up to four label/value rows, a hint line, and what Select
// does. All wording lives here, so it changes without touching the watch.
//
// Commands that need no place names are answered here with real data too
// (owner, 2026-09-28): "I'm on board" / "I'm ashore" (§22.6), "When do we
// leave?", "What's tomorrow?", "Where's my muster station?" and "Take me to my
// cabin". The watch sends whether today's on-board flag is set and its clock
// style (`state`), so cards say "Already on board" and show times as it does.
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
var STATE_24H = 2;      // VOICE voice_state: the watch shows 24-hour time

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

// Cruise minutes as the watch shows a time: "5:00p" or "17:00" (ui.c fmt_clock).
function clock(min, state) {
  var m = ((min % 1440) + 1440) % 1440;
  var h = Math.floor(m / 60);
  var mm = (m % 60 < 10 ? '0' : '') + (m % 60);
  if (state & STATE_24H) {
    return h + ':' + mm;
  }
  return (h % 12 === 0 ? 12 : h % 12) + ':' + mm + (h < 12 ? 'a' : 'p');
}

// A ship time, with the port's local time when it differs: "5:00p · 6:00p local".
function shipTime(min, day, state) {
  return clock(min, state) + (day.localOffset ? ' \u00b7 ' + clock(min + day.localOffset, state) + ' local' : '');
}

var DEPART = /\b(?:when|what time)\b.*\b(?:leave|leaving|sail|sailing|depart|departing|departure|sail ?away)\b|\b(?:departure time|sail ?away time)\b/;
var TOMORROW = /\btomorrow'?s?\b/;
var MUSTER = /\bmust(?:er|ard)\b/;
var CABIN = /\bto (?:my|our) (?:cabin|room|state ?room)\b|\btake (?:me|us) home\b|\bback to (?:the|my|our) (?:cabin|room|state ?room)\b/;

// "When do we leave?": today's port, departure and all-aboard.
function departCard(heard, today, state) {
  var d = today.day;
  if (d.kind !== slice.DAY_PORT || d.depart === slice.NO_TIME) {
    return {action: ACT_NONE, rows: [heard, {label: '', value: d.kind === slice.DAY_SEA ? 'At sea today' :
      d.kind === slice.DAY_PORT ? 'No departure today' : 'No cruise today'}], hint: 'Ask "What\'s tomorrow?"'};
  }
  var rows = [heard, {label: 'TODAY', value: d.location},
              {label: today.now > d.depart ? 'DEPARTED' : 'DEPARTS', value: shipTime(d.depart, d, state)}];
  if (d.allAboard !== slice.NO_TIME) {
    rows.push({label: 'ALL ABOARD', value: shipTime(d.allAboard, d, state)});
  }
  return {action: ACT_NONE, rows: rows, hint: ''};
}

// "What's tomorrow?": tomorrow's port with arrival and all-aboard, or at sea.
function tomorrowCard(heard, today, state) {
  var d = today.tomorrow;
  if (d.kind === slice.DAY_NONE) {
    return {action: ACT_NONE, rows: [heard, {label: 'TOMORROW', value: today.day.kind === slice.DAY_NONE ?
      'No cruise' : 'The cruise has ended'}], hint: ''};
  }
  if (d.kind === slice.DAY_SEA) {
    return {action: ACT_NONE, rows: [heard, {label: 'TOMORROW', value: 'At sea'}], hint: ''};
  }
  var rows = [heard, {label: 'TOMORROW', value: d.location}];
  if (d.arrive !== slice.NO_TIME) {
    rows.push({label: 'ARRIVES', value: shipTime(d.arrive, d, state)});
  }
  if (d.allAboard !== slice.NO_TIME) {
    rows.push({label: 'ALL ABOARD', value: shipTime(d.allAboard, d, state)});
  } else if (d.depart !== slice.NO_TIME) {
    rows.push({label: 'DEPARTS', value: shipTime(d.depart, d, state)});
  }
  return {action: ACT_NONE, rows: rows, hint: ''};
}

// "Where's my muster station?": from the Me tab or the booking, with a route
// when it names a place on the map (the longest match).
function musterCard(heard, ctx) {
  var muster = slice.myInfo(ctx.bundle, (ctx.settings || {}).me || {}).muster;
  if (!muster || muster === 'Not set') {
    return {action: ACT_NONE, rows: [heard, {label: 'MUSTER STATION', value: 'Not set'}],
            hint: 'Add it on the phone: Me, Safety'};
  }
  var ship = (ctx.bundle.ship && ctx.bundle.ship.code) || '';
  var low = muster.toLowerCase();
  var place = null;
  directory.places(ship, ((ctx.settings || {}).venues || {})[ship]).forEach(function(v, i) {
    if (v.decks.length && low.indexOf(v.name.toLowerCase()) !== -1 && (!place || v.name.length > place.name.length)) {
      place = {name: v.name, ref: directory.REF_PLACE + i};
    }
  });
  var rows = [heard, {label: 'MUSTER STATION', value: muster}];
  if (!place) {
    return {action: ACT_NONE, rows: rows, hint: 'Not a place on the map'};
  }
  return {action: ACT_ROUTE, ref: place.ref, rows: rows, hint: 'Select: route to ' + place.name,
          title: place.name, header: ''};
}

// "Take me to my cabin": the route from where routestart.js says you are.
function cabinCard(heard, ctx) {
  var page = directory.routePage(directory.REF_CABIN, false, ctx);
  if (!page.steps.length) {
    return {action: ACT_NONE, rows: [heard, {label: 'TO', value: 'Your cabin'}], hint: page.lead};
  }
  return {action: ACT_ROUTE, ref: directory.REF_CABIN,
          rows: [heard, {label: 'FROM', value: page.from || page.header}, {label: 'TO', value: 'Your cabin'}],
          hint: 'Select: route \u00b7 Hold: ask again', title: 'Your cabin', header: page.header};
}

// The answer to `text` (see the top of this file). `state`: the watch's
// voice_state bits.
function answer(text, ctx, isDemo, state) {
  var heard = {label: 'HEARD', value: '\u201c' + text + '\u201d'};
  var t = (text || '').toLowerCase();
  state = state | 0;
  var on = onboardIntent(t);
  if (on !== null) {
    return onboardCard(on, heard, ctx, state);
  }
  var hasCruise = !!(ctx.bundle && ctx.bundle.sailDate);
  if (hasCruise && CABIN.test(t)) {
    return cabinCard(heard, ctx);
  }
  if (hasCruise && MUSTER.test(t)) {
    return musterCard(heard, ctx);
  }
  if (hasCruise && TOMORROW.test(t)) {
    return tomorrowCard(heard, slice.today(ctx.bundle, ctx.settings, ctx.now || new Date()), state);
  }
  if (hasCruise && DEPART.test(t)) {
    return departCard(heard, slice.today(ctx.bundle, ctx.settings, ctx.now || new Date()), state);
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
  FLAG_REST: FLAG_REST, FLAG_ONBOARD: FLAG_ONBOARD, STATE_ONBOARD: STATE_ONBOARD, STATE_24H: STATE_24H, clock: clock,
  packCard: packCard, placeRef: placeRef, answer: answer, onboardIntent: onboardIntent
};
