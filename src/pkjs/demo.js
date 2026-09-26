// Demo cruise used until real cruise data is saved in settings. It is a normal
// bundle (docs/DATA_FORMAT.md) built around the current time, so it goes through
// the same slice and messaging code as real data.
//
// Variants (hold Up on the watch's Home): 0 port/light, 1 sea/light,
// 2 port/dark "alert test", 3 sea/dark. The alert test puts a starred event
// 17 minutes out and all-aboard 18 minutes out, so with the default 15-minute
// lead a reminder buzzes about 2 minutes after switching and the 15-minute
// all-aboard warning a minute later (close the app to see them launch it). A
// starred show just before the event gives the reminder "From" directions.

var slice = require('./slice');

var CATS = [
  ['Entertainment', 'Shows'],
  ['Activities', 'Games & Trivia'],
  ['Shop', 'Retail'],
  ['Activities', 'Fitness'],
  ['Entertainment', 'Music & Dance']
];

// [title, venue, cat, offset from the base time (null = untimed), minutes, featured, reservation, starred,
//  reserved]
var PORT_EVENTS = [
  ['Scavenger Hunt Sheets', 'Guest Services', 1, null, 0, 0, 0, 0],
  ['Sunrise Stretch', 'Solarium', 3, -150, 30, 0, 0, 0],
  ['Bingo', 'Studio B', 1, -45, 60, 0, 0, 0],
  ['Adventure Ocean Open House', 'Deck 14', 1, -30, 60, 0, 0, 0],
  ['Trivia: Movie Quotes', 'Music Hall', 1, 30, 45, 0, 0, 0],
  ['Salsa Lesson', 'Boleros', 4, 30, 30, 0, 0, 0],
  ['Watch Sale', 'Regalia Watches', 2, 60, 120, 0, 0, 0],
  ['Welcome Back Aboard Party', 'Pool Deck', 4, 90, 60, 1, 0, 0],
  ['HiRO', 'AquaTheater', 0, 180, 45, 1, 1, 1],
  ['Shuffleboard Tournament', 'Sports Court', 1, 180, 45, 0, 0, 0],
  ['Big Band Music With the Harmony of the Seas Orchestra', 'Royal Promenade', 4, 240, 45, 0, 0, 0],
  ['Adult Comedy', 'Comedy Live', 0, 300, 60, 0, 1, 0]
];

var SEA_EVENTS = [
  ['Scavenger Hunt Sheets', 'Guest Services', 1, null, 0, 0, 0, 0],
  ['Morning Walk-a-thon', 'Running Track', 3, -120, 45, 0, 0, 0],
  ['Art Auction Preview', 'Art Gallery', 1, -30, 90, 0, 0, 0],
  ['Pool Games', 'Pool Deck', 1, -15, 45, 0, 0, 0],
  ['Sail Away Karaoke Party', 'On Air', 4, 20, 45, 0, 0, 0],
  // Starred shows needing a reservation: one not marked reserved yet (Home's
  // NEXT card), one reserved (a Home item).
  ['Ice Show: 1887', 'Studio B', 0, 60, 60, 1, 1, 1],
  ['Towel Folding Demo', 'Royal Promenade', 1, 60, 30, 0, 0, 0],
  ['Jewelry Blowout', 'Royal Promenade', 2, 90, 120, 0, 0, 0],
  ['Name That Tune', 'Music Hall', 1, 120, 45, 0, 0, 0],
  ['Mamma Mia!', 'Royal Theater', 0, 240, 120, 1, 1, 1, 1],
  ['Silent Disco', 'Boardwalk', 4, 330, 90, 0, 0, 0]
];

// Tomorrow's events, as above but with a clock time instead of an offset.
var TOMORROW_EVENTS = [
  ['Sunrise Pilates', 'Solarium', 3, '08:30', 45, 0, 0, 1],
  ['Mamma Mia!', 'Royal Theater', 0, '20:00', 120, 1, 1, 0]
];

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

function hhmm(min) {
  return pad2(Math.floor(min / 60)) + ':' + pad2(min % 60);
}

