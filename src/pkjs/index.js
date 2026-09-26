// Cruise Watch phone companion (PebbleKit JS).
//
// Keeps the full cruise bundle in phone storage and sends the watch today's
// slice (docs/WATCH_PROTOCOL.md). Until real data is saved it uses a demo cruise.

var slice = require('./slice');
var pack = require('./pack');
var demo = require('./demo');
var bundleLib = require('./bundle');
var royal = require('./royal');
var config = require('./config');
var venues = require('./venues');
var directory = require('./directory');
var gpstext = require('./gpstext');
var shipmap = require('./shipmap');
var logLib = require('./log');

var MSG_BEGIN = 1;
var MSG_INFO = 2;
var MSG_EVENTS = 3;
var MSG_END = 4;
var MSG_ALARMS = 5;
var MSG_NOTICE = 6;
var MSG_STAR_ACK = 7;
var MSG_DIR_PAGE = 8;
var MSG_REQUEST = 10;
var MSG_DEMO_NEXT = 12;
var MSG_STAR_CHANGES = 13;
var MSG_SAVED = 14;
var MSG_DIR_REQUEST = 15;
var MSG_ROUTE_REQUEST = 16;
var MSG_ROUTE_PAGE = 17;
var MSG_LOG = 18;

// Keep each events chunk well under the watch's 2048-byte inbox.
var CHUNK_BYTES = 1500;

var STORE_BUNDLE = 'bundle';
var STORE_SETTINGS = 'settings';
var STORE_STARS = 'stars';
// When each star last changed (ms), from the watch or the settings page, so the
// latest change wins when both changed one before they synced.
var STORE_STAR_TIMES = 'starTimes';
var STORE_STATUS = 'status';  // {error, at} from the last failed download
var STORE_SHIPS = 'ships';    // {at, list: [{code, name}]}
var STORE_TEST = 'testAlerts';  // time Test alerts was tapped (ms)
// Starred events a re-sync moved or cancelled: {at, list} for the settings
// page (replaced by every sync of the same sailing), and notices not yet
// delivered to the watch.
var STORE_STAR_CHANGES = 'starChanges';
var STORE_NOTICES = 'notices';
// What the watch last reported about its storage (MSG_SAVED): {sailDate,
// cutoff (the first starred event or alert it couldn't save), bytes, max}.
var STORE_WATCH_SAVED = 'watchSaved';

var SHIPS_MAX_AGE_MS = 30 * 24 * 3600 * 1000;

// The demo is built around the time it was first shown and kept for 12 hours,
// so a launch caused by one of its alerts doesn't move every time again.
var STORE_DEMO = 'demo';  // {variant, at}
var DEMO_MAX_AGE_MS = 12 * 3600 * 1000;

var s_demoVariant = (load(STORE_DEMO, {}).variant) || 0;
var s_demo = null;       // demo data while no bundle is saved
var s_sliceId = 0;
var s_sending = false;   // one send at a time: a slice or a star ack
var s_resend = false;
var s_ack = null;        // star ack to send: {seq, resend}
var s_dirRef = null;     // ship directory page the watch asked for
var s_route = null;      // route the watch asked for: {ref, rest} or {start, venue}

function load(key, fallback) {
  try {
    var text = localStorage.getItem(key);
    return text ? JSON.parse(text) : fallback;
  } catch (e) {
    return fallback;
  }
}

function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// ---- Usage log (log.js). The saved cruise's sail date gives each entry its
// cruise day; it's cached so a burst of entries doesn't re-read the bundle.
var s_sailDate;  // undefined until read; null with no cruise saved
var s_lastSaved = '';  // the watch's last storage report, as logged
var usage = logLib.makeLog(localStorage, {
  sailDate: function() {
    if (s_sailDate === undefined) {
      var b = load(STORE_BUNDLE, null);
      s_sailDate = b ? b.sailDate : null;
    }
    return s_sailDate;
  }
});

// "Title, 2027-03-07 20:00, Venue" from a star key (slice.starKey); reserved
// marks say so.
function starText(key) {
  var reserved = slice.isReservedKey(key);
  var p = String(reserved ? key.slice(2) : key).split('|');
  return (reserved ? 'reserved mark: ' : '') + p[0] + ', ' + p[1] + (p[2] ? ' ' + p[2] : '') + (p[3] ? ', ' + p[3] : '');
}

// About how many bytes an AppMessage carries (values plus a small header each).
function msgBytes(m) {
  return Object.keys(m).reduce(function(n, k) {
    var v = m[k];
    var len = typeof v === 'string' ? v.length + 1 : (v && typeof v.length === 'number' ? v.length : 4);
    return n + 7 + len;
  }, 0);
}

