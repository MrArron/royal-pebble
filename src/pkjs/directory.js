// Ship directory on the watch (docs/DESIGN_V1_1.md §3, docs/WATCH_PROTOCOL.md
// Ship directory). The watch asks for one page at a time when a directory
// screen opens; the phone builds every line from the venue table, the owner's
// edits and the cabin deck. Nothing here is saved on the watch.

var venues = require('./venues');
var pack = require('./pack');
var slice = require('./slice');
var shipmap = require('./shipmap');
var gpstext = require('./gpstext');
var routestart = require('./routestart');

var L = venues.lib;
var DOT = ' ' + String.fromCharCode(183) + ' ';

// Page refs. The watch only echoes them back; 0 is the first page.
var REF_DECKS = 0;
var REF_AREAS = 1;
var REF_DECK = 100;    // + deck number
var REF_AREA = 200;    // + index in AREA_KEYS
var REF_ELEVATORS = 300;
var REF_BANK = 301;    // + index in BANKS
var REF_PLACE = 1000;  // + index in places()

// Row kinds.
var ROW_HEADER = 0;  // small-caps header, the cursor skips it
var ROW_ITEM = 1;    // name and optional sub-line; opens `ref` when not 0
var ROW_EVENT = 2;   // an event at the place: title, the watch formats the time
var ROW_PLACE = 3;   // a heading: the name, and for a place its area (where is dir_where)

// Row flags on items: a place the cursor can open, drawn muted (elevator banks).
var ROW_MUTED = 1;

// The elevator banks, directory places on a ship with a map (§9.3).
var BANKS = [{key: 'fwd', name: 'Fore elevators', pos: 'Fore'},
             {key: 'aft', name: 'Aft elevators', pos: 'Aft'}];

var OTHER = 'Other places';
// The seven neighborhoods, venues with none, then Ashore.
var AREA_KEYS = venues.AREAS.concat([OTHER, venues.ASHORE]);

// Shorter names where two share a line.
var SHORT_AREAS = {
  'Royal Promenade': 'Promenade',
  'Pool & Sports Zone': 'Pool & Sports',
  'Vitality Spa & Fitness': 'Spa & Fitness',
  'Entertainment Place': 'Entertainment'
};

var LINE1_MAX = 39;  // the watch keeps 40 and 32 bytes with the NUL
var LINE2_MAX = 31;
var GPS_TEXT_MAX = 31;  // the FROM header and line: 32 bytes with the NUL

// dir_gps flags.
var GPS_APPROX = 1;    // the place's spot is approximate
var GPS_NO_CABIN = 2;  // no stateroom on the Me tab: no FROM block, a hint instead
var GPS_NO_FROM = 4;   // no route from the start: no FROM block, only the restroom line
var ROW_FIXED = 10;
var TEXT_MAX = 23;   // title and label
var MAX_ROWS = 40;
// One message; the watch inbox is 2048 bytes and also holds the keys.
var ROWS_MAX_BYTES = 1500;

function shortArea(area) {
  return SHORT_AREAS[area] || area;
}

function areaKey(v) {
  if (v.neighborhood === venues.ASHORE) {
    return venues.ASHORE;
  }
  return venues.AREAS.indexOf(v.neighborhood) !== -1 ? v.neighborhood : OTHER;
}

// Everything the directory can show: table venues and places plus the owner's
// own, with edits applied, sorted by name. Venues with no deck and no area
// (or not in the table at all) have nothing to show and are left out.
function places(shipCode, overrides) {
  return L.entries(venues.builtIn(shipCode), overrides || {}, []).filter(function(v) {
    return !v.blank && (v.decks.length > 0 || !!v.neighborhood);
  });
}

// "3-6, 8" from deck numbers.
function deckRanges(decks) {
  decks = decks.filter(function(d, i, a) { return a.indexOf(d) === i; }).sort(function(a, b) { return a - b; });
  var out = [];
  decks.forEach(function(d, i) {
    if (i && d === decks[i - 1] + 1) {
      out[out.length - 1][1] = d;
    } else {
      out.push([d, d]);
    }
  });
  return out.map(function(r) { return r[0] === r[1] ? String(r[0]) : r[0] + '-' + r[1]; }).join(', ');
}

// The two neighborhoods with the most venues in `list`, most first.
function areaSummary(list) {
  var counts = {};
  list.forEach(function(v) {
    if (venues.AREAS.indexOf(v.neighborhood) !== -1) {
      counts[v.neighborhood] = (counts[v.neighborhood] || 0) + 1;
    }
  });
  return Object.keys(counts).sort(function(a, b) {
    return counts[b] - counts[a] || venues.AREAS.indexOf(a) - venues.AREAS.indexOf(b);
  }).slice(0, 2).map(shortArea).join(DOT);
}

