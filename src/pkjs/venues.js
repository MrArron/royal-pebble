// Built-in venue table: where each venue in Royal's schedule is on the ship
// (docs/DESIGN_V1_1.md §1 and §6). Phone-only app knowledge, keyed by the venue
// name exactly as royal.clean() produces it; the bundle format doesn't change.
//
// Harmony of the Seas values come from Royal's own deck plans for sailings from
// May 21, 2026 (after the spring 2026 refit), cross-checked with
// cruisedeckplans.com and CruiseMapper. Decks are the decks you can walk in on;
// a venue with entrances on several decks lists them all, and directions use
// the one nearest to where you're coming from. The Main Dining Room is the
// exception: guests are assigned a floor, and Royal's schedule names each floor
// as its own venue ("Main Dining Room 5").
// Position is relative to the two elevator banks: Fore is forward of the forward
// bank, Aft is aft of the aft bank, Mid is between them. Null position = the
// venue runs the length of the ship.

var AREAS = ['Central Park', 'Boardwalk', 'Royal Promenade', 'Pool & Sports Zone',
  'Vitality Spa & Fitness', 'Entertainment Place', 'Youth Zone'];
var ASHORE = 'Ashore';

var CP = 'Central Park';
var BW = 'Boardwalk';
var RP = 'Royal Promenade';
var PS = 'Pool & Sports Zone';
var VS = 'Vitality Spa & Fitness';
var EP = 'Entertainment Place';
var YZ = 'Youth Zone';