function watchInfo() {
  try {
    return Pebble.getActiveWatchInfo ? Pebble.getActiveWatchInfo() : null;
  } catch (e) {
    return null;
  }
}

function phoneText() {
  return logLib.phoneFromUa(typeof navigator !== 'undefined' && navigator.userAgent);
}

// Event handlers log what goes wrong in them before the error surfaces.
function guard(name, fn) {
  return function(e) {
    try {
      return fn(e);
    } catch (err) {
      usage.add('error', name + ': ' + ((err && err.message) || err));
      usage.flush();
      throw err;
    }
  };
}

// {bundle, settings, stars, isDemo}
function currentData() {
  var bundle = load(STORE_BUNDLE, null);
  if (bundle) {
    return {bundle: bundle, settings: load(STORE_SETTINGS, {}), stars: load(STORE_STARS, {}), isDemo: false};
  }
  if (!s_demo) {
    var saved = load(STORE_DEMO, {});
    var at = saved.variant === s_demoVariant && Date.now() - saved.at < DEMO_MAX_AGE_MS ? saved.at : Date.now();
    save(STORE_DEMO, {variant: s_demoVariant, at: at});
    s_demo = demo.make(new Date(at), s_demoVariant);
  }
  // Personal fields saved in settings show up in the demo too.
  var me = (load(STORE_SETTINGS, {}).me) || {};
  Object.keys(me).forEach(function(k) {
    if (me[k]) {
      s_demo.settings.me[k] = me[k];
    }
  });
  return {bundle: s_demo.bundle, settings: s_demo.settings, stars: s_demo.stars, isDemo: true};
}

function sailDateInt(iso) {
  var p = iso.split('-');
  return (+p[0]) * 10000 + (+p[1]) * 100 + (+p[2]);
}

// done(ok, {ms, bytes, retries}).
function sendQueue(messages, done) {
  var i = 0;
  var retried = false;
  var retries = 0;
  var started = Date.now();
  var bytes = messages.reduce(function(n, m) { return n + msgBytes(m); }, 0);
  function finish(ok) {
    done(ok, {ms: Date.now() - started, bytes: bytes, retries: retries});
  }
  function next() {
    if (i >= messages.length) {
      finish(true);
      return;
    }
    Pebble.sendAppMessage(messages[i], function() {
      i++;
      retried = false;
      next();
    }, function(e) {
      if (!retried) {
        retried = true;
        retries++;
        setTimeout(next, 500);
      } else {
        console.log('Send failed at message ' + i + ': ' + JSON.stringify(e));
        usage.add('error', 'send failed at message ' + (i + 1) + ' of ' + messages.length + ': ' +
                  JSON.stringify(e && e.data ? e.data : e).slice(0, 160));
        finish(false);
      }
    });
  }
  next();
}

function sendText(ok, info) {
  return (ok ? 'sent' : 'FAILED') + ' in ' + info.ms + ' ms, about ' + info.bytes + ' bytes' +
    (info.retries ? ', ' + info.retries + ' retries' : '');
}

