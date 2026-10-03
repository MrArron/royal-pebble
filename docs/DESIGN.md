# Royal Pebble — Design

How the watch app and the phone settings page look and behave, as built in
1.6.4. One section per screen or feature. Designs that are approved but not
built are only in §13. The data behind the screens is in `DATA_FORMAT.md`
(the bundle) and `WATCH_PROTOCOL.md` (phone ↔ watch bytes); scope and
decisions are in `PROJECT_BRIEF.md`.

When this file and a mockup differ, this file wins. When this file and the
code differ, the code is right and this file needs a fix.

## Contents

1. Basics
2. Colors
3. Top bar
4. Home
5. Morning summary and tomorrow card
6. Today list
7. Event details
8. Alerts
9. My info
10. Ship directory and Ship GPS
11. Voice (Ask)
12. Settings page
13. Not built yet
14. Mockups
15. Pebble Round 2 (gabbro)

---

## 1. Basics

- **Watch:** Pebble Time 2, 200×228, 64-color palette (every color here is in
  it). System fonts only: Gothic 14/18/24/28 bold for text, Bitham 42 bold for
  the big countdowns. There are no bitmaps or custom fonts.
- **Mockups** are drawn at 2× (400×456 watch, 390×844 phone) with Roboto
  Condensed standing in for Gothic: 48 px ≈ Gothic 24 bold, 34 px ≈ Gothic 18
  bold, 26-30 px ≈ Gothic 14 bold. Check wide lines in the emulator, not the
  mockup.
- **Muted** text is `#555555` (light) / `#AAAAAA` (dark).
- **Drawn glyphs.** The system fonts can't be trusted with ↑ ↓ → ★ ✓ `!`, so
  the watch draws them: ↑/↓ at the digit cap height of the font beside them
  (about 10 px next to Gothic 14, 12 px next to Gothic 18), 1 px before the
  number; → centered on the lowercase letters with 2 px each side.
- **The phone does the thinking.** Venue lookups, distances, routes, clashes
  for the settings page, last-chance tags and every voice answer are worked
  out on the phone; the watch formats numbers and draws strings it's sent. The
  watch has no ship knowledge, so other ships need no watch change.
- **Wording rules.** Never show "unknown": leave a line out when its value is
  missing. Distances carry no `~`; the Help screen says once that every
  distance is approximate (owner, 2026-09-26). Times follow the watch's
  12/24-hour setting (`1:00p` in 12-hour style).
- **Lists scroll** with Up/Down and the muted content triangles when a page
  doesn't fit (details, reminders, place pages, routes, Ask).

## 2. Colors

### Watch theme tokens

| Token | Light | Dark |
|---|---|---|
| background | `#FFFFFF` | `#000000` |
| text | `#000000` | `#FFFFFF` |
| muted text | `#555555` | `#AAAAAA` |
| divider | `#AAAAAA` | `#555555` |
| port accent (countdown label, warnings to act on) | `#AA5500` | `#FFAA00` |
| sea accent (NEXT, star, ✓, hints, route glyphs) | `#0055AA` | `#00AAFF` |
| list cursor background / text | `#0055AA` / `#FFFFFF` | `#00AAFF` / `#000000` |
| NOW label | `#005555` | `#55FFAA` |
| sea pale (time-ashore bar: excursion still ahead) | `#55AAFF` | `#0055AA` |
| warning red (bar: warning window passed) | `#AA0000` | `#FF5555` |
| warning red pale (bar: warning window still ahead) | `#FF5555` | `#AA0000` |
| warning sign (beside the countdown) | `#FF0000` | `#FF0000` |

### Top bar bands (same in both themes)

| Context | Band | Right label |
|---|---|---|
| Port day | `#005555` | `#AAFFFF` |
| Sea day, Today list | `#000055` | `#AAFFFF` |
| My info, directory, Ask, schedule change | `#555555` | `#FFFFFF` |

### Settings page palette

Material 3 Expressive look, hand-built CSS (no component library, works
offline), Roboto Flex with a system-font fallback. Light scheme only. Teal to
match the port band:

| Role | Color |
|---|---|
| primary / on-primary | `#006A6A` / `#FFFFFF` |
| primary container / on (done, confirmed: `✓ Reserved`) | `#9CF1F0` / `#002020` |
| secondary container / on | `#CCE8E7` / `#051F1F` |
| tertiary container / on (personal entries) | `#D3E4FF` / `#001C38` |
| warning container / on (edited, pending, needs action) | `#FFDDB5` / `#2A1700` |
| surface / container low / container / container high | `#F4FBFA` / `#EFF5F4` / `#E9EFEE` / `#E3E9E9` |
| on-surface / on-surface variant / outline (needs checking) | `#161D1D` / `#3F4948` / `#6F7979` |

Shapes: cards 28 px radius, pill buttons, 12 px text fields, connected
segmented buttons, 36 px filter chips.

## 3. Top bar

One line, 22 px, on every screen (alerts and schedule changes included):

- **Left:** the screen's name. Home shows the port or `At Sea`; alerts say
  `Reminder`, `All aboard` or `To reserve`; others say `Today`, `My Info`,
  `Event`, `Place`, `Route`, `Ask`, `Schedule`.
- **Center:** the current ship time, Gothic 14 bold, white, updated each
  minute. It's in the same place on every screen.
- **Right:** a small-caps context label (`DOCKED`, `AT SEA`, `on board`,
  `↓3 decks`). Dropped when it doesn't fit or repeats the name; the time
  always wins.

## 4. Home

The app opens on Home (or the morning summary, §5). Up = My info, Down =
Today, Select = route to the next event, Hold Select = Ask by voice (§11),
Hold Up = next demo variant (demo data only), Back = exit.

### 4.1 NEXT card (sea days, and port days once on board or after all-aboard)

```
★ NEXT · IN 20 MIN             sea accent
Name That Tune Trivia          Gothic 24 bold, wraps
12:00p · On Air                Gothic 18 bold, muted
Deck 4 Aft · ↓2      Route ›   Gothic 14 bold, muted; Route › in sea accent
1 clash                        Gothic 14 bold, port accent (only if any)
Last chance                    Gothic 14 bold, port accent (when tagged)
──────────
1:00p Adults Only Trivia       next two items, Gothic 18 bold
Studio B · 4 Mid               Gothic 14 bold, muted
```

- The card is the next starred event or personal entry. With nothing starred
  ahead: Royal's featured events (`FEATURED`, when the featured switch is
  on), else `Nothing starred today`.
- The next items are upcoming starred items first, topped up with the next
  events, in time order. Items read `Last chance · Venue · 4 Mid` when
  tagged and `Only show · Studio B · 4 Mid · ✓ Reserved` when reserved (the
  venue gives way with an ellipsis).
- A starred event that needs a reservation and isn't reserved gets a
  `Not reserved` line (port accent) under the deck line.
- Short forms: `Deck 6 Aft · your deck` on the cabin deck; `Venue · Ashore`
  for ashore venues.
- **Select** opens the Route screen to the card's event (or the featured one,
  or one on now), starting where you'll be before it (§10.4) and ending with
  the event's time and title instead of the summary. `Route ›` shows only
  when the venue is on board (a deck, not Ashore).