// Returns {bundle, settings, stars} for the demo at `now`.
function make(now, variant) {
  var port = variant % 2 === 0;
  // The demo's "today" is the watch day containing now (days start at 04:00).
  var nowDays = slice.daysFromCivil(now.getFullYear(), now.getMonth() + 1, now.getDate());
  var nowMin = now.getHours() * 60 + now.getMinutes();
  if (nowMin < slice.DAY_START) {
    nowDays -= 1;
    nowMin += 24 * 60;
  }
  var sailDays = nowDays - 1;
  var today = slice.isoFromDays(nowDays);

  // All-aboard 2:13 from now. Late in the evening the departure falls after
  // midnight; like Royal's data it is then listed as an early clock time on
  // the port day, which the slice reads as after midnight. Past the end of the
  // watch day (04:00) there is no departure, so no countdown.
  var alertTest = variant === 2;
  var departMin = nowMin + (alertTest ? 18 : 133) + 30;
  var depart = departMin < 24 * 60 + slice.DAY_START ? hhmm(departMin % (24 * 60)) : null;

  var itinerary = [
    {day: 1, date: slice.isoFromDays(sailDays), port: 'Orlando (Port Canaveral), Fl', code: 'PCN',
     type: 'EMBARK', arrive: null, depart: '16:00'},
    port
      // Arrival at the start of the watch day, before any demo departure.
      ? {day: 2, date: today, port: 'St. Thomas, U.S. Virgin Islands', code: 'STT', type: 'DOCKED',
         arrive: '04:00', depart: depart}
      : {day: 2, date: today, port: 'Cruising', code: 'CRU', type: 'CRUISING', arrive: null, depart: null},
    {day: 3, date: slice.isoFromDays(sailDays + 2), port: 'Nassau, Bahamas', code: 'NAS',
     type: 'DOCKED', arrive: '07:30', depart: '17:30'},
    {day: 4, date: slice.isoFromDays(sailDays + 3), port: 'Orlando (Port Canaveral), Fl', code: 'PCN',
     type: 'DEBARK', arrive: '06:00', depart: null}
  ];

  // Round down to the quarter hour; keep past events after 04:00.
  var base = Math.max(nowMin - nowMin % 15, slice.DAY_START + 180);
  var venues = [];
  var stars = {};
  var events = (port ? PORT_EVENTS : SEA_EVENTS).map(function(e) {
    var date = today;
    var time = null;
    if (e[3] !== null) {
      // Like Royal, after-midnight times stay under today's (the evening's) date.
      time = hhmm((base + e[3]) % (24 * 60));
    }
    if (venues.indexOf(e[1]) === -1) {
      venues.push(e[1]);
    }
    if (e[7]) {
      stars[slice.starKey(e[0], date, time, e[1])] = true;
    }
    if (e[8]) {
      stars[slice.reservedKey(slice.starKey(e[0], date, time, e[1]))] = true;
    }
    return [e[0], venues.indexOf(e[1]), e[2], date, time, e[4], e[5], e[6]];
  });
  // Tomorrow, for the evening's tomorrow card: a starred class, and a featured
  // show that is the sea day's show again (a last chance) or, on port
  // variants, its only showing.
  var tomorrow = slice.isoFromDays(nowDays + 1);
  TOMORROW_EVENTS.forEach(function(e) {
    if (venues.indexOf(e[1]) === -1) {
      venues.push(e[1]);
    }
    if (e[7]) {
      stars[slice.starKey(e[0], tomorrow, e[3], e[1])] = true;
    }
    events.push([e[0], venues.indexOf(e[1]), e[2], tomorrow, e[3], e[4], e[5], e[6]]);
  });
  if (alertTest) {
    // A starred show ending 7 minutes before the class, so the reminder shows
    // "From" directions (from Royal Theater).
    var showTime = hhmm((nowMin + 24 * 60 - 15) % (24 * 60));
    venues.push('Royal Theater');
    events.push(['Magic Matinee', venues.length - 1, 0, today, showTime, 25, 0, 0]);
    stars[slice.starKey('Magic Matinee', today, showTime, 'Royal Theater')] = true;
    var testTime = hhmm((nowMin + 17) % (24 * 60));
    venues.push('Pool Deck');
    events.push(['Towel Animal Class', venues.length - 1, 1, today, testTime, 30, 0, 0]);
    stars[slice.starKey('Towel Animal Class', today, testTime, 'Pool Deck')] = true;
  }

  var bundle = {
    format: 'cruise-watch',
    v: 1,
    generated: new Date(now.getTime() - 3 * 3600 * 1000).toISOString(),
    ship: {code: 'HM', name: 'Harmony of the Seas'},
    sailDate: slice.isoFromDays(sailDays),
    itinerary: itinerary,
    schedule: {
      published: true,
      cats: CATS,
      venues: venues,
      fields: ['title', 'venue', 'cat', 'date', 'time', 'minutes', 'featured', 'reservation'],
      events: events
    }
  };

  var dinner = base + (port ? 150 : 180);
  var settings = {
    theme: variant >= 2 ? 'dark' : 'light',
    showFeatured: true,
    days: {},
    personal: [{
      title: 'Dinner', venue: 'Main Dining', minutes: 90,
      date: today, time: hhmm(dinner % (24 * 60))
    }],
    me: {stateroom: '9254', deck: 'Deck 9', stairs: 'Fwd stairs', muster: 'B4 - Royal Promenade',
         clockNote: 'Demo data - open settings'}
  };

  return {bundle: bundle, settings: settings, stars: stars};
}

module.exports = {make: make, VARIANTS: 4};