function sendSlice() {
  if (s_sending) {
    s_resend = true;
    return;
  }
  var built = Date.now();
  var data = currentData();
  var testAt = load(STORE_TEST, 0);
  var sl = slice.buildSlice(data.bundle, data.settings, data.stars, new Date(),
                            Date.now() - testAt < 3600 * 1000 ? new Date(testAt) : null);
  built = Date.now() - built;
  s_sliceId = (s_sliceId + 1) & 0x7FFF;

  var messages = [{
    msg_type: MSG_BEGIN,
    slice_id: s_sliceId,
    sail_date: sailDateInt(sl.sailDate),
    day_index: sl.dayIndex,
    day_kind: sl.day.kind,
    day_status: sl.day.status,
    day_location: sl.day.location,
    all_aboard: sl.day.allAboard,
    local_offset: sl.day.localOffset,
    arrive: sl.day.arrive,
    depart: sl.day.depart,
    ship_name: pack.cutText(sl.shipName, 31),
    sail_port: pack.cutText(sl.sailPort, 31),
    cruise_starred: Math.min(sl.cruiseStarred, 255),
    tmr_kind: sl.tomorrow.kind,
    tmr_status: pack.cutText(sl.tomorrow.status, 15),
    tmr_location: pack.cutText(sl.tomorrow.location, 31),
    tmr_arrive: sl.tomorrow.arrive,
    tmr_depart: sl.tomorrow.depart,
    tmr_all_aboard: sl.tomorrow.allAboard,
    tmr_starred: Math.min(sl.tomorrow.starred, 255),
    tmr_featured: Math.min(sl.tomorrow.featured, 255),
    tmr_first: pack.cutText(sl.tomorrow.first, 39),
    tmr_first_start: sl.tomorrow.firstStart,
    tmr_last: pack.cutText(sl.tomorrow.last, 39),
    tmr_last_kind: sl.tomorrow.lastKind,
    tmr_to_reserve: Math.min(sl.tomorrow.toReserve, 255),
    event_count: sl.events.length,
    theme: sl.theme,
    show_featured: sl.showFeatured,
    button_hints: sl.buttonHints,
    is_demo: data.isDemo ? 1 : 0,
    reminder_lead: sl.reminderLead,
    alarm_count: sl.alarms.length
  }, {
    msg_type: MSG_INFO,
    slice_id: s_sliceId,
    info_stateroom: sl.info.stateroom,
    info_deck: sl.info.deck,
    info_stairs: sl.info.stairs,
    info_muster: sl.info.muster,
    info_clock: sl.info.clockNote,
    info_sync: sl.info.lastSync
  }];
  pack.packEvents(sl.events, CHUNK_BYTES).forEach(function(chunk) {
    messages.push({msg_type: MSG_EVENTS, slice_id: s_sliceId, event_first: chunk.first, events: chunk.bytes});
  });
  pack.packAlarms(sl.alarms, CHUNK_BYTES).forEach(function(chunk) {
    messages.push({msg_type: MSG_ALARMS, slice_id: s_sliceId, alarm_first: chunk.first, alarms: chunk.bytes});
  });
  messages.push({msg_type: MSG_END, slice_id: s_sliceId});
  // After the slice, so the watch already has the moved stars.
  var notices = data.isDemo ? [] : load(STORE_NOTICES, []);
  if (notices.length) {
    messages.push({msg_type: MSG_NOTICE, notice_count: notices.length, notices: pack.packNotices(notices)});
  }

  s_sending = true;
  var started = Date.now();
  sendQueue(messages, function(ok, info) {
    s_sending = false;
    usage.add('slice', (data.isDemo ? 'demo ' + s_demoVariant + ', ' : '') + 'day ' + sl.dayIndex + ', ' +
              sl.events.length + ' events, ' + sl.alarms.length + ' alerts, ' + messages.length + ' messages, built in ' +
              built + ' ms, ' + sendText(ok, info));
    if (ok && notices.length) {
      save(STORE_NOTICES, []);
      console.log('Sent ' + notices.length + ' schedule change notices');
      usage.add('notice', notices.length + ' schedule change notices sent to the watch');
    }
    console.log('Slice ' + s_sliceId + (ok ? ' sent: ' : ' failed: ') + sl.events.length + ' events, ' + sl.alarms.length + ' alerts, ' +
                messages.length + ' messages, ' + (Date.now() - started) + ' ms');
    sendNext();
  });
}

// After a send: a waiting star ack goes first, so the watch drops the changes
// it acks before a resent slice arrives (it re-applies unacked ones to slices).
function sendNext() {
  if (s_ack) {
    sendAck();
  } else if (s_dirRef !== null) {
    sendDirPage();
  } else if (s_route) {
    sendRoute();
  } else if (s_resend) {
    s_resend = false;
    sendSlice();
  }
}

function sendAck() {
  var ack = s_ack;
  s_ack = null;
  s_sending = true;
  sendQueue([{msg_type: MSG_STAR_ACK, star_ack: ack.seq}], function(ok) {
    s_sending = false;
    console.log('Star ack ' + ack.seq + (ok ? ' sent' : ' failed'));
    if (ack.resend) {
      s_resend = true;
    }
    sendNext();
  });
}

// A ship directory page (docs/WATCH_PROTOCOL.md, Ship directory). Only the
// latest request is answered; the watch shows one page at a time.
function sendDirPage() {
  var ref = s_dirRef;
  s_dirRef = null;
  var built = Date.now();
  var data = currentData();
  var page = directory.buildPage(ref, {bundle: data.bundle, settings: data.settings, stars: data.stars,
                                       now: new Date()});
  var msg = directory.message(page);
  built = Date.now() - built;
  msg.msg_type = MSG_DIR_PAGE;
  s_sending = true;
  sendQueue([msg], function(ok, info) {
    s_sending = false;
    // A place page shows its walking distance and where it's measured from.
    var gps = page.gps && page.gps.text ? ', gps "' + (page.gps.header || '') + ' ' + page.gps.text + '" (start: ' +
      directory.startReason({bundle: data.bundle, settings: data.settings, stars: data.stars, now: new Date()}) + ')' :
      page.gps && page.gps.flags ? ', gps flags ' + page.gps.flags : '';
    usage.add('dir', 'page ' + ref + ' "' + page.title + (page.label ? ' ' + page.label : '') + '": ' +
              page.rows.length + ' rows' + gps + ', built in ' + built + ' ms, ' + sendText(ok, info));
    console.log('Directory page ' + ref + (ok ? ' sent: ' : ' failed: ') + page.rows.length + ' rows, ' +
                msg.dir_rows.length + ' bytes');
    sendNext();
  });
}