function byName(a, b) {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

var POS_ORDER = ['Fore', 'Mid', 'Aft', null];

// "6", or "1 place" when nothing comes before it on the line.
function count(n, alone) {
  return alone ? n + (n === 1 ? ' place' : ' places') : String(n);
}

function item(ref, line1, line2, flags) {
  return {kind: ROW_ITEM, ref: ref, line1: line1, line2: line2 || '', flags: flags || 0};
}

// The ship's banks with their decks and spots; [] for a ship with no map.
function banksOf(ship) {
  return BANKS.map(function(b, i) {
    var m = shipmap.bank(ship, b.key);
    return m ? {ref: REF_BANK + i, name: b.name, pos: b.pos, decks: m.decks, spots: m.spots} : null;
  }).filter(Boolean);
}

// Every deck the directory knows: venues' decks and the banks' stops.
function shipDecks(list, banks) {
  var decks = [];
  function add(d) {
    if (decks.indexOf(d) === -1) {
      decks.push(d);
    }
  }
  list.forEach(function(v) {
    if (v.neighborhood !== venues.ASHORE) {
      v.decks.forEach(add);
    }
  });
  banks.forEach(function(b) { b.decks.forEach(add); });
  return decks.sort(function(a, b) { return a - b; });
}

// "all decks", or "Decks 3-16": runs over the ship's decks (`all`), so a deck
// the ship doesn't have (13) doesn't split a run.
function bankDecksText(decks, all) {
  var idx = decks.map(function(d) { return all.indexOf(d); }).filter(function(i) { return i !== -1; });
  if (idx.length === all.length) {
    return 'all decks';
  }
  idx.sort(function(a, b) { return a - b; });
  var runs = [];
  idx.forEach(function(i, n) {
    if (n && i === idx[n - 1] + 1) {
      runs[runs.length - 1][1] = i;
    } else {
      runs.push([i, i]);
    }
  });
  return (idx.length > 1 ? 'Decks ' : 'Deck ') + runs.map(function(r) {
    return r[0] === r[1] ? String(all[r[0]]) : all[r[0]] + '-' + all[r[1]];
  }).join(', ');
}

function header(text) {
  return {kind: ROW_HEADER, ref: 0, line1: text.toUpperCase(), line2: ''};
}

// Page 0: "Browse by area", then every deck with its main areas and how many
// places it has, then Ashore.
function decksPage(list, cabin) {
  var rows = [item(REF_AREAS, 'Browse by area')];
  var decks = {};
  list.forEach(function(v) {
    if (v.neighborhood !== venues.ASHORE) {
      v.decks.forEach(function(d) { (decks[d] = decks[d] || []).push(v); });
    }
  });
  Object.keys(decks).map(Number).sort(function(a, b) { return a - b; }).forEach(function(d) {
    var on = decks[d];
    var areas = areaSummary(on);
    rows.push(item(REF_DECK + d, 'Deck ' + d + (d === cabin ? DOT + 'your deck' : ''),
                   [areas, count(on.length, !areas)].filter(Boolean).join(DOT)));
  });
  var ashore = list.filter(function(v) { return v.neighborhood === venues.ASHORE; });
  if (ashore.length) {
    rows.push(item(REF_AREA + AREA_KEYS.indexOf(venues.ASHORE), 'Ashore',
                   ashore.map(function(v) { return v.name; }).join(', ')));
  }
  if (rows.length === 1) {
    rows.push(item(0, 'No venues for this ship', 'Add them on your phone'));
  }
  return {title: 'Ship', label: 'by deck', rows: rows};
}

// Page 1: each area with its decks and how many places it has, and the
// Elevators row just before Ashore.
function areasPage(list, banks) {
  var rows = [];
  var lifts = banks.length ? item(REF_ELEVATORS, 'Elevators', banks.map(function(b) { return b.pos; }).join(DOT))
                           : null;
  AREA_KEYS.forEach(function(key, i) {
    if (key === venues.ASHORE && lifts) {
      rows.push(lifts);
      lifts = null;
    }
    var inArea = list.filter(function(v) { return areaKey(v) === key; });
    if (!inArea.length) {
      return;
    }
    var decks = [];
    inArea.forEach(function(v) {
      v.decks.forEach(function(d) {
        if (decks.indexOf(d) === -1) {
          decks.push(d);
        }
      });
    });
    var where = decks.length ? (decks.length > 1 ? 'Decks ' : 'Deck ') + deckRanges(decks) : '';
    rows.push(item(REF_AREA + i, key, [where, count(inArea.length, !where)].filter(Boolean).join(DOT)));
  });
  if (rows.length === 1 && rows[0].ref === REF_ELEVATORS) {
    rows = [];  // no venues: say so rather than show the elevators alone
  }
  if (!rows.length) {
    rows.push(item(0, 'No venues for this ship', 'Add them on your phone'));
  }
  return {title: 'Ship', label: 'by area', rows: rows};
}

// The Elevators row: each bank and the decks it stops at.
function elevatorsPage(banks, all) {
  var rows = [{kind: ROW_PLACE, ref: 0, line1: 'Elevators', line2: ''}];
  banks.forEach(function(b) { rows.push(item(b.ref, b.name, bankDecksText(b.decks, all))); });
  return {title: 'Area', label: '', rows: rows};
}

// One deck: its places under Fore / Mid / Aft (and "full length" for ones with
// no position), each group ending with its elevator bank, muted, when the bank
// stops here. Venues with several entrances show on each of their decks.
function deckPage(list, deck, cabin, placeRef, banks) {
  var on = list.filter(function(v) {
    return v.neighborhood !== venues.ASHORE && v.decks.indexOf(deck) !== -1;
  });
  var rows = [];
  POS_ORDER.forEach(function(pos) {
    var here = on.filter(function(v) { return (v.position || null) === pos; }).sort(byName);
    var lifts = banks.filter(function(b) { return b.pos === pos && b.decks.indexOf(deck) !== -1; });
    if (here.length || lifts.length) {
      rows.push(header(pos || 'full length'));
      here.forEach(function(v) { rows.push(item(placeRef(v), v.name)); });
      lifts.forEach(function(b) { rows.push(item(b.ref, b.name, '', ROW_MUTED)); });
    }
  });
  if (!rows.length) {
    rows.push(item(0, 'Nothing listed on this deck'));
  }
  return {title: 'Deck ' + deck, label: '', rel: cabin === null ? null : deck - cabin, rows: rows};
}

// One area: its name, then its places by deck and position ("Deck 5 · Mid").
// A place with several entrances shows once, under the entrance nearest the
// cabin. Area names are too long for the top bar, so it says "Area".
function areaPage(list, key, cabin, placeRef) {
  var inArea = list.filter(function(v) { return areaKey(v) === key; });
  var groups = {};
  inArea.forEach(function(v) {
    var deck = v.decks.length ? (L.nearestDeck(v.decks, cabin) || v.decks[0]) : 0;
    var pos = POS_ORDER.indexOf(v.position || null);
    var k = deck * 10 + pos;
    (groups[k] = groups[k] || {deck: deck, pos: v.position, rows: []}).rows.push(v);
  });
  var rows = [{kind: ROW_PLACE, ref: 0, line1: key, line2: ''}];
  Object.keys(groups).map(Number).sort(function(a, b) { return a - b; }).forEach(function(k) {
    var g = groups[k];
    if (key !== venues.ASHORE) {
      rows.push(header(g.deck ? 'Deck ' + g.deck + (g.pos ? DOT + g.pos : '') : 'No deck'));
    }
    g.rows.sort(byName).forEach(function(v) { rows.push(item(placeRef(v), v.name)); });
  });
  return {title: 'Area', label: '', rows: rows};
}

// Events at `v` for the rest of today's watch day, with personal entries, as
// the watch's lists show them (hidden categories left out unless starred).
function eventsAt(v, ctx) {
  if (!ctx.bundle) {
    return [];
  }
  var table = venues.builtIn(ctx.shipCode);
  var key = L.norm(v.name);
  var sailDays = slice.daysFromIso(ctx.bundle.sailDate);
  var nowMin = slice.cruiseMinutes(sailDays, ctx.now);
  var dayIndex = slice.cruiseDayIndex(nowMin);
  return slice.buildEvents(ctx.bundle, ctx.settings, ctx.stars, dayIndex, sailDays).filter(function(e) {
    if (!e.venue) {
      return false;
    }
    var name = L.lookup(table, e.venue) || e.venue;
    if (L.norm(name) !== key) {
      return false;
    }
    return e.start === slice.NO_TIME || e.start + (e.minutes || 30) > nowMin;
  });
}

// ---- Ship GPS on place pages (docs/DESIGN_V1_1.md §9.1) ---------------------

// Where a venue is on the map: the plans' spots on its decks, else a rough spot
// from its deck and position (venues the plans don't label, or the owner moved
// or added). [] when it's ashore or has no deck.
function spotsOf(ship, v, cabin) {
  if (v.neighborhood === venues.ASHORE || !v.decks.length) {
    return [];
  }
  var pts = shipmap.venue(ship, v.name).filter(function(p) { return v.decks.indexOf(p.deck) !== -1; });
  if (pts.length) {
    return pts;
  }
  var a = shipmap.approx(ship, L.nearestDeck(v.decks, cabin) || v.decks[0], v.position);
  return a ? [a] : [];
}

// The stateroom from the Me tab, else the booking's (a guarantee has none).
function stateroom(ctx) {
  var room = String(((ctx.settings || {}).me || {}).stateroom || ((ctx.bundle || {}).mine || {}).stateroom || '');
  return /^[0-9]+$/.test(room) ? room : '';
}

// Timed starred events and personal entries from yesterday's watch day to
// today's, in cruise minutes: the stops routestart.js looks at.
function stops(ctx, sailDays, today) {
  var out = [];
  for (var d = today - 1; d <= today; d++) {
    out = out.concat(slice.buildEvents(ctx.bundle, ctx.settings, ctx.stars, d, sailDays).filter(function(e) {
      return e.start !== slice.NO_TIME && (e.flags & (slice.FLAG_STARRED | slice.FLAG_PERSONAL));
    }));
  }
  return out;
}

// The route from where routestart.js says you are now (§9.4), or with `target`
// (an event {start}) where you'll be before it, to the nearest of the spots
// `to`: {start, header, from (the spot it leaves), route}, or {flags} with
// GPS_NO_CABIN or GPS_NO_FROM when there's none.
function bestRoute(to, ctx, cabin, target) {
  var ship = ctx.shipCode;
  var settings = ctx.settings || {};
  var finder = venues.venueFinder(ship, (settings.venues || {})[ship], (settings.me || {}).deck);
  var room = stateroom(ctx);
  var sailDays = slice.daysFromIso(ctx.bundle.sailDate);
  var now = slice.cruiseMinutes(sailDays, ctx.now);
  var start = routestart.start({stops: stops(ctx, sailDays, slice.cruiseDayIndex(now)), now: now, target: target,
                                cabin: room});
  var from = start.venue ? spotsOf(ship, finder.entry(start.venue), cabin) : [];
  if (!from.length && room) {
    // At a stop that isn't on the map (ashore, say): from the cabin.
    start = {kind: 'cabin', cabin: room};
    from = [shipmap.cabin(ship, room)].filter(Boolean);
  }
  if (!room && !from.length) {
    return {flags: GPS_NO_CABIN};
  }
  var best = null;
  from.forEach(function(f) {
    var r = shipmap.route(ship, f, to);
    var cost = r ? (r.cost === undefined ? r.metres : r.cost) : Infinity;
    if (r && (!best || cost < best.cost)) {
      best = {from: f, route: r, cost: cost};
    }
  });
  if (!best) {
    // A stateroom the map doesn't know, say.
    return {flags: GPS_NO_FROM};
  }
  return {start: start, header: gpstext.fromHeader(start, finder.short(start.venue)), from: best.from,
          route: best.route, flags: 0};
}

// The FROM block to the nearest of the spots `to`: {header, decks, text, flags,
// to (the spot the route reaches)}, with GPS_NO_CABIN or GPS_NO_FROM when there's
// no block to show.
function fromBlock(to, ctx, cabin) {
  var best = bestRoute(to, ctx, cabin);
  if (best.flags) {
    return {header: '', decks: 0, text: '', flags: best.flags};
  }
  var line = gpstext.fromLine(best.route, best.from, {units: (ctx.settings || {}).units,
                                                      fromCabin: best.start.kind === 'cabin'});
  return {header: best.header, decks: line.decks, text: line.text, flags: 0, to: best.route.to};
}

// A place page's Ship GPS lines (§9.1): {header, decks, text, flags, rest}, or
// null for none at all (ship not mapped, ashore, no deck, nothing to show).
// `rest` is the closest restroom from the venue ({decks, text}) or null.
function placeGps(v, ctx, cabin) {
  var ship = ctx.shipCode;
  if (!ctx.bundle || !shipmap.data(ship)) {
    return null;
  }
  var to = spotsOf(ship, v, cabin);
  if (!to.length) {
    return null;
  }
  var gps = fromBlock(to, ctx, cabin);
  if (to[0].approx) {
    gps.flags |= GPS_APPROX;
  }
  // From the entrance the route reaches, else the one on the deck nearest the cabin.
  var at = gps.to || to[0];
  delete gps.to;
  var rest = shipmap.restroom(ship, at);
  gps.rest = rest ? gpstext.restroomLine(rest, at, {units: (ctx.settings || {}).units}) : null;
  return (gps.flags & GPS_NO_FROM) && !gps.rest ? null : gps;
}

// An elevator bank (§9.3): its name, `Aft · Decks 3-17`, the STOPS AT chips
// (dir_bank) and the FROM block to its lobby on the best deck.
function bankPage(b, ctx, cabin, all) {
  var gps = ctx.bundle ? fromBlock(b.spots, ctx, cabin) : null;
  if (gps) {
    delete gps.to;
    if (gps.flags & GPS_NO_FROM) {
      gps = null;
    }
  }
  return {title: 'Place', label: '', gps: gps,
          bank: {text: b.pos + DOT + bankDecksText(b.decks, all), decks: b.decks, cabin: cabin},
          rows: [{kind: ROW_PLACE, ref: 0, line1: b.name, line2: ''}]};
}

// A place: its heading (name, area; where it is goes in dir_where), the Ship GPS
// FROM block when there is one, and what's on there for the rest of today.
function placePage(v, ctx, cabin) {
  var key = areaKey(v);
  var area = key === OTHER || key === venues.ASHORE ? '' : key;
  var gps = placeGps(v, ctx, cabin);
  var where = venues.watchWhere(v, cabin);
  if (gps) {
    where.rel = null;  // the FROM line replaces "↓1 deck from cabin"
  }
  var rows = [{kind: ROW_PLACE, ref: 0, line1: v.name, line2: area}];
  var events = eventsAt(v, ctx);
  rows.push(header(events.length ? 'Later today' : 'Today'));
  if (events.length) {
    events.forEach(function(e) {
      rows.push({kind: ROW_EVENT, ref: 0, start: e.start, minutes: e.minutes, flags: e.flags,
                 line1: e.title, line2: ''});
    });
  } else {
    rows.push(item(0, 'Nothing more today'));
  }
  return {title: 'Place', label: '', where: where, gps: gps, rows: rows};
}

// ---- Route screen (docs/DESIGN_V1_1.md §9.2) --------------------------------

var ROUTE_REDUCED = 1;  // shown less: the planner isn't sure (§9.2)
var ROUTE_STEPS_MAX = 8;  // the watch keeps 8, the arrival last
var ROUTE_TEXT_MAX = 39;  // title, steps and the small foot line: 40 bytes with the NUL
var ROUTE_LEAD_MAX = 63;

// "Same deck as Royal Theater", "1 deck above Royal Theater".
function deckFrom(decks, name) {
  if (!decks) {
    return 'Same deck as ' + name;
  }
  return gpstext.deckText(decks) + (decks > 0 ? ' above ' : ' below ') + name;
}

// A route page with only a message in its lead line.
function routeMessage(title, lead) {
  return {title: title, header: '', lead: lead, steps: [], big: '', small: {decks: 0, text: ''}, flags: 0};
}

// The steps, at most ROUTE_STEPS_MAX with the arrival kept last.
function capSteps(list) {
  return list.length <= ROUTE_STEPS_MAX ? list : list.slice(0, ROUTE_STEPS_MAX - 1).concat(list.slice(-1));
}

// The Route screen for place page `ref` (a venue or an elevator bank): the route
// from where you are (§9.4), or with `rest` the one from the venue to its closest
// restroom. Returns {ref, rest, title, header, lead, steps: [{glyph, text}], big,
// small: {decks, text}, flags}: `lead` is a line above the steps (`Same area ·
// your deck`, or a message when there's no route), `big` and `small` the lines
// under them (the summary; for a restroom, its deck and how it relates to the
// venue).
function routePage(ref, rest, ctx) {
  var s = setup(ctx);
  var ship = s.c.shipCode;
  var opts = {units: s.c.settings.units, banks: shipmap.banks(ship)};
  var target = null;
  if (ref >= REF_BANK && ref < REF_BANK + s.banks.length && !rest) {
    var b = s.banks[ref - REF_BANK];
    target = {name: b.name, short: b.name, to: b.spots};
  } else if (ref >= REF_PLACE && ref - REF_PLACE < s.list.length) {
    var v = s.list[ref - REF_PLACE];
    var finder = venues.venueFinder(ship, (s.c.settings.venues || {})[ship], (s.c.settings.me || {}).deck);
    target = {name: v.name, short: finder.short(v.name) || v.name, to: spotsOf(ship, v, s.cabin)};
  }
  var page;
  if (!ctx.bundle || !target || !target.to.length) {
    page = routeMessage('Not found', 'Go back and try again');
  } else {
    var best = bestRoute(target.to, s.c, s.cabin);
    if (rest) {
      page = restroomRoute(target, best.route ? best.route.to || target.to[0] : target.to[0], ship, opts);
    } else if (best.flags & GPS_NO_CABIN) {
      page = routeMessage(target.name, 'Add your stateroom on the phone for walking directions');
    } else if (best.flags) {
      page = routeMessage(target.name, 'No route found');
    } else {
      page = placeRoute(target, best, opts);
    }
  }
  page.ref = ref;
  page.rest = !!rest;
  return page;
}

// The Route screen to an event (Home's NEXT, §9.5): `ev` is {start (cruise
// minutes), venue (as the watch has it, maybe cut short)}. The route starts
// where you'll be before the event (§9.4). As routePage, with `start` in place
// of ref and rest, and no summary: the watch shows the event's time and title
// under the steps.
function eventRoutePage(ev, ctx) {
  var s = setup(ctx);
  var ship = s.c.shipCode;
  var name = eventVenue(ev, s.c);
  var target = null;
  if (ctx.bundle && name && shipmap.data(ship)) {
    var finder = venues.venueFinder(ship, (s.c.settings.venues || {})[ship], (s.c.settings.me || {}).deck);
    var v = finder.entry(name);
    target = {name: v.name, short: v.short || v.name, to: spotsOf(ship, v, s.cabin)};
  }
  var page;
  if (!target || !target.to.length) {
    page = routeMessage(name || 'Not found', 'No route found');
  } else {
    var best = bestRoute(target.to, s.c, s.cabin, {start: ev.start});
    if (best.flags & GPS_NO_CABIN) {
      page = routeMessage(target.name, 'Add your stateroom on the phone for walking directions');
    } else if (best.flags) {
      page = routeMessage(target.name, 'No route found');
    } else {
      page = placeRoute(target, best, {units: s.c.settings.units, banks: shipmap.banks(ship)});
      page.small = {decks: 0, text: ''};
    }
  }
  page.ref = 0;
  page.rest = false;
  page.start = ev.start;
  return page;
}

// The event's full venue name: the watch's copy may be cut short, so match it
// against the day's events that start then.
function eventVenue(ev, c) {
  var sent = String(ev.venue || '');
  if (!c.bundle || !sent) {
    return sent;
  }
  var sailDays = slice.daysFromIso(c.bundle.sailDate);
  var found = slice.buildEvents(c.bundle, c.settings, c.stars, slice.cruiseDayIndex(ev.start), sailDays)
    .filter(function(e) { return e.start === ev.start && e.venue && e.venue.indexOf(sent) === 0; })[0];
  return found ? found.venue : sent;
}

// Only walking, on one deck, within one of Fore / Mid / Aft.
function sameArea(r, from, banks) {
  var to = r.to;
  return !gpstext.reduced(r) && to && from && to.deck === from.deck && banks &&
         gpstext.zone(to.a, banks) === gpstext.zone(from.a, banks) &&
         r.steps.every(function(st) { return st.do === 'walk'; });
}

function placeRoute(target, best, opts) {
  var r = best.route;
  var o = {units: opts.units, banks: opts.banks, name: target.name};
  var page = {title: target.name, header: best.header, lead: '', steps: capSteps(gpstext.steps(r, best.from, o)),
              big: '', small: gpstext.summary(r, best.from, o), flags: gpstext.reduced(r) ? ROUTE_REDUCED : 0};
  if (sameArea(r, best.from, opts.banks)) {
    // `Same area · your deck`, one walk and the arrival; no summary.
    page.lead = 'Same area' + (best.start.kind === 'cabin' ? DOT + 'your deck' : '');
    page.small = {decks: 0, text: ''};
  }
  return page;
}

// From the venue's entrance `at` to its closest restroom: header `CLOSEST TO
// ROYAL THEATER`, and under the steps the restroom's deck and position.
function restroomRoute(target, at, ship, opts) {
  var title = 'Restroom';
  var found = shipmap.restroom(ship, at);
  if (!found) {
    return routeMessage(title, 'No restroom found');
  }
  var r = found.route;
  if (!r.to) {
    r.to = {deck: found.deck, a: found.a, x: found.x};
  }
  var o = {units: opts.units, banks: opts.banks, name: title};
  var where = 'Deck ' + found.deck + (opts.banks ? DOT + gpstext.zone(found.a, opts.banks) : '');
  return {title: title, header: 'CLOSEST TO ' + target.short.toUpperCase(), lead: '',
          steps: capSteps(gpstext.steps(r, at, o)), big: where,
          small: {decks: 0, text: deckFrom(found.deck - at.deck, target.short)},
          flags: gpstext.reduced(r) ? ROUTE_REDUCED : 0};
}

// uint8 flags, int8 decks (the small line's arrow), then title, header, lead,
// big and small texts as uint8 length and UTF-8 bytes, then uint8 step count
// and each step's uint8 glyph and text.
function encodeRoute(p) {
  var out = [p.flags & 255, int8(p.small.decks)];
  [[p.title, ROUTE_TEXT_MAX], [p.header, GPS_TEXT_MAX], [p.lead, ROUTE_LEAD_MAX], [p.big, GPS_TEXT_MAX],
   [p.small.text, ROUTE_TEXT_MAX]].forEach(function(f) {
    var b = pack.utf8(f[0] || '', f[1]);
    out = out.concat([b.length], b);
  });
  out.push(p.steps.length);
  p.steps.forEach(function(st) {
    var b = pack.utf8(st.text || '', ROUTE_TEXT_MAX);
    out = out.concat([st.glyph & 255, b.length], b);
  });
  return out;
}

// The ROUTE_PAGE message (without msg_type). An event's route echoes its start.
function routeMsg(page) {
  var m = {dir_ref: page.ref, route_rest: page.rest ? 1 : 0, route: encodeRoute(page)};
  if (page.start !== undefined) {
    m.route_start = page.start;
  }
  return m;
}

// What every page needs: the context with defaults, the directory's places,
// the elevator banks and the cabin deck.
function setup(ctx) {
  var bundle = ctx.bundle || {};
  var settings = ctx.settings || {};
  var shipCode = (bundle.ship && bundle.ship.code) || '';
  return {
    c: {bundle: ctx.bundle, settings: settings, stars: ctx.stars || {}, now: ctx.now || new Date(),
        shipCode: shipCode},
    list: places(shipCode, (settings.venues || {})[shipCode]),
    banks: banksOf(shipCode),
    cabin: L.cabinDeck((settings.me || {}).deck)
  };
}

// ctx: {bundle, settings, stars, now (Date)}. Returns {ref, title, label,
// rel (decks from the cabin, or null), where and gps (place pages), rows}.
function buildPage(ref, ctx) {
  var s = setup(ctx);
  var c = s.c, list = s.list, banks = s.banks, cabin = s.cabin;
  function placeRef(v) {
    return REF_PLACE + list.indexOf(v);
  }
  var page;
  if (ref === REF_AREAS) {
    page = areasPage(list, banks);
  } else if (ref > REF_DECK && ref < REF_AREA) {
    page = deckPage(list, ref - REF_DECK, cabin, placeRef, banks);
  } else if (ref >= REF_AREA && ref < REF_AREA + AREA_KEYS.length) {
    page = areaPage(list, AREA_KEYS[ref - REF_AREA], cabin, placeRef);
  } else if (ref === REF_ELEVATORS && banks.length) {
    page = elevatorsPage(banks, shipDecks(list, banks));
  } else if (ref >= REF_BANK && ref < REF_BANK + banks.length) {
    page = bankPage(banks[ref - REF_BANK], c, cabin, shipDecks(list, banks));
  } else if (ref >= REF_PLACE && ref - REF_PLACE < list.length) {
    page = placePage(list[ref - REF_PLACE], c, cabin);
  } else if (ref === REF_DECKS) {
    page = decksPage(list, cabin);
  } else {
    // A stale ref, e.g. venue edits changed the list meanwhile.
    page = {title: 'Ship', label: '', rows: [item(0, 'Not found', 'Go back and try again')]};
  }
  page.ref = ref;
  if (page.rel === undefined) {
    page.rel = null;
  }
  return page;
}

// Per row, little-endian: uint8 kind, uint16 ref, int32 start, uint16 minutes,
// uint8 flags, then line1 and line2 as uint8 length and UTF-8 bytes.
function encodeRow(r) {
  var line1 = pack.utf8(r.line1 || '', LINE1_MAX);
  var line2 = pack.utf8(r.line2 || '', LINE2_MAX);
  var start = r.start === undefined ? slice.NO_TIME : r.start | 0;
  var minutes = Math.max(0, Math.min(0xFFFF, r.minutes | 0));
  var ref = (r.ref | 0) & 0xFFFF;
  return [r.kind & 255, ref & 255, ref >> 8,
          start & 255, (start >> 8) & 255, (start >> 16) & 255, (start >> 24) & 255,
          minutes & 255, minutes >> 8, (r.flags | 0) & 255,
          line1.length].concat(line1, [line2.length], line2);
}

// Rows as bytes: as many as fit, and a last row saying how many were left out.
function packRows(rows) {
  var bytes = [];
  var more = {kind: ROW_ITEM, ref: 0, line1: '', line2: 'The rest are on your phone'};
  var reserve = ROW_FIXED + 2 + LINE1_MAX + LINE2_MAX;
  for (var i = 0; i < rows.length; i++) {
    var b = encodeRow(rows[i]);
    var last = i === rows.length - 1;
    if (i >= MAX_ROWS - (last ? 0 : 1) || bytes.length + b.length + (last ? 0 : reserve) > ROWS_MAX_BYTES) {
      more.line1 = (rows.length - i) + ' more';
      return bytes.concat(encodeRow(more));
    }
    bytes = bytes.concat(b);
  }
  return bytes;
}

// The DIR_PAGE message (without msg_type) for a page.
function message(page) {
  var m = {
    dir_ref: page.ref,
    dir_title: (page.title || '').slice(0, TEXT_MAX),
    dir_label: (page.label || '').slice(0, TEXT_MAX),
    dir_rows: packRows(page.rows)
  };
  if (page.rel !== null && page.rel !== undefined) {
    m.dir_rel = page.rel;
  }
  if (page.where) {
    m.dir_where = pack.encodeWhere(page.where);
  }
  if (page.gps) {
    m.dir_gps = encodeGps(page.gps);
  }
  if (page.bank) {
    m.dir_bank = encodeBank(page.bank);
  }
  return m;
}

function int8(n) {
  return Math.max(-127, Math.min(127, n | 0)) & 255;
}

// int8 decks (signed, + = up), uint8 flags, then the FROM header and the FROM
// line text, each as uint8 length and UTF-8 bytes; then, with a closest
// restroom, its int8 decks and text the same way.
function encodeGps(g) {
  var header = pack.utf8(g.header || '', GPS_TEXT_MAX);
  var text = pack.utf8(g.text || '', GPS_TEXT_MAX);
  var out = [int8(g.decks), g.flags & 255, header.length].concat(header, [text.length], text);
  if (g.rest) {
    var rest = pack.utf8(g.rest.text || '', GPS_TEXT_MAX);
    out = out.concat([int8(g.rest.decks), rest.length], rest);
  }
  return out;
}

// uint8 cabin deck (0 none), uint8 count and the decks the bank stops at, then
// the line under the name as uint8 length and UTF-8 bytes.
var BANK_DECKS_MAX = 24;  // the watch keeps 24
function encodeBank(b) {
  var text = pack.utf8(b.text || '', GPS_TEXT_MAX);
  var decks = b.decks.slice(0, BANK_DECKS_MAX);
  return [(b.cabin | 0) & 255, decks.length].concat(decks, [text.length], text);
}

module.exports = {
  REF_DECKS: REF_DECKS, REF_AREAS: REF_AREAS, REF_DECK: REF_DECK, REF_AREA: REF_AREA, REF_PLACE: REF_PLACE,
  REF_ELEVATORS: REF_ELEVATORS, REF_BANK: REF_BANK,
  ROW_HEADER: ROW_HEADER, ROW_ITEM: ROW_ITEM, ROW_EVENT: ROW_EVENT, ROW_PLACE: ROW_PLACE, ROW_MUTED: ROW_MUTED,
  AREA_KEYS: AREA_KEYS, MAX_ROWS: MAX_ROWS, ROWS_MAX_BYTES: ROWS_MAX_BYTES,
  GPS_APPROX: GPS_APPROX, GPS_NO_CABIN: GPS_NO_CABIN, GPS_NO_FROM: GPS_NO_FROM,
  places: places, deckRanges: deckRanges, bankDecksText: bankDecksText, buildPage: buildPage,
  encodeRow: encodeRow, packRows: packRows, encodeGps: encodeGps, encodeBank: encodeBank, message: message,
  ROUTE_REDUCED: ROUTE_REDUCED, ROUTE_STEPS_MAX: ROUTE_STEPS_MAX,
  routePage: routePage, eventRoutePage: eventRoutePage, encodeRoute: encodeRoute, routeMsg: routeMsg
};
