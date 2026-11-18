# CLAUDE.md

Cruise Watch: a private watch app for the Pebble Time 2 and Pebble Round 2 (C +
PebbleKit JS) for Royal Caribbean cruises that works fully offline at sea, an
optional native Android app (price and booking checks, the cruise settings
screens, and, behind a switch, serving the watch itself), and a Windows Python
tool for backup data sync.

Read before making changes:
- `docs/PROJECT_BRIEF.md` — purpose, constraints, what's built, decisions in
  force, measurements and limits, Later
- `docs/DESIGN.md` — every watch screen and settings-page tab as built, color
  tokens, mockups, and what's approved but not built
- `docs/PLAN.md` — the active plan: watch size budget, Phase 5 tuning, Phase 6,
  the freeze, open questions
- `docs/DATA_FORMAT.md` — the cruise data bundle (v1) and the shared plan
- `docs/ROYAL_LOGIN_DATA.md` — what a Royal login can see (sync tool, Advanced download, the Android app's Download with login) and
  ideas for using it
- `docs/WATCH_PROTOCOL.md` — phone ↔ watch messages and the time model (cruise
  minutes, 04:00 day boundary); the Android app's link and how it serves the
  watch
- `docs/BUILD_AND_TEST.md` — the current architecture in one page, and how a
  build gets made, tested and handed to the owner (pbw, apk, checklists)
- `docs/STORE_READINESS.md` and `docs/STORE_LISTING.md` — the Pebble appstore
  plan, disclosures and listing text; `PRIVACY.md` and
  `THIRD_PARTY_NOTICES.md` — keep them true when data handling or
  dependencies change. The app is free forever: never add paid, premium
  or ad features
- `android/README.md` — the Android app: modules, password handling, watch
  alerts, serving the watch, its tests

## Repository layout

- `tools/cruise-sync/` — Windows backup sync tool (Python). Reference
  implementation of every Royal Caribbean request.
- `tools/shipmap/` — builds the Ship GPS map data (`src/pkjs/data/*-HM.js`:
  cabins, places, walkways) from Royal's deck-plan SVGs. See its README; the
  data files are generated, never edited by hand.
- `tools/verify-upstream/` — keeps the Android app's copy of jdeath's price script current and
  verified (daily workflow, local checklist). See `docs/PRICE_SCRIPT_UPDATES.md`.
- `tools/voice/` — builds the voice lexicon (`src/pkjs/data/voice-HM.js`,
  generated) from `venue-mishearings-HM.json` and `venues.js`. See its README.
- `tools/quickjs-probe/` — the Phase 0 check that `src/pkjs` packs the same
  bytes in QuickJS as in Node (`docs/QUICKJS_PHASE0.md`).
- `store/` — appstore icons, banner and (later) screenshots; `tools/store/`
  draws the art.
- `tools/mockups/` — design mockup scripts. `tools/screens.sh` — screenshot
  walk on both emulators. `tools/watch_size.py` — watch size check.
- `docs/` — brief, design, plan, data format, protocol, build and test;
  mockups in `docs/mockups/`.
- Watch app: `package.json` + `wscript` at the root, `src/c/` watch code,
  `src/pkjs/` phone companion and the settings page. Targets the Pebble
  Time 2 (SDK platform `emery`, 200x228, 64 colors) and the Pebble Round 2
  (`gabbro`, 260x260 round, 64 colors) from one .pbw; round-only code sits
  behind `PBL_ROUND`, per-platform numbers in `src/c/layout.h`.
- `android/` — the Android app (Gradle): `app/` (Android UI, PebbleKit
  Android 2 service, `WatchHost`/`WatchLink`), `royal/` (plain Kotlin Royal
  client and cruise store), `watch/` (plain Kotlin: runs `src/pkjs/index.js`
  in QuickJS to serve the watch), `tests/` (Python bridge tests),
  `linktest/` (Phase 0 link test app). See `android/README.md`.

## Working rules

- **Name.** The user-facing name is **Royal Pebble**, short enough for the watch's
  app list (watch app, settings page, READMEs, sync tool messages). "Cruise Watch"
  is the old working name; keep it only in internal identifiers (`"format":
  "cruise-watch"`, file names, code). Say "Pebble Time 2" and "Pebble Round 2",
  not SDK codenames, in user-facing text.
- **Offline first.** Nothing the app needs at sea may depend on the internet,
  including the settings page (build it locally, never load it from a URL).
- **Scope.** What's built is in the brief, what's next in `docs/PLAN.md`. Don't
  add features from the brief's "Later" list or change decisions without
  asking. When a feature lands, update `docs/DESIGN.md` (as built) and the
  brief, and remove it from the plan.
- **Secrets.** Never commit or print passwords, tokens or personal cruise data.
  Output bundles (`cruise-watch-*.json`) can contain a stateroom number and are
  git-ignored. The usage log and map notes hold cabin details: never commit
  a log, an export or quotes from it (exports: `royal-pebble-log-*.txt` and
  `royal-pebble-map-notes-*`, git-ignored; the same goes for account explorer output), and use made-up cabin numbers in tests. The Royal `AppKey` and login client in `cruise_sync.py` are Royal's
  public web-app values (from an MIT project) and are fine to keep.
- **Be gentle with Royal's servers.** Unofficial endpoints: keep requests minimal,
  no polling, no parallel hammering in tests.
- **Ship map conflicts.** When any scrape (Royal's SVGs, the Royal app, a later
  source) disagrees with the ship map data, add an entry to
  `tools/shipmap/conflicts-HM.json` instead of silently changing the data; it's
  settled in person on board.
- **Data format changes** must update `docs/DATA_FORMAT.md` and every producer
  together: the phone companion (`src/pkjs/royal.js`), `cruise_sync.py` and the
  Android app's Kotlin port (`android/royal/`, `RoyalParse`/`RoyalClient`); the
  shared fixtures in `test/fixtures/` keep all three byte-equal. Bump `v` if
  breaking.
- **Verify Pebble details** (platform names, API limits, build commands) against
  the current Pebble SDK docs rather than memory. The Pebble Time 2 is new hardware.

## Commands

- Sync tool: `py tools/cruise-sync/cruise_sync.py --ship HM` (pick a sailing within
  ~2 weeks to get a schedule). Add `--no-clipboard` in automated runs. Its
  offline tests: `python3 tools/cruise-sync/test_cruise_sync.py` (or `py` on
  Windows). `tools/cruise-sync/explore_account.py` dumps everything a login can
  see; run it outside the repo or keep its `royal-pebble-explore-*` output
  (personal data, git-ignored) out of commits.
- Pebble SDK runs in WSL: distro `Ubuntu`, user `pebble`, tool at
  `/home/pebble/.local/bin/pebble` (pebble-tool 5.0.40, SDK 4.33.1). From Git Bash,
  set `MSYS_NO_PATHCONV=1` and run a script file with
  `wsl -d Ubuntu -u pebble -- bash <script>` (inline `$PATH` gets expanded by Git
  Bash). In the script, `cd` to the repo under `/mnt/c/...`, then `pebble build`,
  `pebble install --emulator emery`,
  `pebble screenshot --no-open --emulator emery <file.png>`,
  `pebble emu-button click <up|down|select|back> --emulator emery`. Use
  `--emulator gabbro` for the Pebble Round 2 (one emulator at a time);
  `bash tools/screens.sh <out-dir> [emery] [gabbro]` walks the main screens.
  The .pbw and the emulators exist only on the owner's PC (WSL): a cloud
  session can't build or install the watch app, so it hands that step to a
  session on the PC.
- Android app (`android/`): `./gradlew :royal:test :watch:test
  testDebugUnitTest` (Java 21) and `python -m pytest tests`. A cloud container
  can't reach Google's Maven, so `:app` builds only in CI; `:royal` and
  `:watch` tests run locally (for `:watch`, from a scratch Gradle project that
  includes `android/watch`, since the root build needs AGP). The APK comes
  from the **Android app** workflow (`.github/workflows/android.yml`): it runs
  on pull requests that touch `android/**`, `src/pkjs/**`, `test/fixtures/**`
  or `package.json`, but a merge to `main` has not started it on its own, so
  run it by hand (Actions > Android app > Run workflow on `main`) to get the
  `royal-pebble-android-0.1.0-<commit>.apk` artifact. An `android-v*` tag
  attaches the APK to a release. Details: `docs/BUILD_AND_TEST.md`.
- Phone companion unit tests (Node, in WSL): `node test/pkjs/slice.test.js`
  (every `test/pkjs/*.test.js`, including `shipmap-data.test.js` for the map data). Keep
  tests out of `src/pkjs/`; the build bundles everything there.
- The emulator's phone (pypkjs) ignores daylight saving time, so its JS clock can
  be an hour behind the watch. Export `TZ=Etc/GMT+4` (fixed offset) before
  `pebble install --emulator` after a `pebble kill` to line them up.
- After changing `messageKeys`, run `pebble clean` before building.
- Alerts: test wakeups in real time (the alert-test demo variant fires in 2-3
  minutes). Jumping the emulator clock past a wakeup shows the firmware's "wakeup
  events occurred while off" dialog instead of launching the app, and the phone
  simulator resets the clock when it connects.
- If `pebble install --emulator` hangs at "Waiting for the firmware to boot", stray
  `qemu-pebble` processes or a damaged `~/.local/share/pebble-sdk/4.33.1/emery/
  qemu_spi_flash.bin` are the usual cause: kill the strays, move the flash file
  aside (don't delete it) and remove `/tmp/pb-emulator.json`.
- Voice on the emulator: start `pebble transcribe "how do I get to the theater"
  --emulator emery` in the background (one at a time; it answers the next
  dictation), then Hold Select on Home. `--error no-speech-detected` tries a
  failure. Demo data is answered like real data (the voice matcher, 1.5.8).
- Emulator input: `pebble emu-button click select --duration 900 --emulator emery`
  is a long press (`--repeat` moved the Today cursor only one row). After a `pebble
  kill` and reinstall, the firmware may show "wakeup events occurred"; press Back
  to reach the app. Reinstalling the same app keeps its persistent storage.
- To keep the phone away, don't use `pebble emu-bt-connection --connected no`: it
  restarts the phone simulator (JS `ready` fires again) and messages still get
  through. Make a throwaway build whose `index.js` drops the message instead
  (commit real work first, revert after).
- Watch logs: run `pebble logs --emulator emery > <file>` as its own background
  task; a background `&` inside a one-off `wsl` script dies when the script ends.
  Don't `echo` markers into that file (the log writer overwrites them); filter by
  timestamp.
- The emulator phone's saved data is `~/.local/share/pebble-sdk/4.33.1/emery/
  localstorage`. Copy it aside before tests that change it, and never delete the
  `localstorage.*` copies beside it without asking.
- Settings page: `src/pkjs/config.js` builds it; `showConfiguration` must call
  `Pebble.openURL` right away (no network first). To view it in the emulator, run
  `BROWSER=true pebble emu-app-config --emulator emery` in the background, copy the
  newest `~/pebble-tool-emu-app-config-*.html` to a scratch folder and serve it on
  127.0.0.1. The tool's return listener rejects results over about 64 KB, so paste
  a trimmed bundle there; real phones return via `pebblejs://close#`.
- When editing files with Claude's tools, escape sequences typed in tool input
  (backslash-u-2028, backslash-b) can arrive as raw control characters. Build them
  in code (`String.fromCharCode`) or check the file for control characters after.
- Watch size: code + data + static buffers must stay under 65,535 bytes (the SDK
  stores it in a 16-bit field; the watch has 128 KB, the rest is heap). After
  `pebble build`, run `python3 tools/watch_size.py` (checks both platforms,
  fails over a 62 KB budget) and put its first lines for both in the PR
  description. The Round 2 binary is the tight one (1,480 B left in 1.6.24). Big buffers go on the heap,
  allocated while their screen is open. Budget status: `docs/PLAN.md`; what
  was done and what isn't worth it: the brief, Measurements and limits. The build
  uses link-time optimisation (`wscript`); keep its `-Wl,-u,__pbl_app_info`,
  or LTO drops the app header and installs fail.
- Watch C code: don't use `strtol()` or `strlen()`; both faulted on real Pebble
  Time 2 hardware. The emulator won't catch this.

## Bugs

Known bugs live in the repo's GitHub issues (`gh issue list --label bug`), not in
chat or handoffs. When you notice a bug outside the current task, file an issue
with `gh issue create --label bug` plus `watch` or `phone`: what happens, where
it was seen (watch, emulator, which version), log lines showing it and the
suspected code. The repo is public, so leave out cabin numbers, names and other
personal cruise data. A PR that fixes one says `Fixes #N` in its description.

## Pull requests

Small, focused PRs. In the description say what changed, how it was tested (and on
what: emulator, watch, live data), and anything left unverified.

**App version `1.X.Y`:** X is the v1.1 phase in progress (Phase 3 = `1.3.0`), Y
counts PRs within it. Every PR that changes the watch app or the JS the watch is
served by (`src/c/`, `src/pkjs/`, or Android app code that changes what the
watch gets) bumps Y; a new phase sets X and resets Y to 0; docs-only PRs leave it
alone, and so have Android-app-only PRs (the native screens, #123, and the
restyle, #124, both stayed 1.6.21). The
Android app's own version is `0.1.0-<commit>` from CI (`android-v*` tags give a
plain one); its test log header shows it and the bundled JS version. Change
`package.json` `version` and `APP_VERSION` in `src/pkjs/log.js` together (a test
checks). The usage log records "version  first run of ..." when a new version
first starts, so a shared log shows where the build under test begins. The watch
firmware keeps only `1.X`; the full number lives on the phone side.
