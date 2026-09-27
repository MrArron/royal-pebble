# Cruise data bundle — format v1

Produced by the phone companion's Download and by `tools/cruise-sync/cruise_sync.py`
(the reference implementation). The settings page's paste-in backup accepts the same
text. One compact JSON object, ASCII only.

```json
{
  "format": "cruise-watch",
  "v": 1,
  "generated": "2026-09-24T01:17:45Z",
  "ship": {"code": "HM", "name": "Harmony of the Seas"},
  "sailDate": "2026-10-03",
  "itinerary": [
    {"day": 1, "date": "2026-10-03", "port": "Orlando (Port Canaveral), Fl", "code": "PCN",
     "type": "EMBARK", "arrive": null, "depart": "16:00"},
    {"day": 2, "date": "2026-10-04", "port": "Cruising", "code": "CRU",
     "type": "CRUISING", "arrive": null, "depart": null},
    {"day": 3, "date": "2026-10-05", "port": "Nassau, Bahamas", "code": "NAS",
     "type": "DOCKED", "arrive": "07:30", "depart": "17:30"}
  ],
  "schedule": {
    "published": true,
    "cats": [["Entertainment", "Music & Dance"], ["Shop", "Retail"], ["Activities", "Sports & Recreation"]],
    "venues": ["Royal Promenade", "Sports Court", "Regalia Watches"],
    "venueCodes": ["PROM", "SPORTCRT", null],
    "notes": [["kbyg/general/seapass", "Bring your SeaPass card"],
              ["kbyg/general/WEATHER", "Weather permitting"]],
    "infos": [[[18, null], 15, [0]], [null, null, [1]]],
    "fields": ["title", "venue", "cat", "date", "time", "minutes", "featured", "reservation", "paid", "price",
               "info", "pid"],
    "events": [
      ["Big Band Music With the Harmony of the Seas Orchestra", 0, 0, "2026-10-03", "17:45", 45, 0, 0, 0, null,
       null, "HM-BIGBAND"],
      ["Sports Court Open Play", 1, 2, "2026-10-04", "09:00", 120, 0, 0, 0, null, 1, "HM-SPORTCRT"]
    ]
  },
  "mine": {
    "stateroom": "[ROOM #]", "deck": "9", "muster": "B4", "arrival": null,
    "embarkTimeZone": "America/New_York",
    "ports": [{"day": 3, "code": "NAS", "gangwayDown": "07:00", "gangwayUp": "17:00",
               "lat": 25.0781, "lon": -77.3412}],
    "orders": [
      {"title": "Beach Day at Perfect Day CocoCay", "category": "pt_shoreX", "guests": 2,
       "date": "2026-10-09", "time": "09:00", "day": 7, "port": "PCC",
       "meet": "08:45", "end": "11:30", "minutes": 150},
      {"title": "Deluxe Beverage Package", "category": "pt_beverage", "guests": 2}
    ]
  }
}
```

## Fields

- `format`, `v` — reject anything that isn't `cruise-watch` / a known version.
- `generated` — UTC time of the fetch; show as "last sync".
- `ship.code` — Royal's two-letter code; `sailDate` — `YYYY-MM-DD`.
- `itinerary[]` — one per day, in order.
  - `type`: `EMBARK`, `DOCKED`, `CRUISING`, `DEBARK` (others, e.g. tender, may exist;
    treat unknown types as port days).
  - `arrive` / `depart`: `HH:MM` 24h as Royal lists them (apparently port-local), or
    `null` where Royal only has placeholders.
