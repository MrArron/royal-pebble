# Royal Pebble

Royal Pebble is a Pebble Time 2 watch app for Royal Caribbean cruises. Glance at
your wrist for the all-aboard countdown, what's next on the ship's schedule and
how to get there, without pulling out your phone. Everything is loaded before
you sail, so it works at sea with no internet.

> **Not affiliated with Pebble or Royal Caribbean.** This is an independent,
> personal project. It is not made, endorsed or supported by Royal Caribbean
> Group / Royal Caribbean International, or by Pebble or Core Devices. "Royal
> Caribbean" and "Pebble" are trademarks of their owners and are used here only to
> say what the app works with. The app reads Royal Caribbean's website data
> through unofficial endpoints that can change or stop working at any time.

## Features at a glance

On the watch (open it with a Quick Launch button hold):

- **Home:** on port days, a big countdown to all-aboard in ship and local time,
  with a time-ashore bar that turns red in the last stretch. Otherwise your next
  starred event or personal entry (`NEXT · IN 20 MIN`) with its deck and
  position. Before the cruise, the days to sailing.
- **Morning summary** on the first open of the day, and tomorrow's from 8 PM.
- **Today:** the day's schedule with what's on now. Select opens an event (deck,
  time, ages, arrive-by time, what to bring); hold Select stars it. Clashes,
  **Last chance** shows and reservations to make are flagged.
- **Alerts** before all-aboard and before each starred event, even with the
  phone out of range, plus an evening reminder of what still needs reserving.
- **My info:** stateroom, deck, nearest stairs, muster station, dining room.
- **Ship directory** by deck or area, and on mapped ships the **Ship GPS**:
  walking distance from your cabin, the closest restroom and a step-by-step
  route (`50 m aft` / `Aft elev to Deck 16`).
- **Voice:** hold Select and ask "how do I get to Studio B", "closest restroom",
  "I'm at the Solarium" or "when do we leave". Speech is recognised on the
  phone, so it works in airplane mode with the phone nearby.
- **I'm on board** ends the day's countdown once you're back.
- **Booked excursions** and the terminal arrival time, from your Royal login.

On the phone, in the Pebble app's settings page for Royal Pebble (works offline):

- **Cruise:** download your sailing, optionally with your Royal login for your
  booking; a **Ready to sail** check; ship venues; **Share my plan** with a
  travel companion.
- **Days:** ship time, all-aboard time and warning period per day.
- **Filters:** categories, Casino, and adult / teen / family events.
- **Events:** search, star, mark reserved, your own entries, and pick the paid
  classes and shore excursions you booked.
- **Me:** cabin details, units, theme, reminders, test alerts, the usage log,
  the map check and **Help** (every button, voice commands, tips).

## Ships with Ship GPS

The Ship GPS needs a map of the ship, measured from Royal's deck plans:

| Ship | Mapped from | Notes |
|---|---|---|
| Harmony of the Seas | deck plans for sailings from May 21, 2026 | Port and starboard not yet checked on board; a few spots still to confirm (Me > Map check) |

On any other ship everything else works (schedule, alerts, the directory with
deck and position), without walking distances, routes or voice place names.

**Map a ship.** The tools that built Harmony's map are in
[`tools/shipmap/`](tools/shipmap/README.md). Pick a Royal Caribbean ship, map
it, and open a pull request; the README there explains each step.

## Install on a Pebble Time 2

Royal Pebble isn't in the Pebble app store; you sideload it with the Pebble app
on an Android phone (the only phone it has been tested with).

1. Get `royal-pebble.pbw`: build it from source (below), which writes
   `build/royal-pebble.pbw`.
2. Copy the `.pbw` to the phone and open it with the Pebble app, which
   installs it on the watch. Or, with the Pebble app's developer connection
   on, run `pebble install --phone <phone's IP>` from the SDK.
3. Open Royal Pebble's settings in the Pebble app and download your sailing.

## Getting your cruise in

Do this **before you leave home, while you still have internet**. Royal
publishes the activity schedule about two weeks before sailing; download again
once it appears (stars and settings are kept). After that nothing needs a
connection.

- **Download** (settings page, Cruise): pick your ship and sailing. Public data
  only: itinerary, schedule, shore excursions.
