# CLAUDE.md

Cruise Watch: a private Pebble Time 2 watch app (C + PebbleKit JS) for Royal
Caribbean cruises that works fully offline at sea, plus a Windows Python tool for
backup data sync.

Read before making changes:
- `docs/PROJECT_BRIEF.md` — scope, architecture, decisions, open questions
- `docs/DESIGN.md` — watch and settings-page designs, color tokens
- `docs/DESIGN_V1_1.md` — v1.1 designs (venues, wayfinding, Mark reserved)
- `docs/DATA_FORMAT.md` — the cruise data bundle (v1)
- `docs/ROYAL_LOGIN_DATA.md` — what a Royal login can see (sync tool only) and
  ideas for using it
- `docs/WATCH_PROTOCOL.md` — phone ↔ watch messages and the time model (cruise
  minutes, 04:00 day boundary)

## Repository layout

- `tools/cruise-sync/` — Windows backup sync tool (Python). Reference
  implementation of every Royal Caribbean request.
- `tools/shipmap/` — builds the Ship GPS map data (`src/pkjs/data/*-HM.js`:
  cabins, places, walkways) from Royal's deck-plan SVGs. See its README; the
  data files are generated, never edited by hand.
- `docs/` — brief, design, data format.
- Watch app: `package.json` + `wscript` at the root, `src/c/` watch code,
  `src/pkjs/` phone companion (and later the settings page). Targets the Pebble
  Time 2 only (SDK platform `emery`, 200x228, 64 colors).

## Working rules

- **Name.** The user-facing name is **Royal Pebble**, short enough for the watch's
  app list (watch app, settings page, READMEs, sync tool messages). "Cruise Watch"
  is the old working name; keep it only in internal identifiers (`"format":
  "cruise-watch"`, file names, code). Say "Pebble Time 2", not SDK codenames, in
  user-facing text.
- **Offline first.** Nothing the app needs at sea may depend on the internet,
  including the settings page (build it locally, never load it from a URL).
- **Scope.** v1 and the planned v1.1 features (in phase order) are listed in the
  brief. Don't add features from its "Later" list or change decisions without
  asking.
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
- **Data format changes** must update `docs/DATA_FORMAT.md` and both producers
  (phone companion and `cruise_sync.py`) together; bump `v` if breaking.
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
  `pebble emu-button click <up|down|select|back> --emulator emery`.
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
- Watch C code: don't use `strtol()` or `strlen()`; both faulted on real Pebble
  Time 2 hardware. The emulator won't catch this.

## Pull requests

Small, focused PRs. In the description say what changed, how it was tested (and on
what: emulator, watch, live data), and anything left unverified.
