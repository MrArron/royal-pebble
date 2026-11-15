# Royal Pebble for Android (price and booking checker, and the watch)

An optional add-on: it runs jdeath's
[`CheckRoyalCaribbeanPrice.py`](https://github.com/jdeath/CheckRoyalCaribbeanPrice) unchanged
(through Chaquopy) and shows, for your own Royal Caribbean or Celebrity account:

- bookings: check-in label, per-guest check-in status and boarding window, final payment date,
  balance due;
- price drops: paid vs current, saving, and a "rebook" flag.

It also holds Royal Pebble's cruise settings natively and, behind a switch, can serve the watch
in place of the Pebble app's PebbleKit JS (below). The app wears the settings page's palette
(`ui/RoyalTheme.kt`).

## Layout

One bottom bar whose tabs follow the trip (`AppShell.kt`, `TripPhase`):

- **Planning**: Trip (countdown, price glance, download, Ready to sail, backup paste), Prices
  (Summary and Full report, both selectable with Copy and Share), Plan (Events, Days, Filters, Share),
  Settings.
- **On board**: Today (all aboard, next starred events, to reserve, watch status), Events (the same
  Events, Days, Filters, Share), Cabin (stateroom, muster, dining, theme, reminders), Settings.
- **Auto** (default) is On board from the downloaded sailing's first itinerary day through its last,
  Planning otherwise (and always Planning with the demo cruise). Chips on Trip and Today pick Auto,
  Planning or On board. Every change of the phase shown writes a `phase` line to the test log.
- **Settings** is a list of pages: Royal account (plus `config.yaml`), Me and my stateroom, Watch and
  logs, Price checks, About; on board also Prices.
- Background price checks pause while On board (log line `prices  background check skipped: on board`)
  unless Settings > Price checks > **Keep checking while on board** is on.

## One Royal login

The Royal account page's login is also the Trip screen's "Download with my Royal login" (`RoyalAccount.kt`).
A login typed on the Trip screen becomes the Royal account once Royal accepts it. Saving writes the
simple `config.yaml` (password as a placeholder) unless you wrote your own `config.yaml`, which is
left alone. "Remember on this phone" saves it encrypted with the Android Keystore; after a restart the
remembered login also fills the price check's password, so it isn't asked for again.

Version: `0.1.0-<commit>` from CI (the **Android app** workflow; run it by hand on `main` after a
merge to get an APK, `docs/BUILD_AND_TEST.md`).

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

Settings > Price checks, "Watch alerts" (off by default): after a check (background or Run now) the app sends what
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
  Kotlin bundle matches `JSON.stringify` byte for byte. Slices for the watch are built from this
  store by the JS in `watch/` (below), not by Kotlin.

## Serving the watch (`watch/` and `app/.../watch/`)

Optional and off by default: Settings > Watch and logs > **App serves the watch** (and, on Royal
Pebble's settings page, Me > Help > **Android app serves the watch**, so PebbleKit JS stays
quiet). The app then sends the watch its slices and answers every request by running
`src/pkjs/index.js` itself in QuickJS (Zipline), with its localStorage in the cruise store's
folder. Details: `docs/WATCH_PROTOCOL.md`, App serves the watch.

- `watch/` (plain Kotlin, `./gradlew :watch:test`): the JS host (`host.js`), the bundler, the
  server loop and the AppMessage conversion. Its test runs whole watch sessions in QuickJS and
  in Node (needs `node`) and checks every message is the same, byte for byte.
- `app/.../watch/`: the PebbleKit Android 2 listener service, `WatchLink` (the only sender, also
  `sendNotice` for background checks), `WatchHost` (`storeChanged()` after the app saves) and the
  Settings > Watch and logs page.
