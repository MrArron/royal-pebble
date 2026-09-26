# Cruise Watch — Project Brief

A Pebble Time 2 watch app for Royal Caribbean cruises. Its job is **quick glances at
what's next** without pulling out a phone, and making sure the wearer never misses
all-aboard. All data is loaded before sailing; **at sea the app works with no
internet at all**.

This brief records decisions made during planning. When something here conflicts
with a request in a session, ask before changing direction.

## Status and audience

- Private, single-user app, sideloaded to the owner's phone and Pebble Time 2. No
  app store release planned. Skip public-release polish (store listing, first-run
  tutorials, support for other watches), but keep the code generic: any ship and
  sail date, not hardcoded.
- Royal Caribbean only for v1. Celebrity uses similar endpoints but is untested.
- First real use: the owner's own sailing on Harmony of the Seas (ship code HM).
  Its date is deliberately kept out of this repository; the itinerary includes
  Port Canaveral, St. Thomas, Nassau and Perfect Day at CocoCay.

## Architecture

- **Watch app** (C, Pebble SDK). A watch *app*, not a watch face: the owner opens it
  with a Quick Launch button hold. App glances were considered and dropped (they
  only update when the app closes).
- **Phone companion** (PebbleKit JS, runs inside the Pebble phone app).
  - Fetches data (below), keeps the **full dataset** in phone storage, and is the
    source of truth.
  - Pushes the watch only what it needs (today's slice: countdown, next few items,
    my-info card) over Bluetooth via AppMessage. The watch's persistent storage
    may be small (4 kB on older firmware), so it saves only what's needed
    without the phone, by priority: all-aboard, alerts and starred events in the
    next 12 hours first (`docs/WATCH_PROTOCOL.md`, Stored on the watch).
  - Bluetooth works at sea, so phone → watch refreshes and watch → phone changes
    (e.g. starring an event) work offline.
- **Settings page** (HTML shown by the Pebble phone app). It **must work offline**:
  build it locally from the companion (data URI, the approach the Clay library uses),
  never load it from a website.
- **Backup data path:** `tools/cruise-sync/` (Windows Python tool) produces the same
  data bundle; the owner pastes it into the settings page.

## Data sources

Unofficial, undocumented Royal Caribbean web endpoints (learned from
jdeath/CheckRoyalCaribbeanPrice, MIT). No login in the phone app. Keep request
volume low (a sync or two, not polling). See `docs/DATA_FORMAT.md` for the bundle
format and `tools/cruise-sync/cruise_sync.py` as the reference implementation of
every request.

| Data | Endpoint (host `aws-prd.api.rccl.com`, header `AppKey`) | Notes |
|---|---|---|
| Ships | `/en/royal/web/v2/ships` | name ↔ code |
| Sailings | `/en/royal/web/v3/ships/{code}/voyages` | sail dates |
| Itinerary | `/en/royal/web/v3/ships/{code}/sailDate/{YYYYMMDD}` | port, type, arrive/depart |
| Schedule | `/en/royal/web/v3/products?sailingID={code}{YYYYMMDD}&limit=200&offset=N` | keep `NON_REVENUE_SCHEDULABLE`, `ENTERTAINMENT`, `ACTIVITIES` |

Known facts about the data:

- The activity schedule is published roughly **two weeks before sailing** (observed
  once, Sept 2026). Sync is therefore two-stage: itinerary any time, schedule later.
  The settings page must say "not published yet" instead of showing an empty list.
- A week's schedule is ~400–520 events. Each has a two-level category, venue,
  date/time, duration, a `featured` flag (a handful per sailing) and a
  reservation-required flag. Age fields are empty. Meeting locations say "Check
  back later" pre-cruise (ignore).
- Placeholder times: 00:00 / 23:59 on embark, debark and sea days; some events at
  00:00 are untimed. The bundle already nulls these out.
- **No all-aboard time** in the data. All-aboard = departure − buffer (default 30
  min), editable per day.
- **No time zone.** Times appear to be port-local. Ships from Florida may keep
  Eastern time while St. Thomas is on Atlantic time (+1h in December), hence the
  per-day ship-time offset. Unconfirmed until onboard.
- The public data has no pier coordinates, muster station, onboard spending or
  excursion times. A login (sync tool only) adds deck, muster station, booked
  excursion times, gangway times and approximate port coordinates, some still
  unverified: `docs/ROYAL_LOGIN_DATA.md`.
