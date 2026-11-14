# Royal Pebble for Android (price and booking checker, and the watch)

An optional add-on: it runs jdeath's
[`CheckRoyalCaribbeanPrice.py`](https://github.com/jdeath/CheckRoyalCaribbeanPrice) unchanged
(through Chaquopy) and shows, for your own Royal Caribbean or Celebrity account:

- bookings: check-in label, per-guest check-in status and boarding window, final payment date,
  balance due;
- price drops: paid vs current, saving, and a "rebook" flag.

Tabs: Summary (Run now, results), Log (live coloured output), Account (quick form that writes an
editable `config.yaml`), Settings (background checks off / 6 / 12 / 24 h, script updates).

## Your password

- `config.yaml` never holds your password. Saving swaps it for a placeholder (`'@password-0'`).
- It stays in memory until the app process ends, so Run now works after you typed it once.
- **Only while background checks are on**, it is also saved encrypted with the Android Keystore
  (AES-256-GCM, key held by the Keystore, not readable by the app). Turning checks off deletes the
  saved copy and the key.
- A check writes a temporary config with the password and deletes it right afterwards.
- The Pebble watch app's settings page still never saves a password; this applies to the Android
  app only.

## Background checks

WorkManager, with a network constraint. A notification appears only for things that are new since
the previous check (new rebook alerts, a changed check-in label, a failed check).

## Script updates

"Update script now" downloads the copy Royal Pebble has verified from the `price-script-latest`
release (see `docs/PRICE_SCRIPT_UPDATES.md`). It checks the sha256 in `VERIFIED.json`, compiles
the file, and keeps the old copy on any failure. The Settings switch "follow jdeath's main branch"
downloads jdeath's file directly instead (not verified by us).

## Tests

- Bridge: `python -m pytest tests` (needs `requests PyYAML apprise pytest`).
- Kotlin unit tests: `./gradlew :royal:test :watch:test testDebugUnitTest`. The app's tests need a
  Java 21 runtime (PebbleKit Android 2 ships Java 21 class files; Android Studio's bundled JDK is 21).

## Royal client and cruise store (`royal/`)

Plain Kotlin, no Android, so `./gradlew :royal:test` runs offline on any JVM.

- `RoyalParse` / `RoyalClient`: the parsing and every request of `src/pkjs/royal.js` (ships,
  sail dates, itinerary, schedule pages, sign-in, booking, voyage, order history, catalog
  times). `tools/cruise-sync/cruise_sync.py` is the reference for headers and retries: browser
  user agent on every call, up to 3 tries with 2 s and 4 s pauses for network trouble and 5xx
  on GETs, never for 4xx or the sign-in. Error texts are the JS's fixed wording.
- `CruiseStore`: the sailing (bundle, with the booking's `mine`), stars and reserved marks,
  reservations and settings, one file per key under `src/pkjs/index.js`'s localStorage names,
  so the reused JS packer can read it as it is. Moving stars on a re-download
  (`slice.reconcileStars`) is a hook for the JS engine; until it is wired in, stars stay put.
- Tests read the shared fixtures in `test/fixtures/` (the same expected schedule and booking as
  `test/pkjs/royal.test.js` and `test_cruise_sync.py`) and compare output as JSON text, so the
  Kotlin bundle matches `JSON.stringify` byte for byte. Nothing sends slices to the watch yet.

## Serving the watch (`watch/` and `app/.../watch/`)

Optional and off by default: Settings > Watch > **App serves the watch** (and, on Royal
Pebble's settings page, Me > Help > **Android app serves the watch**, so PebbleKit JS stays
quiet). The app then sends the watch its slices and answers every request by running
`src/pkjs/index.js` itself in QuickJS (Zipline), with its localStorage in the cruise store's
folder. Details: `docs/WATCH_PROTOCOL.md`, App serves the watch.

- `watch/` (plain Kotlin, `./gradlew :watch:test`): the JS host (`host.js`), the bundler, the
  server loop and the AppMessage conversion. Its test runs whole watch sessions in QuickJS and
  in Node (needs `node`) and checks every message is the same, byte for byte.
- `app/.../watch/`: the PebbleKit Android 2 listener service, `WatchLink` (the only sender, also
  `sendNotice` for background checks), `WatchHost` (`storeChanged()` after the app saves) and the
  Settings > Watch card.
