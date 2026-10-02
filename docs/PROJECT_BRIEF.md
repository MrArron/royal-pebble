# Royal Pebble — Project brief

A Pebble Time 2 watch app for Royal Caribbean cruises. Its job is **quick
glances at what's next** without pulling out a phone, and making sure the
wearer never misses all-aboard. All data is loaded before sailing; **at sea the
app works with no internet at all**.

This brief is the "what and why": purpose, constraints, what is built (1.6.1),
the decisions still in force and what's left for later. How things look is in
`DESIGN.md`; the work still to do before the sailing is in `PLAN.md`. When
something here conflicts with a request in a session, ask before changing
direction.

## Status and audience

- Private, single-user app, sideloaded to the owner's Android phone and Pebble
  Time 2 (the owner and a travel companion use it; each phone keeps its own data). No
  app store release planned: skip store listings, first-run tutorials and other
  watches, but keep the code generic (any ship and sail date, nothing
  hardcoded).
- Royal Caribbean only. Celebrity uses similar endpoints but is untested.
- First real use: the owner's upcoming sailing on Harmony of the Seas (ship
  code HM). It is also the app's test cruise: the usage log and map notes
  collected on board drive the next round of fixes.
- Version `1.X.Y`: X is the v1.1 phase in progress, Y counts PRs in it
  (`CLAUDE.md`). Current: **1.6.1**, Round 2 phase (`PLAN.md` §3a).

## Constraints

- **Offline at sea.** Nothing the app needs on board may use the internet: not
  the watch, not the phone script, not the settings page (built locally as a
  `data:` URL, never loaded from a website). Bluetooth between watch and phone
  works at sea, so stars and refreshes still flow.
- **The watch can be without the phone.** It stores the day's schedule,
  alerts and stars and works alone; place pages, routes and voice need the
  phone nearby.
- **Watch size.** Code + data + static buffers must stay under 65,535 bytes:
  the SDK stores the size in a 16-bit field (`PebbleProcessInfo.virtual_size`),
  and the firmware's copy is 16-bit too, so it's a hard cap. The rest of the
  128 KB is heap. Budget 62 KB (`python3 tools/watch_size.py`); status in
  `PLAN.md`.
- **Pebble Time 2 only** (SDK platform `emery`, 200×228, 64 colors). Watch C
  must avoid `strtol()` and `strlen()` (both faulted on the real watch).
- **Be gentle with Royal's servers.** Unofficial endpoints: a sync or two, no
  polling.

## Architecture

- **Watch app** (C, Pebble SDK, `src/c/`). A watch *app*, opened with a Quick
  Launch button hold; not a watch face. App glances were dropped (they only
  update when the app closes).
- **Phone companion** (PebbleKit JS inside the Pebble phone app, `src/pkjs/`).
  Downloads the data, keeps the **full bundle** in phone storage as the source
  of truth, and sends the watch only today's slice over AppMessage
  (`WATCH_PROTOCOL.md`). It holds all ship knowledge: the venue table, the ship
  map and route planner, the voice matcher and every string the watch shows.
- **Settings page** (HTML built by the companion, shown by the Pebble app),
  offline. It returns its result through `pebblejs://close#`.
- **Windows sync tool** (`tools/cruise-sync/`, Python): the reference
  implementation of every Royal request and the backup data path. Its output
  is pasted into the settings page.
- **Build tools** (PC only): `tools/shipmap/` (ship map data), `tools/voice/`
  (voice lexicon), `tools/mockups/` (design mockups), `tools/watch_size.py`.

## Data sources

Unofficial, undocumented Royal Caribbean web endpoints (learned from
jdeath/CheckRoyalCaribbeanPrice, MIT). Bundle format: `DATA_FORMAT.md`.

| Data | Endpoint (host `aws-prd.api.rccl.com`, header `AppKey`) | Notes |
|---|---|---|
| Ships | `/en/royal/web/v2/ships` | name ↔ code |
| Sailings | `/en/royal/web/v3/ships/{code}/voyages` | sail dates |
| Itinerary | `/en/royal/web/v3/ships/{code}/sailDate/{YYYYMMDD}` | port, type, arrive/depart |
| Schedule | `/en/royal/web/v3/products?sailingID={code}{YYYYMMDD}&limit=200&offset=N` | keep `NON_REVENUE_SCHEDULABLE`, `ENTERTAINMENT`, `ACTIVITIES`, `SHOREX`; drop `SPA`, `DINING` |
| Booking (login) | `ROYAL_LOGIN_DATA.md` | stateroom, deck, muster, orders, gangway times |

