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
var REF_PLACE = 1000;  // + index in places()

// Row kinds.
var ROW_HEADER = 0;  // small-caps header, the cursor skips it
var ROW_ITEM = 1;    // name and optional sub-line; opens `ref` when not 0
var ROW_EVENT = 2;   // an event at the place: title, the watch formats the time
var ROW_PLACE = 3;   // a heading: the name, and for a place its area (where is dir_where)

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

function item(ref, line1, line2) {
  return {kind: ROW_ITEM, ref: ref, line1: line1, line2: line2 || ''};
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

// Page 1: each area with its decks and how many places it has.
function areasPage(list) {
  var rows = [];
  AREA_KEYS.forEach(function(key, i) {
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
  if (!rows.length) {
    rows.push(item(0, 'No venues for this ship', 'Add them on your phone'));
  }
  return {title: 'Ship', label: 'by area', rows: rows};
}

// One deck: its places under Fore / Mid / Aft (and "full length" for ones with
// no position). Venues with several entrances show on each of their decks.
function deckPage(list, deck, cabin, placeRef) {
  var on = list.filter(function(v) {
    return v.neighborhood !== venues.ASHORE && v.decks.indexOf(deck) !== -1;
  });
  var rows = [];
  POS_ORDER.forEach(function(pos) {
    var here = on.filter(function(v) { return (v.position || null) === pos; }).sort(byName);
    if (here.length) {
      rows.push(header(pos || 'full length'));
      here.forEach(function(v) { rows.push(item(placeRef(v), v.name)); });
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

// The FROM block for a place page: {header, decks, text, flags}, or null for no
// GPS lines at all (ship not mapped, ashore, no deck, stateroom not on the map).
// The route starts where routestart.js says for "now" (§9.4).
function placeGps(v, ctx, cabin) {
  var ship = ctx.shipCode;
  if (!ctx.bundle || !shipmap.data(ship)) {
    return null;
  }
  var to = spotsOf(ship, v, cabin);
  if (!to.length) {
    return null;
  }
  var flags = to[0].approx ? GPS_APPROX : 0;
  var settings = ctx.settings || {};
  var finder = venues.venueFinder(ship, (settings.venues || {})[ship], (settings.me || {}).deck);
  var room = stateroom(ctx);
  var sailDays = slice.daysFromIso(ctx.bundle.sailDate);
  var now = slice.cruiseMinutes(sailDays, ctx.now);
  var start = routestart.start({stops: stops(ctx, sailDays, slice.cruiseDayIndex(now)), now: now, cabin: room});
  var from = start.venue ? spotsOf(ship, finder.entry(start.venue), cabin) : [];
  if (!from.length && room) {
    // At a stop that isn't on the map (ashore, say): from the cabin.
    start = {kind: 'cabin', cabin: room};
    from = [shipmap.cabin(ship, room)].filter(Boolean);
  }
  if (!room && !from.length) {
    return {header: '', decks: 0, text: '', flags: flags | GPS_NO_CABIN};
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
    return null;
  }
  var line = gpstext.fromLine(best.route, best.from, {units: settings.units, fromCabin: start.kind === 'cabin'});
  return {header: gpstext.fromHeader(start, finder.short(start.venue)), decks: line.decks, text: line.text,
          flags: flags};
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

// ctx: {bundle, settings, stars, now (Date)}. Returns {ref, title, label,
// rel (decks from the cabin, or null), where and gps (place pages), rows}.
function buildPage(ref, ctx) {
  var bundle = ctx.bundle || {};
  var settings = ctx.settings || {};
  var shipCode = (bundle.ship && bundle.ship.code) || '';
  var c = {bundle: ctx.bundle, settings: settings, stars: ctx.stars || {}, now: ctx.now || new Date(),
           shipCode: shipCode};
  var list = places(shipCode, (settings.venues || {})[shipCode]);
  var cabin = L.cabinDeck((settings.me || {}).deck);
  function placeRef(v) {
    return REF_PLACE + list.indexOf(v);
  }
  var page;
  if (ref === REF_AREAS) {
    page = areasPage(list);
  } else if (ref > REF_DECK && ref < REF_AREA) {
    page = deckPage(list, ref - REF_DECK, cabin, placeRef);
  } else if (ref >= REF_AREA && ref < REF_AREA + AREA_KEYS.length) {
    page = areaPage(list, AREA_KEYS[ref - REF_AREA], cabin, placeRef);
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
  return m;
}

// int8 decks (signed, + = up), uint8 flags, then the FROM header and the FROM
// line text, each as uint8 length and UTF-8 bytes.
function encodeGps(g) {
  var header = pack.utf8(g.header || '', GPS_TEXT_MAX);
  var text = pack.utf8(g.text || '', GPS_TEXT_MAX);
  var decks = Math.max(-127, Math.min(127, g.decks | 0));
  return [decks & 255, g.flags & 255, header.length].concat(header, [text.length], text);
}

module.exports = {
  REF_DECKS: REF_DECKS, REF_AREAS: REF_AREAS, REF_DECK: REF_DECK, REF_AREA: REF_AREA, REF_PLACE: REF_PLACE,
  ROW_HEADER: ROW_HEADER, ROW_ITEM: ROW_ITEM, ROW_EVENT: ROW_EVENT, ROW_PLACE: ROW_PLACE,
  AREA_KEYS: AREA_KEYS, MAX_ROWS: MAX_ROWS, ROWS_MAX_BYTES: ROWS_MAX_BYTES,
  GPS_APPROX: GPS_APPROX, GPS_NO_CABIN: GPS_NO_CABIN,
  places: places, deckRanges: deckRanges, buildPage: buildPage, encodeRow: encodeRow,
  packRows: packRows, encodeGps: encodeGps, message: message
};