### 4.2 Port day: all-aboard countdown

Shown on embark and port days until all-aboard (or the day's `depart`, if
that comes first), unless the user said they're on board (§4.4).

```
[CocoCay       10:05a       DOCKED]
ALL ABOARD IN                  Gothic 18 bold, port accent
6:25  ⚠                        Bitham 42 bold; warning sign in the window
4:30p ship · 4:30p local       Gothic 18, muted
[====|=======--------------##] time-ashore bar, 184 × 8 px
7:00a                  4:30p   Gothic 14 bold, muted
Excursion back 11:30a          Gothic 14 bold, sea accent
1 clash                        (only if any)
Hold Select: I'm on board      Gothic 14 bold, sea accent
```

- **Time-ashore bar** from the day's arrival (or 04:00 without one) to
  all-aboard, rounded ends, a 2 × 12 px now tick in the text color. Colors
  change at now (the owner's idea: on a small screen the color change shows
  now better than the tick alone):

| Part | Passed (left of now) | Still ahead |
|---|---|---|
| Plain time | port accent | divider |
| Booked excursion (`time`-`end`) | sea accent | sea pale |
| Warning window (last *warning period* minutes) | warning red | warning red pale |

  The warning window is drawn over the excursion where they overlap.
- `Excursion back 11:30a` shows while the day's first booked excursion's end
  is ahead.
- **Warning sign:** inside the warning window, a red triangle with a black
  `!`, about 31 × 28 px, 8 px right of the digits.
- The bar replaced the next-items list on this layout (owner, 2026-09-26);
  Today is one press away. Tender days look the same as other port days; the
  difference is the longer warning period (§12.3).
- Without an all-aboard time there's no countdown: Home shows the NEXT card.

### 4.3 Embark day: terminal arrival

From 04:00 until the arrival time, when the booking has one (`mine.arrival`):

```
TERMINAL ARRIVAL               Gothic 18 bold, port accent
11:30a                         Bitham 42 bold
in 2 h 18 min                  Gothic 18, muted
Hold Select: I'm on board
──────────
All aboard 3:30p               Gothic 18 bold
Sails 4:00p                    Gothic 14 bold, muted (left out without depart)
```

At the arrival time Home switches to the all-aboard countdown. When Royal's
arrival is text rather than a time, the card shows the text (Gothic 24 bold,
cut with an ellipsis) without `in …` until on board or all-aboard.

### 4.4 I'm on board

On embark and port days with an all-aboard time, the user can end the day's
countdown:

- **By voice** (the normal way, 1.5.4): Hold Select opens Ask; say `I'm on
  board` (or `I'm ashore` to undo).
- **With the phone away:** Hold Select opens the `On board?` screen:
  `On board?` (Gothic 24 bold), `Ends today's countdown`, `All-aboard alerts
  off.` / `Undo in My info.`, with edge labels `Hold: yes` beside Down (sea
  accent pill) and `Not yet` beside Back. Hold Down confirms; Back cancels;
  no timeout.
- **Then:** a short buzz and a 2 s `✓ On board` screen; Home shows the NEXT
  card with the port band and the right label `on board`; the day's
  all-aboard alerts are cancelled. Reminders, Today, directory and routes
  don't change.
- **Undo:** My info's first row reads `ON BOARD` / `Since 2:40p` / `Select:
  back ashore`. Select clears it and re-arms alerts still ahead.
- Kept on the watch with the day, cleared at 04:00. The usage log records set
  and undo times. Not offered on sea or debark days.

### 4.5 Days to sail (before the cruise)

```
SAILS IN                       small caps, muted
78                             Bitham 42 bold
days                           Gothic 18 bold
Sat Mar 6 · Port Canaveral     Gothic 18 bold, muted
Harmony of the Seas            Gothic 14 bold, muted
──────────
★ 3 starred so far             Gothic 14 bold (or `Nothing starred yet`)
```

The watch counts the days from the sail date, so it stays right without the
phone. In the last 3 days it adds `Sync before you leave` / `Works offline
after a full sync` with the last sync date; the day before it reads
`Tomorrow`, and from midnight to 04:00 on sail day `Today`. After the cruise:
`CRUISE ENDED`.

### 4.6 Button hints

On the first 3 user opens (not alerts or installs), and again after an update
adds a button, Home fades to gray under white-outlined labels pointing at each
button: `My info` (Up), `Today` (Down), `Route to next` (Select, only when
there's an event to route to) or `Hold: on board` (when Select has nothing
but on board is offered), `Exit` (Back). They show once Home has its data
(after the morning summary). Up, Select and Down only dismiss them; Back
exits. The open count and a hints version are kept on the watch. Help's
**Always show button hints** switch shows them on every open.

## 5. Morning summary and tomorrow card

Replaces Home on the first user open of the watch day (after 04:00). Opens by
an alert or the silent sync don't count. Any button goes on to Home; Up and
Down go on to My info and Today. My info's first row (`Today's summary` /
`Tomorrow's summary`) reopens it. Everything on it is stored with the day.

```
[St. Thomas     9:12a     DOCKED]
DAY 4 · PORT DAY               small caps, muted
St. Thomas                     Gothic 24 bold
Docked 7:30a - 5:30p           Gothic 18 bold (ship time)
Port time +1 h                 muted, only when the offset isn't 0
All aboard 5:00p               Gothic 18 bold, port accent
──────────
★ 4 starred today              Gothic 18 bold
First 10:00a Zumba             Gothic 14 bold, muted
1 clash                        Gothic 14 bold, port accent (only if any)
```

- **Sea day:** `DAY 2 · SEA DAY`, `At sea`, no docked or all-aboard lines;
  room for the first two starred items.
- **Embark:** `DAY 1 · EMBARK`, the port, `Terminal arrival 11:30a` (when the
  booking has a time), `Sails 4:00p`, `All aboard 3:30p`.
- **Debark:** `LAST DAY · DEBARK`, the port, `Arrive 6:00a`.
- **Nothing starred:** `Nothing starred yet`, plus `6 featured today` when
  the featured switch is on.
- **Tomorrow card:** on the first open after 20:00 (and from the My info row
  until 04:00), the same card for the next day, labelled `TOMORROW · DAY 5 ·
  PORT DAY` with top bar `Tomorrow`. It adds `Last chance: Hairspray` when
  tomorrow has a final performance and `2 to reserve` (port accent) under
  the `First` line.

## 6. Today list

```
[Today        12:40p        AT SEA]
12:00p  Name That Tune Trivia   ★ !
        On Air · 4 Aft
        Adults Only Trivia
        Studio B · 4 Mid
NOW     Pool Games
        ends 12:45
```

- Rows are a time column plus title and venue line. Events with the same
  start are grouped: the time on the first row only, dividers only between
  groups. In-progress events show `NOW` and `ends 11:45`.
- Finished events drop off at their end, or 30 minutes after the start when
  there's no length.
- ★ on starred rows; a drawn port-accent `!` after the star on clashing rows
  (§7.4). The cursor is independent of starring.
- Tags lead the venue line: `Last chance · Royal Theater`. Booked orders read
  `Meet 8:45a · ✓ Booked`.
