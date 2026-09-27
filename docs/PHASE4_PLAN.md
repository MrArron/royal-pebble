# Phase 4 plan: Event data

Planned 2026-09-27 with the owner. Phase 4 of v1.1 (`docs/PROJECT_BRIEF.md`),
after Phase 3's items 25-28; Voice is now Phase 5 and Planning Phase 6. App
versions start at 1.4.0.

The plan comes from a probe of Royal's public products listing for Harmony of the
Seas, sailing 2026-10-01 (a 2-night Port Canaveral - CocoCay trip, pulled 4 days
out): 314 products (NON_REVENUE_SCHEDULABLE 159, SPA 108, SHOREX 30, DINING 9,
ACTIVITIES 6, ENTERTAINMENT 2). The schedule keeps 167 of them as 212 events and
drops none, but Royal sends much more per event than we keep. Brief items 32-39
map to the sections below.

| Brief item | Section |
| --- | --- |
| 32 | 1. Venue codes |
| 33 | 2. Age limits and the age filter |
| 34 | 3. Arrive-early times |
| 35 | 4. Short descriptions and 6. What-to-bring notes |
| 36 | 5. Stable ids for re-sync |
| 37 | 7. Shore excursions: selectable, with meeting times |
| 38 | Advanced download with your Royal login |
| 39 | Windows sync tool (PC) |

## Summary

All seven event items fit in 7 app PRs (1.4.0 to 1.4.6) and a docs PR, plus a
PC-tool-only PR and an optional login track (probe, docs, 1.4.7). Nothing needs a
format version bump: every new field is additive, like `paid` and `price` were.

- **No new requests to Royal.** Every field comes from the products listing both
  producers already download. Item 7 even saves a request per booked excursion.
- **One watch protocol change.** Packed events gain 4 bytes (minimum age, maximum
  age, arrive-early minutes, note tags) and alarms gain 1 (arrive-early). This
  covers items 2, 3, 4 and 6 on the watch with no free text in the watch's memory.
- **Stars stay keyed as today.** Item 5 uses Royal's product ids only to tell
  reschedules apart on re-sync, so saved stars need no migration.

Decisions (owner, 2026-09-27):

1. **New Phase 4: Event data**, holding these items. Voice moves to Phase 5 and
   Planning to Phase 6.
2. **Age filter: yes.** Filters get entries for adults-only and for
   teen/kids-only events (item 2).
3. **Shore excursions become selectable** on the settings page, like Booked
   activities (item 7).
4. **Product id check on 2026-09-30** (re-pull the same sailing); it gates PR H.
5. **Advanced download with Royal login** is in scope, gated on a phone probe.
   It reverses "no login in the phone app".

## Where the work lands

Events travel Royal `v3/products` → producers → bundle → phone (`slice.js`,
`venues.js`) → packed events → watch. The settings page reads the same bundle.

| Part | Files | Items |
| --- | --- | --- |
| Producers | `tools/cruise-sync/cruise_sync.py` `fetch_schedule`, `src/pkjs/royal.js` `addProducts` | 1-7 |
| Sync tool, login path | `cruise_sync.py` `fetch_mine`, `offering_times` | 7 |
| Venue table | `src/pkjs/venues.js` (HM rows and aliases) | 1 |
| Slice and alerts | `src/pkjs/slice.js` (`buildEvents`, reminders, `reconcileStars`), `src/pkjs/pack.js` | 2, 3, 5, 6, 7 |
| Settings page | `src/pkjs/config.js` (event rows, Filters, Booked activities, `starKey`) | 2, 3, 4, 6, 7 |
| Watch | `src/c/codec.c`, `data.h` (`Event`), `details_window.c`, `store.c`, alert screen | 2, 3, 6 |
| Docs | `DATA_FORMAT.md`, `WATCH_PROTOCOL.md`, `PROJECT_BRIEF.md`, `DESIGN_PHASE4.md` (new) | all |

Limits that shape the plan:

- **Consumers read events by field name** (`sched.fields.indexOf`), so appending
  fields is safe for older bundles and older code.
