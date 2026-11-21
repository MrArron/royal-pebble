# Royal Pebble — Architecture, build and test

The current shape of the system on one page, and how a build gets made,
checked and handed to the owner for a test. As of 1.6.25 (2026-11-15). The
detail lives in the files this one points to; when they disagree, they win.

## 1. Architecture

```
               Pebble Time 2 (emery)  /  Pebble Round 2 (gabbro)
                        Royal Pebble watch app (src/c/)
                                   ▲  AppMessage
                                   │  (Pebble app on the phone routes it)
               ┌───────────────────┴────────────────────┐
               │ every watch message goes to both        │
     PebbleKit JS (src/pkjs/)               Royal Pebble Android app (android/)
     inside the Pebble app                  ├─ price and booking checks (Chaquopy,
     ├─ default server of the watch         │  jdeath's script) + Watch alerts
     ├─ settings page (config.js,           ├─ Cruise screens (native settings)
     │  offline data: URL)                  ├─ royal/: Kotlin Royal client, CruiseStore
     └─ localStorage: its own cruise        └─ watch/: runs src/pkjs/index.js in
                                               QuickJS to serve the watch (switch)

     tools/cruise-sync/ (Windows, Python): backup download, pasted into either side
```

- **Watch app** (`src/c/`, C). One .pbw for both watches; round-only code
  under `PBL_ROUND`, per-platform numbers in `layout.h`. Stores the day's
  slice, the alert plan and the stars, so it works with the phone away.
  Screens: `DESIGN.md` (§15 for the Round 2).
- **PebbleKit JS** (`src/pkjs/`). Downloads from Royal (`royal.js`), keeps
  the full bundle, sends the watch one day at a time (`slice.js`, `pack.js`),
  answers directory, route, voice and star requests, keeps the usage log
  (`log.js`), builds the settings page (`config.js`). Messages:
  `WATCH_PROTOCOL.md`.
- **Android app** (`android/`, optional; `android/README.md`).
  - Price and booking checks with jdeath's script, background checks, and
    **Watch alerts** (Settings): price drop, price watch, check-in and final
    payment notices sent as one `NOTICE` through `WatchLink.sendNotice`
    (`WATCH_PROTOCOL.md`, Booking notices); price watches, Mute and alert
    hours in `AlertDelivery.kt` (1.6.29).
  - **Cruise** tab: native versions of the settings page's screens (Cruise,
    Days, Filters, Events, Me, Share) on the Kotlin Royal client and
    `CruiseStore` (`DESIGN.md` §12, Android app).
  - **Serving the watch** (1.6.21): with Settings > Watch and logs > **App serves the
    watch** on (and the settings page's Me > Help > **Android app serves the
    watch** on, so PebbleKit JS stays quiet), the app runs the same
    `src/pkjs/index.js` in QuickJS and does everything PebbleKit JS does.
    Its saves (download, settings, stars) push a fresh slice at once
    (`WatchHost.storeChanged`, 1.6.23). With no cruise in the app the watch
    shows `NO CRUISE YET`, not the demo (1.6.22). On a Round 2 it retries the
    watch-type lookup up to 5 times so the Round 2 gets its layouts (1.6.24).
  - The two sides keep **separate cruises**: PebbleKit JS's localStorage and
    the app's `files/cruise`. Whichever serves the watch sends its own.
