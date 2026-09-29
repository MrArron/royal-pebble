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
// Everything else goes to the voice matcher (voice.js, Phase 5 V3): places,
// groups, cabins, elevators, the closest bar or coffee, a snack, and the
// answers for what it can't do (docs/DESIGN_V1_1.md §9.6, VOICE_FINAL_PLAN
// decisions D1-D22). The commands above keep precedence. Routes use the Route
// screen refs (directory.js); a spoken start (`I'm at X`, `from X to Y`) is not
// used yet: those routes start where routes start now (§9.4) and say so.
'use strict';

var pack = require('./pack');
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
function restroomCard(heard, ctx) {
  var page = directory.routePage(directory.REF_REST_HERE, false, ctx);
  if (!page.steps.length) {
    return {action: ACT_NONE, rows: [heard, {label: 'TO', value: 'Closest restroom'}], hint: page.lead};
  }
  return {action: ACT_ROUTE, ref: directory.REF_REST_HERE,
          rows: [heard, {label: 'FROM', value: page.from}, {label: 'TO', value: 'Closest restroom'}],
          hint: 'Select: route \u00b7 Hold: ask again', title: 'Restroom', header: page.header};
}

var HINT_ROUTE = 'Select: route · Hold: ask again';
var HINT_AGAIN = 'Select to ask again';
var HINT_FROM_NOW = 'Starts where you are now · Select: route';
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

// The route to the nearest of `refs` from where routes start now. o: {label
// (the TO row's), suffix (after the name), extra (rows after TO), hint, spoken
// (a start that was said but isn't used yet)}.
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
          hint: o.hint || (o.spoken ? HINT_FROM_NOW : HINT_ROUTE), title: n.name, header: n.header};
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
  return routeCard(heard, [directory.REF_TO_CABIN + (+n)], ctx, {spoken: !!p.A});
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
  var spoken = !!p.A;
  if (spoken && p.A_target && p.A_target === p.B_target) {
    return note(heard, ['You\'re already there']);
  }
  return routeCard(heard, found.map(function(x) { return x.ref; }), ctx,
                   {suffix: found.length > 1 ? ' (nearest)' : yours ? ' (yours)' : '',
                    extra: extra, spoken: spoken});
}

var REFUSED = {
  restroom: ['There are many restrooms', 'I\'m at Studio B'],
  elevator: ['Elevators stop on many decks', 'I\'m at Studio B'],
  stairs: ['Stairs are in many spots', 'I\'m at Studio B'],
  deck: ['A deck is not one spot', 'I\'m at Studio B'],
  bar: ['There are many bars', 'I\'m at Schooner Bar'],
  coffee: ['There are a few coffee places', 'I\'m at Starbucks']
};

// "I'm at ..." that can't be a start (§9.6: only one-spot places).
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