- Plain HTTP clients have worked for these public endpoints so far; if Royal
  starts returning 403 to the phone, the backup tool uses browser impersonation.

## Version 1 scope

1. **Setup and sync** — settings page: ship + sail-date pickers, Download, sync
   status, paste-in backup. Personal fields: stateroom, deck, nearest stairs,
   muster station.
2. **Itinerary and all-aboard countdown** — day view; on port days the home screen
   is a countdown to all-aboard, with vibration alerts at thresholds. All-aboard
   buffer (30/45/60) and times editable per day.
3. **Ship time vs local time** — per-day offset; countdowns always run on ship time
   and show both clocks.
4. **Schedule, favorites, reminders** — browse by day, filter by category (Shop
   hidden by default), star events (phone or watch), reminders before starred
   events (5/15/30 min), personal entries (e.g. dinner reservations).
5. **My info card** — stateroom, deck, nearest stairs, muster station, ship clock
   note, last sync.
6. **Light / dark theme** setting.

### Watch interaction model

- App opens straight to **Home**. Back exits.
- **Home:** top bar (date · day type, location, ship time). Body:
  - Port day, before all-aboard → all-aboard countdown + next two items (starred
    ones first).
  - Otherwise → next starred event or personal entry ("NEXT · IN 20 MIN") + next
    two items.
  - Nothing starred coming up → Royal's featured events (setting) or "Nothing
    starred today".
- **Down → Today list.** Grouped by start time (time shown on the first row of a
  group only); in-progress events shown as NOW with end time. Finished events drop
  off (at their end, or 30 minutes after the start when there is no length). The
  highlighted row is only the cursor. The settings page likewise hides past days
  and finished events and entries (Days, Events).
- **Up → My info.**
- In lists: **Select** opens event details (title, venue, time, duration,
  reservation needed); **hold Select** toggles the star with a short vibration.
- Reminders: Pebble limits scheduled wakeups per app, so schedule them a day (or a
  few items) at a time. Confirm the current limit in the SDK docs.

## Version 1.1 (planned for the owner's first sailing)

Chosen in a brainstorm on 2026-09-24. The owner's biggest pain on past cruises was
pulling out the phone to find **where** events are and when their picks start; the
watch already covers the time and "when", so wayfinding comes first. Each numbered
item is its own branch and PR, tested on the watch before merging. Items in the last
phase are the first to slip; after them, the dining hint and tender warning.

### Phase 1: Wayfinding (done)

1. **Venue table.** Venue name → deck, fore/mid/aft, neighborhood (Boardwalk,
   Central Park, Royal Promenade, ...). Built into the app for Harmony from its
   current deck plans and checked by the owner; editable on the settings page for
   fixes and other ships. Checked 2026-09-24: Royal's schedule gives a venue only a
   code, a name and a type (no deck or position), so the table is hand-built and
   keyed by venue name. Design: `docs/DESIGN_V1_1.md` (Ship venues card under
   Cruise; per-field "check" flags, "Looks right", aliases for near-duplicate
   names). The table lives in the phone companion, owner fixes in settings; the
   bundle format doesn't change.
2. **Deck and position everywhere** an event appears: details, Home's NEXT card
   and reminder alerts, e.g. `Studio B · Deck 4 · Mid` and `2 decks down from you`
   (relative to the stateroom deck in My info). Final wording and the shortened
   forms are in `docs/DESIGN_V1_1.md` §2. The same PR moves ship time to the
   center of every watch top bar (§4).
3. **Directions from the previous event.** When the last starred event or personal
   entry ends less than 15 minutes before the next one starts (or overlaps it),
   directions start from that venue instead of the cabin: `From Royal Theater: 1
   deck down, aft → mid`, or `Same venue` / `Same area`. An event with no length
   ends 30 minutes after it starts (the Today drop-off rule).