// A Route screen (docs/WATCH_PROTOCOL.md, Route screen): to a place, to its
// closest restroom, or to Home's NEXT event. Only the latest request is answered.
function sendRoute() {
  var req = s_route;
  s_route = null;
  var built = Date.now();
  var data = currentData();
  var ctx = {bundle: data.bundle, settings: data.settings, stars: data.stars, now: new Date()};
  var page = req.venue !== undefined ? directory.eventRoutePage(req, ctx) : directory.routePage(req.ref, req.rest, ctx);
  var msg = directory.routeMsg(page);
  built = Date.now() - built;
  msg.msg_type = MSG_ROUTE_PAGE;
  s_sending = true;
  sendQueue([msg], function(ok, info) {
    s_sending = false;
    usage.add('route', (req.venue !== undefined ? 'to event at ' + req.venue + ' (start ' + req.start + ')' :
                        (req.rest ? 'restroom from place ' : 'to place ') + req.ref) +
              ': "' + page.title + '", ' + (page.header ? page.header + ', ' : '') +
              (page.steps.length ? page.steps.length + ' steps, ' + [page.big, page.small && page.small.text]
                .filter(function(t) { return t; }).join(' / ') : 'no route: ' + page.lead) +
              // A restroom route starts at the venue, whatever the start setting.
              (req.rest ? '' : ', start: ' + directory.startReason(ctx, req.venue !== undefined ? {start: req.start} : undefined)) +
              ', planned in ' + built + ' ms, ' + sendText(ok, info));
    console.log('Route ' + (req.venue !== undefined ? 'to event at ' + req.start : req.ref) +
                (req.rest ? ' (restroom)' : '') + (ok ? ' sent: ' : ' failed: ') +
                page.steps.length + ' steps, ' + msg.route.length + ' bytes');
    sendNext();
  });
}

// Star changes made on the watch, possibly long ago with the phone away. The
// watch keeps them until acked and sends them again after every slice.
function starChangesReceived(bytes) {
  var changes = pack.decodeStarChanges(bytes || []);
  if (!changes.length) {
    return;
  }
  var data = currentData();
  var times = data.isDemo ? null : load(STORE_STAR_TIMES, {});
  var r = slice.applyWatchStarChanges(data.bundle, data.settings, data.stars, times, changes);
  if (!data.isDemo) {
    save(STORE_STARS, data.stars);
    save(STORE_STAR_TIMES, times);
  }
  r.applied.forEach(function(c) {
    var what = c.reserved ? (c.on ? 'Marked reserved' : 'Marked not reserved') : (c.on ? 'Starred' : 'Unstarred');
    console.log(what + ' on the watch: ' + c.key);
    usage.add('star', what.toLowerCase() + ' on the watch: ' + starText(c.key));
  });
  r.ignored.forEach(function(c) {
    console.log('Older than a change on the phone, ignored: ' + c.key);
    usage.add('star', 'watch change older than the phone\'s, ignored: ' + starText(c.key));
  });
  r.unmatched.forEach(function(c) {
    console.log('No such event, ignored: ' + c.title);
    usage.add('star', 'watch change for no such event, ignored: ' + c.title);
  });
  var seq = changes.reduce(function(max, c) { return Math.max(max, c.seq); }, 0);
  // When the watch shows something the phone didn't take, send it a new slice.
  var resend = r.ignored.length + r.unmatched.length > 0;
  s_ack = s_ack ? {seq: Math.max(s_ack.seq, seq), resend: s_ack.resend || resend} : {seq: seq, resend: resend};
  if (!s_sending) {
    sendNext();
  }
}