Known facts:

- The activity schedule is published about **two weeks before sailing**. Sync
  is two-stage: itinerary any time, schedule later; the settings page says
  "not published yet" instead of showing an empty list.
- A week's schedule is about 400-520 events (a 7-night bundle about 135 KB
  with Phase 4 data). Each has a two-level category, venue name and code,
  date/time, duration, `featured` and reservation flags, Royal's product id
  (`pid`, stable between pulls), and optional age limits, arrive-early minutes
  and notes.
- Placeholder times (00:00 / 23:59 on embark, debark and sea days) are nulled
  by the producers.
- **No all-aboard time** in the public data. All-aboard = Royal's gangway time
  from a login download when present, else departure minus a buffer (default
  30 min).
- **No time zone.** Times appear to be port-local; the ship may keep Eastern
  time at St. Thomas (Atlantic). Hence the per-day ship-time offset.
  Unconfirmed until on board.
- Dining products list only bookable reservation slots, not opening hours
  (`PLAN.md`, Phase 6 item 18).
- Plain HTTP clients work for the public endpoints and for the sign-in from
  the phone; if Royal starts refusing, the sync tool impersonates a browser.

## What's built (1.6.1)

Numbers are the brief's item numbers, used in code comments and PRs. Screens
and wording: `DESIGN.md`.

**Watches:** Pebble Time 2 (emery) and, from 1.6.0, Pebble Round 2 (gabbro)
from the same .pbw; the Round 2 draws every screen inside the circle
(`DESIGN.md` §15), its round designs arrive in the Round 2 phase: Home
(timeline arc along the bottom edge) and the morning summary from 1.6.1.

**v1 (core)**

- **Setup and sync:** ship and sail-date pickers, Download, sync status,
  paste-in backup; re-sync keeps stars and settings.
- **Home:** all-aboard countdown on port days, otherwise the next starred
  event or personal entry (`NEXT · IN 20 MIN`), Royal's featured events as a
  fallback, and the next items. Ship time and local time per day.
- **Today list**, event details, star from watch or phone (watch stars queue
  until the phone is back), personal entries, category filters (Shop hidden by
  default).
- **Alerts:** all-aboard alerts and reminders before starred events (5/15/30
  min), opening the app by themselves and working without the phone.
- **My info:** stateroom, deck, nearest stairs, muster station, dining room,
  ship clock note, last sync. Light and dark theme.
- **Schedule changes:** a re-sync that moves or cancels a starred event moves
  or removes the star and tells the user on the watch and the settings page.

**v1.1, Phase 1: wayfinding** (1) built-in venue table for Harmony (deck,
fore/mid/aft, neighborhood; editable on the settings page), (2) deck and
position on every event, ship time centered in every top bar, (3) "From"
directions from the previous starred event, (4) ship directory by deck or area.

**Phase 2: daily view** (5) morning summary and the evening's tomorrow card,
(6) days-to-sail countdown, (7) clash warnings, (8) Last chance / Only show
tags, (9) Mark reserved and the evening reminder to reserve. Paid classes
(Booked activities) are picked on the settings page.

**Ship GPS** (19) walking distance on place pages, (20) closest restroom and
elevator banks, (21) step-by-step Route screen, Select on Home routes to the
next event, button hints, Help screen. Harmony is the only mapped ship
(`tools/shipmap/`): 2,855 cabins, venue spots, both elevator banks, 26
stairwells, a walkway graph per deck with 23 restrooms (58 links marked
uncertain). The map lives on the phone; the watch gets short strings.

**Usage log and Map check** (sections below).

**Phase 3: port days, booking details and settings** (22) booked excursions
from login data on Today with reminders, embark day's terminal arrival card,
**I'm on board**; (23) port day card: Royal's gangway time as the default
all-aboard, per-day warning period, time-ashore bar, warning sign, tender
notice on the phone; (24) Me tab filled from the cabin table and booking,
**Ready to sail** check, search across days; (25) silent morning sync at about
04:30; (26) `Remove star?` confirm; (27) Casino category; (28) **Share my
plan** with a travel companion.

