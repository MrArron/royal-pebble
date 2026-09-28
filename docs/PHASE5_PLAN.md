# Phase 5 plan: voice, and making room on the watch

Draft 2026-09-28, for the owner. Written to sit at `docs/PHASE5_PLAN.md`.
Builds on `VOICE_FINAL_PLAN.md` (lexicon, parser, decisions D1-D22) and brief
item 29 (scope: Android, before the Dec 12 sailing, current PebbleKit JS setup).
Nothing in the repo has been changed.

## 1. Do we need to make room? Yes, on the watch's code budget

Measured from the current build (`build/emery/pebble-app.elf`, 1.4.6 C code,
the last version that changed the watch) with `tools/watch_size.py` (in this
folder):

| | Bytes | Limit | Room |
|---|---|---|---|
| Static (`.text` 59,950 + `.data` 804 + `.bss` 1,800) | **63,032** | **65,535** (hard) | **2,503** |
| Heap at launch (128 KB minus static) | 68,040 | - | see 1.2 |
| Resources (`app_resources.pbpack`) | 4,092 | 1 MB sideloaded | ~all of it |
| Persistent storage | as today | 1 MB (4 KB on old firmware) | voice adds none |
| Phone JS (`pebble-js-app.js`) | 539,596 | no known limit | voice adds ~50 KB raw |

### 1.1 The hard wall: 64 KB of static code and data

The Pebble Time 2 gives an app 128 KB, but code + data + static buffers can't go
over 65,535 bytes: `PebbleProcessInfo.virtual_size` is a `uint16_t`, and the SDK
build stops with "App virtual size ... must be 65535 bytes or smaller"
(`sdk/tools/inject_metadata.py` in coredevices/PebbleOS, checked 2026-09-28;
`store.c` already notes this). The watch firmware's own copy of the header
(`src/fw/process_management/pebble_process_info.h`, current main) has the same
`uint16_t load_size` and `uint16_t virtual_size`, so patching the SDK check out
wouldn't help: the firmware would read a wrapped-around size. The rest of the
128 KB can only be heap. An over-64 KB build test was considered and skipped
(owner, 2026-09-28): the limit is treated as a hard cap.

- The pending **1.4.8 My info dining room** patch adds a row, a message key and
  a stored string: about **200 B**, leaving about **2.3 KB**.
- Phase 5's watch PR (Hold Select to dictate, Ask/confirm screens, phone-away
  and dictation-failed screens, new messages, hints) is estimated at
  **2-2.5 KB** if the screens reuse existing drawing (proposal B below) and
  **4.5-6 KB** as a new stand-alone window (for scale: `route_window` is
  4.3 KB, `notice_window` 2.8 KB, `onboard_window` 2.8 KB).
- After Phase 5 come Phase 6 (meet-up points), "If time allows" (free-time gaps,
  Today filter) and freeze bug fixes, all of which need watch code.

So even the lean voice UI would use all the room left, and the dedicated-window
version doesn't fit. **Target: free 4-8 KB before the watch voice PR**, so
Phase 5 fits and 3+ KB stays for Phase 6 and the freeze.

### 1.2 The soft limit: heap during dictation (measure, don't guess)

Heap in use in normal use, estimated from the code (sizes approximate):

| What | Bytes |
|---|---|
| Events: 160 x ~116 B (`data.c`) | ~18,600 |
| Usage log queue: 800 x 16 B (`usage.c`) | 12,800 |
| Stored-slice scratch blob, kept after first load/save (`store.c`) | 10,240 |
| AppMessage inbox 2,048 + outbox 768 | ~2,800 |
| Alarms 24 x ~86 B, notices, star queue, Today rows | ~3,500 |
| Home window, layers, allocator overhead | ~2,000 |
| **Total, Home open** | **~50,000 of 68,040** |
| Directory: each open level up to 40 rows x 84 B + view | +3,500 per level (5 deep: +17,500) |

With Home open about 18 KB is free; five directory levels deep with a route on
top it's down to a few hundred bytes. The **dictation UI's own heap use is
unknown** (system screen inside the app). Voice starts from Home or a Route
screen, so the worst case is a Route screen opened from a deep directory.

## 2. Proposals for making room

Ranked by gain for risk. A-C are the recommended set.

### A. Static-to-heap and dead-code sweep (~2-2.5 KB static, low risk)

