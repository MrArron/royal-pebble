# Royal Pebble — Plan to the sailing

The one active plan, as of 2026-10-01 (app 1.5.13). What is built is in
`PROJECT_BRIEF.md`; screens are in `DESIGN.md`. Update this file as work lands
and delete what's done once it's in the brief.

## 1. Timeline to the sailing

Counted in weeks before the owner's sailing (about 10 weeks out as of
2026-10-01). Schedules publish about two weeks before sailing, which starts
the freeze.

| Weeks before sailing | Work |
|---|---|
| 10 - 9 | Phase 6 P1 (Bring view); Phase 5 V6 tuning sessions start |
| 9 - 7 | Phase 6 G1 (two dining pulls on one sailing), P2 |
| 7 - 5 | Phase 6 P3 (or the typed fallback only, if G1 fails) |
| 5 - 4 | Phase 6 P4, after the last Phase 5 watch change; one evening on the watch |
| 4 - 3 | Phase 5 V6 tuning ends; spare for fixes |
| last 2 | **Freeze** (§5) |
| 0 | Sailing (the test cruise) |

If P4 slips past 3 weeks out, drop it: P1 still covers item 17 without the watch.

## 2. Watch size budget

`python3 tools/watch_size.py` after `pebble build` (fails over the 62 KB
budget; put its first lines in every watch PR). Last measured on the Sep 29
build (1.5.5 C code; no watch C has changed since, 1.5.6-1.5.13 were
phone-only):

| | Bytes |
|---|---|
| Static (`.text` 60,921 + `.data` 172 + `.bss` 712) | **61,984** |
| Room to the 62 KB budget (63,488) | **1,504** |
| Room to the hard limit (65,535) | 3,551 |
| Heap at launch | 69,088 |

- **Rule until the sailing:** Phase 6 watch code may use at most 600 B, so
  about 900 B stays for Phase 5 tuning and freeze fixes. Prefer phone and
  settings-page work wherever it serves the owner as well.
- Re-measure after a fresh `pebble clean && pebble build` before any watch PR.
- Size anchor: the 1.4.8 My info dining row (one row, one message key, one
  stored string) cost about 200 B. LTO inlines most screen code, so
  per-function sizes can't be read from the ELF.
- If room runs out: `PROJECT_BRIEF.md`, Measurements and limits (what was done,
  what's in reserve, what isn't worth it).

## 3. Phase 5 (voice): what's left

V1-V5 are done (1.5.2-1.5.13). Left:

- **V6, tuning on the watch (owner).** Home dictation sessions with the phone
  in airplane mode: each hard name (Izumi, Hublot, Solera, Boleros, Studio B,
  ...) 3-5 times, plus the 50 hold-out phrases. Share the usage log; its
  `voice` lines show what was heard and matched. Each miss becomes an
  `observed: true` form in `tools/voice/venue-mishearings-HM.json` (rebuild with
  `node tools/voice/build_voice.js`) and a corpus line with a made-up cabin;
  fix what breaks. Phone-only fixes cost no watch bytes.
- **Versions:** Phase 5 tuning PRs that land after Phase 6 starts take the next
  1.6.Y (open question 4).

## 3a. Round 2 (gabbro) phase

**Comes before the rest of Phase 6:** the .pbw targets only the Time 2 today,
so the app does not install on a Pebble Round 2 at all.

**Goal:** the same app and the same .pbw run well on the Pebble Round 2
(260x260 round, about 184x184 usable square), worn by a second person for the
whole sailing. In scope: every watch screen on the round display, phone text
that fits it, build / size / screenshot tooling for both platforms, a
real-hardware soak before the freeze, and matching Time 2 style updates
(G6a). Out of scope: touch, new features, store publishing.

**Approach:** one codebase, two binaries. `gabbro` joins `targetPlatforms`;
per-platform layout numbers live in `layout.h` behind `PBL_ROUND`; round-only
code sits under `#ifdef PBL_ROUND` (costs the Time 2 nothing); `ui.c` row,
header and footer helpers learn the round rules once; the phone reads
`Pebble.getActiveWatchInfo().platform` and sends shorter text for gabbro.
Round rules and mockups: `docs/mockups/round/` (`NOTES.md`). Home's timeline
becomes an arc along the bottom edge.

