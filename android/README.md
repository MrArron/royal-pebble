# Royal Pebble for Android (price and booking checker, and the watch)

An optional add-on: it runs jdeath's
[`CheckRoyalCaribbeanPrice.py`](https://github.com/jdeath/CheckRoyalCaribbeanPrice) unchanged
(through Chaquopy) and shows, for your own Royal Caribbean or Celebrity account:

- bookings: check-in label, per-guest check-in status and boarding window, final payment date,
  balance due;
- price drops: paid vs current, saving, and a "rebook" flag.

Tabs: Summary (Run now, results, Copy/Share report), Log (live coloured output, selectable, Copy/Share),
Account (the one Royal login, plus an editable `config.yaml`), Settings (background checks off / 6 / 12 /
24 h, script updates), Cruise.

## One Royal login

The Account tab's login is also the Cruise screen's "Download with my Royal login" (`RoyalAccount.kt`).
A login typed on the Cruise screen becomes the Account tab's once Royal accepts it. Saving writes the
simple `config.yaml` (password as a placeholder) unless you wrote your own `config.yaml`, which is
left alone. "Remember on this phone" saves it encrypted with the Android Keystore; after a restart the
remembered login also fills the price check's password, so it isn't asked for again.

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

## Watch alerts

Settings, "Watch alerts" (off by default): after a check (background or Run now) the app sends what
is new to the Pebble as one NOTICE message (`docs/WATCH_PROTOCOL.md`, Booking notices):

- a price drop flagged rebook or consider-booking (again only if the price falls further);
- check-in open, then checked in (with the boarding window when the label has one);
- final payment due, at 7, 3, 1 and 0 days and once when overdue (only while a balance is due). The
  price script reports whether a balance is due, not the amount, so the notice reads
  "Balance due Dec 20".

An alert counts as sent only once the watch acknowledges it; otherwise it waits for the next check.
At most 8 go in one message, the rest follow on the next check. Switching alerts on sends the
alerts that are current right now, once. Code: `royal/.../alerts/` (detection, encoders, `WatchSender`
interface; plain Kotlin, tested with a fake sender and against pack.js bytes) and
`WatchAlertBridge.kt` (app side; sends through `WatchLink.sendNotice`, which waits for a slice in progress and opens Royal Pebble on the watch when another app is open).

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
  so the reused JS packer can read it as it is. On a re-download, stars follow events Royal
  moved or cancelled: the app passes `watch/`'s `JsStarReconciler`, which runs `slice.reconcileStars`,
  `pruneStarTimes` and `buildNotices` in QuickJS (issue 129). The test log gets a `stars` line with counts.
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
