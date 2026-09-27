# Royal Pebble — Phase 3 design (port days, booking details, settings)

Scope: brief items 22-28 (`docs/PROJECT_BRIEF.md`, Phase 3). Builds on
`docs/DESIGN.md` and `docs/DESIGN_V1_1.md`, which stay the record for the
existing screens, color tokens, fonts, drawn glyphs (★ ✓ ↑↓ `!`), the thin top
bar and the wording rules. This file doesn't repeat them; it only lists what
Phase 3 adds or changes. One section per item, filled in as each is designed.

- Design canvas (private to the owner):
  https://claude.ai/artifact/8duBBQWuFmwggUrAp8HMA4
  Page "Item 22 (final)" holds the approved screens, and page "Items 23–28
  (draft)" holds a first pass at the rest.
- `docs/mockups/phase3/*.dc.html`: every Phase 3 screen as Claude Design
  component files (400×456 at 2×, inline styles, Roboto Condensed standing in
  for Gothic, same as `docs/mockups/phase2/`). They need the canvas runtime to
  render; open the canvas to see them. `NOTES.md` there lists the files.
- All data in the mockups is placeholder (sail from Galveston, day 7 at Perfect
  Day at CocoCay, the `DATA_FORMAT.md` example excursion). No real stateroom.

| Item | Status |
|---|---|
| 22 Booked excursions and embark day (+ I'm on board) | **Approved 2026-09-26.** Build from §22. |
| 23 Port day card | **Done** (phone: #44, watch: #45), tested on the watch 2026-09-27. |
| 24 Settings page upgrades | First draft (§24), review before building |
| 25 Silent morning sync | No screens needed (§25) |
| 26 Confirm before removing a star | First draft (§26), review before building |
| 27 Casino filter | First draft (§27), review before building |
| 28 Share my plan | First draft (§28), review before building |

---

## 22. Booked excursions and embark day

**Status: approved by the owner, 2026-09-26.** The owner added the "I'm on
board" flag (§22.6) during the design session.

Booked shore excursions (and other orders with a time) show on Today and in the
day lists like a reserved, starred event, with the usual reminder. Embark day's
Home shows the terminal arrival appointment. The data comes from `mine.orders`
and `mine.arrival` (`docs/DATA_FORMAT.md`), which only bundles from
`cruise_sync.py --login` have. Without it, nothing in §22.1-22.5 changes. The
on-board flag (§22.6) doesn't need login data.

### 22.0 Found before designing: a phone download drops `mine`

`useBundle()` in `src/pkjs/index.js` saves a new bundle whole. The phone never
logs in, so a download on the settings page replaces a `--login` bundle and
loses `mine` (stateroom, orders, arrival, ports). **Fix, in the first build
PR:** when the new bundle is for the same ship and sail date and has no `mine`,
copy the old bundle's `mine` onto it before saving. A pasted bundle that has
its own `mine` replaces it. Add a Node test (made-up stateroom).

### 22.1 Which orders show

- Every `mine.orders` entry with a `date` and `time` whose `date` falls in the
  cruise. Packages and credits (no time) never show.
- A shore excursion (`category` `pt_shoreX`) is labeled **Excursion**. Any
  other timed order (dining or a show, if Royal ever gives them a time) is
  labeled **Booking**.
- It behaves like a starred event that is reserved, with one difference: it's
  **booked**. See §22.2-22.4 for the wording and the locked star.
- **Place** = the itinerary location for its `day` (the day's port), marked
  **Ashore** like an Ashore venue (no deck lines, no route, no "From"
  directions).
- Start = `time`. End = `end`, else `time` + `minutes`, else no length (the
  30-minute Today drop-off rule applies).
- **Counts like any starred item:** in `★ N starred today`, `First …` on the
  morning summary and clash checks (item 7).
- **Left out of** the tomorrow card's `N to reserve` and the evening
  reservation alert, since it's already booked. It gets no Last chance or Only
  show tags.

### 22.2 Today row (`WatchExcTodayLight`)

```
9:00a  Beach Day at Perfect Day Co…   ★
       Meet 8:45a · ✓ Booked
```

- The time column is the start (`time`); the row sorts by start like every
  event.
- The second line is `Meet 8:45a · ✓ Booked`, with the drawn ✓. Without
  `meet`, it's just `✓ Booked`.
- The ✓ and `Booked` use the sea accent, or the cursor text color on the
  cursor, like the star.

### 22.3 Details (`WatchExcDetailsLight`, `WatchExcDetailsDark`)

```
[Excursion     8:05a        DOCKED]      top bar: Excursion / Booking
Beach Day at Perfect Day CocoCay         Gothic 24 bold, wraps
Perfect Day at CocoCay                   Gothic 18 bold, muted (the day's port)
Ashore                                   Gothic 18 bold, port accent
9:00a - 11:30a · 2 h 30                  Gothic 18 bold
Meet 8:45a · 2 guests                    Gothic 14 bold, muted
✓ Booked                                 Gothic 18 bold, sea accent
──────────
★ Starred                                sea accent
From your booking                        Gothic 14 bold, muted
```

- `Meet …` is left out without `meet`, and `· 2 guests` without `guests`. With
  neither, the line goes.
- **The star is locked.** Hold Select does nothing on a booked item (log it as
  a press that did nothing), and short Select doesn't toggle Reserved. The hint
  line reads `From your booking` instead of the Select hints. The same goes for
  hold Select on its Today row. It's removed only by cancelling in the Royal app
  and syncing again.
- **Scrolls** (owner, 2026-09-26, after the first watch test): the details
  page scrolls with Up/Down when it doesn't fit, with the muted triangles of
  place and route pages, instead of losing lines at the bottom. As built, the
  clash note comes after `✓ Booked`.

### 22.4 Reminder (`WatchExcReminderLight`)

Fires the usual reminder lead before `meet`, or before `time` without `meet`.

**Changed after the first watch test (owner, 2026-09-26):** the reminder shows
the same detail as the details page. Under the countdown (`MEET IN 15 MIN`
when there is a meeting time, else `IN 15 MIN`) it draws the details body:
title, the port, `Ashore`, `9:00a - 11:30a · 2 h 30 min`, `Meet 8:45a · 2
guests`, `✓ Booked`, and a clash note, without the star line. It scrolls like
the details page. The layout below is the first version, kept as the
fallback for when the event isn't in the watch's day data.

```
IN 15 MIN                                sea accent
Beach Day at Perfect Day CocoCay
Meet 8:45a                               Gothic 18 bold
Starts 9:00a · ends 11:30a               Gothic 14 bold, muted
Ashore                                   Gothic 18 bold, port accent
──────────
✓ Booked · 2 guests                      Gothic 14 bold, sea accent
```

Without `meet`: `9:00a · Ashore` in place of the three middle lines, the same
as other reminders. No "From" block and no `Not reserved` line.

### 22.5 Embark day Home: terminal arrival (`WatchEmbarkHomeALight/Dark`)

Option A (option B, a line under the countdown, was not taken; its board stays
on the canvas for the record).

Embark day, from 04:00 until the arrival time, when `mine.arrival` is a time:

```
[Galveston     9:12a        DOCKED]
TERMINAL ARRIVAL                         Gothic 18 bold, port accent
11:30a                                   Bitham 42 bold (the countdown's font)
in 2 h 18 min                            Gothic 18, muted
──────────
All aboard 3:30p                         Gothic 18 bold
Sails 4:00p                              Gothic 14 bold, muted
──────────
4:15p  Sail Away Party                   next item (as many as fit)
```

- At the arrival time, Home switches to the usual all-aboard countdown.
- **`mine.arrival` is text** (Royal's text, not `HH:MM`): the card shows the
  text in Gothic 24 bold, cut with an ellipsis, with no `in …` line. It stays
  until the flag (§22.6) or all-aboard, since there's no time to switch at.
- `Sails` is left out when the day has no `depart`.
- `mine.arrival` `null`, or no login data: Home is unchanged.
- **Morning summary, embark** (`WatchEmbarkSummaryLight`): a
  `Terminal arrival 11:30a` line (Gothic 18 bold) above `All aboard`, when it's
  a time.

### 22.6 "I'm on board" (`WatchOnboard*`, `WatchOnboardAskLight/Dark`, `WatchEmbarkOnboardHomeLight`, `WatchInfoOnboardLight`)

On embark day and port days the user can say they're on board or done ashore.
Home then shows the **sea-day layout** (the NEXT card) for the rest of the day.

- **Where: Hold Select on Home**, only while Home shows the terminal arrival
  card (§22.5) or the all-aboard countdown. Select does nothing on those
  layouts today (`route_target` is only for the NEXT card), and a hold can't
  happen by accident in a pocket.
- **Hint:** a line under the countdown's ship/local line,
  `Hold Select: I'm on board` (Gothic 14 bold, sea accent), and on the
  arrival card under `in …`. The first-open button hints (§9.5) label Select
  `Hold: on board` on those layouts.
- **Confirm first** (`WatchOnboardAskLight/Dark`; owner, 2026-09-26, the same
  pattern as item 26's `Remove star?`): the hold opens a screen with
  `On board?` (Gothic 24 bold), a divider, `Ends today's countdown` (Gothic 18
  bold) and `All-aboard alerts off.` / `Undo in My info.` (Gothic 14 bold,
  muted). Button labels are drawn at the screen edge like the first-open
  hints: `Hold: yes` beside Down (sea accent pill, white text; black text in
  dark) and `Not yet` beside Back (dark gray pill). **Hold Down** sets the
  flag; **Back** returns to Home unchanged. No timeout, and Up and Select do
  nothing there. The top bar stays Home's (port band, location, ship time).
- **Feedback** (`WatchOnboardConfirmLight`): after Hold Down, a short buzz, and a screen for
  about 2 s with a drawn ✓ (sea accent, about 36 px at 1×), `On board` (Gothic
  28 bold), `All-aboard alert off` (Gothic 18 bold, muted) and `Undo in My info`
  (Gothic 14 bold, muted). Any button closes it early. Then Home.
- **After** (`WatchOnboardHomeLight`, `WatchEmbarkOnboardHomeLight`): the NEXT
  card as on a sea day, including `Route ›` and Select for the route. The top
  bar keeps the port band and location, and the right label reads `on board`
  (small caps) instead of the day's status.
- **Undo** (`WatchInfoOnboardLight`): while the flag is set, the first row of
  My info is `ON BOARD` / `Since 2:40p` / `Select: back ashore`. Select clears
  the flag (short buzz), the row goes away, and Home goes back to the countdown
  (or arrival card) if its time hasn't passed.
- **What the flag changes:** Home's layout, the top bar's right label, and the
  day's **all-aboard warning alert is cancelled** (its wakeup slot is freed;
  undo schedules it again if it's still ahead). Reminders for starred events,
  Today, the directory and routes don't change.
- **Storage:** kept on the watch with the day (persistent storage), so it works
  without the phone and survives a relaunch. It clears at the 04:00 day
  boundary. The phone doesn't need it.
- **Usage log:** record `onboard set` and `onboard undo` with the ship time,
  so real boarding times can tune the all-aboard buffer later.
- **Automatic switch:** Home leaves the countdown at all-aboard, or at the
  day's `depart` if that comes first. The phone computes all-aboard as
  `depart` minus the buffer (`slice.js`), so today's switch at all-aboard
  already comes first unless the owner types a later all-aboard by hand. The
  only new code is the `depart` cap. The watch already has `depart` for the
  morning summary.
- **Not offered** on sea days, debark day, or when the day has no all-aboard
  time (Home already shows the NEXT card then).

### 22.7 Settings page (`PhoneEventsBooked`)

- A read-only **FROM YOUR BOOKING** card (primary container, 28 px radius) at
  the top of that day's Events list, one row per booked item: time column,
  title, `Meet 8:45a · ends 11:30a · 2 guests`, `Ashore · <port>`, and a
  `✓ Booked · ★ on the watch` chip. There's no star button, since the star is
  locked. Footer: `From the sync tool with login. Change it in the Royal app.`
- It shows in the day view and under ★ Starred; search (item 24) finds it
  too.
- Booked items aren't in the `schedule.events` list, so they never show twice.

### 22.8 For the build PRs (not design)

- The phone turns each timed order into an entry in the day's event list sent
  to the watch: starred + reserved + a new **booked** flag (locks the star,
  wording `Booked`, `From your booking`), where = Ashore, plus `meet` and
  `guests`. Check the flag bits and message sizes in `docs/WATCH_PROTOCOL.md`
  and the watch's per-event storage before choosing the fields; `meet` may fit
  as the alarm time rather than a new field.
- The day message gains the arrival appointment (minutes, or `NO_TIME` plus a
  short text) for embark day.
- The on-board flag is watch-only: a byte with the stored day (or its own
  persist key) and the all-aboard wakeup cancel and re-arm.
- Suggested PR order: (1) keep `mine` on phone downloads, (2) booked items on
  Today, details, reminders and the settings page, (3) embark arrival card and
  summary line, (4) I'm on board. Each is testable on its own.
- Testing: the owner's phone holds his real sailing, so use a demo variant or
  a throwaway branch with `mine.orders` / `mine.arrival` in the demo data.
  Alerts are tested in real time (CLAUDE.md). The flag's hold Select and the
  wakeup cancel need a check on the watch, not only the emulator.

### 22.9 Every reminder shows the full details (owner, 2026-09-27)

After the booked reminder (§22.4) the owner asked for the same on **every**
reminder card: starred events and personal entries show the event's details
body under the countdown, and keep the "From" directions they had
(`docs/DESIGN_V1_1.md` §2). The card scrolls like the details page.

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
Clashes with 1:30p Trivia      (when there is one)
Not reserved yet / ✓ Reserved  (starred, needs a reservation)
Last chance                    (when tagged)
```

- The "From" block sits right under the where lines, between two dividers,
  and **replaces** the details' `↓2 decks from cabin` line (both describe how
  far the walk is). Without a "From" block the cabin line stays.
- The body has no star line and no Select hints.
- When the event isn't in the watch's day data (a reminder for tomorrow, or a
  day not loaded), the card falls back to the alert's own fields as before.
- Booked orders keep §22.4 (no "From" block). All-aboard and To reserve cards
  are unchanged.

---

## 23. Port day card

**Status: designed with the owner, 2026-09-26; §23.7 decided the same day.**
Mockups: `Watch23PortCardLight/Dark`, `Watch23WarningLight/Dark`,
`Watch23TenderLight`, `Phone23DaysTender`. This changes brief item 23 in three
places, and the brief has been updated to match. Royal's gangway time is now
the default all-aboard, not a suggestion shown beside it. The tender warning
moved from the watch to the phone. The warning period is a new per-day
setting.

### 23.1 All-aboard time (phone)

- When the bundle has a Royal time for the day (`mine.ports[].gangwayUp`, a
  readable `HH:MM`), that time **is** the day's all-aboard by default.
- On the Days tab the owner can shift it in **5-minute steps**, earlier or
  later. The control reads `Royal's time` at 0, else `−15 min` / `+10 min`,
  with a `From Royal` chip, and the resulting ship and local times are shown
  under it.
- Days without a Royal time keep today's rule: `depart` minus the buffer
  (30 / 45 / 60 min, 60 at tender ports). An exact all-aboard time typed on the
  Days tab still wins over both.
- `gangwayUp` is port-local like the itinerary (check), so it's converted to
  ship time with the day's offset, like `depart`.
- The watch shows **no separate gangway line** any more; Royal's time drives
  the countdown, bar and alerts directly.
- Still unverified on board: that `gangwayUp` is really when you must be back.
  The 5-minute steps are the fix if it isn't.

### 23.2 Warning period (phone)

- A new per-day **Warning period** on the Days tab: 30 / 60 / 90 / 120
  minutes. **Default 30, or 60 at tender ports.**
- It sets the **first all-aboard alert** and the start of the bar's red
  section. The 30- and 15-minute alerts stay. With a 30-minute period, the
  first alert and the 30-minute alert are the same: one buzz at 30, then 15.
  Today the alerts are fixed at 60 / 30 / 15 (`ALL_ABOARD_ALERTS` in
  `slice.js`); that becomes `[period, 30, 15]` without duplicates.
- The helper line under it says when the first alert buzzes (`2:00p ship`).
- **Tender day card** (`Phone23DaysTender`): a `Tender` chip and a
  warning-container notice with a small triangle: `Tender port. Boats back to
  the ship can have long lines, so the warning period is 60 minutes today.
  Make it longer if you like.`
- The phone sends the period to the watch with the day (for the red section).

### 23.3 Time-ashore bar (watch)

On the all-aboard countdown layout, under the ship/local line:

```
[CocoCay       10:05a       DOCKED]
ALL ABOARD IN                            Gothic 18 bold, port accent
6:25                                     Bitham 42 bold
4:30p ship · 4:30p local                 Gothic 18, muted
[====|=======-------------------##]      the bar, 184 × 8 px at 1×
7:00a                        4:30p       Gothic 14 bold, muted
Excursion back 11:30a                    Gothic 14 bold, sea accent
──────────
Hold Select: I'm on board                Gothic 14 bold, sea accent (§22.6)
```

- The bar runs from the day's arrival (ship time) to all-aboard. It's 8 px tall
  with rounded ends, and a now tick is 2 × 12 px.
- **Colors shift at now.** On a small, low-resolution screen the color change
  shows now better than the tick alone (owner).

| Part | Before now (light / dark) | After now (light / dark) |
|---|---|---|
| Plain time | port accent `#AA5500` / `#FFAA00` | divider `#AAAAAA` / `#555555` |
| Booked excursion (`time`–`end`) | `#0055AA` / `#00AAFF` | `#55AAFF` / `#0055AA` |
| Warning window (last *warning period* minutes) | `#AA0000` / `#FF5555` | `#FF5555` / `#AA0000` |

  The now tick is the text color (black / white). The warning window is drawn
  over the excursion if they overlap.
- `Excursion back 11:30a` shows while a booked excursion's `end` is still ahead
  (the first one that day, if there are several). It's left out once it has
  passed and on days without one.
- The next-items list moves off this layout (see §23.7).
- Without an arrival time for the day, the bar starts at 04:00. Without an
  all-aboard, there's no countdown and no bar (Home shows the NEXT card, as
  today).

### 23.4 Warning sign (watch)

- Inside the warning window, a **drawn warning sign** sits right of the
  countdown: a red (`#FF0000`) triangle with a black `!`, about the digits'
  cap height (about 31 × 28 px at 1×), 8 px after the digits, in both themes.
  It's the owner's concept (`Watch23WarningLight/Dark`).
- It goes away at all-aboard, when Home switches to the NEXT card.
- The countdown with the sign is about 150 px wide at 1×. The sign only shows
  in the last 2 hours at most, so the countdown is never three digits beside it.

### 23.5 Tender day (watch)

**No tender notice on the watch** (owner). A tender day's card looks like any
port day (`Watch23TenderLight`); the difference is the longer default warning
period (§23.2).

### 23.6 New color tokens

Red, the first new tokens since v1: **warning red** `#AA0000` (light) /
`#FF5555` (dark), **warning red pale** `#FF5555` / `#AA0000`, and **warning
sign** `#FF0000` in both themes. `#55AAFF` (sea pale) is new too. All are in
the Pebble 64-color palette. Add them to the tokens table in `docs/DESIGN.md`
when this is built.

### 23.7 Bar or next-items list (decided)

The bar takes the space of the next-items list on the countdown layout.
**Decided by the owner, 2026-09-26: as the mockups show**, the bar without the
list (the list is one press away in Today). The alternative, a thinner bar
under the ship/local line with the list kept, was not taken.

---

## 24. Settings page upgrades

**Status: first draft, not reviewed.** Mockups: `Phone24Me`, `Phone24Ready`,
`Phone24Search`. Review with the owner before building.

- **Me tab** (`Phone24Me`):
  - The stateroom box has `inputmode="numeric"` and takes digits only. A number
    found in the ship's cabin table fills **Deck** (now a drop-down: the ship's
    decks from the venue table, or 1-18 without one) and **Nearest stairs**,
    each with a small outlined chip, `From cabin table` / `From ship map`.
  - Muster station and deck are prefilled from the booking (`mine`) when empty,
    with `From booking`.
  - A field changed by hand shows the existing `Edited` warning-container chip
    and a line like `Your change is kept. Ship map says Fore stairs.`. It's
    never refilled.
- **Ready to sail** (`Phone24Ready`, Cruise tab): a card with three rows, each
  a ✓ (primary) or a warning-container row with a fix button:
  - every cruise day downloaded (`8 of 8 days, schedule published`);
  - stateroom set;
  - fits on the watch (`Busiest day 142 of 160 events`).
  The title reads `N thing(s) left before you go offline`. When all three pass,
  the card becomes a primary container reading `You're ready to go offline`.
- **Search events** (`Phone24Search`): a search field at the top of the Events
  tab searches every day. It shows `14 events on 6 days`, with results grouped
  under day headers (`DAY 3 · ST. THOMAS · MON MAR 8`) and the usual star
  buttons. Booked items (§22.7) are found too. Clearing the field goes back to
  the day view.

## 25. Silent morning sync

No new screens. After a silent sync, My info's Last sync reads like any other
sync (`4:31a today`). The usage log records the outcome (brief). The sync wakeup
shares slots with reminders and the all-aboard alerts, which now vary by
warning period (§23.2).

## 26. Confirm before removing a star

**Status: first draft, not reviewed.** Mockups: `Watch26RemoveStarLight/Dark`.

- Hold Select on a starred event (Today, details) opens a screen with
  `Remove star?` (Gothic 24 bold), a divider, the title (Gothic 18 bold) and
  `9:00p · On Air` (Gothic 14 bold, muted). The top bar stays the screen's own.
- Button labels are drawn at the screen edge like the first-open hints:
  `Hold: remove` beside Down (port accent pill) and `Keep` beside Back (dark
  gray pill).
- Hold Down removes the star (the usual short buzz) and returns; Back keeps it.
  Up and Select do nothing, and there's no timeout.
- Starring (hold Select on an unstarred event) stays instant.
- Booked items (§22.3) never get here, since their star is locked.
- The `On board?` screen (§22.6) uses the same layout, with a sea accent pill.
- Check every screen where hold Select already does something else (place
  pages, Home, Route), per the brief.

## 27. Casino filter

**Status: first draft, not reviewed.** Mockup: `Phone27Casino`.

- A **Hide casino events** card on the Filters tab, above the category
  switches (casino events cut across categories). It's a switch, with the
  count it hides (`Hides 23 events this cruise`).
- The description: `Casino Royale and casino games (slots, blackjack, poker,
  roulette, craps, tournaments). Bingo and raffles aren't included. Casino
  Royale stays in the ship directory and routes.`
- Matching is on the phone, per the brief. It affects event lists and Today
  only.

## 28. Share my plan

**Status: first draft, not reviewed.** Mockups: `Phone28Share`,
`Phone28Import`. Needs a new section in `docs/DATA_FORMAT.md` when built.

- **Share my plan** card on the Cruise tab (`Phone28Share`): what goes in,
  as counts (`14 starred events`, `3 personal entries`, `2 days with
  all-aboard or ship-time changes`, `1 itinerary edit · 2 venue fixes`), the
  `Include cabin details (we share a cabin)` checkbox, and `Share plan`
  (primary) / `Import plan` (tonal). It doubles as a backup. The day settings
  now include the all-aboard shift and warning period (§23).
- **Import review** (`Phone28Import`): a summary (`9 differences · same ship and
  sail date`), then `Accept all`, `Review each` and `Reject import`, with the
  note `Accept all adds their stars and uses their settings where they
  differ. It never unstars or deletes anything of yours.`
  - In Review each, differences are grouped (STARS, DAY SETTINGS, …). Each row
    has a two-way segmented choice: `Add star` / `Skip`, `Keep mine` /
    `Unstar`, `Use theirs` / `Keep mine`.
  - `Apply` and `Cancel` sit in a bottom bar. Nothing is saved until Apply.