// Rows: [name, deck or [entrance decks], position, neighborhood, check, place]
//   check: the fields the sources don't confirm, as letters: d = deck,
//     p = position, n = neighborhood.
//   place: 1 for common places that aren't schedule venues (for the ship
//     directory later).
// Aliases: [name, target].
var SHIPS = {
  HM: {
    // Checked deck by deck against Royal's own Harmony deck plans (sail dates
    // May 21, 2026 - Apr 10, 2027, profile 2396) on Sep 24, 2026. Names follow
    // the labels on those plans; other names Royal uses are in aliases below.
    // Positions were then measured against the elevator banks on the same plans
    // (ship map data), which moved PADI Shop to Aft and Coastal Kitchen, Suite
    // Lounge and The Perfect Storm Waterslides to Mid.
    venues: [
      // Deck 3
      ['Main Dining Room 3', 3, 'Aft', RP, 'n'],
      // Deck 4: Entertainment Place
      ['Royal Theater', [3, 4, 5], 'Fore', EP, ''],
      ['Main Dining Room 4', 4, 'Aft', RP, 'n'],
      ['Izumi', 4, 'Aft', EP, 'n'],
      ['Casino Royale', 4, 'Mid', EP, ''],
      ['Studio B', 4, 'Mid', EP, ''],
      ['Art Gallery', 4, 'Mid', EP, ''],
      // Deck 5: Royal Promenade and the spa
      ['Vitality Spa', 5, 'Fore', VS, ''],
      ['Royal Promenade', 5, null, RP, ''],
      ['Running Track', 5, null, null, 'n'],
      ['Rising Tide Bar', [5, 8], 'Mid', RP, ''],
      ['Cafe Promenade', 5, 'Mid', RP, ''],
      ["Sorrento's", 5, 'Mid', RP, ''],
      ['Pesky Parrot', 5, 'Mid', RP, ''],
      ['Boleros', 5, 'Mid', RP, ''],
      ['On Air', 5, 'Mid', RP, ''],
      ['Boot & Bonnet Pub', 5, 'Mid', RP, ''],
      ['NextCruise Office', 5, 'Mid', RP, ''],
      ['Port & Shopping Desk', 5, 'Mid', RP, ''],
      ['Shore Excursions', 5, 'Mid', RP, ''],
      ['Loyalty Desk', 5, 'Mid', RP, ''],
      ['Promenade Shops', 5, 'Mid', RP, ''],
      ['Kate Spade', 5, 'Mid', RP, ''],
      ['Royal Shops', 5, 'Mid', RP, ''],
      ['Port Merchants', 5, 'Mid', RP, ''],
      ['Regalia Fine Jewelry', 5, 'Mid', RP, ''],
      ['Regalia Watches', 5, 'Mid', RP, ''],
      ['Solera', 5, 'Mid', RP, ''],
      ['Prince & Greene', 5, 'Mid', RP, ''],
      ['Pandora', 5, 'Mid', RP, 'd'],
      ['Kids Shop', 5, 'Mid', RP, 'dpn'],
      ['Main Dining Room 5', 5, 'Aft', RP, 'n'],
      // Deck 6: the Boardwalk aft, Vitality forward
      ['Fitness Center', 6, 'Fore', VS, ''],
      ['Vitality Cafe', 6, 'Fore', VS, ''],
      ['Schooner Bar', 6, 'Mid', RP, 'n'],
      ['Focus Photo Gallery', 6, 'Mid', RP, 'n'],
      ['Picture This', 6, 'Mid', RP, 'dpn'],
      ['Boardwalk', 6, 'Aft', BW, ''],
      ['AquaTheater', [5, 6], 'Aft', BW, ''],
      ['Starbucks', 6, 'Aft', BW, ''],
      ['Playmakers Sports Bar & Arcade', 6, 'Aft', BW, ''],
      ['Johnny Rockets', 6, 'Aft', BW, ''],
      ['Boardwalk Dog House', 6, 'Aft', BW, ''],
      ['Carousel', 6, 'Aft', BW, ''],
      ['Luckey Climber', 6, 'Aft', BW, ''],
      ['Arcade', 6, 'Aft', BW, ''],
      // Deck 7 (the plans show it here; the flag stays so the tests keep a
      // deck-only example: tap "Looks right" on the phone)
      ['Rock Climbing Wall', 7, 'Aft', BW, 'd'],
      // Deck 8: Central Park
      ['Central Park', 8, 'Mid', CP, ''],
      ['Chops Grille', 8, 'Mid', CP, ''],
      ['150 Central Park', 8, 'Mid', CP, ''],
      ['Park Cafe', 8, 'Mid', CP, ''],
      ["Jamie's Italian", 8, 'Mid', CP, ''],
      ['Trellis Bar', 8, 'Mid', CP, ''],
      ['Vintages', 8, 'Mid', CP, ''],
      ["Giovanni's Wine Bar", 8, 'Mid', CP, ''],
      ['Hublot', 8, 'Mid', CP, ''],
      ['Omega', 8, 'Mid', CP, ''],
      ['Cartier', 8, 'Mid', CP, ''],
      ['Bulgari', 8, 'Mid', CP, ''],
      ['Breitling', 8, 'Mid', CP, 'dn'],
      ['Messika Boutique', 8, 'Mid', CP, 'dn'],
      ['Roberto Coin Boutique', 8, 'Mid', CP, 'dn'],
      ['Dazzles', [8, 9], 'Aft', CP, 'n'],
      // Deck 14: Adventure Ocean forward, card room aft
      ['Card Room', 14, 'Aft', null, 'n'],
      ['Adventure Ocean Theater', 14, 'Fore', YZ, ''],
      ["Kids' Avenue", 14, 'Fore', YZ, ''],
      ['Play', 14, 'Fore', YZ, ''],
      ['Adventure Science', 14, 'Fore', YZ, ''],
      ['Adventure Art', 14, 'Fore', YZ, ''],
      ['Nursery', 14, 'Fore', YZ, ''],
      ['The Puzzle Break', 14, 'Fore', EP, 'n'],
      ['AO Workshop', 14, 'Fore', YZ, 'd'],
      ['Arena & Hangouts (Ages 6-12)', 14, 'Fore', YZ, 'd'],
      // Deck 15: pool deck and teen area
      ['Solarium', 15, 'Fore', PS, ''],
      ['Pool Deck', 15, 'Mid', PS, ''],
      ['The Lime & Coconut', 15, 'Mid', PS, ''],
      ['Sand Bar', 15, 'Mid', PS, ''],
      ['Sports Pool', 15, 'Mid', PS, ''],
      ['PADI Shop', 15, 'Aft', PS, ''],
      ['Harmony Dunes', 15, 'Aft', PS, ''],
      ['Sports Court', 15, 'Aft', PS, ''],
      ['Table Tennis Court', 15, 'Aft', PS, ''],
      ['El Loco Fresh', 15, 'Aft', PS, ''],
      ['Crown Lounge', 15, 'Aft', PS, 'n'],
      ['Video Arcade', 15, 'Aft', YZ, 'n'],
      ['Teen Center', 15, 'Aft', YZ, ''],
      ['Teen Lounge', 15, 'Aft', YZ, ''],
      ['The Living Room', 15, 'Aft', YZ, ''],
      ['Fuel Teen Disco', 15, 'Aft', YZ, ''],
      ['Social100 (Ages 13-17)', 15, 'Aft', YZ, 'd'],
      // Deck 16: sports deck aft, Mast Bar mid, Solarium Bar forward
      ['FlowRider', 16, 'Aft', PS, ''],
      ['Wipe Out Bar', 16, 'Aft', PS, ''],
      ['The Ultimate Abyss', 16, 'Aft', PS, 'n'],
      ['Zip Line', 16, 'Aft', PS, 'n'],
      ['Mast Bar', 16, 'Mid', PS, ''],
      ['Solarium Bar', 16, 'Fore', PS, ''],
      // Deck 17-18
      ['Coastal Kitchen', 17, 'Mid', PS, 'n'],
      ['Suite Lounge', 17, 'Mid', PS, 'n'],
      ['Suite Sun Deck', 17, 'Fore', PS, 'n'],
      ['The Perfect Storm Waterslides', 18, 'Mid', PS, 'p'],
      // Ashore
      ['Perfect Day at CocoCay', null, null, ASHORE, ''],
      // Common places that aren't schedule venues
      ['Guest Services', 5, 'Mid', RP, '', 1],
      ['Medical Center', 2, null, null, 'dpn', 1],
      ['Windjammer Marketplace', 16, 'Aft', PS, '', 1],
      ['Main Pool', 15, 'Mid', PS, '', 1],
      ['Beach Pool', 15, 'Mid', PS, '', 1],
      ['Splashaway Bay', 15, 'Mid', PS, '', 1],
      ['Solarium Bistro', 15, 'Fore', PS, '', 1]
    ],
    aliases: [
      ['Perfect Day CocoCay', 'Perfect Day at CocoCay'],
      ['Casino Royale Non-Smoking', 'Casino Royale'],
      ['Expanded Casino', 'Casino Royale'],
      ['Adventure Ocean', 'Adventure Ocean Theater'],
      ['Center Ice Rink', 'Studio B'],
      ['Studio B Ice Rink', 'Studio B'],
      ['Izumi Hibachi & Sushi', 'Izumi'],
      ['Izumi Sushi', 'Izumi'],
      ['Izumi Hibachi', 'Izumi'],
      ['On Air Club', 'On Air'],
      ['Rising Tide', 'Rising Tide Bar'],
      ["Sorrento's Pizza", "Sorrento's"],
      ['Loyalty', 'Loyalty Desk'],
      ['Shore Excursions Desk', 'Shore Excursions'],
      ['Port Shopping', 'Port & Shopping Desk'],
      ['Vitality at Sea Spa', 'Vitality Spa'],
      ['Vitality at Sea Fitness Center', 'Fitness Center'],
      ['Focus', 'Focus Photo Gallery'],
      ['Playmakers', 'Playmakers Sports Bar & Arcade'],
      ['Playmakers Sports Bar', 'Playmakers Sports Bar & Arcade'],
      ['Dog House', 'Boardwalk Dog House'],
      ['Boardwalk Carousel', 'Carousel'],
      ['Chops Grille Steakhouse', 'Chops Grille'],
      ["Jamie's Italian by Jamie Oliver", "Jamie's Italian"],
      ['Vintages Wine Bar', 'Vintages'],
      ["Royal Babies & Tots Nursery", 'Nursery'],
      ['Puzzle Break', 'The Puzzle Break'],
      ['Lime & Coconut', 'The Lime & Coconut'],
      ['Ping-Pong Tables', 'Table Tennis Court'],
      ['Crown & Anchor Lounge', 'Crown Lounge'],
      ['Fuel', 'Fuel Teen Disco'],
      ['Ultimate Abyss', 'The Ultimate Abyss'],
      ['Perfect Storm', 'The Perfect Storm Waterslides'],
      ['The Perfect Storm', 'The Perfect Storm Waterslides'],
      ['Windjammer', 'Windjammer Marketplace'],
      ['Jogging Track', 'Running Track']
    ],
    // Names for the reminder alert, which keeps 17 bytes of each venue name
    // (docs/WATCH_PROTOCOL.md, Alerts). Longer names without one are cut.
    short: [
      ['Main Dining Room 3', 'Main Dining 3'],
      ['Main Dining Room 4', 'Main Dining 4'],
      ['Main Dining Room 5', 'Main Dining 5'],
      ['Playmakers Sports Bar & Arcade', 'Playmakers'],
      ['The Perfect Storm Waterslides', 'Perfect Storm'],
      ['Arena & Hangouts (Ages 6-12)', 'Arena & Hangouts'],
      ['Social100 (Ages 13-17)', 'Social100'],
      ['Adventure Ocean Theater', 'Ocean Theater'],
      ['Roberto Coin Boutique', 'Roberto Coin'],
      ['Port & Shopping Desk', 'Port & Shopping'],
      ['Regalia Fine Jewelry', 'Regalia Jewelry'],
      ['Focus Photo Gallery', 'Focus Photo'],
      ['Rock Climbing Wall', 'Climbing Wall'],
      ['Table Tennis Court', 'Table Tennis'],
      ['The Ultimate Abyss', 'Ultimate Abyss'],
      ['The Lime & Coconut', 'Lime & Coconut'],
      ['Windjammer Marketplace', 'Windjammer'],
      ['Perfect Day at CocoCay', 'CocoCay']
    ]
  }
};