// The card for a voice.parse result.
function matchedCard(heard, p, ctx) {
  var b = p.B || '';
  switch (p.intent) {
    case 'CLOSEST_RESTROOM':
      return restroomFromCard(heard, p, ctx) || restroomCard(heard, ctx);
    case 'CLOSEST_BAR':
    case 'CLOSEST_COFFEE':
      var bar = p.intent === 'CLOSEST_BAR';
      var refs = (bar ? voice.bars : voice.coffee)(shipCode(ctx)).map(function(n) {
        return directory.refOf(n, ctx);
      }).filter(function(r) { return r !== -1; });
      return refs.length ? routeCard(heard, refs, ctx, {label: bar ? 'CLOSEST BAR' : 'CLOSEST COFFEE', spoken: !!p.A}) :
        note(heard, ['Not on the map yet']);
    case 'SET_LOCATION':
      var at = p.cabin ? 'Cabin ' + p.cabin : p.A === '@mycabin' ? 'Your cabin' : p.A_target || p.A || '';
      return note(heard, [{label: 'YOU\'RE AT', value: at}, 'Not yet'], 'Routes start here in the next update');
    case 'LOCATION_REFUSED':
      return refusedCard(heard, p, ctx);
    case 'ROUTE':
    case 'ROUTE_COMBINED':
      if (b === '@mycabin') {
        return cabinCard(heard, ctx);  // "Take me back" (D6)
      }
      if (b === '@elevator') {  // the nearest bank (D5)
        var banks = directory.bankRefs(ctx);
        return banks.length ? routeCard(heard, banks, ctx, {suffix: ' (nearest)', spoken: !!p.A}) :
          note(heard, ['Elevators stop on many decks']);
      }
      if (b === '@stairs' || /^@deck:/.test(b)) {  // not one spot (D5)
        var deck = p.deck || (/^@deck:(\d+)$/.exec(b) || [])[1];
        var there = deck ? placeOnDeck(+deck, ctx) : '';
        return note(heard, [b === '@stairs' ? 'Stairs are in many spots' : 'A deck is not one spot'].concat(
          there ? [tryRow('How do I get to ' + there + '?')] : []),
          deck ? 'Say a place on Deck ' + deck : 'Say a place near them');
      }
      if (/^@cabin:/.test(b)) {
        return spokenCabinCard(heard, b.slice(7), p, ctx);
      }
      if (p.B_target) {
        return placeCard(heard, p, ctx, p.via === 'snack' ? [{label: '', value: 'Open 24 hours'}] : null);
      }
      return note(heard, ['Which place?', tryRow(TRY_PLACE)]);
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
      return note(heard, ['No place matched', tryRow(TRY_PLACE)], 'Short phrases work best in noisy places');
  }
}

// What the matcher made of `text`, for the usage log (VOICE_FINAL_PLAN §10.1):
// `ROUTE B=Windjammer Marketplace (part)`.
function matchText(p) {
  var out = p.intent + (p.reason ? ' ' + p.reason : '') + (p.topic ? ' ' + p.topic : '') + (p.via ? ' via ' + p.via : '');
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
function answer(text, ctx, isDemo, state) {
  var heard = {label: 'HEARD', value: quoted(text)};
  var t = (text || '').toLowerCase();
  state = state | 0;
  var card = fixedAnswer(t, heard, ctx, state);
  if (card) {
    return card;
  }
  var ship = shipCode(ctx) || 'HM';
  var p = voice.parse(text || '', {ship: ship, isCabin: function(n) { return !!cabins.find(ship, n); }});
  card = matchedCard(heard, p, ctx);
  card.log = matchText(p);
  return card;
}

// The commands that need no place names (the top of this file), or null.
function fixedAnswer(t, heard, ctx, state) {
  var card = null, log = '';
  var on = onboardIntent(t);
  var hasCruise = !!(ctx.bundle && ctx.bundle.sailDate);
  if (on !== null) {
    card = onboardCard(on, heard, ctx, state);
    log = on ? 'on board' : 'ashore';
  } else if (hasCruise && CABIN.test(t)) {
    card = cabinCard(heard, ctx);
    log = 'my cabin';
  } else if (hasCruise && RESTROOM.test(t)) {
    // "Restroom near the theater": now the matcher names the place.
    var p = voice.parse(t, {ship: shipCode(ctx) || 'HM'});
    card = (p.intent === 'CLOSEST_RESTROOM' && restroomFromCard(heard, p, ctx)) || restroomCard(heard, ctx);
    log = 'restroom' + (card.rest ? ' from A=' + p.A_target + ' (' + p.A_how + ')' : '');
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

module.exports = {
  ACT_NONE: ACT_NONE, ACT_ROUTE: ACT_ROUTE, ACT_CONFIRM: ACT_CONFIRM, ACT_ONBOARD: ACT_ONBOARD,
  FLAG_REST: FLAG_REST, FLAG_ONBOARD: FLAG_ONBOARD, STATE_ONBOARD: STATE_ONBOARD, STATE_24H: STATE_24H, clock: clock,
  packCard: packCard, placeRef: placeRef, answer: answer, onboardIntent: onboardIntent
};