- **Select** opens event details. **Hold Select** on an unstarred event stars
  it at once (short buzz; a double buzz and a 3 s toast `Clashes with` /
  `1:00p Trivia` when it clashes). On a starred event it opens **Remove
  star?**: the title and `9:00p · On Air`, edge labels `Hold: remove` beside
  Down (port accent pill) and `Keep` beside Back. Hold Down removes; Back
  keeps. Booked orders' stars are locked (§7.7).

## 7. Event details

### 7.1 Layout

Top bar `Event` (or `Excursion` / `Booking`) in the day's band color. The page
scrolls.

```
Late Night Comedy              Gothic 24 bold, wraps
Comedy Live                    Gothic 18 bold, muted (venue)
Deck 4 · Fore                  Gothic 18 bold
↓5 decks from cabin            Gothic 14 bold, muted
10:00p - 11:00p · 1 h          Gothic 18 bold (`Any time today` if untimed)
Arrive by 9:45p                Gothic 18 bold
Ages 18+                       Gothic 18 bold, port accent
Bring SeaPass · Sign up at venue   Gothic 14 bold, muted, wraps
Clashes with 10:00p Trivia     Gothic 14 bold, port accent (+1 more)
Not reserved yet               Gothic 18 bold, port accent
Last chance                    port accent
──────────
★ Starred                      sea accent (or `Hold Select to star`, muted)
Select: mark reserved          Gothic 14 bold, muted
```

Every line after the time is left out when its value is missing.

### 7.2 Where a venue is

The phone looks the venue up in its venue table (by Royal's location code,
then name and aliases) and sends deck, deck range, position, Ashore and decks
from the cabin as numbers.

