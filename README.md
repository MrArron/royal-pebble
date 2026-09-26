# Royal Pebble

Royal Pebble is a Pebble Time 2 watch app for Royal Caribbean cruises. Glance at
your wrist for the all-aboard countdown and what's next on the ship's schedule,
without pulling out your phone. Everything is loaded before you sail, so it works
at sea with no internet.

> **Not affiliated with Pebble or Royal Caribbean.** This is an independent,
> personal project. It is not made, endorsed or supported by Royal Caribbean
> Group / Royal Caribbean International, or by Pebble or Core Devices. "Royal
> Caribbean" and "Pebble" are trademarks of their owners and are used here only to
> say what the app works with. The app reads Royal Caribbean's public website data
> through unofficial endpoints that can change or stop working at any time.

## What it does

On the watch (open it with a Quick Launch button hold):

- **Home:** on port days, a big countdown to all-aboard, shown in both ship time and
  local time, with your next two starred events under it (topped up with what's
  next). Otherwise, your next starred event or dinner reservation ("NEXT · IN 20
  MIN"), falling back to Royal's featured events, then the next two items.
- **Today** (Down): the day's schedule grouped by start time, with what's on now.
  Select opens an event; hold Select to star it. Stars you set on the watch reach
  the phone the next time they're in touch, even if the phone was away.
- **Where things are:** every event shows its deck and position, on the event
  details, Home's NEXT card and reminder alerts (`Studio B · Deck 4 · Mid`,
  `2 decks down from you`). When your previous starred event ends just before the
  next one, directions start from there instead of your cabin
  (`From Royal Theater: 1 deck down`, `Same venue`). Ship time sits in the middle
  of every top bar.
- **My info** (Up): stateroom, deck, nearest stairs, muster station, ship clock note
  and last sync.
- **Ship directory** (bottom of My info): browse the ship by deck or by area
  (Royal Promenade, Central Park, Boardwalk...). Each place shows its deck, position
  and what's on there for the rest of today. The directory is loaded from the phone
  one deck or area at a time, so it needs the phone nearby.
- **Ship GPS** (ships with a map only, see below): each place page shows the
  walking distance from your cabin (`↓1 deck · 160 m fore`) and the closest
  restroom. Select opens a short step-by-step route (`25 m aft` / `Aft elev to
  Deck 4` / `130 m fore`), and Hold Select the route to that restroom. On Home,
  Select opens the route to your next event. Routes start from your cabin, or
  from a starred event that ends just before. Every distance is approximate.
- **Alerts:** the watch buzzes 60, 30 and 15 minutes before all-aboard, and before
  each starred event or personal entry (5, 15 or 30 minutes, your choice). Alerts
  open the app by themselves and keep working with your phone out of range.
- **Schedule changes:** when a new download moves one of your starred events, the
  star (and its reminder) moves with it; if Royal cancels it, the star is removed.
  Either way the watch buzzes and tells you, and the settings page lists what changed.
- **Works without the phone:** the watch saves the whole day's schedule, so the
  countdown, next events and alerts keep working when the phone is away. If a day
  ever doesn't fit, it keeps the most important things first and tells you when
  it needs the phone again.
- Late nights work as you'd expect: a day on the watch runs from 4 AM to 4 AM, so
  the midnight show and countdowns past midnight stay with the evening they belong to.

On the phone, in the Pebble app's settings page for the watch app (works offline):

- **Cruise:** pick your ship and sailing and tap Download. The activity schedule is
  usually published about two weeks before sailing; download again then, and your
  stars and settings are kept. **Ship venues** lists where each venue is (deck,
  fore/mid/aft, area). It's built in for Harmony of the Seas from its deck plans;
  fix any entry, or fill it in for another ship, here.
- **Days:** per-day ship time and all-aboard times.
- **Filters:** choose which event categories the watch shows.
- **Events:** browse the schedule, star events and add your own entries.
- **Me:** your stateroom details, muster station, light or dark theme, reminder
  lead time and a ship clock note. **Test alerts** sends your watch a test reminder
  and a test all-aboard alert a couple of minutes later, so you can check alerts
  before you sail.

## Ships with Ship GPS

The Ship GPS needs a map of the ship, measured from Royal's deck plans. Ships
mapped so far:

| Ship | Mapped from | Notes |
|---|---|---|
| Harmony of the Seas | deck plans for sailings from May 21, 2026 | Port and starboard not yet checked on board |

