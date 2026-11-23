# Royal Pebble privacy policy

Royal Pebble is a free, open-source hobby project. It has no servers, no
accounts, no analytics and no ads. This page says what data the app handles,
where it goes and how to remove it. It covers the watch app and its settings
page, the optional Android app, and the Windows sync tool.

Last updated: 2026-11-18.

## The short version

- Nothing is ever sent to the developer. There is no Royal Pebble server.
- The only service the watch app's phone side talks to is Royal Caribbean's
  own website, and only when you tap Download.
- Your Royal Caribbean password is used for that one sign-in and is not
  saved by the watch app.
- Your cruise details stay on your phone and your watch until you delete
  them.

## What the app downloads, and from where

| When | From | What |
|---|---|---|
| You tap **Download** in the settings page | royalcaribbean.com and Royal Caribbean's API (`aws-prd.api.rccl.com`) | Public data for the sailing you pick: itinerary, daily schedule, shore excursions |
| You use **Download with your Royal login** | the same Royal Caribbean sites | Also your booking: stateroom, deck, muster station, terminal arrival time, booked excursions and add-ons. To pick your own booking when the account lists several, the phone compares your profile's Crown & Anchor number, name and birth date with the booking's guests; those are used on the phone and not kept in the saved cruise |
| The Android app runs a **price check** (optional, only if you turn it on) | Royal Caribbean's sites, signed in with your account | Your bookings' prices, check-in status and payment dates |
| The Android app looks for a newer **app release** (Settings > About; **Check for updates**, and once a day while the app is open unless you turn that off) | api.github.com (this project's releases) | One anonymous request for the newest release's name and APK link; nothing about you is sent. If you press Download, the APK comes from github.com. |
| The Android app updates its **price script** | github.com (this project's releases, or optionally jdeath's repository) | The `CheckRoyalCaribbeanPrice.py` script only; nothing about you is sent |

Royal Caribbean's handling of your sign-in is covered by Royal Caribbean's
own privacy policy. Royal Pebble uses unofficial endpoints of their website;
they may log the request like any visit to their site.

## Your password

- **Watch app settings page:** your email and password go straight to Royal
  Caribbean for the one download, then are dropped. They are never saved,
  logged or shown again.
- **Android app:** the same, unless you turn on "Remember on this phone" or
  background price checks. Then the password is saved encrypted with the
  Android Keystore (AES-256-GCM; the key never leaves the Keystore). Turning
  background checks off deletes the saved copy and its key. `config.yaml`
  never holds your password.
- **Windows sync tool:** asks for the password each run and doesn't save it.

## What stays on your devices

- The downloaded cruise (schedule, your stars, reservations, personal
  entries, cabin details you type in) is kept in the Pebble app's storage on
  your phone, in the Android app's storage if you use it, and on the watch.
- The **usage log** and **map notes** record how the app is used (screens
  opened, alerts fired, event titles, cabin details for the map check). They
  stay on your phone and leave it only if you copy or share them yourself.
  The usage log can be turned off on the Me tab. Treat a shared copy as
  private: it can hold your cabin number.
- **Price watches** in the Android app (the item links you add, their prices,
  and which alerts you muted) stay in the app's storage on your phone. They
  are checked with the same signed-in price check as your bookings.
- **Share my plan** creates a text you send yourself (it can include your
  stars and personal entries). Nothing is uploaded.
- The sync tool writes a `cruise-watch-*.json` file on your PC, which can
  hold your stateroom.

## What the app never does

- No analytics, crash reporting, advertising or tracking SDKs.
- No location tracking. "Ship GPS" works out distances from your cabin on a
  ship map built into the app; it doesn't use the phone's GPS.
- No selling or sharing of data: the developer never receives any.

## Voice

Hold Select on the watch to ask a question. Speech is turned into text by the
Pebble app's own dictation on your phone; Royal Pebble receives only the text
and answers it on the phone. The text can appear in the usage log.

## Removing your data

- Uninstall Royal Pebble from the watch and the Pebble app, or use the
  settings page to replace the downloaded cruise.
- In the Android app, clear its storage in Android settings, or uninstall it.
- Delete any `cruise-watch-*.json` files and shared logs you made.

## Children

Royal Pebble isn't aimed at children and collects nothing from anyone.

## Contact

Questions or problems: open an issue at
https://github.com/MrArron/royal-pebble/issues (don't post cabin numbers,
booking numbers or other personal details there; the repository is public).

## Changes

Changes to this policy are made in this file, so its history on GitHub shows
every version.