// The built-in table for a ship code: {venues: {name: venue}, aliases: {name: target}}.
function builtIn(ship) {
  var src = SHIPS[ship];
  var out = {venues: {}, aliases: {}};
  if (!src) {
    return out;
  }
  src.venues.forEach(function(r) {
    var check = r[4] || '';
    out.venues[r[0]] = {
      name: r[0],
      decks: r[1] === null ? [] : [].concat(r[1]),
      position: r[2],
      neighborhood: r[3],
      flags: {
        deck: check.indexOf('d') !== -1,
        position: check.indexOf('p') !== -1,
        neighborhood: check.indexOf('n') !== -1
      },
      place: !!r[5]
    };
  });
  src.aliases.forEach(function(a) {
    out.aliases[a[0]] = a[1];
  });
  (src.short || []).forEach(function(s) {
    out.venues[s[0]].short = s[1];
  });
  return out;
}

// Venue rules shared by the companion and the settings page, which embeds this
// function's source (config.js). So it must not use anything outside itself.
//
// The owner's edits for one ship are {venueName: over}, where over is
// {decks?, position?, neighborhood?, confirmed?: {deck, position, neighborhood}}.
// A field is only present when it differs from the built-in value, so present
// means edited. Venues not in the table are keyed by their schedule name.
function venueLib() {
  var AREAS = ['Central Park', 'Boardwalk', 'Royal Promenade', 'Pool & Sports Zone',
    'Vitality Spa & Fitness', 'Entertainment Place', 'Youth Zone'];
  var ASHORE = 'Ashore';
  var POSITIONS = ['Fore', 'Mid', 'Aft'];
  var FIELDS = ['deck', 'position', 'neighborhood'];
  var DOT = ' ' + String.fromCharCode(183) + ' ';
  var has = function(o, k) { return Object.prototype.hasOwnProperty.call(o, k); };

  // Lookup key: ignores case, accents, punctuation and spaces; "&" = "and".
  function norm(name) {
    var s = String(name || '').toLowerCase();
    if (s.normalize) {
      s = s.normalize('NFD');
    }
    return s.replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
  }

  function valueKey(field) {
    return field === 'deck' ? 'decks' : field;
  }

  // The table name for a schedule venue name, following aliases; null when it
  // isn't in the table. table: {venues: {name: venue}, aliases: {name: target}}.
  function lookup(table, name) {
    var key = norm(name);
    if (!key) {
      return null;
    }
    var names = Object.keys(table.venues);
    for (var i = 0; i < names.length; i++) {
      if (norm(names[i]) === key) {
        return names[i];
      }
    }
    var aliases = Object.keys(table.aliases);
    for (var j = 0; j < aliases.length; j++) {
      if (norm(aliases[j]) === key) {
        var target = norm(table.aliases[aliases[j]]);
        for (var k = 0; k < names.length; k++) {
          if (norm(names[k]) === target) {
            return names[k];
          }
        }
      }
    }
    return null;
  }

  // One venue as the owner sees it: built-in values with their edits applied.
  // base: the built-in venue or null. Adds, per field: edited, check (flagged,
  // not edited, not confirmed) and confirmed.
  function resolve(name, base, over) {
    over = over || {};
    var conf = over.confirmed || {};
    var v = {name: name, builtIn: base || null, place: !!(base && base.place),
             edited: {}, check: {}, confirmed: {}};
    FIELDS.forEach(function(f) {
      var k = valueKey(f);
      var mine = has(over, k);
      v[k] = mine ? over[k] : base ? base[k] : (f === 'deck' ? [] : null);
      v.edited[f] = mine;
      v.confirmed[f] = !!conf[f];
      v.check[f] = !mine && !!(base && base.flags[f]) && !conf[f];
    });
    v.isEdited = FIELDS.some(function(f) { return v.edited[f]; });
    v.blank = !base && !v.isEdited;
    v.toCheck = v.blank || FIELDS.some(function(f) { return v.check[f]; });
    return v;
  }

  function same(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  // Sets one field of `over` (changed in place); a value equal to the built-in
  // one removes the edit. Ashore has no deck or position; leaving Ashore puts
  // the built-in deck and position back when they were cleared for it.
  function setField(over, base, field, value) {
    var k = valueKey(field);
    if (field === 'deck') {
      value = (value || []).filter(function(d, i, a) { return d >= 1 && a.indexOf(d) === i; })
        .sort(function(a, b) { return a - b; });
    }
    var builtInValue = base ? base[k] : (field === 'deck' ? [] : null);
    if (same(value, builtInValue)) {
      delete over[k];
    } else {
      over[k] = value;
    }
    if (field === 'neighborhood') {
      if (value === ASHORE) {
        setField(over, base, 'deck', []);
        setField(over, base, 'position', null);
      } else if (has(over, 'decks') && !over.decks.length) {
        delete over.decks;
        delete over.position;
      }
    }
    return over;
  }

  // Reset: back to the built-in value, and its flag unless it was confirmed.
  function resetField(over, base, field) {
    if (field === 'neighborhood') {
      return setField(over, base, field, base ? base.neighborhood : null);
    }
    delete over[valueKey(field)];
    return over;
  }

  // "Looks right": clears the check without changing the value.
  function confirm(over, field) {
    over.confirmed = over.confirmed || {};
    over.confirmed[field] = true;
    return over;
  }

  // Every venue the owner can look at: the table, schedule venues missing from
  // it, and venues they added that the schedule no longer lists. Sorted by name.
  function entries(table, overrides, scheduleVenues) {
    overrides = overrides || {};
    var out = [];
    var seen = {};
    function add(name, base) {
      var key = norm(name);
      if (!key || seen[key]) {
        return;
      }
      seen[key] = true;
      out.push(resolve(name, base, has(overrides, name) ? overrides[name] : null));
    }
    Object.keys(table.venues).forEach(function(n) { add(n, table.venues[n]); });
    (scheduleVenues || []).concat(Object.keys(overrides)).forEach(function(n) {
      if (n && !lookup(table, n)) {
        add(n, null);
      }
    });
    return out.sort(function(a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
  }

  // Numbers for the Cruise card.
  function counts(list) {
    return {
      venues: list.length,
      toCheck: list.filter(function(v) { return v.toCheck; }).length,
      edited: list.filter(function(v) { return v.isEdited; }).length
    };
  }

  // "3-5", or "3, 5" when they aren't next to each other.
  function deckList(decks) {
    var run = decks.every(function(d, i) { return !i || d === decks[i - 1] + 1; });
    return run && decks.length > 1 ? decks[0] + '-' + decks[decks.length - 1] : decks.join(', ');
  }

  function deckText(decks) {
    return (decks.length > 1 ? 'Decks ' : 'Deck ') + deckList(decks);
  }

  // The entrance deck nearest to `from` (a deck number, or null when it isn't
  // known). Null when the venue has no deck or `from` is unknown and the venue
  // has more than one entrance. On a tie, the lower deck (walking down is easier).
  function nearestDeck(decks, from) {
    if (!decks || !decks.length) {
      return null;
    }
    if (decks.length === 1) {
      return decks[0];
    }
    if (from === null || from === undefined) {
      return null;
    }
    var best = decks[0];
    decks.forEach(function(d) {
      if (Math.abs(d - from) < Math.abs(best - from)) {
        best = d;
      }
    });
    return best;
  }

  // The cabin deck from the Me tab's free-text Deck field: its first number
  // ("Deck 9" -> 9). Null when there is none.
  function cabinDeck(text) {
    var m = /\d+/.exec(String(text || ''));
    var n = m ? +m[0] : 0;
    return n >= 1 && n <= 20 ? n : null;
  }

  // The watch's lines for a venue (docs/DESIGN_V1_1.md §2): loc is
  // "Deck 4 · Mid", "Decks 3-5 · Fore" (no cabin deck), "Ashore" or null (no
  // deck); rel is {dir: 1 up, -1 down, 0 same deck, text} or null (no cabin deck).
  function watchLines(v, cabin) {
    if (v.neighborhood === ASHORE) {
      return {loc: 'Ashore', rel: null};
    }
    if (!v.decks.length) {
      return {loc: null, rel: null};
    }
    var deck = nearestDeck(v.decks, cabin);
    var loc = (deck === null ? deckText(v.decks) : 'Deck ' + deck) + (v.position ? DOT + v.position : '');
    if (cabin === null || cabin === undefined) {
      return {loc: loc, rel: null};
    }
    var diff = deck - cabin;
    var n = Math.abs(diff);
    return {loc: loc, rel: {dir: diff > 0 ? 1 : diff < 0 ? -1 : 0,
                            text: n ? n + (n === 1 ? ' deck' : ' decks') + ' from cabin' : 'On your cabin deck'}};
  }

  var POS_RANK = {Fore: 0, Mid: 1, Aft: 2};
  function posRank(v) {
    return has(POS_RANK, v.position) ? POS_RANK[v.position] : 3;
  }

  // The list's sub-line under a venue name.
  function subLine(v, mode) {
    if (v.blank) {
      return 'Not in the table yet';
    }
    if (v.neighborhood === ASHORE) {
      return 'Ashore' + DOT + 'no deck';
    }
    var bits = mode === 'deck' ? [v.position, v.neighborhood] :
      [v.decks.length ? deckText(v.decks) : 'No deck yet', v.position];
    return bits.filter(Boolean).join(DOT) || 'No area yet';
  }

  // The list's groups, [{title, rows: [venue]}]. mode 'area': Needs details,
  // the seven neighborhoods, Other places, Ashore. mode 'deck': Needs details,
  // each deck (a venue shows under every entrance deck), No deck, Ashore.
  function groups(list, mode) {
    var byKey = {};
    var keys = [];
    function put(key, v) {
      if (!byKey[key]) {
        byKey[key] = [];
        keys.push(key);
      }
      byKey[key].push(v);
    }
    list.forEach(function(v) {
      if (v.blank) {
        put('_blank', v);
      } else if (v.neighborhood === ASHORE) {
        put('_ashore', v);
      } else if (mode === 'deck') {
        if (!v.decks.length) {
          put('_none', v);
        }
        v.decks.forEach(function(d) { put(d, v); });
      } else {
        put(AREAS.indexOf(v.neighborhood) !== -1 ? v.neighborhood : '_none', v);
      }
    });
    function order(k) {
      return k === '_blank' ? -1 : k === '_none' ? 1000 : k === '_ashore' ? 1001 :
        mode === 'deck' ? +k : AREAS.indexOf(k);
    }
    return keys.sort(function(a, b) { return order(a) - order(b); }).map(function(k) {
      var rows = byKey[k].slice().sort(function(a, b) {
        var d = mode === 'deck' ? 0 : (a.decks[0] || 99) - (b.decks[0] || 99);
        return d || posRank(a) - posRank(b) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      });
      var title = k === '_blank' ? 'Needs details' : k === '_ashore' ? ASHORE :
        k === '_none' ? (mode === 'deck' ? 'No deck' : 'Other places') : mode === 'deck' ? 'Deck ' + k : k;
      return {title: title, rows: rows};
    });
  }

  // Venues to check, in the list's Area order (the Review button's queue).
  function reviewQueue(list) {
    var out = [];
    groups(list.filter(function(v) { return v.toCheck; }), 'area').forEach(function(g) {
      g.rows.forEach(function(v) { out.push(v.name); });
    });
    return out;
  }

  return {
    AREAS: AREAS, ASHORE: ASHORE, POSITIONS: POSITIONS, FIELDS: FIELDS,
    norm: norm, lookup: lookup, resolve: resolve, setField: setField, resetField: resetField,
    confirm: confirm, entries: entries, counts: counts, deckList: deckList, deckText: deckText,
    nearestDeck: nearestDeck, cabinDeck: cabinDeck, watchLines: watchLines, subLine: subLine,
    groups: groups, reviewQueue: reviewQueue
  };
}

var lib = venueLib();

// The owner's edits as returned by the settings page, checked. Null when they
// aren't an object.
function cleanOverrides(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  var own = function(o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  var out = {};
  Object.keys(raw).slice(0, 300).forEach(function(name) {
    var o = raw[name];
    if (!name.trim() || name.length > 64 || name === '__proto__' || !o || typeof o !== 'object') {
      return;
    }
    var c = {};
    if (Array.isArray(o.decks)) {
      c.decks = o.decks.filter(function(d, i, a) {
        return typeof d === 'number' && d % 1 === 0 && d >= 1 && d <= 20 && a.indexOf(d) === i;
      }).sort(function(a, b) { return a - b; }).slice(0, 6);
    }
    if (own(o, 'position') && (o.position === null || lib.POSITIONS.indexOf(o.position) !== -1)) {
      c.position = o.position;
    }
    if (own(o, 'neighborhood') && (o.neighborhood === null || o.neighborhood === ASHORE ||
                                   AREAS.indexOf(o.neighborhood) !== -1)) {
      c.neighborhood = o.neighborhood;
    }
    if (o.confirmed && typeof o.confirmed === 'object') {
      var conf = {};
      lib.FIELDS.forEach(function(f) {
        if (o.confirmed[f] === true) {
          conf[f] = true;
        }
      });
      if (Object.keys(conf).length) {
        c.confirmed = conf;
      }
    }
    if (Object.keys(c).length) {
      out[name] = c;
    }
  });
  return out;
}

// Where a venue is, as the watch gets it (docs/WATCH_PROTOCOL.md, Packed
// events). The phone makes every decision (table, owner edits, which entrance,
// how far from the cabin); the watch only formats the numbers.
//   deck: the entrance deck to use (the one nearest the cabin), 0 = none known
//   deckTo: several entrances and no cabin deck: deck..deckTo, else 0
//   pos: 0 none, 1 Fore, 2 Mid, 3 Aft
//   ashore: true for Ashore (no deck)
//   rel: deck - cabin deck, or null when the cabin deck isn't known
var NOWHERE = {deck: 0, deckTo: 0, pos: 0, ashore: false, rel: null};

function watchWhere(v, cabin) {
  if (v.neighborhood === ASHORE) {
    return {deck: 0, deckTo: 0, pos: 0, ashore: true, rel: null};
  }
  if (!v.decks.length) {
    return NOWHERE;
  }
  var deck = lib.nearestDeck(v.decks, cabin);
  var pos = lib.POSITIONS.indexOf(v.position) + 1;
  if (deck === null) {
    return {deck: v.decks[0], deckTo: v.decks[v.decks.length - 1], pos: pos, ashore: false, rel: null};
  }
  return {deck: deck, deckTo: 0, pos: pos, ashore: false, rel: cabin === null ? null : deck - cabin};
}

// "From" directions on a reminder (docs/DESIGN_V1_1.md §2): how to get to a
// venue from the one the user is at just before.
var FROM_NONE = 0;   // directions from the cabin (watchWhere)
var FROM_ROUTE = 1;  // "From Royal Theater:" / "↓1 deck · Fore → Mid"
var FROM_SAME_VENUE = 2;
var FROM_SAME_AREA = 3;  // same neighborhood, deck and position: "Same area · Deck 5"

// The entrance pair nearest to each other: [from deck, to deck]. On a tie, the
// lower destination deck, then the lower starting deck.
function nearestPair(fromDecks, toDecks) {
  var best = null;
  fromDecks.forEach(function(f) {
    toDecks.forEach(function(t) {
      var d = Math.abs(t - f);
      if (!best || d < best.d || (d === best.d && (t < best.t || (t === best.t && f < best.f)))) {
        best = {d: d, f: f, t: t};
      }
    });
  });
  return [best.f, best.t];
}

// Venue answers for one ship with the owner's edits for it. cabinText is the Me
// tab's Deck field. Names are as in the schedule or a personal entry.
//   where(name): watchWhere(), relative to the cabin
//   short(name): the name for the reminder alert (the table's short name, if any)
//   route(fromName, name): null when there are no "From" directions (either
//     venue unknown, Ashore or missing), else {kind: FROM_*, fromPos (0-3),
//     where: the venue's watchWhere() relative to the previous venue (deck is
//     the entrance nearest to it, rel the decks between them)}
function venueFinder(shipCode, overrides, cabinText) {
  var table = builtIn(shipCode);
  var own = function(o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  overrides = overrides || {};
  var cabin = lib.cabinDeck(cabinText);
  var cache = {};

  function venue(name) {
    if (!own(cache, name)) {
      var tableName = lib.lookup(table, name);
      var key = tableName || name;
      var base = tableName ? table.venues[tableName] : null;
      var v = lib.resolve(key, base, own(overrides, key) ? overrides[key] : null);
      v.short = (base && base.short) || name;
      v.where = watchWhere(v, cabin);
      cache[name] = v;
    }
    return cache[name];
  }

  function onBoard(v) {
    return v.neighborhood !== ASHORE && v.decks.length > 0;
  }

  return {
    // The venue as the table and the owner's edits have it (lib.resolve), with
    // `short` and `where`.
    entry: venue,
    where: function(name) {
      return name ? venue(name).where : NOWHERE;
    },
    short: function(name) {
      return name ? venue(name).short : '';
    },
    route: function(fromName, name) {
      if (!fromName || !name) {
        return null;
      }
      var from = venue(fromName);
      var to = venue(name);
      if (!onBoard(from) || !onBoard(to)) {
        return null;
      }
      var pair = nearestPair(from.decks, to.decks);
      var fromPos = lib.POSITIONS.indexOf(from.position) + 1;
      var toPos = lib.POSITIONS.indexOf(to.position) + 1;
      var kind = FROM_ROUTE;
      if (lib.norm(from.name) === lib.norm(to.name)) {
        kind = FROM_SAME_VENUE;
      } else if (from.neighborhood && from.neighborhood === to.neighborhood && pair[0] === pair[1] &&
                 (!fromPos || !toPos || fromPos === toPos)) {
        kind = FROM_SAME_AREA;
      }
      return {kind: kind, fromPos: fromPos,
              where: {deck: pair[1], deckTo: 0, pos: toPos, ashore: false, rel: pair[1] - pair[0]}};
    }
  };
}

// A function from a venue name to its watchWhere() (see venueFinder).
function whereFinder(shipCode, overrides, cabinText) {
  return venueFinder(shipCode, overrides, cabinText).where;
}

module.exports = {
  AREAS: AREAS,
  ASHORE: ASHORE,
  NOWHERE: NOWHERE,
  FROM_NONE: FROM_NONE,
  FROM_ROUTE: FROM_ROUTE,
  FROM_SAME_VENUE: FROM_SAME_VENUE,
  FROM_SAME_AREA: FROM_SAME_AREA,
  watchWhere: watchWhere,
  whereFinder: whereFinder,
  venueFinder: venueFinder,
  builtIn: builtIn,
  venueLib: venueLib,
  lib: lib,
  nearestDeck: lib.nearestDeck,
  cabinDeck: lib.cabinDeck,
  cleanOverrides: cleanOverrides
};
