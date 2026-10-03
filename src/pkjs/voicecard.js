// Voice cards (docs/WATCH_PROTOCOL.md, Voice; docs/DESIGN.md §11).
//
// The watch sends what dictation heard; the phone answers with a card that the
// watch only draws: up to four label/value rows, a hint line, and what Select
// does. All wording lives here, so it changes without touching the watch.
//
// Commands that need no place names are answered here with real data too
// (owner, 2026-09-28): "I'm on board" / "I'm ashore" (§4.4), "When do we
// leave?", "What's tomorrow?", "Where's my muster station?" and "Take me to my
// cabin". The watch sends whether today's on-board flag is set and its clock
// style (`state`), so cards say "Already on board" and show times as it does.
//
// Everything else goes to the voice matcher (voice.js, Phase 5 V3): places,
// groups, cabins, elevators, the closest bar or coffee, a snack, and the
// answers for what it can't do (docs/DESIGN.md §11, VOICE_FINAL_PLAN
// decisions D1-D22). The commands above keep precedence. Routes use the Route
// screen refs (directory.js).
//
// Where routes start (1.5.9, §10.4, routestart.js): `I'm at X` answers YOU'RE AT
// X and sets the spoken start as soon as the card is shown (the card's `start`
// with `set`, saved by index.js; 90 minutes, D22; 1.5.10, owner: Hold to ask the
// next question kept nothing before). Select or Hold keep it; the watch doesn't
// report Back, so the hint says to undo with `Forget where I am`, which clears
// it (Select on its card, `forget`). A start said in the question (`from X to
// Y`) routes from X: the card's `start` goes with the route, and index.js uses it
// for that Route screen; with `I'm at X, how do I get to Y` the start is saved
// when the card shows too (D4). Only one-spot places and cabins can be a start
// (D7, D8, D12, D19).
'use strict';

var pack = require('./pack');
var textfit = require('./textfit');
var slice = require('./slice');
var directory = require('./directory');
var voice = require('./voice');
var cabins = require('./cabins');
var venues = require('./venues');

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
// Dictation heard "I'm ashore" as "I'm sure." on the watch (usage log,
// 2026-09-28); only when that's all that was said.
var SURE = /^\s*i ?'? ?m sure[.!]?\s*$/;

function onboardIntent(t) {
  return ASHORE.test(t) || SURE.test(t) ? false : ONBOARD.test(t) ? true : null;
}

// The card for "I'm on board" (on true) or "I'm ashore" (§4.4). The flag
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
var RESTROOM = /\b(?:bathroom|restroom|rest room|toilet|washroom|lavatory|loo|men'?s room|ladies'? room)s?\b/;
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