// Usage log entries from the watch (docs/WATCH_PROTOCOL.md, Usage log), added
// at the watch's own time. Its cruise minutes count from the slice's sail date.
function watchLogReceived(bytes, dropped) {
  var sailIso = currentData().bundle.sailDate;
  var entries = pack.decodeLogEntries(bytes || []);
  console.log('Watch log: ' + entries.length + ' entries' + (dropped ? ', ' + dropped + ' lost' : ''));
  entries.forEach(function(e) {
    var r = logLib.watchEntry(e, sailIso);
    usage.add(r.kind, r.detail, e.at * 1000);
  });
  if (dropped > 0) {
    usage.add('error', 'watch log queue was full: ' + dropped + ' oldest entries lost');
  }
}

// ---- Settings page

function nowStamp() {
  return slice.formatSync(new Date().toISOString());
}

function pageState(ships) {
  var bundle = load(STORE_BUNDLE, null);
  var settings = load(STORE_SETTINGS, {});
  var cruise = null;
  if (bundle) {
    var events = (bundle.schedule && bundle.schedule.events) || [];
    cruise = {
      shipCode: bundle.ship && bundle.ship.code,
      shipName: (bundle.ship && bundle.ship.name) || 'Your ship',
      sailDate: bundle.sailDate,
      days: bundle.itinerary.length,
      nights: Math.max(0, bundle.itinerary.length - 1),
      published: events.length > 0,
      events: events.length,
      lastSync: slice.formatSync(bundle.generated)
    };
  }
  return {
    ships: ships,
    cruise: cruise,
    // For Settings > Days: Royal's itinerary and the per-day settings.
    itinerary: bundle ? bundle.itinerary.map(function(d) {
      return {date: d.date, type: d.type, port: d.port, arrive: d.arrive, depart: d.depart};
    }) : [],
    days: settings.days || {},
    // For Settings > Filters.
    categories: bundle ? slice.categorySummary(bundle) : [],
    hiddenCats: slice.hiddenCats(settings),
    showFeatured: settings.showFeatured !== false,
    // For Settings > Events.
    schedule: bundle && bundle.schedule && bundle.schedule.events && bundle.schedule.events.length ?
      bundle.schedule : null,
    // Last chance and only show tags by star key (slice.finalShows).
    finals: bundle ? slice.finalShows(bundle) : {},
    stars: bundle ? load(STORE_STARS, {}) : {},
    starChanges: bundle ? load(STORE_STAR_CHANGES, null) : null,
    // Starred events or alerts the watch had no room to save: {date, time}.
    watchFull: bundle ? savedCutoff(bundle) : null,
    watchStorage: watchStorage(),
    personal: settings.personal || [],
    // For Cruise > Ship venues: the built-in table and the owner's edits for
    // this ship (kept per ship code, so they survive re-downloads).
    venues: bundle && bundle.ship && bundle.ship.code ? {
      ship: bundle.ship.code,
      table: venues.builtIn(bundle.ship.code),
      overrides: (settings.venues || {})[bundle.ship.code] || {}
    } : null,
    status: load(STORE_STATUS, {}),
    me: settings.me || {},
    theme: settings.theme || 'light',
    reminderLead: settings.reminderLead || 15,
    reserveAlertAt: slice.reserveAlertAt(settings),
    units: settings.units || 'm',
    alwaysHints: settings.alwaysHints === true,
    // For Help > Port and starboard: only on a ship with a map (§9.7).
    shipSides: shipSidesState(bundle, settings),
    gpsShips: shipmap.shipNames(),
    api: royal.API,
    appKey: royal.APPKEY
  };
}

function shipSidesState(bundle, settings) {
  var code = bundle && bundle.ship && bundle.ship.code;
  if (!code || !shipmap.data(code)) {
    return null;
  }
  var s = (settings.shipSides || {})[code] || {};
  return {ship: code, name: bundle.ship.name || code, decks: shipmap.decks(code), all: s.all === true,
          flipDecks: s.decks || [], confirmed: s.confirmed === true};
}

// Help > Port and starboard as the page returned it: {ship, all, decks, confirmed}.
function cleanShipSides(r) {
  if (!r || typeof r.ship !== 'string' || !shipmap.data(r.ship)) {
    return null;
  }
  var known = shipmap.decks(r.ship);
  var decks = (Array.isArray(r.decks) ? r.decks : []).filter(function(d, i, a) {
    return known.indexOf(d) !== -1 && a.indexOf(d) === i;
  }).sort(function(a, b) { return a - b; });
  return {all: r.all === true, decks: decks, confirmed: r.confirmed === true};
}

function savedCutoff(bundle) {
  var saved = load(STORE_WATCH_SAVED, null);
  if (!saved || saved.sailDate !== bundle.sailDate) {
    return null;
  }
  return slice.cutoffWhen(bundle.sailDate, saved.cutoff, new Date());
}