- **Which side served what.** Usage log lines about serving the watch start
  `[js]` or `[app]` (1.6.22). PebbleKit JS's log: settings page Me > Usage
  log > Copy part N. The app's: Settings > Watch and logs > **Share log file** or
  **Save to Downloads** (a `royal-pebble-log-*.txt` file with a header, the
  app's own lines, the app-side usage log and, when on, every watch message).
  Both hold cruise and cabin details: never commit or quote one.
- **Windows sync tool** (`tools/cruise-sync/`): the reference for every Royal
  request and the backup path. Three producers make the same bundle
  (`royal.js`, `cruise_sync.py`, `android/royal/`); `test/fixtures/` keeps
  them equal (`DATA_FORMAT.md`).

## 2. Versions

- **Watch and JS: `1.X.Y`** in `package.json` and `src/pkjs/log.js`
  (`APP_VERSION`), bumped together for every PR that changes what runs on the
  watch or the JS that serves it (`CLAUDE.md`, Pull requests). The watch keeps
  only `1.X`. The usage log writes `version  first run of 1.X.Y, was ...` on
  the first start of a new build.
- **Android app: `0.1.0-<commit>`**, set by CI from the commit it was built
  from (an `android-v*` tag gives a plain version and a release). It bundles
  `src/pkjs` from the same commit, so its test log header shows both
  (`App 0.1.0-abc1234 (abc1234), Royal Pebble JS 1.6.25`).

## 3. Size budgets

`python3 tools/watch_size.py` after `pebble build` reads both platforms' ELFs
and fails over 62 KB (63,488 B) static. 1.6.24 and 1.6.25 (no watch C change): Time 2 59,392 B (4,096 B
left), Round 2 62,008 B (**1,480 B left**). Every watch PR gives both before
and after; status in `PLAN.md` §2, history in `PROJECT_BRIEF.md`,
Measurements and limits.

## 4. Building

| What | Where it can be built | How |
|---|---|---|
| Watch app `.pbw` | Only the owner's PC (Pebble SDK in WSL); not in CI, not in a cloud session | `pebble clean && pebble build` (WSL, `CLAUDE.md` Commands), then `python3 tools/watch_size.py`. Output `build/royal-pebble.pbw` |
| Android `.apk` | Only GitHub Actions (a cloud container can't reach Google's Maven) | Workflow **Android app**: runs on PRs touching `android/**`, `src/pkjs/**`, `test/fixtures/**`, `package.json`. After a merge, run it by hand on `main` (Actions > Android app > Run workflow); merges haven't started it by themselves. Artifact `royal-pebble-android` holds `royal-pebble-android-0.1.0-<commit>.apk` |
| Link test app | Its own Gradle project, `android/linktest/` | See its README (Phase 0 only) |

Install: open the `.pbw` in the Pebble app on the phone (not through
CloudPebble, which drops the `companionApp` entry the Android app needs), and
sideload the `.apk`. A matched test build is a pbw and an apk from the same
commit.

SDK version: test builds use SDK 4.33.1, which makes a legacy-permissions
app. A `.pbw` for the appstore must be built with SDK 4.44+ and pebble-tool
5.1.0+, so the `usesPermissions` declaration in `package.json` takes effect;
check it first with the steps in `STORE_READINESS.md` §7.

## 5. Tests

| Suite | Runs where | Command |
|---|---|---|
| Phone companion (Node) | Anywhere with Node, also a cloud session; not in CI | `for t in test/pkjs/*.test.js; do node $t; done` |
| Sync tool | Anywhere with Python; not in CI | `python3 tools/cruise-sync/test_cruise_sync.py` |
| Android bridge (Python) | CI (Android app workflow) | `cd android && python -m pytest tests` |
| Android Kotlin | CI; `:royal`/`:watch` also locally (Java 21) | `./gradlew :royal:test :watch:test testDebugUnitTest` |
| **Serving gate** | CI (`:watch:test`, needs `node`) | `WatchServerSessionTest`: whole watch sessions through the app's QuickJS server and through Node, every message compared byte for byte |
| Watch screens | Owner's PC, emulators | `bash tools/screens.sh <out> [emery] [gabbro]`; alerts in real time (Test alerts) |
| Real hardware | Owner, Pebble Time 2 (no real Round 2 yet) | The build's test checklist |

Other workflows: **Verify upstream price script** (daily) and **Publish
verified price script** (`docs/PRICE_SCRIPT_UPDATES.md`), and the Claude
review and `@claude` workflows.

## 6. Handing a build to the owner

1. Merge the PRs; run the Android app workflow on `main` and take its APK.
2. Build the `.pbw` from the same commit on the PC (a PC session).
3. Put both in the project files under `builds/`
   (`royal-pebble-1.X.Y.pbw`, `royal-pebble-android-0.1.0-<commit>.apk`).
4. Write `builds/TEST-CHECKLIST-1.X.Y.md`. Every item passes or fails on a log
   line or a number from the exported logs (the app's log file, and the
   settings page's usage log only where an item says so), never on how
   something looks. `TEST-CHECKLIST-1.6.25.md` is the pattern: install and
   versions first (commit in the header = the apk's name, `first run of`),
   then who serves, then each feature.
5. The owner exports the logs after the test and shares them; findings become
   issues (patterns only, no cabin numbers) and the next PRs.
