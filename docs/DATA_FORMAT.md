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
    "fields": ["title", "venue", "cat", "date", "time", "minutes", "featured", "reservation", "paid", "price"],
    "events": [
      ["Big Band Music With the Harmony of the Seas Orchestra", 0, 0, "2026-10-03", "17:45", 45, 0, 0]
    ]
  },
  "mine": {"stateroom": "[ROOM #]", "orders": [{"title": "...", "category": "...", "guests": 2}]}
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
    reserve (`ENTERTAINMENT`: free, featured, reservation required) and the paid
    classes and experiences (`ACTIVITIES`: escape room, FlowRider lessons,
    tastings). Spa, dining and shore excursions are left out: they are booking
    slots, not events. So are NextCruise sales appointments (by title), about 22
    slots a day that would push busy days past the watch's 160 events.
  - Paid (`ACTIVITIES`) events come as many sessions each (27 of the escape
    room on one sailing). Consumers show them only once the user picks a
    session (the settings page's Booked activities, which stars it and marks
    it reserved); the other sessions stay off the watch and out of the lists. Checked on a live Harmony sailing, 2026-09-25.
- `mine` — only when fetched with login. Contains a stateroom number: private.
  `stateroom` is `null` until a cabin is assigned (Royal lists guarantee
  bookings as "GTY"); consumers also treat a value without digits as unassigned.
  `orders` is **experimental**; any date/time fields Royal returned are kept under
  `when` until we know which ones are real.

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
    moves to it, so its reminder follows;
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