- **Packed event flags are full**: all 8 bits of `flags` are used (128 = booked),
  so new watch data needs new bytes.
- **Watch memory and storage**: up to 160 events per slice, and saved slices are
  capped (`saved_max`). Free text per event is too costly; small numbers and bit
  tags are not.
- **Bundle size**: the 2026-10-01 schedule is 17 KB for 212 events (82 bytes
  each). A 7-night sailing is roughly 1,000+ events, about 85-90 KB today.

## Bundle format changes (v stays 1)

All additions are optional: a bundle without them is still valid and behaves as
today. Both producers and `docs/DATA_FORMAT.md` change in the same PR.

| Where | New field | Value | Item |
| --- | --- | --- | --- |
| `schedule` | `venueCodes` | Array beside `venues`: Royal's `locationCode` per venue, or `null` | 1 |
| `schedule` | `notes` | Shared table of `[id, text]`: advisements, restrictions and useful short descriptions, boilerplate dropped | 4, 6 |
| `schedule` | `infos` | Shared table of `[age, early, noteIndexes]` combinations. `age` = `[min, max]` years (either may be `null`) or `null`; `early` = minutes to arrive before the start | 2, 3, 4, 6 |
| `fields` + events | `info` | Index into `infos`, or `null` when the event has none | 2, 3, 4, 6 |
| `fields` + events | `pid` | Royal's `productID` (the activity, the same for every session), or `null` | 5 |

Venue indexing changes from name to name + code, so the wine tasting (code
`VINT`, blank title) gets its own venue entry instead of sharing `""`.

**Boilerplate dropped from notes:** "Images are illustrative only", "This
activity has a fee" / "Fee applies" (already `paid`), and any text over 120
characters (the FlowRider legal paragraph). On 2026-10-01 that leaves 57 notes.

**Size:** measured on 2026-10-01, these fields add about 8.6 KB to a 17.5 KB
schedule (+49%): notes and infos 5.0 KB, `pid` 3.0 KB, `info` 0.5 KB. Sharing one
`infos` row across sessions keeps it small, since most products have identical
notes on every session. A 7-night bundle would grow from about 90 KB to about
135 KB, plus excursion sessions (item 7). Check this against the paste-in path
before shipping (Open questions).

## 1. Venue codes

The phone matches an event's venue by Royal's code first, then by name as today.
The watch doesn't change. Size: small, phone only.

- **Producers:** record `locationCode` per venue into `venueCodes`. Index venues
  by name + code.
- **Venue table** (`venues.js`): add a `codes` list per ship, `[code, table
  name]`, for the 42 codes seen on 2026-10-01 (`PROM` → Royal Promenade,
  `RYLTHTR` → Royal Theater, `ICE_AL` → Studio B, `VINT` → Vintages, and so on).
  The venue lookup tries the code, then the name and aliases. An unknown code
  falls back to the name, so nothing gets worse.
- **Blank titles:** an event whose venue title is empty but whose code is known
  shows the table name (the wine tasting shows Vintages).
- **Conflicts:** where the code and name point at different table venues, add an
  entry to `tools/shipmap/conflicts-HM.json` instead of picking one. Candidate:
  `SILK` is titled "Main Dining Room 5".
- **Tests:** `venues.test.js` (code wins over name, unknown code falls back, blank
  title filled); `slice.test.js` for the `where` bytes of a code-only venue.
- Codes seen on one sailing may not cover every venue, so re-run the dump
  (`--dump-products`, PR K) on the owner's sailing once its schedule is out and add
  any new codes.

## 2. Age limits and the age filter

Events with an age limit show it (`Ages 18+`, `Ages 13-17`), and two new Filters
let a couple hide kids' and teen events, or a teen hide adults-only ones. Size:
medium, because it opens the watch protocol change that items 3 and 6 share.

