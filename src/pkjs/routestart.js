// Where directions and routes start (docs/DESIGN_V1_1.md §9.4, one rule for the
// "From" lines on event details and reminders and for the Ship GPS).
//
// - The cabin, by default.
// - A starred event or personal entry: when it ends less than FROM_GAP minutes
//   before the target starts, or overlaps it. For a route asked for now (a place
//   page), that means one on now or ended less than FROM_GAP minutes ago. An
//   event with no length ends FINISHED_GRACE minutes after it starts.
// - A spoken location ("I'm at the Solarium", voice, later): for SPOKEN_FOR
//   minutes, until a starred event or entry starts after it, and never past the
//   04:00 day change.
// Chosen by the owner on 2026-09-26: a stop hours earlier doesn't count (a 9:00p
// show doesn't start the route to an 11:00p event).
//
// Times are cruise minutes (docs/WATCH_PROTOCOL.md, "Time model").
'use strict';

var FROM_GAP = 15;
var FINISHED_GRACE = 30;
var SPOKEN_FOR = 90;
var DAY_START = 4 * 60;
var MINUTES_PER_DAY = 24 * 60;

function watchDay(min) {
  return Math.floor((min - DAY_START) / MINUTES_PER_DAY);
}

function ends(p) {
  return p.start + (p.minutes || FINISHED_GRACE);
}

// The stop just before `e` among `stops` ({start, minutes, venue}, sorted by
// start): the latest to start before it that ends less than FROM_GAP minutes
// before it starts. Null when there is none.
function previousStop(stops, e) {
  var prev = null;
  stops.forEach(function(p) {
    if (p.start < e.start && ends(p) > e.start - FROM_GAP) {
      prev = p;
    }
  });
  return prev;
}

// The stop you're at now: one that has started and ends less than FROM_GAP
// minutes ago (or later). The latest to start wins.
function currentStop(stops, now) {
  var cur = null;
  stops.forEach(function(p) {
    if (p.start <= now && ends(p) > now - FROM_GAP) {
      cur = p;
    }
  });
  return cur;
}

// Is a spoken location still the start at `now`? spoken: {at, ...}.
function spokenValid(spoken, stops, now) {
  if (!spoken || spoken.at > now || now - spoken.at >= SPOKEN_FOR || watchDay(spoken.at) !== watchDay(now)) {
    return false;
  }
  return !stops.some(function(p) { return p.start > spoken.at && p.start <= now; });
}

// Where a route starts. opts:
//   stops   timed starred events and personal entries, sorted by start
//   now     cruise minutes
//   target  optional event {start}: the route to it (Home's NEXT, reminders);
//           without it, the route starts from where you are now (place pages)
//   spoken  optional {at, venue} or {at, cabin}
//   cabin   optional stateroom number
// Returns {kind: 'spoken' | 'stop' | 'cabin' | 'none', venue?, cabin?, stop?}.
function start(opts) {
  var stops = opts.stops || [];
  var now = opts.now;
  var stop = opts.target ? previousStop(stops, opts.target) : currentStop(stops, now);
  var spoken = spokenValid(opts.spoken, stops, now) ? opts.spoken : null;
  // A stop that starts after you said where you were wins (you'll be there).
  if (spoken && !(stop && stop.start > spoken.at)) {
    return spoken.cabin ? {kind: 'spoken', cabin: String(spoken.cabin)} : {kind: 'spoken', venue: spoken.venue};
  }
  if (stop && stop.venue) {
    return {kind: 'stop', venue: stop.venue, stop: stop};
  }
  if (opts.cabin) {
    return {kind: 'cabin', cabin: String(opts.cabin)};
  }
  return {kind: 'none'};
}

module.exports = {
  FROM_GAP: FROM_GAP,
  FINISHED_GRACE: FINISHED_GRACE,
  SPOKEN_FOR: SPOKEN_FOR,
  previousStop: previousStop,
  currentStop: currentStop,
  spokenValid: spokenValid,
  start: start
};