// ctx with a start said in the question (`place`: {venue} | {cabin} | {mine}):
// directory.js routes from it (routestart.js `from`).
function withFrom(ctx, place) {
  var out = {};
  Object.keys(ctx).forEach(function(k) { out[k] = ctx[k]; });
  out.from = place;
  return out;
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

// "Nearest bathroom": the route to the closest restroom from where you are
// now (a starred event on now, else the cabin). A place named in the question
// ("restroom near the theater") needs the matcher; until then the FROM row
// shows where it starts.
// With `deck` (D10): the closest one on that deck.
function restroomCard(heard, ctx, deck) {
  var ref = deck ? directory.REF_REST_DECK + deck : directory.REF_REST_HERE;
  var page = directory.routePage(ref, false, ctx);
  var to = {label: 'TO', value: 'Closest restroom' + (deck ? ' on Deck ' + deck : '')};
  if (!page.steps.length) {
    return {action: ACT_NONE, rows: [heard, to], hint: page.lead};
  }
  return {action: ACT_ROUTE, ref: ref,
          rows: [heard, {label: 'FROM', value: page.from}, to],
          hint: 'Select: route \u00b7 Hold: ask again', title: 'Restroom', header: page.header};
}

var HINT_ROUTE = 'Select: route · Hold: ask again';
var HINT_AGAIN = 'Select to ask again';
// A start from "I'm at" is saved when its card is shown (index.js, 1.5.10); the
// watch doesn't tell the phone about Back, so the hint says how to undo it.
var HINT_ROUTE_SET = 'Select: route · Undo: say Forget where I am';
var HINT_SET = 'Saved · Undo: say “Forget where I am”';
var HINT_FORGET = 'Select: forget it · Hold: ask again';
var TRY_PLACE = 'How do I get to the Windjammer?';

function quoted(text) {
  return '“' + text + '”';
}

function tryRow(text) {
  return {label: 'TRY', value: quoted(text)};
}

// A card with nothing to do: the heard row, then `rows` (strings are unlabelled values).
function note(heard, rows, hint) {
  return {action: ACT_NONE, rows: [heard].concat(rows.map(function(r) {
    return typeof r === 'string' ? {label: '', value: r} : r;
  })), hint: hint === undefined ? HINT_AGAIN : hint};
}

function shipCode(ctx) {
  return (ctx.bundle && ctx.bundle.ship && ctx.bundle.ship.code) || '';
}

// `Harmony` for Harmony of the Seas.
function shipShort(ctx) {
  return ((ctx.bundle && ctx.bundle.ship && ctx.bundle.ship.name) || 'the ship').replace(/ of the Seas$/, '');
}

// The directory place named `name`: {v, ref}, or null.
function placeOf(name, ctx) {
  var ship = shipCode(ctx);
  var list = directory.places(ship, ((ctx.settings || {}).venues || {})[ship]);
  for (var i = 0; i < list.length; i++) {
    if (list[i].name === name) {
      return {v: list[i], ref: directory.REF_PLACE + i};
    }
  }
  return null;
}

// The shortest name the app uses for a place (`CocoCay`).
function shortName(name, ctx) {
  var ship = shipCode(ctx);
  var s = ctx.settings || {};
  return venues.venueFinder(ship, (s.venues || {})[ship], (s.me || {}).deck).short(name) || name;
}

// The route to the nearest of `refs` from where routes start now (or from
// ctx.from). o: {label (the TO row's), suffix (after the name), extra (rows
// after TO), hint}.
function routeCard(heard, refs, ctx, o) {
  o = o || {};
  var n = directory.nearestRef(refs, ctx);
  var to = {label: o.label || 'TO', value: n.name + (o.suffix || '')};
  if (!ctx.bundle || !ctx.bundle.sailDate) {
    return note(heard, [to, 'No cruise on the phone yet']);
  }
  if (n.flags & directory.GPS_NO_CABIN) {
    return note(heard, [to, 'Where are you?'], 'Add your stateroom on the phone');
  }
  if (n.flags) {
    return note(heard, [to, 'No route found']);
  }
  if (n.at && n.at === n.name) {
    return note(heard, [to, 'You\'re already there']);
  }
  return {action: ACT_ROUTE, ref: n.ref, rows: [heard, {label: 'FROM', value: n.from}, to].concat(o.extra || []),
          hint: o.hint || HINT_ROUTE, title: n.name, header: n.header};
}

// "Closest restroom from Studio B": the restroom route from that place page
// (the existing Hold Select route), else null.
function restroomFromCard(heard, p, ctx) {
  var place = p.A_target && p.A_target.indexOf('|') === -1 ? placeOf(p.A_target, ctx) : null;
  if (!place || !ctx.bundle || !ctx.bundle.sailDate) {
    return null;
  }
  var page = directory.routePage(place.ref, true, ctx);
  var from = {label: 'FROM', value: shortName(place.v.name, ctx)};
  if (!page.steps.length) {
    return note(heard, [from, {label: 'TO', value: 'Closest restroom'}], page.lead);
  }
  return {action: ACT_ROUTE, rest: true, ref: place.ref, rows: [heard, from, {label: 'TO', value: 'Closest restroom'}],
          hint: HINT_ROUTE, title: 'Restroom', header: page.header};
}

// A place on deck `deck` to suggest ("Say a place on Deck 15"), or ''.
function placeOnDeck(deck, ctx) {
  var ship = shipCode(ctx);
  var list = directory.places(ship, ((ctx.settings || {}).venues || {})[ship]).filter(function(v) {
    return v.decks.length === 1 && v.decks[0] === deck && v.neighborhood !== venues.ASHORE;
  }).sort(function(a, b) { return a.name.length - b.name.length || (a.name < b.name ? -1 : 1); });
  return list.length ? shortName(list[0].name, ctx) : '';
}

// A spoken cabin number: checked against the plans, never kept (D11, D13).
function spokenCabinCard(heard, n, p, ctx) {
  if (n.length < 4) {
    return note(heard, [{label: 'TO', value: 'Cabin ' + n}, 'Say all 4 or 5 digits']);
  }
  if (!cabins.find(shipCode(ctx), n)) {
    return note(heard, ['No cabin ' + n + ' on ' + shipShort(ctx)]);
  }
  if (n === directory.stateroomOf(ctx)) {
    return cabinCard(heard, ctx);
  }
  return routeCard(heard, [directory.REF_TO_CABIN + (+n)], ctx);
}

// A spoken cabin number as a start: {cabin} or {mine} for your stateroom, or
// a card saying why not (D13).
function cabinStart(heard, n, ctx, label) {
  if (n.length < 4) {
    return {card: note(heard, [{label: label, value: 'Cabin ' + n}, 'Say all 4 or 5 digits'])};
  }
  if (!cabins.find(shipCode(ctx), n)) {
    return {card: note(heard, ['No cabin ' + n + ' on ' + shipShort(ctx)])};
  }
  return n === directory.stateroomOf(ctx) ? {place: {mine: true}, name: 'Your cabin'} :
    {place: {cabin: n}, name: 'Cabin ' + n};
}

var START_REFUSED = {'@restroom': 'restroom', '@elevator': 'elevator', '@forelev': 'elevator', '@aftelev': 'elevator',
                     '@stairs': 'stairs'};

// Where a spoken start (slot A: `I'm at X`, `from X`) is: {place ({venue} |
// {cabin} | {mine}), name (as the card says it)}, {card} when it can't be a
// start (only one-spot places and cabins, §11: D7, D8, D12, D19), or null
// with no A. `label` names it on a card ('YOU\'RE AT' or 'FROM').
function startFrom(heard, p, ctx, label) {
  var a = p.A || '';
  if (!a) {
    return null;
  }
  if (a === '@mycabin') {
    return directory.stateroomOf(ctx) ? {place: {mine: true}, name: 'Your cabin'} :
      {card: note(heard, [{label: label, value: 'Your cabin'}, 'Set your stateroom on the phone'], 'Me tab in the Pebble app settings')};
  }
  var cab = /^@cabin:(\d+)$/.exec(a);
  if (cab) {
    return cabinStart(heard, cab[1], ctx, label);
  }
  if (a.charAt(0) === '@') {
    return {card: refusedCard(heard, {reason: START_REFUSED[a] || (/^@deck:/.test(a) ? 'deck' : 'restroom')}, ctx)};
  }
  if (p.A_spot) {
    return {card: refusedCard(heard, {reason: p.A_spot, A_target: p.A_target}, ctx)};
  }
  var place = p.A_target ? placeOf(p.A_target, ctx) : null;
  if (!place) {
    return {card: note(heard, [{label: label, value: p.A_target || a}, 'Not on the map yet'])};
  }
  if (place.v.neighborhood === venues.ASHORE) {
    return {card: refusedCard(heard, {reason: 'ashore', A_target: place.v.name}, ctx)};
  }
  return {place: {venue: place.v.name}, name: shortName(place.v.name, ctx)};
}

// "I'm at X": YOU'RE AT X; the spoken start is saved when the card shows (index.js).
function setLocationCard(heard, p, ctx) {
  var sf = startFrom(heard, p, ctx, 'YOU\'RE AT');
  if (!sf) {
    return note(heard, ['Which place?', tryRow('I\'m at Studio B')]);
  }
  if (sf.card) {
    return sf.card;
  }
  if (!ctx.bundle || !ctx.bundle.sailDate) {
    return note(heard, [{label: 'YOU\'RE AT', value: sf.name}, 'No cruise on the phone yet']);
  }
  return {action: ACT_CONFIRM, rows: [heard, {label: 'YOU\'RE AT', value: sf.name},
                                      {label: '', value: 'Routes start here for 90 min'}],
          hint: HINT_SET, start: {place: sf.place, name: sf.name, set: true}};
}

// "Forget where I am": Select clears the spoken start (index.js).
var FORGET = /\bforget (?:where (?:i|we) ?'? ?(?:am|are|m|re)(?: at)?|my (?:location|spot|place)|(?:the |my )?start)\b|\b(?:clear|reset) (?:my |the )?(?:location|start)\b/;

function forgetCard(heard, ctx) {
  var active = ctx.spoken && !directory.spokenEnded(ctx);
  var after = directory.startNow(withoutSpoken(ctx));
  if (!active) {
    return note(heard, ['Nothing to forget'].concat(after ? [{label: 'ROUTES FROM', value: after}] : []));
  }
  return {action: ACT_CONFIRM, forget: true,
          rows: [heard, {label: 'YOU\'RE AT', value: ctx.spoken.name || ''}].concat(
            after ? [{label: 'THEN FROM', value: after}] : []),
          hint: HINT_FORGET};
}

function withoutSpoken(ctx) {
  var out = withFrom(ctx, null);
  delete out.from;
  delete out.spoken;
  return out;
}

// A route card from a start said in the question: routed from it, and it goes
// with the route (index.js); with "I'm at" (atA) it is also saved when the card shows (D4).
function fromCard(heard, p, ctx, build) {
  var sf = startFrom(heard, p, ctx, 'FROM');
  if (!sf) {
    return build(ctx);
  }
  if (sf.card) {
    return sf.card;
  }
  var card = build(withFrom(ctx, sf.place));
  if (card.action === ACT_ROUTE) {
    card.start = {place: sf.place, name: sf.name, set: !!p.atA};
    if (p.atA) {
      card.hint = HINT_ROUTE_SET;
    }
  }
  return card;
}

// The closest restroom: from a place named in the question (its restroom
// route), from a cabin said, or from where you are, on deck N when said (D10).
function restroomAnswer(heard, p, ctx) {
  if (p.atA && p.A_spot) {
    return startFrom(heard, p, ctx, 'YOU\'RE AT').card;
  }
  var place = restroomFromCard(heard, p, ctx);
  if (place) {
    if (p.atA && place.action === ACT_ROUTE) {
      place.start = {place: {venue: placeOf(p.A_target, ctx).v.name}, name: shortName(p.A_target, ctx), set: true};
      place.hint = HINT_ROUTE_SET;
    }
    return place;
  }
  return fromCard(heard, p, ctx, function(c) { return restroomCard(heard, c, p.deck); });
}

// A place target from the lexicon ("Windjammer Marketplace", or a group
// "Arcade|Video Arcade"): the nearest member (D12), your own main dining room
// (D3), or why there's no route.
function placeCard(heard, p, ctx, extra) {
  var names = p.B_target.split('|');
  var mine = names.length > 1 ? slice.myInfo(ctx.bundle || {}, (ctx.settings || {}).me || {}).dining : '';
  var yours = names.indexOf(mine) !== -1;
  if (yours) {
    names = [mine];
  }
  var found = names.map(function(n) {
    var place = placeOf(n, ctx);
    return place ? place : n === 'Fore elevators' || n === 'Aft elevators' ?
      {v: null, ref: directory.refOf(n, ctx)} : null;
  }).filter(function(x) { return x && x.ref !== -1; });
  if (!found.length) {
    return note(heard, [{label: 'TO', value: names[0]}, 'Not on the map yet']);
  }
  var v = found[0].v;
  if (found.length === 1 && v && v.neighborhood === venues.ASHORE) {
    return note(heard, [shortName(v.name, ctx) + ' is ashore'], 'No ship route');
  }
  if (p.A && p.A_target && p.A_target === p.B_target) {
    return note(heard, ['You\'re already there']);
  }
  return routeCard(heard, found.map(function(x) { return x.ref; }), ctx,
                   {suffix: found.length > 1 ? ' (nearest)' : yours ? ' (yours)' : '', extra: extra});
}

var REFUSED = {
  restroom: ['There are many restrooms', 'I\'m at Studio B'],
  elevator: ['Elevators stop on many decks', 'I\'m at Studio B'],
  stairs: ['Stairs are in many spots', 'I\'m at Studio B'],
  deck: ['A deck is not one spot', 'I\'m at Studio B'],
  bar: ['There are many bars', 'I\'m at Schooner Bar'],
  coffee: ['There are a few coffee places', 'I\'m at Starbucks']
};

// "I'm at ..." that can't be a start (§11: only one-spot places).
function refusedCard(heard, p, ctx) {
  var r = REFUSED[p.reason];
  if (r) {
    return note(heard, [r[0], tryRow(r[1])], 'Say a place or cabin number near you');
  }
  if (p.reason === 'ashore') {
    return note(heard, [shortName(p.A_target, ctx) + ' is ashore'], 'No ship route');
  }
  if (p.reason === 'group') {
    return note(heard, ['Which one?', {label: '', value: p.A_target.split('|').join(' or ')}]);
  }
  // multi_spot (D8): the Running Track.
  return note(heard, [shortName(p.A_target || '', ctx) + ' is in many spots', tryRow('I\'m at Studio B')],
              'Say a place near you');
}

// ROUTE and ROUTE_COMBINED: to B, from A when said.
function routeAnswer(heard, p, ctx, b) {
  if (b === '@mycabin') {
    return fromCard(heard, p, ctx, function(c) { return cabinCard(heard, c); });  // "Take me back" (D6)
  }
  if (b === '@elevator') {  // the nearest bank (D5)
    var banks = directory.bankRefs(ctx);
    return banks.length ? fromCard(heard, p, ctx, function(c) {
      return routeCard(heard, banks, c, {suffix: ' (nearest)'});
    }) : note(heard, ['Elevators stop on many decks']);
  }
  if (b === '@stairs' || /^@deck:/.test(b)) {  // not one spot (D5)
    var deck = p.deck || (/^@deck:(\d+)$/.exec(b) || [])[1];
    var there = deck ? placeOnDeck(+deck, ctx) : '';
    return note(heard, [b === '@stairs' ? 'Stairs are in many spots' : 'A deck is not one spot'].concat(
      there ? [tryRow('How do I get to ' + there + '?')] : []),
      deck ? 'Say a place on Deck ' + deck : 'Say a place near them');
  }
  if (/^@cabin:/.test(b)) {
    return fromCard(heard, p, ctx, function(c) { return spokenCabinCard(heard, b.slice(7), p, c); });
  }
  if (p.B_target) {
    if (p.A && p.A_target && p.A_target === p.B_target) {
      return note(heard, ['You\'re already there']);
    }
    return fromCard(heard, p, ctx, function(c) {
      return placeCard(heard, p, c, p.via === 'snack' ? [{label: '', value: 'Open 24 hours'}] : null);
    });
  }
  return note(heard, ['Which place?', tryRow(TRY_PLACE)]);
}

// The card for a voice.parse result.
function matchedCard(heard, p, ctx) {
  var b = p.B || '';
  switch (p.intent) {
    case 'CLOSEST_RESTROOM':
      return restroomAnswer(heard, p, ctx);
    case 'CLOSEST_BAR':
    case 'CLOSEST_COFFEE':
      var bar = p.intent === 'CLOSEST_BAR';
      var refs = (bar ? voice.bars : voice.coffee)(shipCode(ctx)).map(function(n) {
        return directory.refOf(n, ctx);
      }).filter(function(r) { return r !== -1; });
      return refs.length ? fromCard(heard, p, ctx, function(c) {
        return routeCard(heard, refs, c, {label: bar ? 'CLOSEST BAR' : 'CLOSEST COFFEE'});
      }) : note(heard, ['Not on the map yet']);
    case 'SET_LOCATION':
      return setLocationCard(heard, p, ctx);
    case 'LOCATION_REFUSED':
      return refusedCard(heard, p, ctx);
    case 'ROUTE':
    case 'ROUTE_COMBINED':
      return routeAnswer(heard, p, ctx, b);
    case 'OUT_OF_SCOPE_KNOWN':
      if (p.topic === 'stateroom') {
        return note(heard, ['Set your stateroom on the phone'], 'Me tab in the Pebble app settings');
      }
      return p.topic === 'hours' ?
        note(heard, [{label: 'NOT YET', value: 'Opening times aren\'t in voice yet'}, tryRow('Where is the Windjammer?')]) :
        note(heard, [{label: 'NOT YET', value: 'Voice can\'t read the schedule yet. Press Down for Today'},
                     tryRow(TRY_PLACE)]);
    case 'INCOMPLETE':
      return note(heard, ['Which place?', tryRow('How do I get to the Solarium?')]);
    default:  // NO_MATCH
      if (p.reason === 'not_mapped') {
        var what = p.B_target || p.A_target || '';
        return note(heard, [{label: 'TO', value: what.charAt(0).toUpperCase() + what.slice(1)}, 'Not on the map yet']);
      }
      if (p.reason === 'empty') {
        return note(heard, ['Nothing heard'], 'Select and speak after the tone');
      }
      if (p.reason === 'no_command') {
        return note(heard, ['Not something I know', tryRow('Closest restroom')]);
      }
      if ((p.miss === 'A' && p.B) || (p.miss === 'B' && p.A)) {
        // One side matched: say which word didn't ("from the Boardwalk to the sailboat").
        var word = pack.cutText(p.miss === 'A' ? p.A : p.B, VALUE_MAX - 15);
        return note(heard, ['No place ' + quoted(word), tryRow(TRY_PLACE)],
                    'Short phrases work best in noisy places');
      }
      return note(heard, ['No place matched', tryRow(TRY_PLACE)], 'Short phrases work best in noisy places');
  }
}

// What the matcher made of `text`, for the usage log (VOICE_FINAL_PLAN §10.1):
// `ROUTE B=Windjammer Marketplace (part)`.
function matchText(p) {
  var out = p.intent + (p.reason ? ' ' + p.reason : '') + (p.miss ? ' miss=' + p.miss : '') +
    (p.topic ? ' ' + p.topic : '') + (p.via ? ' via ' + p.via : '');
  [['A', p.A, p.A_target, p.A_how], ['B', p.B, p.B_target, p.B_how]].forEach(function(s) {
    if (s[1] || s[2]) {
      out += ' ' + s[0] + '=' + (s[2] || s[1]) + (s[2] ? ' (' + (s[3] || 'none') + ')' : '');
    }
  });
  return out + (p.deck ? ' deck ' + p.deck : '');
}

// The answer to `text` (see the top of this file). `state`: the watch's
// voice_state bits. The card's `log` says which command answered, for the usage log.
// Demo data is answered like real data (`isDemo` is kept for the callers).
// `platform` ('emery' or 'gabbro', textfit.platformOf): the card is worded for
// that watch (textfit.js); the Time 2's card is the one built here.
function answer(text, ctx, isDemo, state, platform) {
  return textfit.cardFor(platform, answerCard(text, ctx, isDemo, state));
}

function answerCard(text, ctx, isDemo, state) {
  var heard = {label: 'HEARD', value: quoted(text)};
  var t = (text || '').toLowerCase();
  state = state | 0;
  var card = fixedAnswer(t, heard, ctx, state);
  if (card) {
    return card;
  }
  var ship = shipCode(ctx) || 'HM';
  var p = parseText(text || '', ctx);
  card = matchedCard(heard, p, ctx);
  card.log = matchText(p);
  return card;
}

function parseText(text, ctx) {
  var ship = shipCode(ctx) || 'HM';
  return voice.parse(text, {ship: ship, isCabin: function(n) { return !!cabins.find(ship, n); }});
}

// The commands that need no place names (the top of this file), or null.
function fixedAnswer(t, heard, ctx, state) {
  var card = null, log = '';
  var on = onboardIntent(t);
  var hasCruise = !!(ctx.bundle && ctx.bundle.sailDate);
  var p;
  if (on !== null) {
    card = onboardCard(on, heard, ctx, state);
    log = on ? 'on board' : 'ashore';
  } else if (FORGET.test(t)) {
    card = forgetCard(heard, ctx);
    log = 'forget where I am';
  } else if (hasCruise && CABIN.test(t) && !(p = parseText(t, ctx)).A) {
    // "From the Solarium to my cabin" goes to the matcher (a start said).
    card = cabinCard(heard, ctx);
    log = 'my cabin';
  } else if (hasCruise && RESTROOM.test(t)) {
    // "Restroom near the theater", "on deck 5", "I'm at X, where's the restroom".
    p = parseText(t, ctx);
    card = p.intent === 'CLOSEST_RESTROOM' ? restroomAnswer(heard, p, ctx) :
      p.intent === 'LOCATION_REFUSED' ? refusedCard(heard, p, ctx) : restroomCard(heard, ctx);
    log = 'restroom' + (card.rest ? ' from A=' + p.A_target + ' (' + p.A_how + ')' : card.start ? ' A=' + card.start.name : '') +
      (p.deck && !p.A ? ' deck ' + p.deck : '');
  } else if (hasCruise && MUSTER.test(t)) {
    card = musterCard(heard, ctx);
    log = 'muster';
  } else if (hasCruise && TOMORROW.test(t)) {
    card = tomorrowCard(heard, slice.today(ctx.bundle, ctx.settings, ctx.now || new Date()), state);
    log = 'tomorrow';
  } else if (hasCruise && DEPART.test(t)) {
    card = departCard(heard, slice.today(ctx.bundle, ctx.settings, ctx.now || new Date()), state);
    log = 'departure';
  }
  if (card) {
    card.log = 'fixed ' + log;
  }
  return card;
}

// A card as text lines, for the settings page's voice test box (Help): the
// rows as the watch shows them, the hint, what Select would do, what matched.
function cardLines(card) {
  var out = card.rows.map(function(r) { return (r.label ? r.label + '  ' : '') + r.value; });
  out.push('Hint: ' + (card.hint || ''));
  var st = card.start;
  var sel = card.action === ACT_ROUTE ?
    'opens the route to ' + (card.title || '') + (st ? ' from ' + st.name : '') +
      (st && st.set ? ' (routes start at ' + st.name + ' for 90 min, set when the card shows)' : '') :
    card.action === ACT_CONFIRM ? (card.forget ? 'forgets where you are' :
                                   'closes (routes start at ' + (st ? st.name : '') + ' for 90 min, set when the card shows)') :
    card.action === ACT_ONBOARD ? (card.onboard ? 'sets I\'m on board' : 'clears I\'m on board') : 'asks again';
  out.push('Select ' + sel);
  if (card.log) {
    out.push('Matched: ' + card.log);
  }
  return out;
}

module.exports = {
  ACT_NONE: ACT_NONE, ACT_ROUTE: ACT_ROUTE, ACT_CONFIRM: ACT_CONFIRM, ACT_ONBOARD: ACT_ONBOARD,
  FLAG_REST: FLAG_REST, FLAG_ONBOARD: FLAG_ONBOARD, STATE_ONBOARD: STATE_ONBOARD, STATE_24H: STATE_24H, clock: clock,
  packCard: packCard, placeRef: placeRef, answer: answer, onboardIntent: onboardIntent, cardLines: cardLines
};