- **Advanced download with your Royal login** (same card): also fetches your
  stateroom, deck, muster station, terminal arrival time, booked excursions and
  gangway times. Your email and password go only to Royal Caribbean for that
  one download and are never saved.
- **Backup: the Windows sync tool** ([`tools/cruise-sync/`](tools/cruise-sync/README.md)),
  if the phone can't download: it saves the same data as text, optionally with
  your login, and you paste it into **Cruise > Backup: paste cruise data**.

## Privacy

- The app reads public sailing and schedule data, plus your booking when you
  use the Advanced download or the sync tool's login. Your password is used
  once and never saved or logged.
- Your cruise and cabin details stay in the Pebble app's storage on your phone
  and on your watch. The sync tool's output file can hold your stateroom and
  booking, so don't share it.
- The usage log and map notes stay on your phone and leave it only when you
  copy them. They can include event titles and cabin details; treat a copy as
  private. The usage log can be turned off on the Me tab.

## Build from source

Pebble SDK 4.x (`pebble build`, platform `emery`), Node for the phone tests and
Python for the tools. Commands, emulator tips and working rules are in
[`CLAUDE.md`](CLAUDE.md).

- `src/c/`: the watch app (C). `src/pkjs/`: the phone companion (PebbleKit JS),
  including the settings page and generated map and voice data.
- `tools/cruise-sync/`: Windows sync tool, the reference for every Royal
  request. `tools/shipmap/`: ship map data. `tools/voice/`: voice lexicon.
  `tools/mockups/`: design mockup scripts. `tools/watch_size.py`: watch size
  check.
- Tests: `node test/pkjs/<name>.test.js` for each file in `test/pkjs/`;
  `python tools/cruise-sync/test_cruise_sync.py`.

## Docs

| File | What it holds |
|---|---|
| [`docs/PROJECT_BRIEF.md`](docs/PROJECT_BRIEF.md) | Purpose, constraints, what's built, decisions, limits, later ideas |
| [`docs/DESIGN.md`](docs/DESIGN.md) | Every watch screen and settings-page tab as built, colors, mockups |
| [`docs/PLAN.md`](docs/PLAN.md) | The work left before the sailing: Phase 5 tuning, Phase 6, the freeze |
| [`docs/DATA_FORMAT.md`](docs/DATA_FORMAT.md) | The cruise data bundle and the shared plan format |
| [`docs/WATCH_PROTOCOL.md`](docs/WATCH_PROTOCOL.md) | Phone ↔ watch messages, storage and the time model |
| [`docs/ROYAL_LOGIN_DATA.md`](docs/ROYAL_LOGIN_DATA.md) | What a Royal login can see |

## Credits and attributions

- **[jdeath/CheckRoyalCaribbeanPrice](https://github.com/jdeath/CheckRoyalCaribbeanPrice/tree/main)**
  (MIT License, Copyright (c) 2025 jdeath): the knowledge of Royal Caribbean's web
  endpoints, the public web-app `AppKey` and the login client used by the sync tool
  and the phone companion all come from this project. Thank you.
- **Howard Hinnant's date algorithms**
  ([`days_from_civil` / `civil_from_days`](https://howardhinnant.github.io/date_algorithms.html),
  public domain): used on both the phone and the watch to count days without time
  zones.
- **Royal Caribbean's published deck plans** for Harmony of the Seas: the source of
  the built-in venue table and the Ship GPS map.
- **Pebble SDK** project template (`wscript`), from `pebble new-project`.
- **Clay** (Pebble's configuration library): the idea of opening the settings page
  as a local `data:` URL so it works offline. No Clay code is included.
- **Built with help from Claude**, Anthropic's AI model, through Claude Code. Claude
  aided in designing and writing the watch app, phone companion, settings page, sync
  tool, venue table, tests and documentation, working with the project's owner who
  tested every step on a real Pebble Time 2.

## License

[MIT License](LICENSE), for the code and the docs. You can use, change and share
this project freely; just keep the copyright and license notice. The parts derived
from CheckRoyalCaribbeanPrice are also MIT-licensed (Copyright (c) 2025 jdeath),
and their notice is kept in the same file.
