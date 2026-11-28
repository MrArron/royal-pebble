# Royal Pebble — Project brief

A watch app for the Pebble Time 2 and Pebble Round 2 for Royal Caribbean
cruises. Its job is **quick
glances at what's next** without pulling out a phone, and making sure the
wearer never misses all-aboard. All data is loaded before sailing; **at sea the
app works with no internet at all**.

This brief is the "what and why": purpose, constraints, what is built (1.6.26),
the decisions still in force and what's left for later. How things look is in
`DESIGN.md`; the work still to do before the sailing is in `PLAN.md`. When
something here conflicts with a request in a session, ask before changing
direction.

## Status and audience

- Private app, sideloaded to the owner's Android phone and Pebble Time 2, and
  to a travel companion's Pebble Round 2 (each phone keeps its own data; the
  Round 2 is tested on the emulator until it arrives). An appstore release
  is being prepared for after the test cruise (owner, 2026-11-18;
  `STORE_READINESS.md`): free and open source forever, no paid or premium
  features. Until then skip first-run tutorials and other watches, but keep
  the code generic (any ship and sail date, nothing hardcoded).
- Royal Caribbean only. Celebrity uses similar endpoints but is untested.
- First real use: the owner's upcoming sailing on Harmony of the Seas (ship
  code HM). It is also the app's test cruise: the usage log and map notes
  collected on board drive the next round of fixes.
- Version `1.X.Y`: X is the v1.1 phase in progress, Y counts PRs in it
  (`CLAUDE.md`). Current: **1.6.33**, phase 6 (`PLAN.md`). The Android app is
  versioned on its own (`0.1.0-<commit>`, `BUILD_AND_TEST.md`).

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
- **Two watches:** Pebble Time 2 (SDK platform `emery`, 200×228, 64 colors)
  and Pebble Round 2 (`gabbro`, 260×260 round, 64 colors), one .pbw. The
  Round 2 binary is the larger one (1,480 B under the budget in 1.6.24).
  Watch C must avoid `strtol()` and `strlen()` (both faulted on the real
  watch).
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
- **Android app** (`android/`, optional, sideloaded; `android/README.md`):
  price and booking checks with jdeath's script and their Watch alerts
  (booking notices), native Cruise screens on a Kotlin port of the Royal
  client and store, and, behind two switches that are off by default, serving
  the watch itself by running `src/pkjs/index.js` in QuickJS
  (`WATCH_PROTOCOL.md`, App serves the watch). It keeps its own cruise,
  separate from PebbleKit JS's. One-page overview: `BUILD_AND_TEST.md`.