- Move the biggest static buffers to the heap, allocated when their screen
  opens: `.bss` is 1,800 B (comm 563, route window 379, store 192, data 167,
  alert window 149), `.data` 804 B (`s_tomorrow` 152, `s_info` 148, `s_day`
  104, `s_meta` 76 have initializers). A heap copy costs the same bytes, but out
  of the 68 KB side instead of the 64 KB side.
- Remove the pre-1.4 usage-log migration (`OLD_MAX_ENTRIES`, `OLD_META_SIZE`
  in `usage.c`); the watch has run the 800-entry format since then.
- Look for leftovers from earlier storage versions and unused helpers
  (`-Wno-error=unused-function` is set, so the compiler won't flag them).

### B. Build the voice screens from phone-sent rows (saves ~2.5-3.5 KB vs a new window)

The confirm screen is label/value rows (`HEARD`, `FROM`, `TO` or `YOU'RE AT`,
`TRY`) with a hint line, the same shape as My info's rows. The phone already
composes every string (VOICE_FINAL_PLAN §2), so the watch needs one generic
"card" screen: up to 4 label/value pairs + footer hint, drawn with the existing
`ui.c` row helpers. Only the phone-away and dictation-failed texts live on the
watch (the phone can't send them). Wording changes then never touch C.

### C. Link-time optimisation and `-Oz` (~3-6 KB expected, needs hardware test)

The toolchain is GCC 14.2.1 (from the ELF's `.comment`), which supports both.
Add `-flto` (and try `-Oz`) to `CFLAGS`/`LINKFLAGS` in `wscript` after
`ctx.load('pebble_sdk')`. Typical gains on `-Os` Thumb code are 5-10% of
`.text` (60 KB here). Risks: PIE relocations with LTO, and hardware-only
faults like the `strtol`/`strlen` ones, so it needs a full emulator walk and a
day on the watch before it's trusted. Easy to revert: one `wscript` change.

### D. Free the 10 KB stored-slice blob between uses (heap, low risk)

`store.c` keeps its 10,240 B scratch buffer forever after the first load or
save. It's only used during `store_load` (launch) and `store_save` (a star,
a reserve toggle, a new slice). Free it after each use, or at least before
starting dictation. That alone gives back 10 KB of heap. (Fragmentation could
make a later 10 KB `malloc` fail; `store_save` already logs storage errors, so
the usage log would show it.)

### E. Shared drawing pass on the biggest screens (~2-4 KB static, medium risk)

`home_window.c` is 8.8 KB (its `body_update_proc` alone is 4.6 KB), then
`alert_window` 7.8 KB, `ui.c` 5.6 KB, `dir_window` 5.1 KB. Four screens have
their own `body_update_proc`/`draw_row`. Folding repeated layout into `ui.c`
helpers would save code but touches every screen, so only do it if A-C fall
short. Not before the freeze otherwise.

### F. Heap trims if the dictation measurement says so

- Usage log RAM queue 800 -> 400 entries (6.4 KB back; entries still persist).
- Close directory levels below a Route screen when dictation starts, or cap
  directory depth at 4.

### Not worth it

- **Strings to resources or the phone:** all watch strings total ~2.5-5 KB and
  are short; moving them costs heap and code to load them back.
- **Background worker or a second watch app:** a worker can't draw, and one
  app can't open another.
- **Bitmaps/fonts:** there are none to shrink (resources are 4 KB).

### Guard: a size check in every PR

Add `tools/watch_size.py` (this folder) to the repo. Run after `pebble build`;
it fails over a 62 KB budget (today: 456 B under). Each PR description states
static size and room before/after, like `voice.test.js` does for the lexicon.

## 3. Development plan (all of Phase 5)

Version rule unchanged: first app-changing PR of the phase is 1.5.0; docs-only
PRs don't bump. The phone-side voice PRs don't touch the watch budget; PR R
lands before the watch voice PR.

### Stage 0: land what's waiting (docs, 1.4.8)

| # | What | Version |
|---|---|---|
| 0a | Pending docs patches: `voice-test-result`, `voice-closest-bar-docs`, `voice-categories-docs` | none |
| 0b | My info dining room (`me-dining-room.patch`) | 1.4.8 |
| 0c | Owner answers D1-D18 (defaults already implemented; only changes need work) | - |

### Stage 1: measure (no app change)

| # | What | Decides |
|---|---|---|
| M1 | RP Probe round 4 (throwaway `rp-webview-probe`): allocate 30/40/50 KB of ballast, then dictate; log `heap_bytes_free()` before, during (in the status callback) and after, 3 times each. Also check Hold Select for firmware clashes | How much heap dictation needs, and whether F/D are needed |
| M2 | On the watch with 1.4.8: open the app, go 5 directory levels deep into a route, share the usage log; read "lowest free memory while open" (log code 2) | Real heap headroom vs the estimate in 1.2 |

### Stage 2: make room (watch)

| PR | What | Version | Exit check |
|---|---|---|---|
| R1 | `tools/watch_size.py` + proposal A (static to heap, dead code) + proposal D (free the blob) | 1.5.0 | Static <= 60.5 KB; emulator walk of every screen; one day on the watch |
| R2 | Proposal C (LTO, `-Oz`) as its own PR so it can be reverted alone | 1.5.1 | Static drop measured; full emulator walk; alerts fire in real time; one day on the watch with the usage log |

If R2 has to be reverted, R1 plus proposal B still fits Phase 5 (about 1.5 KB
left after it), and E goes on the list for Phase 6.

### Stage 3: voice on the phone (no watch size impact)

| PR | What | Version |
|---|---|---|
| V1 | Docs: VOICE_FINAL_PLAN into `DESIGN_V1_1.md` §9.6, voice messages drafted in `WATCH_PROTOCOL.md` with byte limits (transcript <= 256 B, each confirm string <= 48 B), the generic card screen from proposal B | none |
| V2 | Lexicon + parser: `tools/voice/`, `src/pkjs/data/voice-HM.js`, `src/pkjs/voice.js`, tests and fixtures (from `voice-phase5/`), not wired | 1.5.2 |
| V3 | Phone wiring: transcript message in, parse, resolve (group to nearest, cabin check, stateroom, ashore, same place), confirm rows out, spoken start via `routestart.js`, `voice` log lines; a settings-page test box to type a phrase without the watch | 1.5.3 |

### Stage 4: voice on the watch

| PR | What | Version | Budget |
|---|---|---|---|
| V4 | Hold Select on Home and Route starts dictation (`dictation_session_create(0, ...)`, confirm off, the phone does its own); the card screen; Select confirms (existing Route messages), Hold Select asks again, Back cancels; phone-away and dictation-failed screens; `Hold: Ask by voice` hint; `voice` usage-log entries with free heap at start | 1.5.4 | <= 2.5 KB static; heap check from M1 |
| V5 | Settings Help: voice commands card, `HELP_KEYS` | 1.5.5 | phone only |

### Stage 5: tune before the freeze

| PR | What | Version |
|---|---|---|
| V6 | Home dictation session in airplane mode on the watch: each hard name (Izumi, Hublot, Solera, Boleros, Studio B...) 3-5 times, plus the 50 hold-out phrases spoken. Add observed forms, fix what breaks | 1.5.6 |
| - | Freeze: re-sync with the sailing's schedule, full test on the watch, bug fixes only | fixes |

### After the sailing (1.6.x)

The log review in VOICE_FINAL_PLAN §10: `voice` lines grouped by outcome,
observed forms into `venue-mishearings-HM.json`, conflicts into
`conflicts-HM.json`, corpus updated with made-up cabins.

## 4. Timeline to Dec 12

Schedules publish about two weeks before sailing (~Nov 28), which starts the
freeze. That leaves about eight weeks.

| Weeks of | Work |
|---|---|
| Sep 28 - Oct 4 | Stage 0, M1 probe, M2 log |
| Oct 5 - Oct 18 | R1, R2 (each needs a day on the watch) |
| Oct 5 - Oct 25 | V1-V3 on the phone, in parallel with Stage 2 |
| Oct 26 - Nov 8 | V4, V5 |
| Nov 9 - Nov 22 | V6 tuning, Phase 6 if room and time allow |
| Nov 28 - Dec 11 | Freeze |

## 5. Not verified

- The 2-2.5 KB and 4.5-6 KB estimates for the watch voice PR are comparisons
  with existing screens, not builds.
- Heap figures in 1.2 are from struct sizes in the code, not measured; M1 and
  M2 replace them with real numbers.
- LTO and `-Oz` gains are typical figures for GCC on Thumb code, not measured
  on this app; PIE plus LTO with the Pebble SDK is untested here.
- The ELF measured is the last local build; run `watch_size.py` after a fresh
  `pebble clean && pebble build` to confirm.
