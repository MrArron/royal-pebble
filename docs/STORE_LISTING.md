# Royal Pebble — Pebble appstore listing (draft)

Copy-ready text and the asset list for the appstore listing. Everything here
is a draft for the owner to approve; open choices are in
[`STORE_READINESS.md`](STORE_READINESS.md) §6. The listing describes the
**watch app** (`.pbw`). The optional Android app is sideloaded from GitHub and
is not part of the appstore listing (see §6 below).

Field names and sizes follow the appstore guide, "Preparing a Submission"
(developer.repebble.com/guides/appstore-publishing/preparing-a-submission/,
read 2026-11-18). The appstore takes the description as **plain text**, so
the text below has no Markdown inside the fences.

## 1. Basic details

| Field | Value |
|---|---|
| App name | Royal Pebble (comes from `displayName` in `package.json`) |
| Type | Watchapp (`watchapp.watchface: false`) |
| Category | **Daily** (alternative: Tools & Utilities) |
| Platforms | Pebble Time 2 (`emery`), Pebble Round 2 (`gabbro`); one `.pbw` |
| Website URL | https://github.com/MrArron/royal-pebble |
| Source code URL | https://github.com/MrArron/royal-pebble |
| Support | GitHub issues: https://github.com/MrArron/royal-pebble/issues (a support email is optional; see decisions) |
| Price | Free. No in-app purchases, no premium tier, no ads, ever. |
| Visibility | Start **Unlisted** for a few testers, then **Listed** (decision D7) |
| UUID | `c2b564f0-f418-4968-b545-08825e3fef19` (must stay the same for every release) |
| Version | `package.json` `version`, numbers and dots only, each part at most 255, new for every release |

## 2. Short description

The appstore has one description field; this first line is written to stand
on its own where a listing is cut short.

```
Your unofficial Royal Caribbean cruise companion on your wrist: all-aboard countdown, today's schedule, alerts and directions around the ship. Works offline at sea. Free and open source.
```

## 3. Description (long)

```
Royal Pebble is your unofficial Royal Caribbean cruise companion, on your wrist. Glance at your watch for the all-aboard countdown, what's on next and how to get there, without pulling out your phone. Everything is downloaded before you sail, so it works at sea with no internet and no paid Wi-Fi.

ON THE WATCH
- Home: on port days a big countdown to all-aboard in ship time and local time, with a time-ashore bar. Otherwise your next starred event with its deck and position. Before the cruise, the days to sailing.
- Morning summary of the day, and tomorrow's from 8 PM.
- Today: the day's schedule with what's on now. Open an event for its deck, time, ages and what to bring; hold Select to star it. Clashes, last-chance shows and reservations still to make are flagged.
- Alerts before all-aboard and before each starred event, even with the phone out of range.
- My info: stateroom, deck, nearest stairs, muster station, dining room.
- Ship directory by deck or area. On mapped ships, Ship GPS: walking distance from your cabin, the closest restroom and step-by-step routes (see SHIPS below).
- Voice: hold Select and ask "how do I get to Studio B" or "closest restroom". Speech is recognised on the phone, so it works in airplane mode with the phone nearby.

ON THE PHONE (the app's settings page, works offline)
- Download your sailing before you leave home: itinerary, the daily schedule (published about two weeks before sailing) and shore excursions.
- Optional: sign in with your Royal Caribbean account for that one download to add your stateroom, muster station, terminal arrival time and booked excursions. Your password goes only to Royal Caribbean and is never saved.
- Star events, mark reservations, add your own entries, set all-aboard times and filters, and share your plan with a travel companion.

SHIPS
- Cruise lines: Royal Caribbean today. The app is built so other lines can be added later.
- Ship GPS and voice directions (ships mapped so far): Harmony of the Seas.
- Every other Royal Caribbean ship gets everything else: schedule, alerts, my info and the directory by deck.
- Want your ship mapped? The tools that mapped Harmony are in the project on GitHub, and pull requests adding ships are welcome.

FREE AND OPEN SOURCE, FOREVER
Royal Pebble is a free, open-source hobby project (MIT License). It will never charge money, sell a premium version, show ads or put features behind a paywall. The source code is on GitHub.

PRIVACY
No account with us, no tracking, no analytics. Your cruise details stay on your phone and watch. The app talks only to Royal Caribbean's own website, and only when you tap Download. Full policy: https://github.com/MrArron/royal-pebble/blob/main/PRIVACY.md

NOT AFFILIATED
Royal Pebble is an independent, unofficial app. It is not made, endorsed or supported by Royal Caribbean Group or Royal Caribbean International. "Royal Caribbean" and ship names are trademarks of their owners, used only to say what the app works with. It reads Royal Caribbean's public website data through unofficial endpoints that can change or stop working at any time; always check the official Royal Caribbean app and the ship's announcements for times that matter, such as all-aboard.

Requires a Pebble Time 2 or Pebble Round 2 and an Android phone with the Pebble app. Tested with Android only.
```