- **Windows sync tool** (`tools/cruise-sync/`, Python): the reference
  implementation of every Royal request and the backup data path. Its output
  is pasted into the settings page (or the app's Trip screen).
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

## What's built (1.6.26)

Numbers are the brief's item numbers, used in code comments and PRs. Screens
and wording: `DESIGN.md`.

**Watches:** Pebble Time 2 (emery) and, from 1.6.0, Pebble Round 2 (gabbro)
from the same .pbw; the Round 2 draws every screen inside the circle
(`DESIGN.md` §15), its round designs arrive in the Round 2 phase: Home
(timeline arc along the bottom edge) the morning summary from 1.6.1, and alerts, notices and the clash toast from 1.6.2. From 1.6.3 the
directory's place card and the Route screen are built on the phone as
pages of styled lines and drawn by one small watch renderer, laid out for
each watch (`WATCH_PROTOCOL.md`, Page lines). From 1.6.4 the Round 2's
lists (Today, the directory) keep the selected row centered on a rounded
pill, and long pages show a scroll arc on the right edge. From 1.6.5 My info,
the Ask card (and its phone-away and no-answer messages) and the On board?
screen are centered too, with the On board? labels beside the buttons. From
1.6.6 the Time 2 matches the Round 2's style: a rounded selection pill on
its lists and My info (with a stateroom card, orange since 1.6.13), a thin scroll bar on
the right edge of long pages instead of the triangles, and the all-aboard
alert shows Home's countdown with the time-ashore bar. From 1.6.7 the phone words the voice card and the pages for
each watch (`textfit.js`): the Round 2 gets short hints and lines cut to its
narrow column, the Time 2's text is unchanged.

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
Help. Left: tuning on the watch (`PLAN.md`). Item 30 (a native Android
companion) was judged not needed for voice in 2026-09; the Android app below
was built later for other reasons.

**Round 2 phase (1.6.0-1.6.7)** and the **1.6 hardware-test fixes
(1.6.9-1.6.18)**: see "Watches" above and `PLAN.md` §3a.

**Android app (1.6.19-1.6.33; `android/README.md`)**

- Price and booking checker running jdeath's script (Chaquopy), with
  background checks, a Keystore-encrypted password only while those are on,
  and verified script updates (`docs/PRICE_SCRIPT_UPDATES.md`).
- Phase 0 link test (1.6.19): an Android app can share the watch with
  PebbleKit JS through PebbleKit Android 2 (`android/linktest/`,
  `WATCH_PROTOCOL.md`).
- Booking notices on the watch (1.6.20) and the app's **Watch alerts** that
  send them: price drop, check-in open / checked in, final payment due.
- **Price watches and quieter alerts** (1.6.29): watches on Cruise Planner
  items not bought yet (any drop below the price when set, the default; a
  percent below it; or below your own price), checked by the price script's
  `watchList` and decided by the app (`royal/.../alerts/PriceWatch.kt`); one
  phone notification per alert with Mute (Unmute in Prices >
  Watches; items can be picked instead of pasting a link: shore excursions from the downloaded schedule, and
  drinks, internet, dining, activities and spa from the Cruise Planner's own product list, loaded
  with the saved Royal login (`RoyalClient.fetchCatalog`, Royal's `WebProductsByCategory` GraphQL call;
  see `docs/ROYAL_LOGIN_DATA.md`)), the same alerts on the watch (Watch alerts now on by default),
  and alert hours (default 8 AM to 9 PM) that hold background-check alerts
  overnight until the hours open.
- **Price watch picker** (1.6.33, PRs #139 and #140): items are picked from a list instead of pasted: shore excursions from the schedule, and drinks, internet, dining, activities and spa loaded from the Cruise Planner with the saved login. No watch change; the version bump only lets the update check see the release.
- **Sailings kept separately, pull down to refresh** (1.6.35, PRs #145, #146 and #147; no watch change, the bump lets the update check see the release): price watches run only for their own sailing; every downloaded sailing is kept on its own (Trip > Your sailings) and a sailing picker on Prices chooses which one the app and watch follow; pull down on Trip, Today and Prices replaces Run now and Refresh from Royal with one refresh on one shared sign-in, limited to one refresh per 10 minutes.
- **Prices in one place, one Royal sync** (1.6.34, PRs #142 and #143; no watch change, the bump lets the update check see the release): the Prices tab holds Summary, Watches, Checks and Report (price watches and price check settings left Settings), and Trip's download, the background schedule refresh and Prices > Refresh from Royal share one sign-in and one copy of the schedule, bookings and Cruise Planner list (`RoyalSync.kt`), with a Royal data card on Trip and Prices showing when each was fetched. The price check script still signs in by itself.
- **Pull down to refresh, one sign-in** (Android app, stacked on #145/#146; no watch change): Run now and Refresh from Royal are gone; pulling down on Trip, Today or Prices refreshes the shown sailing's schedule and bookings, the planner list when it's 6 hours old, then the price check, all on one sign-in to Royal (`SignInCache`; the unchanged price script is handed the app's sign-in by `rcp_runner`). At most one refresh every 10 minutes, and data pulled in the last 10 minutes is kept rather than pulled again (`PullRules`). Background runs refresh the schedule first, then check prices on that sign-in. The price script is not forked.
- **Watch launcher icon** (1.6.32): the C3b ship as a 25x25 menu icon (`resources/images/menu-icon.png`).
- **In-app update** (1.6.31): Settings > About checks this repo's newest GitHub release (once a day if left on, or on
  Check for updates), shows its notes and offers the APK link, which opens in the browser (1.6.32: no in-app install, so no
  install permission; Play Protect flagged 1.6.31's). The launcher icon is the C3b art as an adaptive icon.
- **Schedule is up** alert (1.6.30): the background schedule refresh starts
  21 days before sailing, and when it finds the daily schedule newly posted
  (or 25% bigger) the phone and the watch (`SCHEDULE UP`, NOTICE kind 8) say
  how many events there are, how many are free and how many free ones take a
  reservation, so shows get booked before they fill up.
- Kotlin Royal client and `CruiseStore` (port of `royal.js`, same fixtures),
  native Cruise screens (Cruise, Days, Filters, Events, Me, Share; laid out
  by trip phase in 1.6.25), restyled
  in the settings page's palette.
- **App serves the watch** (1.6.21): the app runs `src/pkjs/index.js` in
  QuickJS and does all PebbleKit JS does, byte for byte (the serving gate in
  CI); off by default, with the settings page's **Android app serves the
  watch** to make PebbleKit JS quiet.
- 1.6.22: `[js]` / `[app]` on every serving line of the usage log, and `NO
  CRUISE YET` instead of the demo when the app has no cruise. 1.6.23: the
  app's saves reach the watch at once (`storeChanged`), Settings > Watch and logs >
  Share log file / Save to Downloads and Test alerts. 1.6.24: the app
  retries the watch-type lookup, so a Round 2 always gets its layouts.
- 1.6.25: one bottom bar that follows the trip (Planning: Trip, Prices, Plan,
  Settings; On board: Today, Events, Cabin, Settings; Auto from the sailing's
  dates; `DESIGN.md` §12), background price checks paused on board unless
  turned back on, stars follow moved or cancelled events on a re-download
  (`JsStarReconciler`, issue 129), one Royal login for price checks and
  downloads, selectable reports with Copy and Share, and port stops counted
  from gangway times.
- 1.6.26: Filters > Cost > Hide events with a fee (free-type events Royal
  marks "Fee applies", the bundle's new `fee` note, kept by all three
  downloaders), the background price check also refreshes the schedule with
  the login (Also refresh the schedule, `ScheduleRefresh`), bookings match
  schedule events ignoring case and punctuation, and `schedule` and `booked`
  log lines.

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
  code, a device label set on the Me tab, and who serves the watch (1.6.22).
  The first start of a new version logs `first run of 1.X.Y, was …`.
- **Which side (1.6.22):** with the Android app able to serve the watch, every
  line about serving it starts `[js]` (PebbleKit JS) or `[app]` (the Android
  app): slices (with their data: `demo N`, `no cruise` or `cruise HM
  2026-12-12`), notices, directory pages, routes, voice answers, star changes,
  data requests and the watch's storage report (which names the data too, since
  its size follows the slice: demo and real data differ by a few dozen bytes).
  Each start logs who serves, the build and the switch it read: PebbleKit JS
  the settings page's Android app serves the watch, the app its App serves the
  watch, version, commit and wire log. A quiet PebbleKit JS logs each kind of
  watch message it leaves to the app once. The app's own log and export are
  Settings > Watch and logs > Share log file / Save to Downloads (a file, not the
  clipboard; `docs/WATCH_PROTOCOL.md`, Test log).
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
| Watch static, Time 2, 1.5.5 (before the Round 2 phase) | 61,984 B of 65,535; 1,504 B under the 62 KB budget | `tools/watch_size.py`, Sep 29 build |
| Heap at launch, Time 2, 1.5.5 | 69,088 B | same |
| Pebble Round 2 (gabbro) static, 1.6.0 | 62,176 B; 1,312 B under the budget; heap at launch 68,896 B (same 128 KB app RAM as the Time 2) | `tools/watch_size.py`, 2026-10-02 |
| Pebble Round 2 (gabbro) static, 1.6.1 (round Home, G3) | 62,920 B; 568 B under the budget; heap at launch 68,152 B. The Time 2 binary is unchanged (61,984 B) | `tools/watch_size.py`, 2026-10-02 |
| Pebble Round 2 (gabbro) static, 1.6.2 (alerts, G4) | 63,472 B; 16 B under the budget. The Time 2 is 61,904 B (80 B smaller than 1.6.1) | `tools/watch_size.py`, 2026-10-02 |
| Both watches, 1.6.3 (generic phone page, GP) | Time 2 58,776 B (3,128 B smaller; 4,712 B under the budget); Round 2 60,216 B (3,256 B smaller; 3,272 B under). The place card and Route layouts moved to the phone (`pagelines.js`) | `tools/watch_size.py`, 2026-10-02 |
| Pebble Round 2 (gabbro) static, 1.6.4 (lists and scroll arc, G5) | 61,120 B (+904 B); 2,368 B under the budget. The Time 2's code is byte-identical (58,776 B) | `tools/watch_size.py`, 2026-10-03 |
| Pebble Round 2 (gabbro) static, 1.6.5 (My info, Ask, On board?, G6) | 61,856 B (+736 B); 1,632 B under the budget. The Time 2's code is byte-identical (58,776 B) | `tools/watch_size.py`, 2026-10-03 |
| Both watches, 1.6.6 (Time 2 matching style, G6a) | Time 2 59,056 B (+280 B; 4,432 B under the budget); Round 2 61,592 B (264 B smaller; 1,896 B under). The scroll bar, pill and stateroom card are shared helpers; the content-triangle code is gone | `tools/watch_size.py`, 2026-10-03 |
| Both watches, 1.6.24 (Round 2 recheck) | Time 2 59,392 B (4,096 B under the budget); Round 2 62,008 B (1,480 B under); heap at launch on the Round 2 69,064 B, peak use 48,488 B in the emulator pass | `tools/watch_size.py`, gabbro emulator log, 2026-11-15 |
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
  included. (That made item 30, a native companion for voice, unnecessary;
  the Android app built from 2026-11 doesn't change how voice works.)
- **The Android app is optional and serves the watch only when switched on**
  (both switches, off by default); PebbleKit JS stays the default, and the
  watch works the same either way (2026-11).
- **The Android app reuses `src/pkjs/index.js`** in QuickJS rather than
  porting the watch-serving code, so the two can't drift; the serving gate
  compares them byte for byte (2026-11-13, `QUICKJS_PHASE0.md`).
- **Hold Select on Home always asks by voice** (2026-09-28); since 1.6.12
  (owner, 2026-10-04) Hold Down opens the `On board?` screen, phone or not.
- **Casino is a category,** shown by default (2026-09-27).
- **Usage log scope:** log anything that could improve the app, cabin details
  included, never in the repo (2026-09-26).

## Later (v2+)

- Back-to-the-ship distance and direction (phone GPS pin dropped going
  ashore), with a "Leave now" alert at all-aboard minus the walk back.
- The Android app as the only phone side (replacing PebbleKit JS, not just
  added to it): built as far as serving the watch behind a switch (What's
  built, Android app); making it the default is the owner's call.
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
- **Round 2 phase, 1.6.0-1.6.7** (2026-10-02 to 10-03): the Pebble Round 2
  from the same .pbw, round layouts, the generic phone page, the Time 2's
  matching style, per-watch text.
- **1.6 hardware-test fixes, 1.6.8-1.6.18** (2026-10-04 to 11-07): fixes from
  the Time 2 test of 1.6.8, booked shows, gangway times, Advanced download
  and Me tab fixes.
- **Android app, 1.6.19-1.6.25** (2026-11-13 to 11-15): link test, booking
  notices, the price checker's Watch alerts, Kotlin Royal client and store,
  native Cruise screens, the app serving the watch, logging, instant push,
  log file export, Round 2 watch-type retry, the trip-phase layout and
  star reconciling (1.6.25).

## Testing

Schedules exist only for sailings about two weeks out, so develop against any
Harmony sailing in that window (`py tools/cruise-sync/cruise_sync.py --ship HM`,
pick the nearest date) or the built-in demo data. Re-test with the owner's
sailing once its schedule appears (the freeze, `PLAN.md`). Commands, emulator
tips and test files: `CLAUDE.md`.