**Phase 4: event data** (32) Royal's venue codes, (33) age limits and the
adult, teen/kid and family filters, (34) arrive-early times and reminders,
(35) event notes and what-to-bring tags, (36) a star follows its Royal product
id on re-sync, (37) shore excursions selectable on the settings page, (38)
**Advanced download** with the Royal login on the phone, and Main dining room
on the Me tab, (39) sync tool: every new field, `--dump-products`.

**Phase 5: voice** (29) scope session, (31) offline voice: Hold Select on Home
or a Route screen asks by voice; routes to places, closest restroom / bar /
coffee, `I'm at` as a route start, on board / ashore, departure, tomorrow,
muster station, my cabin; a Voice commands card and a Try a voice phrase box in
Help. Item 30 (a native Android companion) wasn't needed. Left: tuning on the
watch (`PLAN.md`).

**Planned: Phase 6** (`PLAN.md`): (17) "Before you go", starred events with
requirements gathered ahead of time; (18) a dining hint (`Last dinner
seating`), under consideration. Item 16 (meet-up points) was removed on
2026-10-01. Then the freeze: re-sync, full watch test, fixes only.

### Usage log

The sailing is the app's first real test, so the app records how it's used and
the log is reviewed afterwards (owner, 2026-09-24 and 09-26; both users
consent).

- **Where:** in the phone companion's storage. The watch sends its entries to
  the phone and queues up to 800 while the phone is away. Every entry has a
  real timestamp and the ship time. Fully offline.
- **What:** app opens and closes (who opened it, battery, phone connected,
  first screen), screens and time on each, button presses (while the phone is
  connected), stars, alerts scheduled / fired / opened / missed, syncs and
  their size and timing, phone connects, storage and message errors, free
  memory, venues not in the table, "From" lines shown, settings changes (old →
  new), Ship GPS pages and routes, voice turns, battery hourly while a wakeup
  runs anyway. Each new feature adds its own log events.
- **Header:** app and bundle versions, watch firmware, phone platform, ship
  code, a device label set on the Me tab. The first start of a new version
  logs `first run of 1.X.Y, was …`.
- **Personal data:** titles and cabin details are included, on condition that
  none of it ever reaches the GitHub repo. Never commit a log, an export or a
  quote from it; exports use the git-ignored name `royal-pebble-log-*.txt`.
  Tests use made-up cabin numbers; issues describe patterns, not entries.
- **Export:** the Me tab's Usage log card: **Copy part 1 of N** (plain text,
  each part at most 384 KB and starting with the header), entry count and
  size, Clear log, on/off (on by default). Capped at 768 KB; the oldest
  entries drop first. Entries are stored as `[ms, cruise day, minute, kind,
  detail]` and rendered when copied (`2026-09-26 14:03:12  D3 14:03  setting
  theme: "light" -> "dark"`; D1 is sail day).