- `Deck 4 · Mid`; no position for full-length venues (Royal Promenade).
- `↓2 decks from cabin` / `On your cabin deck`; left out without a cabin deck
  (the digits of the Me tab's Deck).
- **Ashore:** the deck line reads `Ashore` (port accent), no relative line.
- **Not in the table:** no deck lines at all.
- **Several entrance decks** (Royal Theater 3-5, AquaTheater 5-6, Dazzles
  8-9): the entrance nearest the reference deck (cabin, or the previous venue
  for "From"; ties go lower). With no reference: `Decks 3-5 · Fore`. The Main
  Dining Room is the exception: each floor is its own venue, never redirected.
- Short forms: Home `Deck 4 Aft · ↓2`, list items `Studio B · 4 Mid`.
- Alerts use the table's short names (`Main Dining 5`, `Playmakers`) and cut
  the rest at 17 bytes; everything else uses full names.

### 7.3 Reserved

For starred events that need a reservation:

- Not reserved: `Not reserved yet` (port accent) and the hint `Select: mark
  reserved`. Reserved: a drawn ✓ `Reserved` (sea accent) and `Select: not
  reserved`. Short Select toggles it with a short buzz.
- Unstarred events keep `Reservation needed` (port accent). Unstarring keeps
  the mark, so starring again restores it.
- The mark travels with the stars (`R|` + star key) through the watch's star
  queue; the latest change wins and a rescheduled star takes it along.
- Royal flags no free activity as reservation-required; reservable shows come
  as `ENTERTAINMENT` products and stay in the lists like any event.

### 7.4 Clashes

Two starred events or personal entries whose times overlap (no length = 30
minutes; back-to-back isn't a clash; finished items don't count). The watch
works them out itself from today's events, since stars change with the phone
away; not across the 04:00 boundary. The watch's `1 clash` counts pairs; the
settings page's `Clashes · N` counts items. It's a warning, never a block.

### 7.5 Last chance and Only show

The final performance of a featured show in the cruise (matched by title
across all days) is tagged `Last chance`; a featured show with one performance
`Only show`. The phone sets the flags (bits 16 and 32); personal entries,
unfeatured events and paid classes never get them. Shown on Today rows, details,
Home, the tomorrow card and as an outlined chip on the settings page.

### 7.6 Ages, arrive-early and what-to-bring tags

From Royal's products listing (`DATA_FORMAT.md`, Event details), sent as four
bytes per event (`WATCH_PROTOCOL.md`, Packed events):

- **Ages:** `Ages 18+` (minimum only), `Ages 17 & under` (maximum only),
  `Ages 13-17` (both). Port accent: it's a condition on joining.
- **Arrive by:** start minus `early`. Ashore (a picked excursion) it reads
  `Meet 9:00a`.
- **Tags:** one line, joined with ` · `, in bit order. The texts are fixed on
  the watch; the phone matches them from Royal's note ids first, keywords
  second (Royal's ids are inconsistent):

| Bit | Watch text | Matches |
|---|---|---|
| 1 | Bring SeaPass | `kbyg/general/seapass`, `kbyg/seapass` |
| 2 | Weather permitting | `kbyg/general/WEATHER` |
| 4 | Sign up at venue | sign-up / signups ids |
| 8 | Waiver needed | `legal/waiver`, `kbyg/signedwaiver`, `WARNDISCLAIM`, `isWaiverRequired` |
| 16 | Athletic shoes | sneakers, athletic, closed-toe, no Crocs |
| 32 | Swimwear or active wear | `attire/bathing`, `Activeattire`, dry clothes |
| 64 | Limited spots, come early | limited spots or seating, first-come, early arrival with no number (left out when `Arrive by` shows) |
| 128 | Meeting spot on phone | a short description with "(Meet …)" |

Lists and Home don't show ages or tags; details is one press away.

### 7.7 Booked orders and picked excursions

- **Booked orders** (timed orders from a login download: shore excursions
  `Excursion`, others `Booking`): starred, reserved and **booked**, placed at
  the day's port as Ashore (no deck lines, routes or "From"). Details add
  `Meet 8:45a · 2 guests` and `✓ Booked` (sea accent). The star is locked:
  Hold Select and Select do nothing and the hint reads `From your booking`.
  They count as starred in summaries and clashes, but never in "to reserve",
  and get no tags.
- **Picked excursions** (chosen on the settings page, §12.5): an ordinary
  starred, reserved event at the day's port, Ashore, with `Meet 9:00a`; the
  user can unstar it. Sea-day "excursions" (ship tours, venue "Cruising")
  aren't Ashore and read `Arrive by`. All-day rentals show at their listed
  time with no end.
- A picked excursion that's also in the login data shows once, as booked.

## 8. Alerts

Alerts open the app by themselves and work with the phone away. The phone
plans up to 24 alarms; the watch keeps 7 of its 8 wakeup slots for the next
alert minutes (alerts in the same minute share one, shown with `+ N more`)
and the 8th for the morning sync (§8.5). Select goes Home, Back closes.

### 8.1 Reminder

`reminder_lead` (5/15/30 min, Me tab) before a starred event or personal
entry, or before its arrive-by or meeting time when it has one (`ARRIVE IN 15
MIN`, `MEET IN 15 MIN`; otherwise `IN 10 MIN`, sea accent). Under the
countdown it draws the event's details body (§7.1) without the star line or
Select hints, and scrolls:

```
IN 10 MIN                      sea accent
Title
Studio B                       muted
Deck 4 · Mid
──────────
From Royal Theater:            Gothic 14 bold, muted
↓1 deck · Fore → Mid           Gothic 18 bold
──────────
1:00p - 2:00p · 1 h
Not reserved yet / ✓ Reserved
```

- **"From" directions** replace the `↓2 decks from cabin` line when the
  previous starred event or personal entry ends less than 15 minutes before
  this one starts, or overlaps it (§10.4). The one that started last wins.
  Wording: `↑10 decks · Fore → Mid`, `Same deck · Fore → Mid`, one position
  when both match or one is unknown, `Same venue`, or `Same area · Deck 5`
  (neighborhood, deck and position all match). The pair of entrances nearest
  each other is used. No "From" when either venue is Ashore or not in the
  table.
- Booked orders: no "From" block. When the event isn't in the watch's day
  data (tomorrow's), the card falls back to the alarm's own fields (title 31
  bytes, venue 17, `Arrive by` from its `early` byte).

### 8.2 All-aboard

Alerts at the day's **warning period** (30/60/90/120 min, Days tab; 30 by
default, 60 at tender ports), then 30 and 15 minutes before all-aboard,
without duplicates. Top bar `All aboard`, `ALL ABOARD IN` large (Gothic 28,
port accent). Cancelled by I'm on board (§4.4).

### 8.3 To reserve (evening)

At the Me tab's time (6-10 pm on the hour, default 8 pm, ship time) when
tomorrow (the next watch day) has starred events that need a reservation and
aren't reserved: top bar `To reserve`, `TOMORROW` (sea accent), then each as
`7:00p Hairspray` over its venue, untimed first, as many as fit (3-4), then
`+ 3 more` (port accent). It buzzes like a reminder. No alert when nothing is left; booked sessions never
appear. A reminder in the same minute takes the screen instead.

### 8.4 Schedule change

After a re-sync moved or cancelled starred events (a star follows its Royal
product id, else its title): gray band, top bar `Schedule`, `MOVED` /
`CANCELLED` / `CHECK TIMES`, the title, `Now 9:30p · Studio B` (bold), `Was
8:00p` (muted), and `1 of 3 · Down for next`. The settings page shows the same
in **Changed since your last sync** (§12.2).

### 8.5 Silent morning sync

A wakeup at about 04:30 ship time (moved 5 minutes at a time, up to 04:55,
around alerts and other apps) opens the app with no buzz. The phone sends the
new day's slice as on any open; the app closes 5 s after it arrives, or after
60 s without one (`timed out` / `phone unreachable` in the usage log). It
stays open when a notice arrived or the user left Home. It's set for embark
day (from the evening before) through debark day, re-set by every schedule
change, and stops after 7 days without the phone. It doesn't use up the
morning summary.

### 8.6 Test alerts

Me tab switch: a test reminder, a test all-aboard alert and a test to-reserve
alert with two events arrive a couple of minutes later. It turns itself off
after an hour.

## 9. My info

Top bar `My Info` in the gray band. Rows, top to bottom:

1. `ON BOARD` undo row, while on board (§4.4).
2. `Today's summary` / `Tomorrow's summary` (§5).
3. `STATEROOM` (large) with deck and nearest stairs.
4. `MUSTER STATION`, `DINING ROOM` (`Not set` when empty), `SHIP CLOCK`
   note, `LAST SYNC` (`4:31a today`).
5. `Ship directory` (§10.1).

Up/Down pick a row; Select opens it.

## 10. Ship directory and Ship GPS

The directory works on any ship with a venue table. The Ship GPS (distances,
restrooms, routes) needs a ship map, measured from Royal's deck plans
(`tools/shipmap/`); Harmony is the only mapped ship. The phone builds every
page and sends one at a time, so this needs the phone nearby; without it:
`Connect your phone` / `Select tries again`.

### 10.1 Directory

- Level 1: `Browse by area`, then one row per deck: `Deck 5` over the two
  areas with the most places and the count (`Promenade · Boardwalk · 28`), or
  `1 place`. The cabin deck reads `your deck`. Ashore last.
- A deck page groups by `FORE` / `MID` / `AFT`, then `FULL LENGTH`. The top
  bar's right label is `↓3 decks` (or `your deck`). Elevator banks are muted
  rows in their group.
- An area page groups by deck and position (`DECK 8 · MID`); a multi-deck
  venue shows once, under the entrance nearest the cabin. Top bar `Area`, the
  name as a Gothic 24 bold heading. Areas end with `Elevators` before Ashore.
- Restrooms are not directory places (26 would clutter every deck).

### 10.2 Place page

```
Royal Theater                  Gothic 24 bold, wraps
Deck 5 · Fore                  Gothic 18 bold
Entertainment Place            Gothic 14 bold, muted (area)
Closest restroom · 30 m aft    Gothic 14 bold, muted
Hold Select for its route      Gothic 14 bold, sea accent
──────────
FROM YOUR CABIN                small caps, muted (the route start, §10.4)
↓1 deck · 160 m fore           Gothic 18 bold (`Your deck · 180 m fore`)
Select for route ›             Gothic 14 bold, sea accent
──────────
LATER TODAY                    small caps, muted
Evening Show · 7:00p ★         (or `Nothing more today`)
──────────
Flag a map problem             mapped ships only
```

- The closest restroom is measured from the entrance the FROM route reaches;
  on another deck, or when too wide, the direction goes on its own line
  (`↑1 deck · 20 m aft`). It shows without a stateroom too.
- `Spot approximate` (muted) for venues with no spot on the plans.
- No cabin set: no FROM block, but `Add your stateroom on the phone for
  walking directions`.
- Ashore or not in the table: no GPS lines.
- **Elevator bank pages:** the name, `Aft · Decks 3-17` (or `all decks`;
  counted over the ship's decks so the missing deck 13 doesn't split the
  run), `STOPS AT` with deck chips (7 per row, the cabin deck filled sea
  accent), the FROM block to the bank's lobby. No restroom line.
- **Flag a map problem:** Select saves the time, the place, what the page
  showed and the route start for Me > Map check, and shows `Flagged`.
- Distances use the Me tab's unit (metres, feet or steps), rounded.
- **Built on the phone (1.6.3):** the card above `LATER TODAY` is a page of
  styled lines the phone lays out and the watch draws as sent
  (`WATCH_PROTOCOL.md`, Page lines; `src/pkjs/pagelines.js`,
  `src/c/lines.c`). The Time 2's card is pixel for pixel the 1.6.2 one; the
  Round 2's is centered (§15). The list rows below it stay the watch's own.

### 10.3 Route screen

Top bar `Route`. Opened by Select on a place page (to the entrance its FROM
line reaches; an elevator bank's lobby), Hold Select on a place page (from that
entrance to its closest restroom; works without a stateroom), Select on Home
(§4.1) and Select on an Ask card that names a place (§11).

```
Royal Theater                  Gothic 24 bold (destination)
FROM YOUR CABIN                small caps, muted
──────────
•  60 m fore                   Gothic 18 bold, one line per step
⟋  Fore stairs to Deck 5
•  40 m fore
◎  Royal Theater
──────────
↓1 deck · 100 m in all         Gothic 14 bold, muted
```

- Drawn step glyphs (about 13 px, sea accent): dot walk, double arrow cross
  the ship, box with ▲▼ elevator, stair line, ring arrive. At most 8 steps.
- Stairs are named by place: `Fore` / `Aft stairs` beside the elevator banks,
  `Mid stairs` between.
- **Crossing:** its own step whenever the route changes side: `Cross the
  ship` until the sides are checked on board, then `Cross to port` / `Cross
  to stbd`, and the arrive step may add `· port side`. No side word appears
  before that.
- `Same area · your deck` (cabin start) or `Same area` (venue start), one walk
  step, arrive.
- **Shown less** when the planner isn't sure (an uncertain link, an
  unplaceable spot): `To Deck 16`, the overall `300 m aft`, arrive; the
  summary drops `in all`.
- Restroom route: header `Restroom` / `CLOSEST TO ROYAL THEATER`, ending with
  its `Deck 5 · Fore` and `Same deck as Royal Theater` (or `1 deck above` /
  `2 decks below Royal Theater`).
- From Home it ends with `12:00p Name That Tune Trivia` (muted) instead of the
  summary.
- `Finding route…` while loading; `No route found`, `No restroom found`.
  Up/Down scroll; Hold Select asks by voice.
- **Built on the phone (1.6.3):** the whole screen is a page of styled lines
  from the phone, as the place card (§10.2); the time on Home's route follows
  the watch's 12/24h setting, which the request carries. Until the page comes
  (and with the phone away) the watch draws the title, header and
  `Finding route…` / `Connect your phone` itself in the same layout.
- **Route safety** (planner rules): every step walkable as written (no
  fore/aft run through cabin corridors that don't connect); change sides only
  where the plans show a link (lobby, promenade, open deck); no crew doors or
  doors that may close at night; when unsure, show less.

### 10.4 Where routes start

One rule for routes, place pages, Home's Select and the "From" lines on
reminders (`src/pkjs/routestart.js`, owner 2026-09-26):

- **The cabin**, by default.
- **A starred event or personal entry** that ends less than 15 minutes before
  the target starts, or overlaps it (no length = 30 minutes). For "from where
  you are now" (place pages), one that's on now or ended less than 15 minutes
  ago. Booked and reserved events count.
- **A spoken location** (`I'm at the Solarium`, §11) for 90 minutes, until a
  starred event or entry starts after it, and never past 04:00. `I'm at my
  cabin` makes the cabin the start. A start said in the question (`from X to
  Y`) is for that route only.
- Headers always name the start: `FROM YOUR CABIN`, `FROM SOLARIUM`, `FROM
  ROYAL THEATER`. The phone keeps the start and its timer.

### 10.5 Checks on board (Harmony)

- Confirm port/starboard against one known cabin; use Help > Port and
  starboard if it's wrong on some or all decks.
- Walk routes from the cabin to far venues on both sides; tune the elevator
  wait and stairs-per-deck costs.
- Main Dining Room: the nearest spot never sends you to another floor.
- Check a few `Spot approximate` venues and the open conflicts (Me > Map
  check), and walk a known distance to check the step length (about 0.75 m).

## 11. Voice (Ask)

Built in 1.5.2-1.5.13 on the current setup: the Pebble app's dictation with
on-phone speech recognition, which works in airplane mode (tested 12/12 on the
owner's Android phone, 2026-09-28). The phone must be within Bluetooth range.

**Watch** (`src/c/ask_window.c`): Hold Select on Home or a Route screen opens
the `Ask` screen (gray band) and starts dictation with the system confirm step
off. The transcript goes to the phone; the screen draws the card the phone
sends back: up to four rows of a small label and a bold value (`HEARD`,
`FROM`, `TO`, `YOU'RE AT`, `TRY`, ...) and a sea-accent hint (`Select: route ·
Hold: ask again`). Select does what the hint says (open the route, confirm,
set on board, or ask again), Hold Select asks again, Up/Down scroll, Back
closes. A Route screen opened from Ask replaces an open one. The watch has no
place names or wording of its own except: `Voice is heard on the phone` /
`Bring the phone nearby, then hold Select to ask` (phone away), `Matching on
the phone...`, `No answer from the phone` (10 s), `Phone busy. Select to try
again`, `Voice isn't available`. Byte limits: `WATCH_PROTOCOL.md`, Voice.

**Phone:** fixed commands first (`src/pkjs/voicecard.js`), then the matcher
(`src/pkjs/voice.js`): command and category words live only in its `GRAMMAR`;
venue names, aliases and mishearings only in the generated lexicon
`src/pkjs/data/voice-HM.js` (`tools/voice/`). Every card starts with `HEARD`,
so the user sees what was heard and matched before anything happens. Matcher
decisions D1-D22 are in the Phase 5 voice plan (kept outside the repo);
the behavior they produce is below.

| Say | Answer |
|---|---|
| `How do I get to <place>` / `Take me to` / `Where is` | `FROM` (where routes start now) and `TO`; Select opens the route |
| `From <A> to <B>` / `<A> to <B>` | the route from A, for that route only |
| `Take me to my cabin` / `back to my room` / `Take me back` | route to the stateroom from a starred event on now or a spoken start; `No starred event on now to start from` otherwise |
| `Take me to the dining room` | your main dining room from the Me tab (`(yours)`) |
| a group or elevator bank | the nearest member, `(nearest)` |
| `Closest restroom` / `Nearest bathroom` / `I need a toilet` | restroom route from where routes start now; `near the theater` or `on deck 5` narrow it (`No restroom on Deck 12 on the map`) |
| `Closest bar` / `Closest coffee` | the nearest flagged place; a snack is Cafe Promenade (`Open 24 hours`) |
| `I'm at <place>` / `I'm in cabin <number>` / `I'm at my cabin` | `YOU'RE AT X` / `Routes start here for 90 min`; saved as soon as the card shows; hint `Saved · Undo: say "Forget where I am"` |
| `I'm at X, how do I get to Y` | sets X and routes to Y |
| `Forget where I am` | `YOU'RE AT X`, `THEN FROM`; Select forgets it (`Nothing to forget` otherwise) |
| `I'm on board` / `We're back on the ship`; `I'm ashore` / `Going ashore` / `I'm sure.` | sets or clears on board (§4.4) on port and embark days; `At sea today`, `Already on board`, `Already ashore` otherwise |
| `When do we leave?` / `What time do we sail?` | `TODAY` port, `DEPARTS`, `ALL ABOARD` (port local time too when it differs) |
| `What's tomorrow?` / `Where are we tomorrow?` | `TOMORROW` port, `ARRIVES`, `ALL ABOARD` or `DEPARTS` |
| `Where's my muster station?` (also `mustard`) | `MUSTER STATION`; Select routes there when it's on the map |

- **A location must be one spot:** a place, a big one-spot venue (Royal
  Promenade, Boardwalk, Central Park, Pool Deck) or a cabin. Restrooms, bars,
  coffee places, elevators, stairs, decks, the Running Track and groups are
  refused (`There are many restrooms`, `Elevators stop on many decks`, `Which
  one?`) with a `TRY` row and `Say a place or cabin number near you`; they're
  fine as destinations.
- **Answers with nothing to do:** `CocoCay is ashore`, `Not on the map yet`,
  `You're already there`, `Stairs are in many spots`, `A deck is not one spot`
  (`Say a place on Deck N`), `Which place?`, `No place matched`, `No place
  "word"` (the side that matched nothing), `Not something I know`, and `NOT
  YET` for schedule and opening-time questions, each with a `TRY` example.
- A spoken cabin is checked against the plans (`No cabin N on Harmony`, `Say
  all 4 or 5 digits`) and kept only as the route start.
- **Usage log:** a `voice` line per turn on the phone (heard, matched, the
  card, what Select did) and a watch entry per dictation with its status and
  free heap.
- **Try a voice phrase** (Help): type a phrase and tap `Save and test`; the
  phone answers it as for the watch (nothing set or opened) and the card shows
  next time the page opens.

## 12. Settings page

Built by the phone (`src/pkjs/config.js`) as a local `data:` URL, so it works
with no internet. Bottom navigation with five tabs: Cruise, Days, Filters,
Events, Me; **Save** is a pill at the top right of every screen. The page
can't talk to the phone script while open; everything returns on close
(`pebblejs://close#`).

### 12.1 Shared patterns

- Values filled from somewhere carry a chip (`From booking`, `From cabin
  table`, `From ship map`, `From Royal`). A hand edit shows the `Edited`
  warning chip, `Your change is kept. Ship map says …` and a `Use ship map` /
  `Use booking` button; an edited field is never refilled by itself.
- Past days and finished events and entries are hidden.

### 12.2 Cruise

- **Download your sailing:** ship and sailing pickers, **Download**, sync
  status (with `Schedule not published yet` before Royal publishes, about two
  weeks out), and **Last download failed** with the reason.
- **Advanced download with your Royal login** (tonal button inside the same
  card, so it uses the sailing picked there): expands email and password
  fields (autocomplete off, cleared as the page closes, never stored) and
  **Download with login**, off until a sailing is picked and both fields are
  filled. The text under it:

  > Your email and password go from this page to Royal Pebble's phone script
  > inside the Pebble app, and from there only to Royal Caribbean, to sign in
  > for this one download. Royal Pebble doesn't save them, doesn't put them in
  > the usage log, and never sends them anywhere else. Royal sends back your
  > booking details (stateroom, deck, muster station, terminal time, booked
  > excursions and purchases); those are saved on this phone and your watch
  > like the rest of your cruise data. You'll type your login again next time
  > you sync if you wish to keep your data synced with Royal's. This uses
  > Royal's website sign-in, which Royal could change without notice; if it
  > stops working, use the Windows sync tool.

  The phone signs in first and drops the password, then downloads the sailing,
  then the booking (`royal.fetchMine`). A refused sign-in downloads nothing
  (`Royal Caribbean didn't accept that email and password.`). If only the
  booking part fails, the sailing is saved, the old booking kept, and a
  **Booking details not downloaded** card gives the reason. A plain phone
  download keeps the old bundle's booking for the same sailing.
- **Ready to sail:** three checks, each a ✓ row or a warning row with a fix
  button: every day downloaded and the schedule published (`8 of 8 days`;
  debark always counts), stateroom set and found on the ship map, and the
  busiest day within the watch's 160 events (`Busiest day 142 of 160
  events`, counted per the Filters tab; fix `Hide categories`). Title `N
  things left before you go offline`, then `You're ready to go offline`.
  Shown from the first download until embark day ends.
- **Changed since your last sync:** starred events a re-sync moved or
  cancelled (also under Events > Starred).
- **Ship venues:** a card (`N venues`, `N to check`, `N edited by you`;
  `Review N`, `All venues`) opening the venue list: search, chips `All` /
  `To check · N` / `Edited · N`, group by `Area | Deck`, a `Needs details`
  group first for schedule venues not in the table, a `✓ Review N` button.
  Each venue's edit screen has a Deck stepper per entrance (`Add entrance`),
  `Fore | Mid | Aft`, neighborhood chips (seven areas plus Ashore), and under
  each field `Built-in value`, a `Check` chip with **Looks right**, or an
  `Edited · built-in 6` chip with **Reset**. A dark preview card shows the
  watch lines. `Show events at this venue` links to Events. Owner fixes are
  kept per ship code (`settings.venues.HM`), only for fields that differ;
  flags and confirmations are per field; aliases (`Casino Royale Non-Smoking`
  → `Casino Royale`; Harmony has 36) show `Same as …` and edit the target.
- **Share my plan:** counts of what goes in, `Include cabin details (we
  share a cabin)`, **Share plan** (copies a readable first line plus a code;
  the Pebble app's WebView has no share sheet) and **Import plan** (a paste
  box). Import refuses a different sailing, then offers **Accept all** (adds
  their stars and uses their settings where they differ, never unstars or
  deletes anything), **Review each** (rows under STARS, PERSONAL ENTRIES, DAY
  SETTINGS, VENUE FIXES, CABIN DETAILS with two-way choices, then Apply) or
  **Reject import**. Format: `DATA_FORMAT.md`, Shared plan.
- **Backup: paste cruise data** (collapsed): the bundle from the Windows sync
  tool.

### 12.3 Days

One card per cruise day. Expanded: local-vs-ship offset stepper; all-aboard
from Royal's gangway time (`mine.ports[].gangwayUp`, converted to ship time)
shifted in 5-minute steps (`Royal's time`, `−15 min`), else departure minus a
buffer (30/45/60, 60 at tender ports), or an exact time typed in (wins over
both); **Warning period** 30/60/90/120 (helper: when the first alert buzzes);
the resulting times in both clocks; **Change itinerary** for skipped or added
ports and changed times. Tender days get a `Tender` chip and a notice:
`Tender port. Boats back to the ship can have long lines, so the warning
period is 60 minutes today. Make it longer if you like.`

### 12.4 Filters

- **Featured events** switch (Home's fallback card).
- **AGES**, three switches, all off: **Hide Adult only events** (`18+ and
  21+`), **Hide Teen and Kid only events** (`17 and under`), **Hide Family
  events** (title starts with "Family" or contains "All Ages", or the venue is
  Adventure Ocean Theater). Note: `Events you star always show. Events with
  no age listed never hide. Casino games are in the Casino category below.`
- **CATEGORIES:** a switch per category expanding to subcategory chips, each
  with its count. Shop is hidden by default. **Casino** is its own category:
  events at Casino Royale (and `Expanded Casino`), Royal's `Casino`
  subcategory, or titles about casino games (slots, blackjack, poker,
  roulette, craps, hold'em, baccarat), never bingo or raffles. Hiding it
  leaves Casino Royale in the directory and routes.
- Hidden events still appear in search, marked `Hidden on watch`. Starred and
  booked events always reach the watch.

### 12.5 Events

- Search across every day (results grouped under day headers with a count
  line, first 150; finds personal entries and booked orders too), day chips,
  and view chips `★ Starred`, `To reserve · N`, `Clashes · N` (each hidden at
  0).
- **Event row:** time column · title, venue line (`Comedy Live · Ages 18+ ·
  Arrive 15 min early`), chips (`Last chance`, `Clashes with Trivia 1:00p`,
  `Reservation needed` + `✓ Mark reserved`, or `✓ Reserved` + `Not
  reserved`), a `Notes · 2 ▾` toggle with the full notes, and a 48 px star
  button. Unstarred events that need a reservation say `Reservation needed ·
  star it to track`.
- **My entries:** personal entries (title, place, time) with Add. They
  get reminders like starred events.
- **FROM YOUR BOOKING:** read-only card of booked orders at the top of their
  day (`Meet 8:45a · ends 11:30a · 2 guests`, `✓ Booked · ★ on the watch`;
  `From your booking. Change it in the Royal app.`).
- **Booked activities and excursions:** paid classes and shore excursions,
  one card per day and kind (`DAY 4 · NASSAU · SHORE EXCURSIONS`, `DAY 3 · SEA
  DAY · TOURS`). Each session has **Pick** (`✓ Picked`), which stars it and
  marks it reserved; only picked sessions reach the watch. Excursion
  sub-line: `Meet 9:00a · 2 h 30 · Ages 6+`; all-day rentals `All day from
  9:00a`. Booked products first; the rest fold behind `Show all N`.

### 12.6 Me

- **Stateroom:** digits only, prefilled from the booking. A number in the
  ship's cabin table fills **Deck** (drop-down) and **Nearest stairs**
  (drop-down of the deck's stairwells, e.g. `Forward stairs, port`; a ship
  without a map gets a generic list). Sources are kept in `me.src`.
- **Muster station** (from the booking), **Main dining room** (drop-down of
  the ship's main dining rooms; typed in until Royal's data is checked for
  it), walking-distance units (metres, feet, steps), theme, reminder lead
  time, **Evening reminder to reserve** time, ship clock note, device label,
  **Test alerts** (§8.6).
- **Map check** (mapped ships): one row per open conflict
  (`tools/shipmap/conflicts-HM.json`) with what each source says, answered
  `website right` / `app right` / `neither` / `not checked`, an optional
  where and a note; `Flagged on watch – add details` rows; `Found by the app`
  rows; **Add a problem**; **Copy notes**; Clear notes. Brief: "Map check".
- **Usage log:** entry count and size, **Copy part 1 of N**, Clear log, on/off.
  Brief: "Usage log".
- **Help** card opens the Help screen (§12.7).

### 12.7 Help

A screen under Me (Back arrow). Cards:

- **Always show button hints** switch.
- **Watch buttons:** every press and hold per screen (`HELP_KEYS` in
  `config.js`; keep in step with the watch's click handlers).
- **Good to know:** sync before sailing, the 04:00 day change, where routes
  start and the 90-minute spoken start, distances approximate, `Spot
  approximate`, no side until checked, keep the phone nearby for place pages
  and routes.
- **Voice commands** (1.5.13): what to say under Going places, Closest, Where
  you are and Your cruise, and what isn't answered yet (`HELP_VOICE` in
  `config.js`; keep in step with `voicecard.js` and `voice.js`).
- **Try a voice phrase** (§11).
- **Ships with Ship GPS** (from `shipmap.js`, the same list as the README).
- **Port and starboard** (only on a mapped ship): `Sides checked on board`
  (turns on side words), `Flip the whole ship`, and a chip per deck for
  `Flip single decks`, kept per ship (`settings.shipSides`). Test cruise only:
  once the map is confirmed, fix the data and remove it.

## 13. Not built yet

Approved or wanted, but not in the app. Scheduled work is in `PLAN.md`.

- **Phase 6** (`PLAN.md`): a `Bring · N` view on the Events tab, a tomorrow
  alert that also lists what to bring, and a `Last dinner seating` line.
- **Route from a venue ending time:** `Evening Show ends 9:00p` under a route
  that starts at a venue (`WatchRouteFromVenue`).
- **Schedule questions by voice** (future goal): `What's next`, `When is
  <event>`, `Where is <event>`, answered from the day's slice. Harder than
  places: titles change daily and must be matched from speech. Builds on the
  matcher once it has been tried at sea. Today these answer `NOT YET`.
- **Main dining room from Royal's data:** if the booking holds it, the
  Advanced download fills Me's Main dining room (`From booking`).

Mocked and not chosen (kept in `docs/mockups/` for the record): the first
watch concepts (Deck Log, Horizon, Timeline), the inline route on the place
page (`WatchPlaceInline*`), restrooms as directory places
(`WatchRestroomPlace`), the embark line under the countdown
(`WatchEmbarkHomeBLight`), the Casino card (`Phone27Casino`). The GPS mockups
still show `~` on distances and `all decks but 1` on elevator pages; this file
supersedes them.

## 14. Mockups

Claude Design component files (`*.dc.html`): plain HTML with inline styles, so
sizes, colors and copy can be read from them, but they need the canvas runtime
to render (`preview.png` / `preview.html` show them). All data in them is
placeholder; no real stateroom. Each folder's `NOTES.md` lists its files.

| Folder | Covers |
|---|---|
| `docs/mockups/v1.1/` | Ship venues editor (`Cruise`, `Venues`, `VenueEdit`, `VenueStates`), venue lines (`WatchEvent*`, `WatchHome*`, `WatchReminder`), directory (`WatchDirectory`, `WatchDeck`), Reserved (`EventsReserve`, `WatchRes*`) |
| `docs/mockups/phase2/` | Morning summary, days to sail, clashes, last chance (§4.5, §5, §6, §7.4-7.5) |
| `docs/mockups/gps/` | Place page, route, restrooms and elevators, Home Select and hints, voice (§4.6, §10, §11) |
| `docs/mockups/phase3/` | Booked orders, embark arrival, on board, port card and bar, Me tab, Ready to sail, search, Remove star?, Share my plan (§4.2-4.4, §6, §7.7, §12) |
| `docs/mockups/phase4/` | Ages, arrive-early, tags, excursions, Filters (§7.6-7.7, §12.4-12.5); generated by `tools/mockups/gen_phase4.py` |
| `docs/mockups/round/` | Pebble Round 2 (gabbro) layouts for every screen, Home timeline arc, Time 2 matching style (G6a); `NOTES.md` holds the round rules (PLAN.md §3a) |

## 15. Pebble Round 2 (gabbro)

The same app and .pbw run on the Pebble Round 2 (260x260 round, 64 colors)
beside the Pebble Time 2. Built in 1.6.0 (Round 2 phase G2, `PLAN.md` §3a):
every screen fits inside the circle; the round designs in
`docs/mockups/round/` arrive screen by screen in G3-G6. Everything in §1-§12
holds on the Round 2 unless this section says otherwise.

**How it's built:** per-platform numbers live in `src/c/layout.h` behind
`PBL_ROUND`; the Time 2 keeps its numbers exactly, so its binary is unchanged
(byte-for-byte the same code in 1.6.0). Round-only drawing sits under
`#ifdef PBL_ROUND`.

**Geometry (round):**

- **Top bar (§3), 48 px:** a 30 px band in the screen's band color with the
  ship time centered (Gothic 14 bold, white), then one centered small-caps
  line on the background in `muted`: the screen's name and the day's status,
  `ST. THOMAS · DOCKED`, `TODAY · AT SEA`, `MY INFO · DOCKED`. The status is
  left out when it repeats the name; a directory page's decks from the cabin
  read `PLACE · ↓1 DECK` / `YOUR DECK`. The line is at most 170 px wide,
  trailing ellipsis.
- **Body:** a 184 px wide column (inset 38 px each side) from y 48 to 220,
  whose corners stay inside the circle. Every screen draws its §4-§11 layout
  in it, left-aligned as on the Time 2, except small-caps labels (`STATEROOM`,
  `MUSTER STATION`) and My info's values, which are centered. Content that
  ran into the bottom on the Time 2 scrolls or is cut by the body's edge, the
  same as there.
- **Lists** (Today, directory): the firmware keeps the selected row in the
  middle of the column. A place page (§10.2), a single tall row, keeps its top
  in view instead.
- **Home (§4), round layout since 1.6.1 (G3; mockups `Main`,
  `HomeNextDark`, `HomePortArc`, `HomePortArcDark`, `DaysToSail`):** the
  body is a wider 210 px column (inset 25 px) from y 48 to 220, its first
  line right under the label line, and every line is centered.
  - NEXT card: the star and `NEXT · IN 20 MIN` centered together, the
    title, `12:00p · On Air`, `Deck 4 Aft · ↓2`, tags and the clash count,
    then a divider and **one** next item (`1:00p ★ Title` and its venue
    line, each centered as one line; left out when it doesn't fit above the
    body's bottom). `Route ›` is a centered bottom hint at y 221, outside
    the body, while Select routes.
  - All-aboard countdown: `ALL ABOARD IN`, the count (centered together
    with the warning sign in the warning window), `4:30p ship · 4:30p
    local`, `Excursion back 11:30a` and the clash count. The time-ashore bar
    becomes an **arc along the bottom edge**: radius 121, 8 px wide, from
    140° on the left to 40° on the right (screen angles), rounded ends,
    the §4.2 colors one degree at a time, and the now tick as a 2 px radial
    line (radius 114-128) in `text`. The start and all-aboard times sit
    just above the arc's ends (Gothic 14 bold, `muted`, y 177), and `Hold
    Select: on board` is centered at y 202 between them.
  - Days to sail: the label line reads `SAILS IN` (`SAILS` on the last
    day), then the count (LECO 42) with `days` under it, the sail line and
    ship, a divider and `★ 3 starred so far`. In the last 3 days the ship
    line is left out to make room for the sync reminder.
  - Arrival card, messages: the same lines, centered; `Hold Select: on
    board` (shorter than the Time 2's `I'm on board`).
  - The arc, its times and the bottom hints are drawn on a full-screen layer
    over the body, so they fade with the rest behind the button hints.
  Button hints (§4.6) sit at Up 70, Select 130, Down 190 on the right and
  Exit at 130 on the left (window y), inside a 200 px column.
- **Morning summary (§5), since 1.6.1 (mockup `MorningSummary`):** today's
  card puts `DAY 4 · PORT DAY` on the label line (no status after it) and
  starts with the place; every line is centered, the star with its count.
  Tomorrow's card keeps `TOMORROW` on the label line and the day label in
  the body.
- **Arrow lines** (`↓2 decks from cabin`, `Deck 4 Aft · ↓2`, route and
  place lines) are centered in their box on the Round 2 since 1.6.1.
- **On board? and Remove star? (§4.4, §6):** the edge labels (`Not yet` /
  `Keep`, `Hold: yes` / `Hold: remove`) sit along the bottom of the body,
  left and right, until G6 puts them on the bezel by their buttons.
- **Alerts and notices, since 1.6.2 (G4; mockups `AlertReminder`,
  `AlertAllAboard`, `AlertToReserve`, `NoticeSchedule`, `ClashToast`):** every
  line is centered, including the event details body a reminder shows (the
  route line `↑2 decks · Fore → Mid`, `✓ Booked`, `✓ Reserved`, the star with
  `Starred` are centered as one run). The all-aboard alert for the day's
  all-aboard time shows Home's countdown (`ALL ABOARD IN`, the count with the
  warning sign in the warning window, ship and local times) over the same
  time-ashore arc and its end times, with `Select: Home` at the bottom;
  other all-aboard alerts (the test alert) keep the `IN 15 MIN` layout. On
  `PHONE NEEDED` the text is smaller so it clears the footer. The clash toast
  is a bordered rounded card over the middle of Today (200 x 70, two lines)
  instead of the bar at the bottom. Long alerts show the scroll arc (below)
  since 1.6.4.
- **Place card and Route screen, since 1.6.3 (GP; mockups `Place`,
  `Route`):** both are phone-built pages (§10.2, §10.3), laid out for the
  Round 2 on the phone. The place card is centered with short dividers
  (150 px), `Restroom · 30 m aft` in place of `Closest restroom · …`, and
  only `Select for route ›` as its hint (`Hold Select: restroom route`
  when there's no route). The Route screen puts its header in the top
  bar's label line (`ROUTE · FROM YOUR CABIN`, `CLOSEST TO` shortened to
  `NEAR`), centers the title and the lines under the steps between short
  dividers (110 px), keeps the steps left-aligned with their glyphs, and
  puts Home's event time and title on two lines. A step wraps to three lines
  there (two on the Time 2), so the longest Harmony arrival, `Playmakers
  Sports Bar & Arcade · stbd side`, shows whole (1.6.4).
- **Lists, since 1.6.4 (G5; mockups `Today`, `Directory`):** Today and the
  directory's lists keep the selected row in the middle on a rounded pill
  (14 px radius, 12 px in from the screen's edge, so the list is 236 px wide)
  with every line centered. The selected row is larger (a directory name in
  Gothic 24, an event title in Gothic 18, its second line in 14 bold); the
  rows above and below are smaller (14 bold, second line in 14) and muted,
  and short dividers (110 px) separate them, none beside the pill. Today's
  time sits on its own line above the title (`12:00p`, `NOW · ends 12:45` in
  the now color) on a group's first row and on the selected row, with the
  star and the clash `!` after it (in the cursor text color on the pill); a
  booked order adds `Meet 8:45a` to it and shows `✓ Booked` under the title,
  and a final show adds `Last chance` / `Only show` to it in the port accent.
  The venue is the line under the title. A directory event row has its time
  above its title the same way. Headers (`FORE`, `DECK 8 · MID`) and the
  `Connect your phone` message are centered. Under a place or area card the
  selection isn't centered: rows keep their height and the selected one gets
  a smaller pill, and the list narrows to the body column the card was laid
  out for.
- **Scroll arc, since 1.6.4 (mockup `Event`):** long pages (event details,
  route, place and area pages, alerts, the Ask card) show their scroll
  position as a short arc on the right edge beside Up and Down instead of the
  triangles: from -35° to 35°, radius 123, track `divider` 2 px, thumb
  `muted` 4 px sized to the share of the page on screen. Nothing shows when
  the page fits.

**Tools:** `tools/watch_size.py` checks both binaries against the 62 KB
budget; `tools/screens.sh <dir>` installs on each emulator in turn and saves a
screenshot walk of the main screens.