- **Producers:** `age` comes from, in order:
    - `restrictions[]` of type `age` ("Minimum 18 years old" → `[18, null]`,
      "Maximum 17" → `[null, 17]`, "13 to 17 years old" → `[13, 17]`);
    - `experiences[]` age entries (`ages/age18` → `[18, null]`; `ages/funforall` →
      none);
    - the alcohol advisement `kbyg/general/over21` → `[21, null]`;
    - title and venue patterns: `(18+)`, `Adults (18+)`, `(17 & Under)`,
      `(Ages 13-17)` (Social100), and kids' venues (Adventure Ocean).
    - If several apply, keep the tightest. Height, weight and wristband limits go
      to notes (item 6).
- **Filters** (settings page, Filters tab, beside the Casino category from
  Phase 3 item 27):
    - **Hide adults-only events (18+ and 21+)**, for a teen's watch. It hides adult
      parties, drinking events and adult game shows. Casino games are covered by
      the Casino category, and turning both on hides everything a teen can't join.
    - **Hide teen and kids-only events** (any event whose `age` has a maximum of
      17 or under), for adults cruising without kids.
    - Both are off by default and work like hidden categories. They apply to
      lists, Today, search and the morning summary counts. Starred and booked
      events always go to the watch, as today. An event with no age data is never
      hidden.
- **Watch protocol** (`WATCH_PROTOCOL.md`, Packed events): add 4 bytes after
  `where` on every event: `age_min` and `age_max` uint8 (0 = none), `early` uint8
  (item 3) and `tags` uint8 (item 6). The `Event` struct grows by about 640 bytes
  for 160 events. Saved slices grow the same, so re-check `saved_max` headroom on
  a busy sea day.
- **Watch:** `codec.c` decodes the bytes; `details_window.c` adds an `Ages 18+`
  line under the time. Filtering happens on the phone, so the watch needs no
  filter code.
- **Settings page:** the age text after the venue in event rows; the two filter
  toggles.
- **Tests:** a producer test for each wording and pattern seen; `slice.test.js`
  for the new bytes and for both filters (starred events kept, no-age events
  kept); emulator screenshot of an 18+ event's details.

## 3. Arrive-early times

Events that ask you to come early show `Arrive by 7:45p` on the details, and a
starred one's reminder counts down to that time instead of the start. It works
the same way booked excursions already use their meeting time. Size: medium.

- **Producers:** `early` comes from, in order:
  `productDuration.leadTimeInMinutes` when above 0 (Voices 15, The Fine Line 10,
  Escape Room 10); then a number in an advisement: "Arrive 15 minutes early",
  "Sign up at the venue 15 minutes before". "Doors open 45 minutes prior" and
  "seats released 10 minutes prior" are facts, not arrive-by times, so they stay
  notes. "Early arrival is recommended" has no number, so it becomes a tag (item
  6). Cap `early` at 120.
- **Alerts** (`slice.js`, `WATCH_PROTOCOL.md` Alerts): a starred event's reminder
  fires `reminder_lead` minutes before start − `early`. The alarm carries `early`
  in one new byte so the alert screen can show `Arrive by`. Clash warnings and
  "From" directions keep using the start.
- **Watch:** details line `Arrive by 7:45p`; alert screen line the same. Uses the
  `early` byte from item 2's protocol change.