On any other ship, everything else works (the schedule, alerts, the directory
with deck and position), but there are no walking distances or routes.

**Map a ship.** Want the Ship GPS on your Royal Caribbean ship? The tools that
built Harmony's map are in [`tools/shipmap/`](tools/shipmap/README.md): they
download the ship's deck plans and turn them into cabins, venue spots and
walkways. Pick a ship, map it, and open a pull request; the README there
explains each step and what to check.

## Status

Version 1 is done and in use on a real Pebble Time 2. Version 1.1 is being built
for the owner's first sailing, one feature at a time, each
tested on the watch before it's merged. The full plan is in the
[project brief](docs/PROJECT_BRIEF.md).

- **Done:** v1; v1.1 Phase 1 (wayfinding: the venue table, deck and position on
  the watch, "From" directions and the ship directory); Phase 2 (daily view: the
  morning summary, days-to-sail countdown, clash warnings, last-chance tags and
  the reservation reminder with **Mark reserved**); and most of the Ship GPS
  (walking distances, closest restrooms, elevator banks and routes).
- **Next:** the rest of the Ship GPS (button hints and a Help section on the
  settings page), then a usage log to review after the sailing, followed by
  port-day and planning features if time allows.

## Getting it on your watch

It isn't in the Pebble app store; you sideload it.

- **CloudPebble:** import this GitHub repository (or a branch of it), build, and
  install to your watch.
- **Pebble SDK:** `pebble build`, then `pebble install --phone <your phone's IP>`.
  The only target is the Pebble Time 2.

Then open the app's settings in the Pebble phone app and download your sailing
**before you leave home, while you still have internet.** Royal usually publishes
the activity schedule about two weeks before sailing, so download again once it
appears (your stars and settings are kept). Once your sailing and its schedule are
downloaded, Royal Pebble works at sea with no internet: nothing on the watch or the
settings page needs a connection.

### Backup: the Windows sync tool

If the in-app Download doesn't work (for example, Royal's servers refuse your
phone), `tools/cruise-sync` downloads the same data on a Windows PC. You paste the
result into **Settings > Cruise > Backup: paste cruise data**. It can optionally log
in to your Royal Caribbean account to add your stateroom. See
[tools/cruise-sync/README.md](tools/cruise-sync/README.md).

## Privacy

- The watch app and phone settings never ask for your Royal Caribbean login. They
  only read public sailing and schedule data.
- Your personal details (stateroom and so on) stay in the Pebble phone app's storage
  on your phone.
- The sync tool's optional login uses your password once and never saves it. Its
  output file can contain your stateroom number, so don't share it.

## For developers

- `src/c/`: watch app (C, Pebble SDK 4.x, platform `emery`).
- `src/pkjs/`: phone companion (PebbleKit JS): data download, settings page, and
  what gets sent to the watch.
- `tools/cruise-sync/`: Windows backup tool (Python), the reference implementation
  of every Royal Caribbean request.
- `tools/shipmap/`: builds the Ship GPS map data (`src/pkjs/data/`) from Royal's
  deck plans. New ships welcome (see Ships with Ship GPS above).
- `docs/`: [project brief](docs/PROJECT_BRIEF.md), [design](docs/DESIGN.md),
  [data format](docs/DATA_FORMAT.md), [phone ↔ watch protocol](docs/WATCH_PROTOCOL.md),
  [v1.1 design](docs/DESIGN_V1_1.md) (mockups in `docs/mockups/`).
- Tests (Node): `node test/pkjs/<name>.test.js` for `slice`, `settings`, `venues`
  and `directory`.
- Emulator: `pebble build`, `pebble install --emulator emery`.

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
  the built-in venue table (deck, position and area of each venue).
- **Pebble SDK** project template (`wscript`), from `pebble new-project`.
- **Clay** (Pebble's configuration library): the idea of opening the settings page
  as a local `data:` URL so it works offline. No Clay code is included.
- **Built with help from Claude**, Anthropic's AI model, through Claude Code. Claude
  aided in designing and writing the watch app, phone companion, settings page, sync
  tool, venue table, tests and documentation, working with the project's owner who tested every
  step on a real Pebble Time 2.

## License

[MIT License](LICENSE), for the code and the docs. You can use, change and share
this project freely; just keep the copyright and license notice. The parts derived
from CheckRoyalCaribbeanPrice are also MIT-licensed (Copyright (c) 2025 jdeath),
and their notice is kept in the same file.