function watchStorage() {
  var saved = load(STORE_WATCH_SAVED, null);
  return saved && saved.max > 0 ? {bytes: saved.bytes || 0, max: saved.max} : null;
}

// The Pebble app's WebView doesn't load a data: URL of about 2 MB or more
// (probe, 2026-09-26), so the page gets the newest log entries that keep it
// under this. A page that never returns a result (it may not have loaded)
// halves the limit for the next open, until one does.
var PAGE_URL_MAX = 1800 * 1024;
var STORE_PAGE = 'settingsPage';  // {pending, urlKB, shrink}

// Opens right away (the phone app expects openURL during showConfiguration).
// The page fetches the ship list itself when the cached one is missing or old,
// and hands it back for caching.
function openSettings() {
  console.log('Opening settings');
  var built = Date.now();
  var last = load(STORE_PAGE, {});
  var shrink = last.shrink || 0;
  if (last.pending && last.urlKB > 1024) {
    shrink = Math.min(shrink + 1, 4);
    usage.add('error', 'last settings page (' + last.urlKB + ' KB) returned nothing; this one is kept under ' +
              Math.round((PAGE_URL_MAX >> shrink) / 1024) + ' KB');
  }
  var cached = load(STORE_SHIPS, null);
  var state = pageState((cached && cached.list) || []);
  state.shipsStale = !cached || !cached.list || !cached.list.length || Date.now() - cached.at > SHIPS_MAX_AGE_MS;
  var bundle = load(STORE_BUNDLE, null);
  var hdr = logLib.header({bundle: bundle, watch: watchInfo(), phone: phoneText(), label: usage.label(),
                           count: usage.count(), dropped: usage.pageState('').dropped, now: new Date()});
  state.usage = usage.pageState(hdr);
  var url = config.pageUrl(state);
  var max = PAGE_URL_MAX >> shrink;
  if (url.length > max) {
    var rest = url.length - logLib.encodedLength(state.usage.text);
    state.usage = usage.pageState(hdr, Math.max(0, max - rest));
    url = config.pageUrl(state);
  }
  save(STORE_PAGE, {pending: true, urlKB: Math.round(url.length / 1024), shrink: shrink});
  usage.add('settings', 'page opened: ' + Math.round(url.length / 1024) + ' KB URL, built in ' +
            (Date.now() - built) + ' ms, log ' + state.usage.shown + ' of ' + state.usage.count + ' entries shown');
  usage.flush();
  Pebble.openURL(url);
}

// `how`: 'downloaded' or 'pasted'.
function useBundle(bundle, how) {
  // Stars of rescheduled events follow them; cancelled ones are dropped. The
  // user hears about both on the watch and the settings page.
  var old = load(STORE_BUNDLE, null);
  var sameSailing = old && old.sailDate === bundle.sailDate && old.ship && bundle.ship &&
    old.ship.code === bundle.ship.code;
  var settings = load(STORE_SETTINGS, {});
  var r = slice.reconcileStars(old, bundle, load(STORE_STARS, {}), settings, new Date(),
                               load(STORE_STAR_TIMES, {}));
  // Change times of events no longer listed (and not starred) are dropped.
  save(STORE_STAR_TIMES, slice.pruneStarTimes(r.times, bundle, settings, r.stars));
  if (r.changes.length) {
    save(STORE_STARS, r.stars);
    // Added to any the watch hasn't received yet.
    save(STORE_NOTICES, load(STORE_NOTICES, []).concat(slice.buildNotices(bundle.sailDate, r.changes)).slice(-8));
    r.changes.forEach(function(c) {
      var text = c.title + ' ' + c.date + ' ' + (c.time || '') +
        (c.to ? ' -> ' + c.to.date + ' ' + (c.to.time || '') + ' ' + c.to.venue : '');
      console.log('Star ' + c.kind + ': ' + text);
      usage.add('resync', 'starred event ' + c.kind + ': ' + text);
    });
  }
  if (sameSailing) {
    save(STORE_STAR_CHANGES, {at: nowStamp(), list: r.changes});
  } else {
    save(STORE_STAR_CHANGES, null);
    save(STORE_NOTICES, []);
  }
  var text = JSON.stringify(bundle);
  localStorage.setItem(STORE_BUNDLE, text);
  save(STORE_STATUS, {});
  s_demo = null;
  s_sailDate = bundle.sailDate;
  console.log('Cruise data saved: ' + bundle.ship.code + ' ' + bundle.sailDate + ', ' +
              bundle.itinerary.length + ' days, ' + bundle.schedule.events.length + ' events');
  // Counts only, no contents.
  usage.add('bundle', how + ': ship ' + bundle.ship.code + ', ' + (sameSailing ? 'same sailing' : 'new sailing') +
            ', ' + bundle.itinerary.length + ' days, ' + bundle.schedule.events.length + ' events, ' +
            Math.round(text.length / 1024) + ' KB, ' + r.changes.length + ' starred events moved or cancelled');
}

