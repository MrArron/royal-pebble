# Royal Pebble for Android (price and booking checker)

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
- Kotlin unit tests: `./gradlew testDebugUnitTest`.