- **Settings page:** `Arrive 15 min early` in the event row.
- **Tests:** producer precedence (lead time beats text); reminder time with and
  without `early`; real-time alert test in the emulator with the alert-test
  variant (don't jump the clock).

## 4. Short descriptions and meeting spots

Keep a short description only when it says more than the title, and show it on the
settings page. On 2026-10-01 only 1 of 19 held a meeting spot, so this is the
smallest item and rides along with item 6. Size: small.

- **Producers:** keep `productShortDescription` as a note (id `short`) when it
  isn't the title in other words: after lowercasing and dropping punctuation, it
  has a word or a parenthesis the title lacks. On 2026-10-01 that keeps "Dance
  Fitness with your Cruise Director's Staff ... (Meet by the Car)", "Seminar: Burn
  Fat Fast" and "...Competition: Sign Ups", and drops the 16 that just restate the
  title.
- **Meeting spot:** text in parentheses starting with "Meet" sets tag 128 (item
  6), which the watch shows as "Meeting spot on phone". The watch keeps no free
  text per event, so the spot itself appears only on the settings page.
- **Tests:** producer keep/drop on the 19 examples (public data, fine in a
  fixture).

## 5. Stable ids for re-sync

Use Royal's product id to match a starred event to its rescheduled session on
re-sync. Stars stay keyed by title + date + time + venue, so nothing saved needs
migrating. Size: small, but gated on a check.

**What the data showed:** 168 of 212 session ids embed the start time
(`1777304207326.HM.HM20261001.20261002T220000`). A rescheduled free activity would
get a new session id, so session ids can't follow a move. The product id
(`productID`) is the same for every session of an activity, so that's the one to
use.

- **Producers:** `pid` per event (the format table above).
- **Re-sync** (`slice.reconcileStars`, `DATA_FORMAT.md` rules): when a starred key
  is gone, look for new events on the same watch day with the old event's `pid`
  (from the old bundle, which `useBundle` already loads). Fall back to today's
  same-title rule when either bundle has no `pid`. The "exactly one" and "several:
  drop and tell" rules stay.
- **What it fixes:** a title reworded between pulls still follows its star. Two
  different products with the same title (2026-10-01 had 2: Guitar Melodies With
  Jabes, Shock Waves LIVE!) are no longer confused. A show that runs twice is still
  ambiguous, as today.
- **Gate:** re-pull the same sailing on 2026-09-30 and compare `productID` by title
  with the 2026-09-27 pull. If ids change between pulls, drop this item.
- **Tests:** `slice.test.js` cases for renamed title, same-title different
  product, and the no-`pid` fallback.

## 6. What-to-bring notes

The settings page shows each event's full notes. The watch shows up to eight fixed
tags, sent as one byte, which the phone works out from the notes. Size: medium,
shared with item 2's protocol change.

- **Producers:** fill `schedule.notes` from `advisements[]` (id + title), non-age
  `restrictions[]` and item 4's short descriptions. Drop the boilerplate listed in
  the format section. Also note `isWaiverRequired`.
- **Phone → watch tags** (`slice.js`). Royal's ids are inconsistent (two
  different SeaPass ids on one sailing), so match by id and fall back to keywords:

| Bit | Watch text | Matches on 2026-10-01 |
| --- | --- | --- |
| 1 | Bring SeaPass | `kbyg/general/seapass`, `kbyg/seapass` (28) |
| 2 | Weather permitting | `kbyg/general/WEATHER` (14) |
| 4 | Sign up at venue | sign-up / signups ids (5) |
| 8 | Waiver needed | `legal/waiver`, `kbyg/signedwaiver`, `WARNDISCLAIM`, `isWaiverRequired` |
| 16 | Athletic shoes | sneakers, athletic, closed-toe, no Crocs (9) |
| 32 | Swimwear or active wear | `attire/bathing`, `Activeattire`, dry clothes (4) |
| 64 | Limited spots, come early | limited spots/seating, first-come, early arrival with no number (12) |
| 128 | Meeting spot on phone | item 4 |

- **Watch:** one extra line on event details joining the tags (`Bring SeaPass ·
  Weather permitting`), after the age and arrive-by lines. The page already
  scrolls. Lists don't change.
- **Settings page:** notes under the event row, collapsed behind a "Notes" toggle
  on busy days.
- **Tests:** tag mapping from ids and from keywords; emulator screenshot of a
  details page with 3 tags, light and dark theme.

## 7. Shore excursions: selectable, with meeting times

Shore excursions join the schedule as paid sessions. Anyone can pick theirs on the
settings page, login or not, and the watch shows them with the meeting time. The
sync tool also uses the public meeting time for booked orders. Size: medium, phone
and sync tool.

**Selectable excursions (phone and sync tool)**

- **Producers:** add `SHOREX` to the kept product types in both producers, with
  `paid` = 1 and category `Shore excursions`. `early` (item 3) = start −
  `meetingTime`, so the watch shows `Meet 7:45a` through the arrive-by path. This
  reverses the "excursions are booking slots" line in `DATA_FORMAT.md`; spa and
  dining stay out.
- **Settings page:** Booked activities becomes **Booked activities and
  excursions**, with excursions grouped under their port day. Picking a session
  stars it and marks it reserved, like a paid class. Unpicked sessions stay off the
  watch.