Notes on the text:

- The SHIPS list must change when another ship is mapped (the ship list in
  the README is the source).
- "Tested with Android only" stays until someone tries the Pebble app on
  iPhone (the settings page should work there; nothing iOS-specific is known
  to break).
- Keep the free-forever and not-affiliated paragraphs in every edit of this
  text; they are the point of `STORE_READINESS.md` §2.

## 4. Release notes (first release)

```
First appstore release. All-aboard countdown, today's schedule, starred-event alerts, ship directory, Ship GPS on Harmony of the Seas, voice questions and offline settings. Free and open source; not affiliated with Royal Caribbean.
```

Later releases: one or two plain sentences on what changed for the wearer,
taken from the PR descriptions since the last release. Never mention a
sailing date, cabin or other personal detail.

## 5. Images

All PNG (JPEG and GIF also allowed), at most 4.4 MB each. Screenshots must be
exactly the display size and **not** framed in a watch outline.

| Asset | Size | Count | Source |
|---|---|---|---|
| Large icon | 144×144 | 1 | `store/art/icon-144.png` (C3b, chosen) |
| Small icon | 80×80 | 1 | `store/art/icon-80.png` (C3b, chosen) |
| Banner | 720×320 | 1 per platform (optional) | `store/art/banner-720x320.png` |
| Screenshots, Pebble Time 2 | 200×228 | up to 5 | emulator, `emery`, demo cruise |
| Screenshots, Pebble Round 2 | 260×260 | up to 5 | emulator, `gabbro`, demo cruise |

`node tools/store/icon_c.js` regenerates the icons and banner (the chosen
icon is concept C3b, a Pebble Time 2 showing a cruise ship bow-on).

### Screenshot plan (5 per watch)

Take them from the **demo cruise** (what the app shows before a sailing is
saved) so no real booking, cabin or date appears. The demo's stateroom is a
made-up number. Use the dark theme on one or two for variety.

1. Home, port day: the all-aboard countdown with the time-ashore bar.
2. Today: the schedule with an event on now and a starred event.
3. Event details: deck, time, ages and arrive-by.
4. Ship GPS route: `FROM YOUR CABIN` with step-by-step lines.
5. Morning summary, or the voice answer card for "closest restroom".

How: on the owner's PC, `bash tools/screens.sh <out-dir> emery gabbro`
captures the main screens; add the route and voice shots by hand
(`CLAUDE.md`, Commands). Before uploading, open every image and check it
shows only demo data. Save the picks as `store/screenshots/emery-1.png` ...
`gabbro-5.png`.

## 6. Companion app

`package.json` lists two Android packages under `companionApp` (the Royal
Pebble Android app and the Phase 0 link test app), with `required: false`.
The appstore's companion fields want a Google Play listing (name, Play Store
URL, 144×144 icon), and neither app is on Google Play. Recommended: don't
declare a companion in the appstore listing; mention the optional Android app
only through the GitHub link. Whether to drop the link test package from
`package.json` before release is decision D6.

## 7. Policy checks against this listing

- No timeline web API (the appstore doesn't support it): Royal Pebble uses
  none; alerts are local wakeups.
- `.pbw` under 4.4 MB: 1.6 MB at 1.6.24.
- UUID unique and unchanged; new version per release.
- Settings page loads locally (`data:` URL), no internet needed to open it.
- Permissions: the store lists the app's declared permissions as Required
  or Optional. Royal Pebble declares one, Internet for Royal Caribbean's
  domains, required (`STORE_READINESS.md` §7). Build the store `.pbw` with
  SDK 4.44+ so it isn't shown as a legacy app.