| # | What | Exit check |
|---|---|---|
| G0a | SDK in WSL has gabbro and its emulator boots | Tooling ready |
| G0b | Throwaway build with `gabbro` added; screenshot every screen; gabbro size and RAM | Baseline |
| G0c | When the Round 2 arrives: install through the second wearer's Android phone (share her data first) | Install route works |
| G1 | Round mockups in `docs/mockups/round/` (done) | Owner approved; arc chosen |
| G2 | `gabbro` target, `pebble-dev.json`, `watch_size.py` for both, `layout.h`, round-aware `ui.c` helpers, screenshot script | Nothing clipped on gabbro; Time 2 walk unchanged. **Usable build; this is what sails if later stages slip** |
| G3 | Home: centered time and next event, timeline arc | Mockup match; Time 2 unchanged |
| G4 | Alerts and notices | Alerts fire on time on the gabbro emulator |
| G5 | Directory and Route | Longest real step fits; 5-level directory walk |
| G6 | My info, voice card, On board?, phone-away, dictation failed | 4-row card fits; long TRY text wraps |
| G6a | Time 2 matching style: rounded selection pill, right-edge scroll bar on long pages, time-ashore bar on the all-aboard alert (shared `ui.c` helpers) | Mockup match on the Time 2; under the 62 KB budget; cost stated in the PR |
| G7 | Phone: per-platform text budgets for route lines, card rows, hints; tests for both | No fixture string over budget |
| G8 | Soak on the Round 2 from arrival to the freeze: alerts, routes, a dictation session, both themes, usage log shared back | No crashes; hardware-only faults fixed |

Stages before G0c and G8 run on the gabbro emulator until the Round 2 arrives.
G7 can run alongside G3-G6. Phase 6 items pick up only after G6.

**Size rules:** every watch PR puts `watch_size.py` first lines for both
platforms (before / after) in its description, and both pass the 62 KB budget.
The Time 2 (emery) binary may grow at most 50 B per PR; G6a is the one
exception and states its cost up front. Gabbro's limits are assumed to match
the Time 2's until G0b measures them.

**Versions:** the first app-changing Round 2 PR starts the next minor version;
docs-only PRs don't bump.

## 4. Phase 6: Planning

App versions start at 1.6.0. Owner decisions so far (2026-10-01):

| Brief item | Decision | Here |
|---|---|---|
| 16. Meet-up points | **Removed.** A meet-up is a personal entry (title, venue, time, reminder). | - |
| 17. Checklists | **Re-scoped:** no free-form checklists; a list or notification for starred events that carry requirements or restrictions ("Before you go"). | §4.1 |
| 18. Dining window hint | **Under consideration.** | §4.2 |
| If time allows | Brief look only. | §4.3 |

### 4.1 Item 17: events with requirements ("Before you go")

**Already built (Phase 4):** the bundle's `schedule.notes` and `infos`; the
settings page's `Notes · N ▾` toggle and `Ages 18+` / `Arrive 15 min early`;
the watch's `Arrive by`, `Ages` and up to eight tags on event details. Every
reminder already draws the details body, so a starred event's reminder shows
its tags and counts down to the arrive-by time (read in `alert_window.c`, not
yet seen on the watch with real data). The evening to-reserve alert lists
tomorrow's starred events that still need a reservation.

**Missing:** nothing gathers the requirements of several starred events ahead
of time. The reminder comes 5-30 minutes before: too late to go back for
sneakers.

| Option | Watch static | Notifies | Work |
|---|---|---|---|
| **17-A** `Bring · N` chip on the Events tab beside `★ Starred`, `To reserve`, `Clashes`: upcoming starred and booked events with notes, an age limit or an arrive-early time, grouped by day, notes open | 0 B | no | small, phone |
| **17-B** The evening alert becomes a tomorrow alert that also lists what to bring | ~150-250 B | yes, evening buzz | medium, phone + watch |
| 17-C `Bring: SeaPass · Sneakers` line on the morning and tomorrow cards (new message key, storage version bump) | ~200-300 B | no | medium, phone + watch + storage |

**Recommendation: 17-A, then 17-B; skip 17-C** (costs more and only shows if
the card is opened).

17-B in detail:

```
[Tomorrow        8:00p       AT SEA]
TO RESERVE
7:00p Hairspray
Royal Theater
BRING
9:00a FlowRider
Sneakers, waiver
```