- **Slice:** a picked excursion is placed at the day's port with `where` Ashore,
  like booked orders. If login data has the same excursion (`mine.orders`, same
  title, date and time), only the booked version goes, so it never shows twice.
- **All-day rentals** (beach beds, cabanas, day passes: 15 of 53 sessions on
  2026-10-01, 0 minutes) show as untimed on their day, with the listed time as the
  meeting time.
- **Size:** 2026-10-01 adds 53 sessions (+25% events). A 7-night sailing with 4
  ports could add about 150-250. Only picked ones reach the watch, so the 160-event
  cap isn't affected.

**Booked orders' meeting time (sync tool)**

- **Today:** `fetch_mine` calls `offering_times` (commerce catalog, logged in)
  once per timed order to get `meet`, `end` and `minutes`.
- **Change:** fill `meet` from the public SHOREX offerings first, matched by
  cleaned title, date and time (more than one match: none). Call the catalog only
  when `end` or `minutes` is still missing. That saves requests, in line with "be
  gentle with Royal's servers".

**Tests:** producer tests for SHOREX rows and `early` from `meetingTime`;
`slice.test.js` for picked excursions, dedupe against `mine.orders` and all-day
rentals; `test_cruise_sync.py` for the meet fallback; settings page test for the
renamed section.

## PR sequence

Phase 4 starts at 1.4.0 after Phase 3's items 25-28. Each app PR bumps
`package.json` and `APP_VERSION` in `src/pkjs/log.js` together.

| # | Version | Items | What changes | Tested on |
| --- | --- | --- | --- | --- |
| A | none (docs) | all | `DATA_FORMAT.md` fields and the excursions change; `WATCH_PROTOCOL.md` 4 event bytes + 1 alarm byte; watch mockups in a new `DESIGN_PHASE4.md` | review |
| B | 1.4.0 | data for 1-7 | Both producers write `venueCodes`, `notes`, `infos`, `info`, `pid` and keep SHOREX; shared fixture trimmed from the 2026-10-01 pull | `test_cruise_sync.py`, a producer test in `test/pkjs`, live pull of a sailing within 2 weeks |
| C | 1.4.1 | 1 | Venue codes in `venues.js`, code-first lookup, blank titles filled, conflicts entries | `venues.test.js`, `slice.test.js` |
| D | 1.4.2 | 2, 4, 6 (+3 display) | Packed events +4 bytes; watch details lines; settings page rows | Node tests, emulator screenshots, then the Pebble Time 2 |
| E | 1.4.3 | 2 | The two age filters | `slice.test.js`, `settings.test.js` |
| F | 1.4.4 | 3 | Reminder at arrive-by time; alarm byte; alert screen line | Real-time alert-test variant in the emulator, then the watch |
| G | 1.4.5 | 7 | Selectable excursions; sync tool meet fallback | Node tests, `test_cruise_sync.py`, one `--login` run on the owner's booking |
| H | 1.4.6 | 5 | `pid` in `reconcileStars` | `slice.test.js`; only if the 2026-09-30 check passes |
| K | none (PC tool only) | checks | `--dump-products` (Windows sync tool section) | `test_cruise_sync.py`, one live run |
| — | throwaway | login | Phone sign-in probe (not merged): passed 2026-09-27 | the owner's phone |
| I | none (docs) | login | `DATA_FORMAT.md`, page text | review |
| J | 1.4.7 | login | Advanced download block, `royal.fetchMine`, log guards | Node tests with made-up bookings, then the owner's real account on the phone |

- **B comes first:** the new fields must exist in both producers before anything
  reads them. B alone changes nothing a user sees; excursion sessions stay hidden
  until G.
- **D is the only watch C change** apart from F's alert line. It adds no
  `messageKeys`, so no `pebble clean`. New decode code must avoid `strtol()` and
  `strlen()` and run on the real watch, not just the emulator.
- **K can go any time.** The login track (probe, I, J) is independent and can run
  alongside C-H once the probe passes.

## Windows sync tool (PC)