function settingsClosed(text) {
  var r;
  try {
    r = JSON.parse(decodeURIComponent(text));
  } catch (e) {
    try {
      r = JSON.parse(text);
    } catch (e2) {
      console.log('Settings: could not read the result');
      usage.add('error', 'settings page result unreadable (' + text.length + ' chars)');
      return;
    }
  }
  usage.add('settings', 'page closed: ' + (r.action || 'save') + ', result ' + Math.round(text.length / 1024) + ' KB');
  usage.applySettings(r.usage);

  if (Array.isArray(r.ships) && r.ships.length) {
    save(STORE_SHIPS, {at: Date.now(), list: r.ships});
  }

  var settings = load(STORE_SETTINGS, {});
  var before = JSON.parse(JSON.stringify(settings));
  settings.me = r.me || settings.me || {};
  settings.theme = r.theme === 'dark' ? 'dark' : 'light';
  settings.reminderLead = [5, 15, 30].indexOf(r.reminderLead) !== -1 ? r.reminderLead : 15;
  settings.reserveAlertAt = slice.reserveAlertAt(r);
  // Walking distances on the watch's place pages (docs/DESIGN_V1_1.md §9.7).
  if (gpstext.UNITS.indexOf(r.units) !== -1) {
    settings.units = r.units;
  }
  if (typeof r.showFeatured === 'boolean') {
    settings.showFeatured = r.showFeatured;
  }
  // Home's button hints at every open, not just the first few (§9.5).
  if (typeof r.alwaysHints === 'boolean') {
    settings.alwaysHints = r.alwaysHints;
  }
  // Port/starboard flip and "sides confirmed", kept per ship (§9.7).
  var sides = cleanShipSides(r.shipSides);
  if (sides) {
    settings.shipSides = settings.shipSides || {};
    settings.shipSides[r.shipSides.ship] = sides;
  }
  var personal = slice.cleanPersonal(r.personal);
  if (personal) {
    settings.personal = personal;
  }
  // Only stars changed on the page come back, so ones set on the watch meanwhile
  // stay; if the watch changed the same star after the page did, the watch wins.
  if (r.stars && load(STORE_BUNDLE, null)) {
    Object.keys(r.stars).forEach(function(key) {
      usage.add('star', (slice.isReservedKey(key) ? (r.stars[key] ? 'marked' : 'unmarked') :
                         (r.stars[key] ? 'starred' : 'unstarred')) + ' on the phone: ' + starText(key));
    });
    var times = load(STORE_STAR_TIMES, {});
    save(STORE_STARS, slice.applyStarChanges(load(STORE_STARS, {}), r.stars, times, r.starTimes, Date.now()));
    save(STORE_STAR_TIMES, times);
  }
  // Venue edits come back whole for the ship the page showed.
  var venueEdits = r.venues && typeof r.venues.ship === 'string' && venues.cleanOverrides(r.venues.overrides);
  if (venueEdits) {
    settings.venues = settings.venues || {};
    if (Object.keys(venueEdits).length) {
      settings.venues[r.venues.ship] = venueEdits;
    } else {
      delete settings.venues[r.venues.ship];
    }
    console.log('Venue edits for ' + r.venues.ship + ': ' + Object.keys(venueEdits).length + ' venues');
  }
  var hidden = slice.cleanHiddenCats(r.hiddenCats);
  if (hidden) {
    settings.hiddenCats = hidden;
  }
  // Per-day settings come back for every day the page showed; null clears one.
  if (r.days && typeof r.days === 'object') {
    settings.days = settings.days || {};
    Object.keys(r.days).forEach(function(date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return;
      }
      var day = slice.cleanDaySettings(r.days[date]);
      if (day) {
        settings.days[date] = day;
      } else {
        delete settings.days[date];
      }
    });
  }
  save(STORE_SETTINGS, settings);
  logLib.diffSettings(before, settings).forEach(function(d) { usage.add('setting', d); });

  if (r.action === 'test') {
    console.log('Test alerts requested');
    usage.add('alert', 'test alerts asked for');
    save(STORE_TEST, Date.now());
  }

  if (r.bundle) {
    var error = bundleLib.validate(r.bundle);
    if (error) {
      save(STORE_STATUS, {error: 'Pasted data: ' + error, at: nowStamp()});
      usage.add('error', 'pasted cruise data rejected: ' + error);
    } else {
      useBundle(r.bundle, 'pasted');
    }
  }
  sendSlice();

  if (r.download && r.download.ship && r.download.ship.code && r.download.sailDate) {
    console.log('Downloading ' + r.download.ship.code + ' ' + r.download.sailDate);
    usage.add('download', 'asked for ' + r.download.ship.code + ' ' + r.download.sailDate);
    var started = Date.now();
    royal.download(r.download.ship, r.download.sailDate, function(err, bundle) {
      if (err) {
        console.log('Download failed: ' + err);
        usage.add('download', 'FAILED after ' + (Date.now() - started) + ' ms: ' + err);
        save(STORE_STATUS, {error: err, at: nowStamp()});
        return;
      }
      usage.add('download', 'done in ' + (Date.now() - started) + ' ms');
      useBundle(bundle, 'downloaded');
      sendSlice();
    });
  }
}