- The phone adds an item for each of tomorrow's starred events with a
  requirement tag or an arrive-early time over 15 minutes, as alarm kind 3
  (`ALARM_TO_PREPARE`) at the same minute. Its second line is the requirement
  in short form in the alarm's 17-byte venue slot: `SeaPass`, `Weather`,
  `Sign up`, `Waiver`, `Sneakers`, `Swimwear`, `Come early`, `Meet spot`,
  `Arrive 30m early`, joined with `, ` and cut to fit.
- Up to 5 items in all (reserve items first), then `+ N more`. Fires even when
  nothing is to reserve. Its own Me tab switch under Evening reminder to
  reserve: `Also list what to bring` (on by default).
- Watch: kind 3 collected with kind 2, a `BRING` heading, top label `Tomorrow`
  when both show. No new message key, no storage format change.
- Risk: more alarms in the 24-alarm plan, all in the evening; on a busy day a
  few of tomorrow's late reminders could drop off until the next sync (the
  morning sync resends the plan).

### 4.2 Item 18: dining window hint

**Data** (one live public pull, a 2-night Harmony sailing on 2026-10-01,
pulled on embark evening):

- 9 `DINING` products, dropped by both producers today (`SCHEDULE_TYPES`).
- **My Time Dining:** product `HM_MYTMDINNER`, location `My Time Dining Room`,
  code `NVMYTIMEDINE`; bookable slots every 15 minutes, 18:45 to 21:00 both
  nights. Specialty restaurants: slots 17:00-21:00 (Izumi Hibachi to 21:30,
  Giovanni's lunch 12:30-13:15).
- **No opening or closing hours anywhere,** only slots, and they look like
  remaining availability: the first slot is not a reliable opening time; the
  last slot is more reliable (late slots sell out last), read as the last
  seating. So the hint says `Last seating 9:00p`, never `open until`.
- Unknown: whether `My Time Dining Room` is one of the venue table's Main
  Dining Room 3/4/5 or a separate room.

**Data change (no watch change):** an optional `schedule.dining` table, one row
per DINING product per date, `[name, locationCode, date, first, last, slots]`
(ship-time `HH:MM`); about 3 KB for 7 nights. Both producers in one PR with a
shared fixture; `v` stays 1.

| Option | Watch static | Seen without looking | Work |
|---|---|---|---|
| 18-A The My info dining row reads `<room> · last 9:00p` | 0 B | no | tiny |
| **18-B** A phone-made `Last dinner seating` event each evening at the last slot, at the Me tab's main dining room (or My Time Dining's own venue), flagged featured: Home's NEXT card shows it when nothing starred is next, Today lists it, details route there, Hold Select stars it for a reminder | 0 B | yes | small-medium, phone |
| 18-C A `Dining until 9:00p` line on Home or the cards | ~200-300 B | yes | medium, watch |

**Fallback typed once:** Me tab, under Main dining room: `Last dinner seating`
with `From Royal` (default when the bundle has dining data), `8:00p` to
`10:00p` in half hours, or `Off`. A typed time wins every night.

**Recommendation: 18-B with the fallback, after gate G1; 18-A can ride along;
skip 18-C.**

**Gate G1** (before P3): re-pull a Harmony sailing about two weeks out with
`py tools/cruise-sync/cruise_sync.py --ship HM --dump-products`, once when its
schedule first appears and once the day before it sails. Check: do early My
Time Dining slots appear well before sailing; is the last slot the same every
night and in both pulls; is there a dining row on embark and debark days; does
`NVMYTIMEDINE` match a table venue (conflicts go to
`tools/shipmap/conflicts-HM.json`). If the last slot isn't stable, 18-B uses
the typed fallback only.

### 4.3 If time allows

- **Free-time gaps between starred events:** a muted `Free 2:00p - 3:30p` row
  in the settings page's Starred view (0 B on the watch; on the watch it would
  be 300-500 B). Only if Phase 6 finishes early.
- **Filter Today by category on the watch:** moved to Later (needs a category
  per event on the watch, well over 1 KB).

### 4.4 PRs

