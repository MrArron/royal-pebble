# Royal Pebble link test (Phase 0)

A bare Android app that checks whether a native app can share the watch with
Royal Pebble's PebbleKit JS phone companion, through
[PebbleKit Android 2](https://github.com/pebble-dev/PebbleKitAndroid2) 1.3.2.
It does three things:

- **Open Royal Pebble on the watch** (`startAppOnTheWatch`).
- **Send test notice**: one `NOTICE` (msg_type 6), packed like
  `src/pkjs/pack.js` `packNotices` (a unit test checks the bytes match). The
  watch should buzz and show `SCHEDULE CHANGE / MOVED` for
  "Android app link test", `Now 9:30p · Royal Pebble app`, `Was 8:00p`, with a
  weekday since the times are on cruise day 2.
- **Log** every message the watch sends to this app, by name (`REQUEST`,
  `LOG`, `STAR_CHANGES`...), plus when Royal Pebble opens and closes on the
  watch. Only message names and sizes are kept, no cruise data.

What the Pebble app's source says to expect is in `docs/WATCH_PROTOCOL.md`,
"Android companion app (PebbleKit Android 2)".

## Needs

- The Core Pebble app 1.0.7.7 or later (or microPebble 1.0.0-alpha35).
- Royal Pebble 1.6.19 or later **built with `pebble build`**, since its
  `package.json` lists this app's package (`companionApp`). CloudPebble drops
  that entry, so its builds won't work for this test.

## Build

Android SDK 37 and a JDK 17 or later (Android Studio's own JDK works):

```bash
cd android/linktest && ./gradlew assembleDebug testDebugUnitTest
```

The APK is `app/build/outputs/apk/debug/app-debug.apk`. Create
`local.properties` with `sdk.dir=...` if `ANDROID_HOME` isn't set.

## Phone and watch test

1. Install Royal Pebble 1.6.19 from the `.pbw` (open it with the Pebble app).
2. Install the link test APK and open it. The log's first line should name the
   Pebble app (`coredevices.coreapp` or similar), not "none found".
3. Tap **Open Royal Pebble on the watch**. Royal Pebble should open; the log
   shows `open app: watch ACKed` and `Royal Pebble opened on the watch`. If the
   Pebble app asks whether the link test may talk to Royal Pebble, allow it.
4. Tap **Send test notice**. The watch buzzes and shows the notice above; the
   log shows `sent NOTICE: watch ACKed`.
5. With the link test still installed, check JS still works: Royal Pebble's
   Home and Today show your data as before, the settings page opens, and a
   star made on the watch is still there after closing and reopening.
6. Use the watch app for a minute (open Today, star or unstar something, open
   the ship directory). The link test's log should list `REQUEST`,
   `STAR_CHANGES`, `DIR_REQUEST`, `LOG` and so on: messages JS also answered.
7. Uninstall the link test and open Royal Pebble again: no "needs a companion
   app" message from the Pebble app, and everything works as before.

Report pass/fail per number, and a screenshot of the link test's log after
step 6.