The PC tool (`tools/cruise-sync/cruise_sync.py`) stays the reference producer. It
gets every new field in the same PRs as the phone, and a shared test fixture makes
both produce the same schedule. It needs no new downloads from Royal: everything
comes from the products listing it already pulls, and item 7 cuts requests on
login runs.

| PR | Change in the PC tool | Items |
| --- | --- | --- |
| B | `fetch_schedule` writes `venueCodes`, `notes`, `infos`, `info` and `pid`, and keeps SHOREX sessions (`paid` 1, category `Shore excursions`, `early` from `meetingTime`). New helpers `age_of`, `early_of`, `notes_of`; the boilerplate list, age patterns and tag keywords sit beside `SCHEDULE_TYPES` with a "keep in step with `src/pkjs/royal.js`" note | 1-7 |
| B | Console summary gains a line: `212 events (53 shore excursion sessions): 23 with age limits, 8 arrive early, 95 with notes`. The size line warns when the bundle is over the paste limit found on the owner's phone (Open questions) | all |
| B | Shared fixture: `test/fixtures/products-HM-sample.json` (about 30 public products trimmed from the 2026-10-01 pull, one per case) and `expected-schedule.json`. `test_cruise_sync.py` and a Node test both check their output against it, so the two producers can't drift | all |
| G | `fetch_mine` fills `meet` from the public SHOREX sessions first and calls the logged-in catalog only for a missing `end` or `minutes` | 7 |
| K | `--dump-products`: saves the raw listing and a field report as `royal-pebble-products-*` (git-ignored), for the 2026-09-30 and later re-runs | 5, checks |
| J | No change to the PC tool; `royal.fetchMine` copies `fetch_mine`, with its own shared fixture of a made-up booking so both give the same `mine` | login |

- **Old and new mix safely.** A new bundle pasted into an older app version is
  fine: consumers read fields by name and ignore the rest. An old bundle in a new
  app shows no age, notes or excursions until the next sync.
- **Unchanged:** `sync.bat`, `sync-with-login.bat`, `install.bat`,
  `requirements.txt` and `explore_account.py`.
- **README** (`tools/cruise-sync/README.md`): a short "What's in the file" list
  (ages, arrive-early times, notes, shore excursions), the `--dump-products`
  option, and a note that shore excursions are picked on the phone's settings page
  after pasting.
- **Tests:** the shared-fixture checks; `test_cruise_sync.py` cases for each helper
  (restriction wordings, lead time over advisement text, boilerplate dropped,
  SHOREX `early`); the existing `test_gentle_requests` extended to show a login run
  with public meeting times makes fewer catalog calls. A live run against a sailing
  within 2 weeks before each PR merges.

## Advanced download with your Royal login

It looks doable: the settings page takes the email and password for one download,
the phone script signs in to Royal and fetches `mine`, and nothing is kept. It
needs a real-phone probe first, because Royal could block the phone where it
doesn't block the Windows tool.

**Checked 2026-09-27**

- **Royal's sign-in accepts a plain client.** One sign-in request with a made-up
  account, from a plain Python client (no browser impersonation), got Royal's
  normal "Login failure / invalid_grant" reply (400), not a 403 block. Promising,
  but a phone's network stack looks different, so it isn't proof.
- **The settings page can't call Royal itself.** The sign-in reply has no CORS
  header, and the page is a `data:` URL, so a browser would refuse it. The phone
  script already calls Royal for Download, so the sign-in has to go there too.
- **The only way from page to phone script is the close URL**
  (`pebblejs://close#` + the result). So the password passes through the Pebble
  app once, in memory, when the page closes. The page's text below says so.

**How it would work**

1. Download tab: a new block under Download, **"Advanced download using your Royal
   login to pull your bookings/information automatically."** Email and password
   fields (password masked, autocomplete off) and a **Download with login**
   button.
2. The page closes with action `download-login`, the email and the password.
   Nothing is saved in the page.