| PR | What | Version | Watch static |
|---|---|---|---|
| D1 | Docs: design notes for the Bring view, the tomorrow alert and the dining line in `DESIGN.md` (this plan and the brief changes are done) | none | - |
| P1 | 17-A: `Bring · N` chip on the Events tab; Help line | 1.6.0 | 0 B |
| G1 | Dining probe on a sailing two weeks out (§4.2) | none | - |
| P2 | `schedule.dining` in both producers, `DATA_FORMAT.md`, shared fixture | 1.6.1 | 0 B |
| P3 | 18-B line, Me tab fallback, 18-A text on My info (fallback only if G1 fails) | 1.6.2 | 0 B |
| P4 | 17-B: tomorrow alert lists what to bring (`WATCH_PROTOCOL.md` alarm kind 3, `slice.js` `buildAlarms`, `alert_window.c`, Me switch, Test alerts adds one item) | 1.6.3 | ~150-250 B, ≤ 600 B |

P1-P3 are phone and PC only and can run alongside Phase 5 tuning. P4 is the
only watch PR and lands after the last Phase 5 watch change.

**Tests:** P1 settings-page logic (which events show: starred, booked,
finished left out, notes / age / early) and an emulator view. P2
`test_cruise_sync.py` and Node producer tests on the same fixture (products
with no offering, dates outside the sailing). P3 `slice.test.js`: the line at
the last slot and the Me tab's room, typed time wins, `Off`, no data and no
typed time gives nothing, a starred line keeps its star across a re-sync
(`pid` `HM_MYTMDINNER`), the day stays under 160 events; emulator Home, Today,
details, route. P4 `slice.test.js` (tags, 17-byte cut, cap of 5, fires with
nothing to reserve, switch off); real-time alert with Test alerts, both themes;
one evening on the watch.

**Not verified:** the size estimates are comparisons with the dining row and
the to-reserve screen, not builds. Dining findings are one pull of one 2-night
sailing. Alarm crowding with 17-B was reasoned from `buildAlarms`, not tested
on a busy 7-night day.

## 5. Freeze (the last two weeks before sailing)

Bug fixes only; no new features.

- **Re-sync with the published schedule** of the owner's sailing (phone
  Download, and the Advanced download for the booking); fills the real dining
  slots if Phase 6 P3 is in.
- **Main dining room:** re-run `tools/cruise-sync/explore_account.py` once the
  booking shows a dining assignment and look for it in `profileBookings` and
  the voyage data (`ROYAL_LOGIN_DATA.md`). If it's there, add it to `mine` in
  both producers and let the Advanced download fill the Me tab (`From
  booking`); otherwise it stays typed.
- **Re-run `--dump-products`** on the owner's sailing: new venue codes, notes,
  age wordings and excursions (Phase 4 data came from one 2-night sailing);
  conflicts go to `tools/shipmap/conflicts-HM.json`.
- **Watch storage:** check `saved_bytes` against `saved_max` on the busiest
  day of the real 7-night schedule (open since Phase 4 added 4 bytes per
  event); and the Ready to sail card's busiest-day count against 160.
- **Full test on the watch** with the real data: Home on each day type,
  Today, stars, the stored schedule with the phone away, alerts in real time
  (Test alerts), the morning sync, My info, directory, routes, voice in
  airplane mode, the usage log export and Map check.
- Turn on the usage log and set the device label on both phones.

## 6. After the sailing

- Review the usage log (patterns only in issues and PRs; the log never goes in
  the repo): `voice` lines grouped by outcome, observed forms into
  `tools/voice/venue-mishearings-HM.json`, voice corpus updated with made-up
  cabins.
- Apply the Map check notes: confirm entries in `conflicts-HM.json`, fix the
  overrides or the venue table, fix port/starboard in the data and remove the
  flip settings, rebuild (`tools/shipmap/README.md`).
- Tune route costs and the step length from what was walked.

## 7. Open questions for the owner

1. **17-B:** is an evening buzz for what to bring wanted, or is the settings
   page's Bring view (17-A, no watch bytes) enough?
2. **17-B wording:** heading `BRING`, top label `Tomorrow`, switch `Also list
   what to bring`. Change any?
3. **18-B:** a phone-made `Last dinner seating` line in Today and Home's NEXT
   card, or only the My info text (18-A)? Featured (shows on Home when nothing
   starred is next) or only in Today?
4. **Versions:** Phase 5 tuning PRs after 1.6.0 take 1.6.Y. OK?
5. **Later list:** keep meet-up points and free-form checklists in Later, or
   drop them?
6. **Debark night:** the old starter lists (bags out, settle account,
   passports, safe) aren't planned; personal entries cover them. Want a
   one-tap "Add debark-night entries" on the settings page (phone only)?