- `schedule`
  - `published`: `false` until Royal releases the schedule (then `events` is empty).
  - `cats`: `[category, subcategory]`; `venues`: names. Events refer to both by index.
  - `events[]`: arrays in `fields` order. `time` is `null` for untimed entries
    (Royal's 00:00). `minutes` may be 0. `featured` and `reservation` are 0/1.
    `paid` (0/1) marks a paid class or experience; `price` is its adult "from"
    price in dollars, or `null`. Both were added later without a version bump:
    bundles without them are still valid, and every event then counts as free.
    Sorted by date, time, title; duplicates removed.
  - Which of Royal's products become events: the free activities
    (`NON_REVENUE_SCHEDULABLE`, never marked reservation-required), the shows you
    reserve (`ENTERTAINMENT`: free, featured, reservation required), the paid
    classes and experiences (`ACTIVITIES`: escape room, FlowRider lessons,
    tastings) and the shore excursions (`SHOREX`, below). Spa and dining are left
    out: they are booking slots, not events. So are NextCruise sales appointments
    (by title), about 22 slots a day that would push busy days past the watch's
    160 events.
  - Paid (`ACTIVITIES`) events come as many sessions each (27 of the escape
    room on one sailing). Consumers show them only once the user picks a
    session (the settings page's Booked activities and excursions, which stars
    it and marks it reserved); the other sessions stay off the watch and out of
    the lists. Checked on a live Harmony sailing, 2026-09-25.
  - **Shore excursions** (`SHOREX`, added in Phase 4 without a version bump):
    one event per session, `paid` 1, category `["Shore excursions", ""]`,
    `venue` the excursion's own location from Royal (often empty). They follow
    the paid rule above: nothing shows until the user picks a session. `time`
    is the start; the meeting time is in `info` (`early`, below). All-day
    rentals (beach beds, cabanas, day passes, listed with 0 minutes) keep
    Royal's listed time and `minutes` 0. Older bundles have none, and their
    consumers simply see no excursions.
  - **Event details** (Phase 4, added without a version bump; a bundle without
    them is valid and every event then has no venue code, age, arrive-early
    time or notes). Each comes from the products listing both producers already
    download (`docs/PHASE4_PLAN.md` items 1-7):
    - `venueCodes`: beside `venues`, Royal's `locationCode` for each venue, or
      `null`. Venues are indexed by name and code together, so a blank title
      with a code (the wine tasting: `""`, `VINT`) is its own entry.
    - `notes`: shared table of `[id, text]`. `id` is Royal's advisement or
      restriction id (`kbyg/general/seapass`), `short` for a product's short
      description when it says more than the title, and `waiver` for Royal's
      `isWaiverRequired`. `text` is simplified like other text. Left out:
      "Images are illustrative only", "This activity has a fee" and "Fee
      applies" (already `paid`), age limits (they go in `age`) and any text over
      120 characters. A row appears once, however many events use it.
    - `infos`: shared table of `[age, early, notes]`, one row per distinct
      combination. `age` is `[min, max]` in years (either may be `null`: `[18,
      null]` is 18 and over, `[null, 17]` is 17 and under) or `null`. It comes
      from Royal's age restrictions, then its age experiences (`ages/age18`),
      then the over-21 alcohol advisement, then title and venue patterns
      (`(18+)`, `(Ages 13-17)`, `(17 & Under)`, Adventure Ocean); if several
      apply, the tightest wins. `early` is minutes to arrive before `time`, or
      `null`: Royal's `leadTimeInMinutes` when above 0, else a number in an
      advisement ("Arrive 15 minutes early"), at most 120; for a shore
      excursion, the start minus Royal's `meetingTime`, at most 240. `notes`
      holds indexes into `notes`, in Royal's order (may be empty).
    - Event field `info`: index into `infos`, or `null` when the event has none
      of these.
    - Event field `pid`: Royal's `productID`, the same for every session of an
      activity (session ids embed the start time, so they change when a session
      moves), or `null`. Used only to follow a starred event through a
      reschedule (Rules for consumers).
    - Consumers read events by field name, so older consumers ignore `info` and
      `pid`, and new consumers treat missing fields as `null`.
- `mine` — only when fetched with login, so only `cruise_sync.py --login`
  produces it (the phone companion never logs in). Private: it holds the
  stateroom and cabin details. Every field may be missing or `null`; consumers
  must not require any of them. What each field is based on, and what is still
  unverified, is in `docs/ROYAL_LOGIN_DATA.md`. A new bundle for the same ship
  and sail date without `mine` (a phone download) keeps the saved bundle's
  `mine`; one with its own `mine` replaces it.
  - `stateroom` is `null` until a cabin is assigned (Royal lists guarantee
    bookings as "GTY"); consumers also treat a value without digits as unassigned.
  - `deck`, `muster`: the booking's deck number and muster station as Royal
    lists them, or `null`.
  - `arrival`: terminal arrival appointment on embark day (`HH:MM`, or Royal's
    text when it isn't a readable time), `null` until online check-in.
  - `embarkTimeZone`: the embarkation port's time zone name, e.g.
    `America/New_York`.
  - `ports[]`: port days with extra details, by itinerary `day`. `gangwayDown`,
    `gangwayUp`: `HH:MM`, or Royal's text when it isn't a readable time
    (port-local like the itinerary). A readable `gangwayUp` is the day's
    all-aboard by default (`docs/DESIGN_PHASE3.md` §23.1); its meaning is
    still to be checked on board. `lat`,
    `lon`: approximate port coordinates (a point of interest near the port).
    Each field is present only when Royal lists it; days without any are left out.
  - `orders[]`: purchased add-ons, not cancelled, sorted by `date` and `time`
    (untimed last). `category` is Royal's product type id (`pt_shoreX`,
    `pt_beverage`, `pt_arcades`, ...). `guests` counts everyone on the order,
    which can include guests from other staterooms. Timed bookings (shore
    excursions; probably dining and shows) add `date` (`YYYY-MM-DD`), `time`
    (`HH:MM`, ship/port-local like the schedule), `day` (cruise day, 1 = embark),
    `port` (port code) and, when the product page lists them, `meet` and `end`
    (`HH:MM`, same date) and `minutes`. Packages and credits have none of these.
  - `voyageError`, `ordersError`: a message when that part couldn't be fetched.
  - Changes to `mine` are additive and don't bump `v`. Before September 2026,
    `orders` entries could hold a `when` object instead of `date`/`time`; ignore it.

## Rules for consumers

- Treat the bundle as replaceable input: re-importing a newer bundle replaces
  itinerary and schedule but must **keep user data** (stars, personal entries,
  per-day buffers/offsets/all-aboard times and itinerary edits, filters, my-info
  fields). Match stars to events by `title + date + time + venue`, since there is
  no stable event id in v1. So a re-import of the same sailing checks every
  upcoming star (not finished, not a personal entry) whose event was in the old
  schedule:
  - key still in the new schedule: nothing to do;
  - exactly one event that is new in this schedule, with the same title
    (ignoring case and outer spaces) on the same watch day: rescheduled, the star
    moves to it, so its reminder follows. When both schedules have `pid` (Phase
    4, only once product ids are shown to stay the same between pulls), match on
    the old event's `pid` instead of the title, so a reworded title still
    follows its star and two products with the same title aren't confused;
  - several such events (a show that runs twice): don't guess; drop the star and
    tell the user to check the times;
  - none: cancelled; drop the star.

  A **Reserved** mark (`docs/DESIGN_V1_1.md` §5) is user data kept with the
  stars, under the same key with `R|` in front; it moves or is dropped with its
  star.

  Tell the user about every moved or dropped star. Skip the check for a
  different sailing (ship or sail date) and when the new schedule is empty (not
  published, or a failed fetch), so stars are never dropped for that. Per-day settings are keyed by date; an itinerary edit
  stores only the fields (`type`, `port`, `arrive`, `depart`) that differ from
  Royal's, so a field the user didn't touch follows a newer download.
- Event times before 04:00 belong to the night of their `date`: Royal lists
  after-midnight events under the evening's date (a 01:00 curfew is dated the
  embark day). The same goes for an itinerary `depart` before 04:00 or before
  `arrive`.