- **Why copy in parts** (probe on the owner's Android phone, 2026-09-26): the
  Pebble app's WebView (Chrome 153) can't save or share a file (`<a
  download>`, `navigator.share`, `navigator.clipboard`, `intent:` and
  `mailto:` all fail), but `document.execCommand('copy')` works up to 512 KB.
  Paste with long-press > Paste: the keyboard's clipboard suggestion cuts at
  20,000 characters.
- **Page-size guard:** the phone measures the settings page URL before opening
  it; past 1.8 MB the page gets the newest entries that fit and says so. A page
  that comes back with no result while over 1 MB halves that limit for the
  next open.

### Map check

On-board corrections for the ship map (designed 2026-09-26, built the same
day).

- Map notes live in the usage log's store but in their own list: they never
  drop off and Clear log doesn't touch them (Clear notes, with a confirm).
- The Me tab's **Map check** card, only on a mapped ship: one row per open
  entry in `tools/shipmap/conflicts-HM.json` (bundled into
  `src/pkjs/data/conflicts-HM.js` by `tools/shipmap/build_conflicts.js`), with
  its question and what each source says. Answers: `website right` / `app
  right` / `neither` / `not checked`, an optional where and a note. **Add a
  problem** covers anything else.
- **Flag a map problem** is the last row of every place page on a mapped
  ship: Select saves the time, place, what the page showed and the route start
  (`Flagged on watch – add details` on the card). The watch can't take notes:
  dictation needs the phone, and notes are typed on the phone.
- **Found by the app:** a venue not in the table, no spot, no route or no
  restroom found is saved once per problem with a repeat count (not with demo
  data).
- **Copy notes** exports JSON (`"format": "royal-pebble-map-notes"`):
  `conflicts` by id, then `flags`, `found` and `added`. It can hold cabin
  details, so saved copies use the git-ignored name `royal-pebble-map-notes-*`.
  After the sailing each entry gets `status: confirmed` and `truth`, and the
  data is fixed and rebuilt (`tools/shipmap/README.md`, Conflicts).

## Measurements and limits

| What | Value | Source |
|---|---|---|
| Watch static (1.5.5 C code, the last watch change) | 61,984 B of 65,535; 1,504 B under the 62 KB budget | `tools/watch_size.py`, Sep 29 build |
| Heap at launch | 69,088 B | same |
| Pebble Round 2 (gabbro) static, 1.6.0 | 62,176 B; 1,312 B under the budget; heap at launch 68,896 B (same 128 KB app RAM as the Time 2) | `tools/watch_size.py`, 2026-10-02 |
| Pebble Round 2 (gabbro) static, 1.6.1 (round Home, G3) | 62,920 B; 568 B under the budget; heap at launch 68,152 B. The Time 2 binary is unchanged (61,984 B) | `tools/watch_size.py`, 2026-10-02 |
| Free heap on the watch, Home open | about 30.7 KB (1.5.4, 115-event day) | usage log, 2026-09-28 |
| Free heap at dictation start | 24-25 KB from Home and from a Route screen; dictation takes no app heap | usage log |
| Events per watch day | 160 | `MAX_EVENTS` |
| Alarms planned / wakeup slots | 24 / 8 (7 alerts + morning sync) | `data.h`, `alarms.h` |
| Phone `localStorage` | about 5 M characters across all keys | probe, 2026-09-26 |
| Clipboard copy from the settings page | works to 512 KB, 1 MB fails | probe |
| Settings page `data:` URL | 1,850 KB loads, about 2 MB never does; text grows about 1.6× in the URL | probe |
| Page result through `pebblejs://close#` | 1,024 KB arrived whole on the phone; the emulator rejects over about 64 KB. On Android the result arrives already URL-decoded, so the phone parses it as is first | RP Probe, 2026-09-27 |
| Phone script | about 540 KB; no known limit | build |

**Making room on the watch** (Phase 5, 2026-09-28): static buffers moved to
the heap and dead code removed (1.5.0, −1,576 B, and the 10 KB stored-slice
buffer is freed after use: +10.5 KB free heap), link-time optimisation (1.5.1,
−2,224 B; `-Oz` gave the same as `-Os`; LTO needs `-Wl,-u,__pbl_app_info` or
installs fail). The Ask screen draws phone-sent rows instead of its own
screens (1.5.2, +2,528 B).

**Not worth it** (judged 2026-09-28): moving watch strings to resources or the
phone (they total 2.5-5 KB and loading them back costs code and heap), a
background worker or second app (a worker can't draw; an app can't open
another), shrinking bitmaps or fonts (there are none). Held in reserve if
needed: a shared drawing pass over the biggest screens (2-4 KB, touches every
screen, not before the freeze), and halving the usage log's RAM queue to 400
entries (6.4 KB heap).

## Decisions in force

- **Watch app, not a face; no app glances** (planning, Sept 2026).
- **Offline settings page** as a `data:` URL, the approach Clay uses (planning).
- **Venue logic and all wording on the phone;** the watch formats numbers and
  draws phone strings (2026-09-24, reaffirmed for voice 2026-09-28).
- **Thin one-line top bar with ship time centered** (2026-09-24).
- **Wayfinding first** for v1.1: the owner's biggest pain on past cruises was
  finding *where* things are (2026-09-24).
- **Route start rule:** cabin, else a starred event ending less than 15
  minutes before, else a spoken location for 90 minutes; back to the cabin at
  04:00 (2026-09-26).
- **No side words until port/starboard is checked on board;** test-cruise flip
  settings in Help (2026-09-25).
- **No `~` on distances;** Help says once they're approximate (2026-09-26).
- **Restrooms aren't directory places;** elevator banks are (2026-09-25).
- **Ship GPS ships are listed** in the README, the settings page's Help and
  `tools/shipmap/README.md`, kept in step; the README invites people to map
  another ship (2026-09-26).
- **Royal's gangway time is the default all-aboard**, shifted in 5-minute
  steps; tender ports get a longer warning period on the phone, no tender
  notice on the watch (2026-09-26).
- **Dining must not assume a fixed nightly seating:** the owner has My Time
  Dining; specialty dinners are personal entries.
- **Advanced download with the Royal login on the phone** (2026-09-27, after a
  probe on the owner's phone passed: sign-in 200 with no block, the password
  survives the close URL unchanged, no password manager prompt). Nothing is
  saved; the usage log records counts only.
- **Voice on the current setup** (PebbleKit JS and the Pebble app's on-phone
  dictation) on Android; the airplane-mode test passed 12/12 on 2026-09-28,
  and 1.5.4 passed a full watch test the same day, dictation in airplane mode
  included. Item 30 (native Android companion) is not needed.
- **Hold Select on Home always asks by voice** (2026-09-28); the `On board?`
  screen remains for when the phone is away.
- **Casino is a category,** shown by default (2026-09-27).
- **Usage log scope:** log anything that could improve the app, cabin details
  included, never in the repo (2026-09-26).

## Later (v2+)

- Back-to-the-ship distance and direction (phone GPS pin dropped going
  ashore), with a "Leave now" alert at all-aboard minus the walk back.
- Native Android companion app (only if PebbleKit JS runs out; nothing needs
  it now).
- A quick "remind me in N minutes" timer, lap counter, spending log (Royal's
  onboard credit is a starting balance), currency conversion, Celebrity
  support.
- Meet-up points as their own kind of entry, and free-form checklists ticked
  off on the watch (both dropped from Phase 6 on 2026-10-01; a meet-up is a
  personal entry with a venue and a reminder today).
- Filter Today by category on the watch (needs a category per event on the
  watch, well over 1 KB).
- Usage log upload to the owner's Google Drive when online (the app's first
  internet use beyond Royal; needs the owner's OK).

**Future concepts** (no timeline):

- **Schedule questions by voice** (`What's next`, `When is <event>`, `Where is
  <event>`), after the matcher has been tried at sea (`DESIGN.md` §13).
- **Sun and hydration reminders,** only together: separate toggles and
  intervals (sun 60/80/120 min, default 80, between sunrise and sunset;
  hydration 45/60/90, default 60, 8:00-22:00), per day with defaults by day
  type. The phone computes sunrise and sunset from port coordinates
  (`mine.ports`, else a small built-in table; sea days interpolated between
  ports) and sends absolute times. The watch keeps only the next one scheduled
  so star reminders keep their wakeup slots.

**Out of scope:** live data on board, messaging between phones, app glances, a
watch face.

## Edge cases handled

Itinerary changes (skipped or added ports) editable offline; overnight port
stays; tender ports (longer warning period); placeholder times; events past
midnight (the watch day runs 04:00 to 04:00); the schedule changing between
pulls; an empty schedule before publication.

## Still to verify on board

- Ship time at St. Thomas, and whether port times are port-local.
- That Royal's `gangwayUp` is when you must be back (the 5-minute steps are the
  fix if not), and whether `bazaarDayType` marks tender ports (the app matches
  `TENDER` in the day type today).
