# Third-party notices

Royal Pebble's own code and docs are under the [MIT License](LICENSE). This
file lists everything else the project uses or ships, by deliverable, with its
license. "Ships in" says whether the item ends up inside a file people install.

Last checked: 2026-11-18. Licenses marked *(to confirm)* were taken from
memory or a secondary source and should be checked against the project's own
license file before a release (`docs/STORE_READINESS.md` §4).

## 1. Watch app (`.pbw`, the appstore download)

The `.pbw` holds only this project's C code, its PebbleKit JS and generated
data. No third-party libraries are bundled.

| Item | Use | License | Ships in |
|---|---|---|---|
| Pebble SDK and its `wscript` project template (`pebble new-project`) | Build system and the watch APIs | Apache-2.0 *(to confirm: Core Devices' open-source SDK)* | Build only; the SDK's runtime is in the watch firmware |
| Howard Hinnant's `days_from_civil` / `civil_from_days` ([date algorithms](https://howardhinnant.github.io/date_algorithms.html)) | Counting days without time zones, watch and phone | Public domain | Yes (reimplemented) |
| [jdeath/CheckRoyalCaribbeanPrice](https://github.com/jdeath/CheckRoyalCaribbeanPrice) | Knowledge of Royal Caribbean's web endpoints, the public web-app `AppKey` and login client used in `src/pkjs/royal.js` | MIT, Copyright (c) 2025 jdeath (notice in [`LICENSE`](LICENSE)) | Yes (the endpoint and key values) |
| Clay (Pebble's configuration library) | The idea of a local `data:` URL settings page; no Clay code is included | MIT | No |
| Royal Caribbean's published deck plans (Harmony of the Seas) | Measured to build the venue table and Ship GPS map (`tools/shipmap/`) | Royal Caribbean's material; the app ships derived facts (positions, names), not the images | Derived data only (see `docs/STORE_READINESS.md` §3) |

Watch fonts (Gothic, Bitham, LECO) are the firmware's system fonts and are
not bundled.

## 2. Android app (optional, sideloaded APK)

| Item | Use | License |
|---|---|---|
| [CheckRoyalCaribbeanPrice.py](https://github.com/jdeath/CheckRoyalCaribbeanPrice) | Run unchanged for price and booking checks (`android/app/src/main/python/upstream/`, with its `LICENSE`) | MIT, Copyright (c) 2025 jdeath |
| [PebbleKit Android 2](https://github.com/pebble-dev/PebbleKitAndroid2) (`io.rebble.pebblekit2:client`) | Link to the watch | Apache-2.0 |
| [Zipline](https://github.com/cashapp/zipline) (`app.cash.zipline:zipline-android`), which embeds QuickJS | Runs the phone script in the app | Apache-2.0; QuickJS is MIT |
| [Chaquopy](https://chaquo.com/chaquopy/) (Gradle plugin and runtime) | Runs the Python price script | MIT *(to confirm)* |
| Python packages installed by Chaquopy: `requests`, `PyYAML`, `apprise` | Used by the price script | Apache-2.0; MIT; BSD-2-Clause *(to confirm for apprise)* |
| Python (CPython runtime, via Chaquopy) | | PSF License |
| AndroidX (core, activity, lifecycle, work), Jetpack Compose, Material 3, Material Icons Extended | UI and background work | Apache-2.0 |
| Kotlin standard library, kotlinx.coroutines, kotlinx.serialization | | Apache-2.0 |
| Gradle wrapper (`gradle-wrapper.jar`) | Build only | Apache-2.0 |

Apache-2.0 asks redistributors to pass on a copy of the license and any
`NOTICE` files. The APK should show these in Settings > About; until it does,
this file and the release page are the notice (`docs/STORE_READINESS.md` §4).

## 3. Tools (not shipped to users' watches)

| Item | Use | License |
|---|---|---|
| `tools/cruise-sync/` | Python standard library only; endpoints from CheckRoyalCaribbeanPrice | MIT (jdeath notice in `LICENSE`) |
| `tools/quickjs-probe/`: `quickjs-emscripten`, `@jitl/quickjs-ng-wasmfile-release-sync` | Phase 0 check | MIT |
| `tools/shipmap/`, `tools/mockups/`, `tools/store/`: Playwright (Chromium), Pillow | Rendering deck plans, mockups and store art | Apache-2.0; MIT-CMU (HPND) |
| DejaVu Sans (system font, used by `tools/store/icon_c.js` to draw the banner text) | Text in `store/art/banner-720x320.png` | Bitstream Vera / DejaVu license (free to use, embed and modify) |

## 4. Trademarks

"Royal Caribbean", "Royal Caribbean International", "Crown & Anchor",
"Harmony of the Seas" and other ship names are trademarks of Royal Caribbean
Group or its affiliates. "Pebble", "Pebble Time 2" and "Pebble Round 2" are
trademarks of their owner. They are used only to say what Royal Pebble works
with; Royal Pebble is not affiliated with, endorsed by or supported by either.

## 5. Built with Claude

Much of the code and documentation was written with Claude (Anthropic's AI
model) through Claude Code, working with the project's owner, who reviewed
and tested every change. No Anthropic code is included.