- Text has been simplified to ASCII (straight quotes, no ® ™ ℠).
- Bump `v` for any breaking change and update both producers.

## Shared plan (Share my plan) — v1

Not part of the bundle: the text the settings page's **Share plan** copies
(`docs/DESIGN_PHASE3.md` §28) and **Import plan** reads on another phone. Only
the phone companion produces it (`src/pkjs/share.js`); the sync tool doesn't.
It holds the user's own choices, so treat it like a bundle: no shared plans
in the repo, and made-up cabin numbers in tests.

The message has three lines:

```
Royal Pebble plan · Harmony · sails 3 Oct 2026 · 14 stars
To import it, open Royal Pebble's settings, tap Import plan under Share my plan and paste this whole message.
RPPLAN1:<base64>:END
```

The first two are for people and ignored on import. `RPPLAN` is followed by the
format version (`1`), a colon, the plan as UTF-8 JSON in standard base64, and
`:END`. Import finds `RPPLAN` anywhere in the pasted text and drops whitespace
inside the code, since chat apps may wrap long lines. A missing `:END` means
the paste was cut short. A version above the reader's asks the user to update.

```json
{
  "v": 1,
  "ship": "HM",
  "sail": "2026-10-03",
  "stars": ["Hairspray|2026-10-05|19:00|Royal Theater", "R|Hairspray|2026-10-05|19:00|Royal Theater"],
  "personal": [{"title": "Dinner", "venue": "Chops Grille", "date": "2026-10-04", "time": "19:30", "minutes": 90}],
  "days": {"2026-10-07": {"allAboard": "16:00", "warn": 60}, "2026-10-08": {"edit": {"type": "CRUISING"}}},
  "venues": {"Chops Grille": {"decks": [8], "position": "aft"}},
  "cabin": {"stateroom": "1234", "deck": "Deck 12", "stairs": "Forward stairs", "muster": "A1"}
}
```

| Field | Content |
|---|---|
| `v` | Plan format version, `1`. |
| `ship`, `sail` | Ship code and sail date. Import only works onto the same sailing. |
| `stars` | Sorted star keys (`title\|date\|time\|venue`, as in the bundle rules above). A Reserved mark (`R\|` + key) is included only while its event is starred. |
| `personal` | Personal entries, as the phone stores them. Left out when empty. |
| `days` | Per-day settings by date, only the fields set: `allAboard`, `shift`, `buffer`, `warn`, `offset`, `edit` (the same values as the phone's day settings). Left out when empty. |
| `venues` | The sender's venue fixes for this ship, as the phone stores them. Left out when empty. |
| `cabin` | Only when "Include cabin details" is ticked, and only the fields that are set. |

On import the receiver's page compares the plan with its own state
(`share.js` `diff`): stars differ both ways; personal entries, day-setting
fields, venue fixes and cabin fields are listed only where the sender has a
value that differs. **Accept all** takes the sender's side of every
difference except stars only the receiver has. It never unstars or removes
anything. The phone cleans every imported value the same way as any other
settings page result (`cleanPersonal`, `cleanDaySettings`, `cleanOverrides`).
There is no split into parts: even a very full plan stays far below the
384 KB the usage log's parts use.