3. `index.js` passes them straight to a new `royal.fetchMine` (a JS port of
   `cruise_sync.fetch_mine`: sign-in, bookings, voyage details, order history,
   order details, and the catalog only when item 7's public data lacks a time).
   The password is dropped as soon as the sign-in request is sent; the token lives
   only until the download ends.
4. The result is the same `mine` object the sync tool makes, saved with the
   bundle. `DATA_FORMAT.md` changes one line: `mine` can now come from the phone
   too.
5. Guards: the usage log records only "login download: ok / failed (status)",
   never the email, password, token or replies. `guard()` error text and
   `diffSettings` must skip these fields. Tests check that none of them reach
   `localStorage` or the log.

**What users are told (draft, under the button)**

> Your email and password go from this page to Royal Pebble's phone script inside
> the Pebble app, and from there only to Royal Caribbean, to sign in for this one
> download. Royal Pebble doesn't save them, doesn't put them in the usage log, and
> never sends them anywhere else. Royal sends back your booking details
> (stateroom, deck, muster station, terminal time, booked excursions and
> purchases); those are saved on this phone and your watch like the rest of your
> cruise data. You'll type your login again next time you sync if you wish to keep
> your data synced with Royal's. This uses Royal's website sign-in, which Royal
> could change without notice; if it stops working, use the Windows sync tool.

**Probe: passed on 2026-09-27.** The throwaway RP Probe app (round 2, repo
`MrArron/rp-webview-probe`) ran on the owner's Android phone and Pebble Time 2.
It recorded only status codes, timings, yes/no checks and a count:

- [x] **Sign-in from the phone script:** 200 in 753 ms (no 403). The token came
  back and its account id was readable. The bookings list then answered 200 in
  420 ms and could be read. The requests used the same headers as `cruise_sync.py`,
  without its browser `User-Agent`, which a phone script can't set anyway.
- [x] **The password survives the close URL.** A password and a test string with
  `#`, `&`, `%`, `+`, `=`, `?`, `/`, an accented letter and an emoji all arrived
  unchanged.
- [x] **No password manager prompt.** LastPass didn't offer to save the password
  from the page's masked field.
- [ ] Not checked: iPhone (the owner has none), and whether the Pebble app's own
  logs hold the close URL. The page text already says the login passes through
  the Pebble app.

So the login track goes ahead.

**PRs:** a docs PR (`DATA_FORMAT.md`; the page text), then one
app PR for the page block, `royal.fetchMine` and the log guards, with offline tests
using made-up bookings and cabin numbers.

## Open questions and risks

- [ ] **Product id stability:** re-pull on 2026-09-30. It gates PR H.
- [x] **Paste-in size: no problem (2026-09-27).** A 7-night bundle may grow from
  about 90 KB to about 135 KB, plus excursion sessions. On the owner's Android
  phone, RP Probe sent made-up bundles of 128, 192, 256, 512 and 1,024 KB back
  through `pebblejs://close#` (1,675 KB in the URL), and every one arrived whole.
  The page's own size is a separate limit of about 1.8 MB (`PROJECT_BRIEF.md`).
  Only the emulator caps results at about 64 KB, so test big pastes on the phone.
- [ ] **The Pebble app decodes the result itself.** On the phone, `e.response`
  arrives already URL-decoded. `settingsClosed` in `index.js` tries
  `decodeURIComponent` first, which throws on most decoded text and falls back
  to a plain parse. But text holding a valid escape (a note with `%41`, say)
  would be decoded twice and changed. PR B, which puts Royal's notes in the
  bundle, should parse the plain text first and decode only when that fails.
- [ ] **Watch storage.** 4 more bytes per event and 1 per alarm. Check
  `saved_bytes` against `saved_max` on the busiest day of a 7-night sailing after
  PR D.
- [ ] **One short sailing.** All numbers come from a 2-night trip 4 days out.
  Re-run the dump on the owner's sailing once its schedule is out (about two weeks
  before) for more venue codes, notes, age wordings and excursions.
- [x] **Login probe on the owner's phone** passed on 2026-09-27 (Advanced
  download with your Royal login), so the login track goes ahead.
- [ ] **Time before the sailing.** Phase 3 items 25-28 plus this phase is a lot
  before the freeze. If it gets tight, B-E and G are the ones that matter most on
  board.