4. **Ship directory** at the bottom of My info: browse by deck or neighborhood;
   each place shows deck, position, distance from the cabin and what's on there for
   the rest of today. Includes non-venue places from the deck plans (Guest
   Services, Medical, Windjammer, pools, kids' club, elevator lobbies). The phone
   sends one deck or neighborhood at a time.

### Phase 2: Daily view

5. **Morning summary** on the first open of the day (port, arrive/depart,
   all-aboard, starred count), and the same summary for **tomorrow** after about
   8 pm.
6. **Days-to-sail countdown** on Home before the cruise.
7. **Clash warning** when a star overlaps another starred event or a personal
   entry (watch and settings page).
8. **Last-chance tag** on a featured show's final performance of the cruise.
9. **Reservation reminder** the evening before: starred events that need a
   reservation. Built with **Mark reserved** (`docs/DESIGN_V1_1.md` §5): the owner
   marks a starred event reserved on the phone or with a short Select on the
   watch's event details, and the reminder skips reserved events.

### Ship GPS (after Phase 2, before the usage log)

Moved from "Later" into v1.1 by the owner on 2026-09-24, as a follow-up to the
ship directory (item 4). It builds on a prepared Harmony ship map, measured from
Royal's deck plans:
- 2,855 cabins;
- venue spots (89 of the table's 108, some with several spots);
- both elevator banks with the decks they serve, and 26 stairwells (7 of them
  single-deck);
- a walkway graph per deck: cabin corridors, public spaces, where port and
  starboard really connect, and 23 restrooms (58 edges marked uncertain);
- a route planner.

The map data (`src/pkjs/data/`, built by `tools/shipmap/`) and the planner
(`src/pkjs/shipmap.js`) live in the phone companion. The watch gets only short
strings and stores no map data.

**Which ships have GPS** (owner, 2026-09-26): users must be told. Keep one list
of the mapped ships in the README, the settings page's Help section and the
store listing (when there is one), and update all of them whenever a ship's map
is added (`tools/shipmap/README.md`, Mapped ships). The README invites people to
map another Royal ship with `tools/shipmap/` and open a pull request.

19. **Walking distance** on directory place pages: from the cabin (by stateroom
    number on the Me tab), e.g. `160 m aft`, next to the existing deck line.
20. **Closest restroom** on place pages (Hold Select opens its route), and
    elevator banks as directory places. Restrooms themselves are not listed in
    the directory (owner, 2026-09-25).
21. **Step-by-step route** on its own Route screen, opened with Select from a
    place page or from Home's NEXT card: short lines such as `50 m aft` /
    `Aft elev to Deck 16` / `20 m aft`, from the current start (cabin by
    default; see `docs/DESIGN_V1_1.md` §9.4).

Designed 2026-09-25: `docs/DESIGN_V1_1.md` §9, mockups in `docs/mockups/gps/`.

Before showing any of it:
- **Port/starboard:** confirm the side against one known cabin on board, and
  don't show a side until then.
- **Main Dining Room:** check that choosing the nearest venue spot never sends
  you to a different floor of it.
- **Approximate spots:** treat the venues with no spot on the plans (now just
  the Medical Center, on deck 2) as approximate.
- **Route costs:** the elevator wait and stairs-per-deck costs are guesses, to
  tune after walking the ship.
- **Source conflicts:** the SVG scrape and the Royal app's plans disagree in
  places (a venue's deck or side, names, restrooms). Each is listed in
  `tools/shipmap/conflicts-HM.json`, as are conflicts from any later scrape;
  the data keeps its current value until the owner checks it on board.
- **On-board logging (designed with the owner, 2026-09-26; built after the usage
  log, see "Map check" under it):** a way for the owner to log the true situation
  in person during the sailing, for each open conflict (and anything else found
  wrong), so the data can be fixed afterwards. It has to be on the watch and
  phone before the freeze.

### Usage log (after Phase 2 and the Ship GPS; must be on the watch well before the freeze)

Scope agreed with the owner on 2026-09-24. The sailing is the app's first real
test, so the app records how it's used, and the log is evaluated afterwards. Own
branch and PR; once the sailing gets close, it goes ahead of remaining feature work.

- **Where:** the log lives in the phone companion's storage. The watch reports its
  events to the phone in a new watch → phone message and queues them in its own
  storage while the phone is away (about 200 entries). Every entry has a real
  timestamp and the ship time. Fully offline.
- **Detail:** while the phone is connected, every button press is logged. Screen
  views with time on screen and a scroll count per screen are logged all the
  time (PR 2: they cost little and give the presses their context), so with the
  phone away the log still shows where time went. Formats in
  `docs/WATCH_PROTOCOL.md`, "Usage log".
- **Events:** (A) app opened (you or an alert, battery %, phone connected, first
  screen) and closed (time open); (B) screens shown and time on each, and what
  Home's main card showed at open; (C) star/unstar from watch or phone with the
  event title and venue, and Selects that did nothing; (D) alerts scheduled,
  fired (lateness), opened, dismissed, missed while off, wakeup slots full;
  (E) data syncs asked for (time taken, size, timeouts), phone connected or
  disconnected, star confirmation delay, the watch storage report, schedule-change
  notices shown; (F) watch message and storage errors with codes, free memory at
  start and its lowest point, phone script errors, bundle problems, venue names
  with no match in the venue table, and which "From" lines were shown; (G) settings
  page opened or saved, bundle imported (counts only), re-sync changes.
- **Wider scope (owner, 2026-09-26):** log anything that could help improve the
  app and its development. Only the owner and his fiancé use it and both consent.
  On top of (A)–(G), that includes: (H) Ship GPS: place pages opened, distances
  shown, routes asked (start and destination kind, length, steps, planner time,
  no-route failures), route start changes, restroom routes; (I) performance:
  message round trips, sizes and retries, phone-side slice and page build times;
  (J) battery % and charging at every open and close, and hourly from the watch
  while the app has a wakeup anyway (no extra wakeups just for logging); (K)
  every settings change (old → new value) and hints shown. Each feature built
  from now on adds its own log events.
- **Log header** on export: app and bundle versions, watch firmware, phone
  platform, ship code, a device label set on the Me tab (two people, two
  watches: each phone keeps its own log).
- **Titles and cabin details are included** (stateroom, muster station, spoken
  cabin numbers; owner, 2026-09-26), on condition that none of it ever reaches
  the GitHub repo. The log is personal cruise data: never commit it, any export
  or excerpt of it, or findings that quote it; never print it in full. Saved
  exports use the git-ignored name `royal-pebble-log-*.txt` and belong outside
  the repo. Tests use made-up cabin numbers, never the owner's. PR descriptions
  and issues about log findings describe patterns, not the entries.
- **Export:** a Usage log card on the settings page Me tab with Copy log (plain
  text), entry count and size, Clear log and an on/off switch. When full, the
  oldest entries drop first.
- **Export design (settled 2026-09-26 from a probe app on the owner's Android
  phone):** the settings page opens as a `data:` URL in the Pebble app's Android
  WebView (Chrome 153), which blocks every way of saving or sharing a file
  (`<a download>` with data: or blob: URLs does nothing; no `navigator.share` or
  `navigator.clipboard`; `intent:` and `mailto:` links error). Copying a textarea
  with `document.execCommand('copy')` works up to 512 KB (1 MB fails). So:
  - **Copy in parts:** each part at most 384 KB, buttons "Copy part 1 of N", each
    part starting with the log header and its part number. A tip on the card says
    to paste with long-press > Paste: the keyboard's clipboard suggestion cut a
    paste to 20,000 characters.
  - **Cap 768 KB of log text** (two parts). The phone script's `localStorage` holds
    about 5 M characters for all keys together (one key saved 4 M; keys adding up
    stopped at 4.6 M), so the log fits beside the cruise bundle; saving a full log
    takes about 12 ms and loading it 1 ms. If storage fills anyway, the log drops
    its oldest entries until it saves.
  - **Page-size guard:** a `data:` URL of about 2 MB or more never loads (1,850 KB
    did), and text grows about 1.6x in the URL. The phone measures the page URL
    before opening it; past 1.8 MB the page gets the newest entries that fit and
    says so. Nothing is deleted. A page that comes back with no result while over
    1 MB halves that limit for the next open, until a page returns a result (a
    page that doesn't load stays broken across reinstalls, since reinstalling
    keeps `localStorage`).
  - **Entries** are stored as `[ms, cruise day, minute of that day, kind, detail]`
    and rendered when copied, as `2026-09-26 14:03:12  D3 14:03  setting  theme:
    "light" -> "dark"` (D1 is sail day; before sailing D-1, D-2...). On by default;
    the device label is empty until set.
  - **Later, optional:** automatic upload to the owner's Google Drive when online
    is possible (the page and phone script can reach the internet), but it would
    be the app's first internet use beyond Royal's servers, so it needs the owner's
    OK first.
- **Build order:** PR 1 phone log store, Usage log card and phone-side events;
  PR 2 the watch → phone log message, the watch queue and watch-side events;
  PR 3 Map check.

#### Map check (on-board map corrections; designed 2026-09-26)

- **Same store, separate list:** map notes live in the usage log's phone-side
  store but in their own list. They never drop off when the store is full and
  Clear log doesn't touch them (it has its own Clear, with a confirm).
- **Map check card** on the Me tab, only for a mapped ship: one row per open
  entry in `tools/shipmap/conflicts-HM.json` (bundled into the phone script at
  build time), showing the `check` question and what each source says. Answer
  with `website right` / `app right` / `neither` / `not checked`, an optional
  where (deck, fore/mid/aft, port/stbd) and a short note. An **Add a problem**
  row covers anything else found wrong (place, deck, note).
- **Quick flag on the watch** (the watch can't take notes offline: dictation
  needs the internet): place pages on a mapped ship end with a **Flag a map
  problem** row (owner, 2026-09-26: on the directory's place pages only, not the
  Route screen). Select on it saves the time, the place, what the page showed
  (FROM and restroom lines) and where the route starts, and opens a page saying
  `Flagged`. It's an ordinary directory row built by the phone, so the watch
  code is unchanged (docs/WATCH_PROTOCOL.md, Ship directory). Flags appear in
  the card as `Flagged on watch – add details`.
- **Found by the app** (owner, 2026-09-26): when the phone runs into a map
  problem by itself (a venue not in the venue table, a venue with no spot on its
  deck, no route found, no restroom found), it saves a note once per problem and
  counts repeats. Not with demo data. They appear in the card under `Found by
  the app`, with the same where and note fields.
- **Copy notes** exports the answers keyed by conflict id, so after the sailing
  each entry gets `status: confirmed` and `truth`, and the data is fixed and
  rebuilt (`tools/shipmap/README.md`, Conflicts). The export is JSON
  (`"format": "royal-pebble-map-notes"`): `conflicts` by id (every open one,
  `not checked` included), then `flags`, `found` and `added`. It can hold cabin
  details (a route start), so a saved copy uses the git-ignored name
  `royal-pebble-map-notes-*` and stays out of the repo.
- **Built (2026-09-26):** the card, answers, flags, problems found, Copy notes
  and Clear notes (applied on Save, like Clear log). The open conflicts are
  bundled by `tools/shipmap/build_conflicts.js` into `src/pkjs/data/conflicts-HM.js`.

### Phase 3: Port days and outdoors

10. **Time-ashore bar** on the port countdown, from arrival to all-aboard.
11. **"Leave now" alert** at all-aboard minus a walking time the owner sets.
12. **Tender-day warning** with a larger suggested buffer, if Royal's itinerary
    marks tender ports (check the data first).
13. **Sun reminders.** A toggle and interval (default 80 min: 60/80/120), on or
    off per day with defaults by day type, only between sunrise and sunset.
    (Hydration reminders moved to Future concepts, owner 2026-09-26.) The
    **phone** computes sunrise and sunset with a simple solar formula (approximate is fine) from port coordinates
    on port days and, on sea days, a point interpolated between the previous and
    next port at (day − departure day) ÷ (arrival day − departure day), e.g. 1/3
    and 2/3 on the two sea days from Port Canaveral to St. Thomas. It sends
    absolute times, so no time zone is needed. Port coordinates come from a small
    built-in table (this itinerary plus common Caribbean and Bahamas ports), with a
    lat/long field or a default 7:00–18:00 window for unknown ports. The watch keeps
    only the next reminder scheduled so star reminders keep their wakeup slots.

### Phase 4: Planning

14. **Search events** on the settings page.
15. **Share my plan.** Share plan on the settings page produces text to send to a
    travel companion; Import plan on their phone merges it. It carries stars,
    personal entries (including meet-ups and checklists), per-day all-aboard and
    ship-time settings, itinerary edits and venue-table fixes. Cabin details
    (stateroom, deck, stairs, muster station) only when "Include cabin details (we
    share a cabin)" is ticked. Import opens a review screen: **Accept all**, **Reject
    import** or **Review each**, where every difference is a row with its own choice
    (add or skip a star, keep mine or unstar, use theirs or keep mine for settings
    and cabin details). Accept all takes everything the sender has and uses their
    values where they differ, but never unstars or deletes anything of the
    receiver's. Nothing is saved until Apply or Accept all. Also works as a backup
    of the owner's own choices. Needs a new section in `docs/DATA_FORMAT.md`.
16. **Meet-up points.** A personal entry that points at a directory place, with a
    reminder.
17. **Checklists** written on the settings page and ticked off on the watch;
    starter lists for debark night (bags out, settle account, passports, safe) and
    port days (SeaPass, ID, sunscreen, cash).
18. **Dining window hint** in the evening, e.g. `Dining room open until 9:30`, from
    Royal's schedule if it lists the hours, otherwise typed in once. Dining features
    must not assume a fixed nightly seating: the owner has My Time Dining, and
    specialty dinners are one-off personal entries.

### If time allows

Free-time gaps between starred events; filter Today by category on the watch.

### Freeze (the last stretch before the sailing)

Re-sync with the sailing's published schedule, full test on the watch, bug fixes only.

### Later (v2+), not in v1.1

Back-to-the-ship distance/direction (phone GPS pin dropped when going ashore), a
quick "remind me in N minutes" timer, lap counter, spending log, currency
conversion (not needed for this itinerary), Celebrity support.

**Ship GPS** (idea from the owner, 2026-09-24; the routes on directory place pages
moved into v1.1, see "Ship GPS" above): pick a starting place and a
destination on board and get step-by-step directions that account for stairs
and elevators (which bank to use, walking down being easier than up). It would
build on the venue table's decks, fore/mid/aft and entrance lists, plus a map of
the stair and elevator banks per ship.

**Offline voice questions** (idea, researched 2026-09-24): ask the watch a
simple question such as "how do I get to my cabin from the Windjammer". Uses the
Dictation API with the Pebble app's on-phone speech recognition, keyword-matched
against the venue table and directory. Needs an airplane-mode test on Android and
iOS first. See `docs/FUTURE_VOICE_QUERIES.md`.

**Native Android companion app** (asked 2026-09-26; decided to stay on PebbleKit
JS until after the sailing): voice dictation goes through the Pebble app either
way, copy-in-parts covers the usage log export, and it would be a large rebuild
with unconfirmed support for third-party PebbleKit Android apps in the new Pebble
app. Revisit for v2 after two cheap probes: dictation in airplane mode, and
whether the Pebble app accepts a PebbleKit Android companion.

### Future concepts (no timeline)

Ideas kept for later with no version or date attached.

**Hydration reminders** (in v1.1 Phase 3 with sun reminders until the owner
moved them here on 2026-09-26): a toggle and interval (default 60 min:
45/60/90), on or off per day with defaults by day type, within waking hours
(default 8:00–22:00). They could share the sun reminders' scheduling (only the
next reminder kept as a wakeup).

### Out of scope

Logging in from the phone app, live data onboard, messaging between phones,
app glances, a watch face.

## Edge cases to handle from the start

Itinerary changes (skipped/added ports) editable offline; overnight port stays;
tender ports (larger buffer); placeholder times; events spanning midnight; the
schedule changing onboard vs the pre-cruise version; an empty schedule before
publication.

## To verify early

- Pebble Time 2 platform details in the current SDK (screen assumed 200×228,
  64-color palette; platform name).
- Wakeup/reminder limits.
- Offline settings page approach works in the current Pebble phone app (iOS and
  Android).
- Ship-time behavior at St. Thomas (onboard).
- What the logged-in order history actually contains. Answered (Sept 2026, with
  `tools/cruise-sync/explore_account.py`): a guarantee booking lists stateroom
  "GTY"; packages have no date or time; a **booked shore excursion carries its
  date, time, cruise day and port**, and its product page adds meeting and end
  times. The sync tool now copies these into `mine` (`docs/DATA_FORMAT.md`);
  showing them in the app is not scheduled yet. Details and candidate uses:
  `docs/ROYAL_LOGIN_DATA.md`. Still to check: dining and show bookings, and
  what `gangwayUp` means (compare with the Daily Planner on board).
- Logging in from the phone app stays out of scope for now (decided Sept 2026).
  Revisit only if timed orders turn out to carry usable times: the password
  would pass through the Pebble app's settings-page return, and the phone can't
  mimic a browser if Royal blocks it. Until then the Windows tool is the login
  path. (Excursion orders do carry times, as of Sept 2026, so this is now the
  owner's call; unchanged until decided.)

## Testing

Schedules exist only for sailings about two weeks out, so develop against any
Harmony (HM) sailing currently within that window, e.g. run
`py tools/cruise-sync/cruise_sync.py --ship HM` and pick the nearest date. Re-test
with the owner's sailing once its schedule appears.