Pebble.addEventListener('showConfiguration', guard('showConfiguration', openSettings));

Pebble.addEventListener('webviewclosed', guard('webviewclosed', function(e) {
  var page = load(STORE_PAGE, {});
  if (e && e.response) {
    save(STORE_PAGE, {pending: false, urlKB: page.urlKB, shrink: 0});
    settingsClosed(e.response);
  } else {
    // Closed with no result: backed out, or the page never loaded. Left pending,
    // so a big page that keeps failing gets smaller (openSettings).
    usage.add('settings', 'page closed without saving');
  }
}));

Pebble.addEventListener('ready', guard('ready', function() {
  console.log('Cruise Watch companion ready, phone time ' + new Date().toString());
  var w = watchInfo();
  usage.add('phone', 'companion started (watch app open, phone connected); watch ' +
            ((w && (w.model || w.platform)) || 'unknown') + (w && w.firmware ? ' firmware ' + w.firmware.major + '.' +
            w.firmware.minor + '.' + w.firmware.patch : '') + ', log ' + usage.count() + ' entries, ' +
            Math.round(usage.chars() / 1024) + ' KB');
  sendSlice();
}));

Pebble.addEventListener('appmessage', guard('appmessage', function(e) {
  var p = e.payload;
  switch (p.msg_type) {
    case MSG_REQUEST:
      usage.add('sync', 'watch asked for data');
      sendSlice();
      break;
    case MSG_STAR_CHANGES:
      starChangesReceived(p.star_changes);
      break;
    case MSG_LOG:
      watchLogReceived(p.log_entries, p.log_dropped | 0);
      break;
    case MSG_DIR_REQUEST:
      s_dirRef = p.dir_ref | 0;
      if (!s_sending) {
        sendNext();
      }
      break;
    case MSG_ROUTE_REQUEST:
      s_route = p.route_start !== undefined ? {start: p.route_start | 0, venue: String(p.route_venue || '')}
                                            : {ref: p.dir_ref | 0, rest: !!p.route_rest};
      if (!s_sending) {
        sendNext();
      }
      break;
    case MSG_SAVED:
      save(STORE_WATCH_SAVED, {sailDate: currentData().bundle.sailDate, cutoff: p.saved_cutoff,
                               bytes: p.saved_bytes, max: p.saved_max});
      if (p.saved_cutoff !== slice.NO_TIME) {
        console.log('Watch storage full from cruise minute ' + p.saved_cutoff);
      }
      console.log('Watch saved ' + p.saved_bytes + ' of ' + p.saved_max + ' bytes');
      // Reported after every slice; logged when it changes.
      var report = 'storage: schedule uses ' + p.saved_bytes + ' of ' + p.saved_max + ' bytes' +
        (p.saved_cutoff !== slice.NO_TIME ? ', FULL from cruise minute ' + p.saved_cutoff : '');
      if (report !== s_lastSaved) {
        s_lastSaved = report;
        usage.add('watch', report);
      }
      break;
    case MSG_DEMO_NEXT:
      if (!load(STORE_BUNDLE, null)) {
        usage.add('demo', 'next demo screen (variant ' + ((s_demoVariant + 1) % demo.VARIANTS) + ')');
        s_demoVariant = (s_demoVariant + 1) % demo.VARIANTS;
        save(STORE_DEMO, {variant: s_demoVariant, at: Date.now()});
        s_demo = null;
        sendSlice();
      }
      break;
  }
}));