- Ship map: port/starboard, the open conflicts, approximate spots, route costs,
  the step length (`DESIGN.md` §10.5).
- Voice in noisy places, with the hard venue names.
- Whether Royal's booking data holds the main dining room assignment
  (`ROYAL_LOGIN_DATA.md`).

## History

Git history has the detail; one line per stretch:

- **v1** (2026-09-24): sync, Home, Today, alerts, My info, settings page,
  Windows sync tool.
- **Phases 1-2** (2026-09-24 to 09-25): venue table and wayfinding, ship
  directory, daily view, Mark reserved, paid classes.
- **Ship GPS, usage log, Map check** (2026-09-25 to 09-26).
- **Phase 3, 1.3.0-1.3.9** (2026-09-26 to 09-27): port days, booking details,
  settings upgrades, morning sync, Share my plan.
- **Phase 4, 1.4.0-1.4.8** (2026-09-27 to 09-28): event data, excursions,
  Advanced download, Main dining room.
- **Phase 5, 1.5.0-1.5.13** (2026-09-28 to 10-01): making room on the watch,
  voice, Harmony refit names (1.5.11), re-sync by product id (1.5.12), Help >
  Voice commands (1.5.13).

## Testing

Schedules exist only for sailings about two weeks out, so develop against any
Harmony sailing in that window (`py tools/cruise-sync/cruise_sync.py --ship HM`,
pick the nearest date) or the built-in demo data. Re-test with the owner's
sailing once its schedule appears (the freeze, `PLAN.md`). Commands, emulator
tips and test files: `CLAUDE.md`.
