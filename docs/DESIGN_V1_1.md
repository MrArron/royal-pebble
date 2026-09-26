# Royal Pebble — v1.1 design (venue table, wayfinding, reservations, daily view, Ship GPS)

Returned from Claude Design on 2026-09-24 and approved by the owner. Build from
this file; the mockups in `docs/mockups/v1.1/` are reference. `docs/DESIGN.md`
still covers everything v1.1 doesn't change.

**Decisions made after the return** (these override the text below):

- **Top bar:** ship time moves from the right to the **center** of every watch
  top bar (§4), so it's in the same place on every screen. The `SHIP TIME`
  label goes; the right side holds the small context label.
- **Thin top bar** (owner's choice, 2026-09-24): the mockups' one-line 22 px bar
  replaces v1's two-line 56 px bar on every screen, alert and schedule-change
  screens included. The date line goes. Built as: screen name on the left
  (Home shows the port or `At Sea`, since the Today list is already "Today";
  alerts say `Reminder` / `All aboard`; schedule changes say `Schedule`), ship
  time centered, the day's status (`DOCKED`, `AT SEA`) in the small-caps color on
  the right. The right label is dropped when it doesn't fit or repeats the name.
- **Alert screens** lose their tall colored band: `IN 10 MIN` is the first body
  line (sea accent; all-aboard keeps it large, Gothic 28, in the port accent).
  A reminder without "From" directions shows the cabin-relative line under the
  deck line, as on event details.
- **Venue logic stays on the phone.** The phone sends each event's deck,
  deck range, position, Ashore and decks-from-cabin as numbers
  (`docs/WATCH_PROTOCOL.md`); the watch only formats them, so other ships need
  no watch change.
- **Home short form** on the cabin deck reads `Deck 6 Aft · your deck`; list
  items at Ashore venues read `Venue · Ashore`.
- **Reserved** (§5) is built together with item 9 (reservation reminder) in
  phase 2, not with the wayfinding items.
- **"From" directions** (§2, reminder alert) follow the brief's rule: they start
  from the previous starred event or personal entry only when it ends less than
  15 minutes before this one starts (or overlaps it; no length = 30 minutes).
  Otherwise directions are relative to the cabin. As built (item 3):
  - When several stops qualify, the one that started last is used. The first
    stop after 04:00 can start from one the night before.
  - The deck line and the route use the pair of entrances nearest each other
    (Royal Theater 3-5 to Pool Deck 15 goes from deck 5).
  - Route line: `↑10 decks · Fore → Mid`; `Same deck · Fore → Mid` on the same
    deck; one position (`· Mid`) when both are the same or the previous one
    isn't known; none when the venue has no position.
  - `Same area · Deck 5` only when the neighborhood, the deck and the position
    all match (or a position isn't set, like Royal Promenade). Otherwise, even
    in the same neighborhood, the route line shows.
  - No "From" block when either venue is Ashore, not in the table, or missing;
    the reminder falls back to the cabin line.
- **Ship directory as built** (item 4, §3; protocol in
  `docs/WATCH_PROTOCOL.md`, Ship directory):
  - My info ends with a `Ship directory` row drawn under the cursor; Select
    opens it. Levels: the decks (or `Browse by area`), one deck or area, one
    place.
  - Deck rows: `Deck 5` over the two areas with the most places there and the
    count (`Promenade · Boardwalk · 28`; short area names on this line), or
    `1 place` with no area. A venue with several entrances counts on each deck.
  - A deck page groups by `FORE` / `MID` / `AFT`, then `FULL LENGTH` for places
    with no position (Royal Promenade). The top bar's right side is the drawn
    `↓3 decks` (or `your deck`).
  - An area page groups by deck and position (`DECK 8 · MID`); a place with
    several entrances shows once, under the entrance nearest the cabin. Area
    names don't fit beside the ship time, so the top bar says `Area` and the
    name is a Gothic 24 bold heading.
  - A place page (top bar `Place`): the name, `Deck 5 · Mid`, `↓3 decks from
    cabin`, the area, then `LATER TODAY` with the events still to come there
    (title, time, star), or `Nothing more today`.
  - Without the phone: `Connect your phone`; Select tries again.
- **Reminder alerts keep shorter text** so they take little of the watch's
  storage (sized when it was thought to be 4 kB in all): title 31 bytes, venue
  and previous venue 17 bytes each. Long venue names have a short name in the
  table for the alert only (`Main Dining 5`, `Playmakers`, `Ocean Theater`,
  `Perfect Storm`...); the rest are cut (`Boardwalk Dog Hou`). Event details,
  Home and Today keep the full names.
- **Cabin deck** comes from the Me tab's free-text Deck field; the phone reads
  the digits out of it ("Deck 9" → 9). No digits → no relative lines.
- **Venues with entrances on several decks** (Harmony: Royal Theater 3–5,
  AquaTheater 5–6, Dazzles 8–9) list every entrance deck. Directions and deck
  lines use the entrance nearest to where the user is coming from (the cabin
  deck, or the previous venue under the "From" rule; ties go to the lower deck).
  With no reference deck, show the range (`Decks 3-5 · Fore`). **Exception:**
  the Main Dining Room. Guests are assigned a floor and the schedule names each
  floor as its own venue ("Main Dining Room 5"), so never redirect it to a nearer
  floor. In the editor, the Deck card holds one stepper per entrance with an
  "Add entrance" text button; the Deck grouping lists the venue under each of its
  decks.

- Design canvas (private to the owner):
  https://claude.ai/artifact/7de76Akgfyt6zvpwTZr2R5
- `docs/mockups/v1.1/*.dc.html`: the source of each screen. They are Claude Design
  component files: plain HTML with every style inline, so exact sizes, colors
  and copy can be read straight from them. They won't render on their own
  (they need the canvas runtime). Open the canvas link to see them.
- **All deck/position values in the mockups are placeholders.** The real
  Harmony values get filled in and checked separately. Mockups assume the
  cabin is on deck 6. No real stateroom number appears anywhere.

Scope of this return:

1. Venues editor on the phone settings page (v1.1 item 1).
2. Venue wording on the watch (item 2), including shortened forms that fit.
3. Ship directory on the watch (item 4), a rough version.
4. **Added during design:** current ship time in every watch top bar.
5. **Added during design:** marking a starred event as **Reserved**.

---

## 1. Phone: Venues editor

### Where it lives

The editor lives under **Cruise**. A new **Ship venues** card sits between the
schedule card and the paste-in backup card.

- **Why Cruise:** venues are ship data that arrive with the schedule. Me is for
  personal things. The bottom nav stays at five destinations.
- **Second entry point:** tapping a venue on an event (Events tab) opens the
  same edit screen for that venue. The edit screen has a
  "Show events at this venue" link going the other way.

### Screens (mockups: `Cruise`, `Venues`, `VenueEdit`, `VenueStates`)

**Cruise › Ship venues card**

- **Header:** a 48 px round icon (map pin) on primary container, the title
  "Ship venues", and the subtitle "Deck, fore/mid/aft and area for each venue".
- **Three-up stat grid**, each tile 16 px radius:
  - `N venues` on container high
  - `N to check` as an outlined tile
  - `N edited by you` on warning container
- **Buttons:**
  - filled pill `Review N`, which opens the edit screen in review mode on the
    first venue to check
  - text button `All venues`, which opens the list

**Venues list** (full screen, bottom nav stays with Cruise selected)

- **Top bar:** back arrow, the title "Ship venues", and the Save pill.
- **Search:** a 48 px search field (container high, 24 px radius) that matches
  venue names.
- **Filter chips:** `All` · `To check · N` · `Edited · N`.
  - "To check" means a flagged value **or** a venue that isn't in the table.
  - Chips are 36 px tall with 10 px radius. Selected = secondary container;
    unselected = 1 px outline.
- **Group by:** a connected segmented button, `Area | Deck`. The selected half
  is primary / on-primary.
  - **Area:** the seven neighborhoods in Harmony order, then Ashore.
  - **Deck:** ascending deck number, venues ordered Fore → Mid → Aft within each
    deck, then Ashore.
  - In both modes, venues that aren't in the table come first, in a
    **"Needs details"** group.
- **Group header:** the name in primary, 14 px, 600 weight, with the count on
  the right.
- **Group card:** container low, 20 px radius, rows split by 1 px container-high
  dividers.
- **Row** (min height 60 px):
  - name, 16 px
  - sub-line, 13 px on-surface-variant: `Deck 5 · Mid` in Area mode,
    `Mid · Royal Promenade` in Deck mode
  - a status badge, then a chevron
- **Floating button:** extended FAB `✓ Review N` (primary container, 56 px tall,
  18 px radius), bottom-right just above the nav, for one-handed use.
- **Empty search result:** "No venues match. Venues that aren't in the table yet
  show up under "To check" once an event uses them."

**Row badges and states** (see `VenueStates`)

| State | Sub-line | Badge |
|---|---|---|
| Built-in, confirmed | `Deck 4 · Mid` | none |
| Flagged "check" | `Deck 4 · Mid` | outlined chip `? Check` (1 px outline, on-surface-variant) |
| Edited by owner | `Deck 4 · Fore` | warning-container chip `✎ Edited` |
| Not in table (blank) | `Not in the table yet` | container-high chip `+ Add` |
| Ashore | `Ashore · no deck` | none |

**Edit venue** (`VenueEdit`, interactive in the canvas)

- **Top bar:** back arrow, then two lines of text — a small progress label
  (`3 of 12 to check`) above the venue name at 22 px — and the Save pill.
- **Three field cards**, each a container-low card with 28 px radius:
  - **Deck:** a stepper — 48 px round `−` / `+` buttons on secondary container,
    around a 56 px number field (12 px radius, range 1–18). Helper text:
    "The deck you walk in on".
  - **Position:** a three-part connected segmented button, `Fore | Mid | Aft`,
    48 px tall.
  - **Neighborhood:** wrapping chips, 40 px min height, for the seven areas plus
    `Ashore`.
- **Status line under each field** (one of three):
  - **Built-in, not flagged:** muted text "Built-in value".
  - **Flagged:** outlined chip "Check · not confirmed on deck plans", with a
    **Looks right** text button.
  - **Edited:** warning-container chip "Edited · built-in 6", with a **Reset**
    text button. The field itself also turns warning container: the deck input
    background, the selected segment, or the selected chip.
- **Watch preview card:** dark (`#161D1D`) with the label
  "ON YOUR PEBBLE TIME 2". It shows the watch lines live (`Deck 7 · Aft`, then
  the relative line with its arrow). Choosing Ashore shows just `Ashore`.
- **Link:** "Show events at this venue".
- **Bottom bar** (replaces the nav on this screen, container color):
  **Reset all to built-in** as a text button, and **Next ›** as a 56 px filled
  pill. In review mode, Next goes to the next venue to check. Otherwise it goes
  back to the list.

### Tokens

**No new tokens.** Existing roles are reused:

- **Warning container** = edited or pending: edited venue values, and
  "Reservation needed" (section 5).
- **Primary container** = done / confirmed: the Reserved chip.
- **Outline** = needs checking.

---

## 2. Watch: venue wording

The mockups are 400×456 (2×). Roboto Condensed stands in for Gothic:

| Mockup size | Pebble font |
|---|---|
| 48 px | Gothic 24 bold |
| 34 px | Gothic 18 bold |
| 26–30 px | Gothic 14 bold |

"Muted" means `#555555` in light and `#AAAAAA` in dark.

### Event details (`WatchEventLight`, `WatchEventDark`, `WatchEventAshore`)

The lines, in order:

```
Title                          Gothic 24 bold, wraps
Studio B                       Gothic 18 bold, muted
Deck 4 · Mid                   Gothic 18 bold
↓2 decks from cabin            Gothic 14 bold, muted
1:00p - 2:00p · 1 h            Gothic 18 bold
Reservation needed             Gothic 14 bold, port accent   (see §5 for starred)
──────────
★ Starred / Hold Select to star
```

- **Same deck as the cabin:** `On your cabin deck`.
- **Ashore:** the deck line becomes `Ashore` (Gothic 18 bold, port accent) and
  the relative line is left out.
- **Venue not in the table:** leave out the deck and relative lines. Never show
  "unknown".

### Home NEXT card (`WatchHomeLight`, `WatchHomeDark`)

```
★ NEXT · IN 20 MIN             sea accent
Title                          Gothic 24 bold
12:00p · On Air                Gothic 18 bold, muted (long venue names wrap)
Deck 4 Aft · ↓2                Gothic 14 bold, muted   ← short form
──────────
1:00p Adults Only Trivia       Gothic 18 bold
Studio B · 4 Mid               Gothic 14 bold, muted   ← list-item short form
```

### Reminder alert (`WatchReminder`)

```
IN 10 MIN                      sea accent
Title
1:00p · Studio B               muted
Deck 4 · Mid
──────────
From Royal Theater:            Gothic 14 bold, muted
↓1 deck · Fore → Mid           Gothic 18 bold
```

The "From" part uses the previous starred event or personal entry when it ends
less than 15 minutes before this one starts (see the decisions at the top).
Otherwise leave it out.

- **Previous event at the same venue:** replace the two "From" lines with
  `Same venue`.
- **Same neighborhood:** `Same area · Deck 5`.

### Wording that was shortened to fit 200 px

| Proposed | Final |
|---|---|
| `Studio B · Deck 4 · Mid` | split: venue on one line, `Deck 4 · Mid` below |
| `2 decks down from you` | `↓2 decks from cabin` |
| `From Royal Theater: 1 deck down, aft → mid` | `From Royal Theater:` / `↓1 deck · Fore → Mid` |
| (Home) | `Deck 4 Aft · ↓2` |
| (list items) | `Studio B · 4 Mid` |

### Arrows must be drawn, not typed

The Pebble system fonts can't be trusted to include ↑ ↓ →, and in the
mockups the glyphs looked too small next to the bold digits. Draw them:

- ↑ / ↓ are small bitmaps (or GPath) exactly the **digit cap height** of the
  font they sit beside: about **10 px** next to Gothic 14 and **12 px** next to
  Gothic 18. The bottom sits on the text baseline, the stroke matches the bold
  digit stroke, and there is 1 px of space before the number.
- → sits centered on the lowercase letters, with 2 px of space on each side.

The mockups show the target proportions.

---

## 3. Watch: ship directory (item 4, rough)

`WatchDirectory`, `WatchDeck`. It lives at the bottom of My info. The top bar is
`#555555`.

**Level 1**

- The first row is `Browse by area`.
- Then one two-line row per deck: `Deck 5` (Gothic 18 bold) over
  `Royal Promenade · 6` (area + venue count, Gothic 14 bold, muted).
- The cabin's deck is labelled `Deck 6 · your deck`.
- The selected row uses the sea accent background with white text.

**Level 2 (one deck)**

- Top bar: `Deck 5` on the left; the relative label `↓1 deck` on the right.
- Small-caps section headers `fore` / `mid` / `aft` (muted), then venue names in
  Gothic 18 bold.
- Ashore comes last on level 1.

"Browse by area" uses the same pattern, with neighborhoods at level 1.

---

## 4. Watch: ship time in the top bar

Every watch screen shows the **current ship time centered in the top bar**
(Gothic 14 bold, white, e.g. `12:40p`). The screen label stays on the left and
the small-caps `#AAFFFF` label on the right.

Keep the side labels short. Where a label would run into the time, the right
label is shortened: the deck screen went from `↓1 from cabin` to `↓1 deck`. When
space is tight, the time wins and the right label is dropped. Update it once a
minute.

---

## 5. New: mark a starred event "Reserved"

For events whose schedule entry says a reservation is needed. Mockups:
`EventsReserve` (interactive), `WatchResNeeded`, `WatchResReserved`,
`WatchResHome`.

### Phone (Events tab)

- **Starred, reservation needed, not marked:**
  - warning-container chip `Reservation needed`
  - a secondary-container pill button `✓ Mark reserved` (40 px)
- **Starred and reserved:**
  - primary-container chip `✓ Reserved`
  - a text button `Not reserved` to undo
- **Not starred:** a muted note, `Reservation needed · star it to track`, with
  no button. Reserved only applies to starred events.
- **Unstarring** a reserved event hides the Reserved state but keeps the flag,
  so starring it again restores it.
- **New filter chip** after All / Starred: `To reserve · N`. N is the number of
  starred events that need a reservation and aren't marked. When it's empty:
  "Every starred event that needs a reservation is marked reserved."
- **Event row layout:** time column (52 px, bold 14) · title / venue / status ·
  a 48 px star button (filled primary when starred), on a container-low card
  with 20 px radius.

### Watch

- **Event details, starred, not reserved:** the reservation line reads
  `Not reserved yet` (Gothic 18 bold, port accent). Under ★ Starred there's a
  hint, `Select: mark reserved` (Gothic 14 bold, muted).
- **Event details, reserved:** the line becomes a drawn ✓ plus `Reserved`
  (Gothic 18 bold, sea accent), and the hint becomes `Select: not reserved`.
- **Home NEXT:** if the next event is starred, needs a reservation and isn't
  reserved, add a line `Not reserved` (Gothic 14/18 bold, port accent) under the
  deck line. List items that are reserved get a small drawn ✓ plus `Reserved`
  in the sea accent after the venue.
- **Reminder alert:** show the same `Not reserved` line when it applies (not
  mocked; follow the Home pattern).
- **Unstarred events** keep today's `Reservation needed` line.

**Button assumption:** a short press of **Select** on event details toggles
Reserved; Hold Select still stars. If short Select is already used on that
screen, put "Mark reserved" in a small action menu instead, or make it
phone-only. Check the current input handling before building.

As built (item 9, part 1):
- Short Select was free on event details, so it toggles Reserved there (short
  buzz); on other events it does nothing. Details show `Not reserved yet` or a
  drawn ✓ `Reserved` in the reservation line's place, and the Select hint under
  ★ Starred.
- The phone keeps the mark with the stars under `R|` + the star key, so it goes
  through the watch's star queue and the latest change wins
  (`docs/WATCH_PROTOCOL.md`, Star changes). A rescheduled star takes its mark
  along.
- Home items read `Only show · Studio B · 4 Mid · ✓ Reserved`; the venue gives
  way (ellipsis) so the mark always fits. The reminder alert's `Not reserved`
  line comes after the where and "From" lines.
- Settings page: the chip and button replace the old `Reservation` word in the
  row's details line; the button and star update the row in place. `To reserve
  · N` sits after `★ Starred` and shows while N > 0 (or while it's open); rows
  marked on it stay until another chip is picked, so a mark can be undone. My
  entries is hidden on it.

**Real data** (checked 2026-09-25): Royal marks no free activity as
reservation-required. The shows you reserve come as `ENTERTAINMENT` products and
paid classes as `ACTIVITIES`, which the sync used to drop; both are kept now
(`docs/DATA_FORMAT.md`). Owner's choices: shows stay in the lists like any
event (free; the data still flags them as needing a reservation). Paid classes
get a **Booked activities** card on the Events tab, under My entries (day and
★ Starred views): one row per product with its price and venue, a dropdown per
booked session (change or × to remove) and `Another session…`. Booking stars
the session and marks it reserved; only booked sessions reach the watch or the
event lists. Booked products are listed first; the rest fold behind `Show all
N`. Paid classes never get Last chance / Only show tags.

**Reservation reminder** (item 9, part 2; owner's choices, 2026-09-25):
- A buzzing alert the evening before, listing tomorrow's starred events that
  need a reservation and aren't marked reserved, plus a `To reserve` line on
  the tomorrow summary card (§8.1).
- The alert time is a setting on the Me tab (default 20:00 ship time).

As built (item 9, part 2):
- Me tab: `Evening reminder to reserve`, 6 pm to 10 pm on the hour, default
  8 pm. Ship time.
- The alert buzzes like a reminder (double pulse). Top bar `To reserve`, then
  `TOMORROW` (sea accent) and each event as `7:00p Hairspray` over its venue,
  untimed ones first, as many as fit (3 to 4), then `+ 3 more` (port accent).
  No alert when nothing is left to reserve.
- It lists the next watch day, so a show just after midnight counts with the
  evening before. Booked paid sessions are already reserved and never appear.
- The tomorrow card reads `2 to reserve` (Gothic 14 bold, port accent) under
  the `First` line.
- Test alerts adds a to-reserve alert with two test events a minute after the
  test all-aboard warning.
- If a reminder or all-aboard warning falls in the same minute, that is shown
  with `+ N more` and the list isn't (rare: a starred event exactly one
  reminder lead after the alert time).

---

## 6. Data shape changes

Venue table, per venue:

```
name            string (key; the name as it appears in Royal's schedule)
decks           int[]            (entrance decks, ascending; [] = blank, or Ashore)
position        "Fore"|"Mid"|"Aft"|null   ← now optional (see below)
neighborhood    one of 7 | "Ashore" | null
flags           per field: { deck: bool, position: bool, neighborhood: bool }
confirmed       per field: bool  ← NEW: owner tapped "Looks right"
aliasOf         string | null    ← NEW (see below)
```

Owner overrides, stored separately and surviving re-downloads:

```
{ venueName: { decks?, position?, neighborhood?, confirmed?: {field: true} } }
```

The phone keeps them in its settings per ship code (`settings.venues.HM`). A
field is only stored when it differs from the built-in value, so a stored field
means edited. Venues that aren't in the table are keyed by their schedule name.

- **A flag is per field, not per venue.**
  - An edited field is never shown as flagged.
  - Reset puts back the built-in value **and** its flag, unless that field is
    confirmed.
  - "Reset all to built-in" also clears confirmations for that venue.
- **Confirmed is separate from edited.** "Looks right" clears the check without
  changing the value, and doesn't count as Edited in the counts.
- **Position is optional** for venues that run the length of the ship (e.g.
  Royal Promenade). On the watch, leave out ` · Mid` when it's null.
- **Aliases** for near-duplicate schedule names, so they're only entered once,
  for example:
  - `Perfect Day CocoCay` → `Perfect Day at CocoCay`
  - `Casino Royale Non-Smoking` → `Casino Royale`
  - `Adventure Ocean` → `Adventure Ocean Theater`

  Harmony has 36 (all in `SHIPS.HM` in `src/pkjs/venues.js`, refreshed from
  Royal's deck plans on 2026-09-24). An alias row shows "Same as …" in the list,
  and editing it goes to the target.
- **Blank venues:** any venue name in the downloaded schedule that isn't in the
  table (and isn't an alias) shows up in "Needs details". Events with no venue
  at all (7 in the sample) are ignored here.
- **Cabin deck** for the relative lines comes from the existing Stateroom card
  on Me. If it isn't set, leave out every relative line (`↓2 decks from cabin`,
  `↓2`) and the "your deck" label.

Events:

```
reserved   bool   ← NEW, owner state, keyed like stars; survives re-downloads
```

**Sync:** if the watch can toggle Reserved, the change must go back to the phone
through the companion. The phone must not overwrite a watch-side toggle on the
next sync. Use last-write-wins with a timestamp, or treat the watch as
authoritative for this flag until it's acknowledged.

---

## 7. Check before or while building

- Whether short Select is free on event details (§5).
- Whether Gothic 14/18 bold fits the final strings at 200 px in both themes.
  The mockups use a stand-in font, so check against the real one. The widest
  lines are `↓2 decks from cabin`, `1:00p - 2:00p · 1 h` and
  `↓1 deck · Fore → Mid`.
- Top bar: that the time plus the widest left label (`Reminder`) plus the right
  label fit. If not, drop the right label.
- Arrow bitmaps: sized to digit cap height for each font used (§2).
- Real Harmony deck/position values: a separate task. Everything shown here is
  a placeholder.

## 8. Phase 2: daily view (items 5-8)

**Status: as returned, approved 2026-09-24.** Written as the brief for a Claude
Design pass; the mockups came back and the owner answered the open decisions
(8.6). Items 5 (the morning summary), 6 (the countdown), 7 (the clash
warning), 8 (the last-chance tag) and 9 (Mark reserved and the reservation
reminder, §5) are built. The layouts below are the original text sketches at watch size; the mockups
and their `NOTES.md` are the final word on text and layout.

**Brief for Claude Design:**
- Pebble Time 2 watch screens, 200×228 (mockups at 2×, 400×456, like §2).
- Light and dark themes, the v1.1 thin top bar (§4), and the fonts and tokens in
  §2 and `docs/DESIGN.md`. No new tokens unless needed.
- Plus the settings page pieces for item 7.
- Use placeholder dates, decks and names, and no real stateroom.
- Wanted mockups: `WatchSummaryPort`, `WatchSummarySea`, `WatchSummaryTomorrow`,
  `WatchCountdown` (far away and the last day), `WatchClashToast`,
  `WatchClashDetails`, `EventsClash` (phone), `WatchLastChance` (a Today row and
  event details).
- **Mockups as returned** (2026-09-24, approved with the 8.6 answers):
  `docs/mockups/phase2/`. Its `NOTES.md` lists shortened text, the new drawn
  `!` and the smaller layout choices; `preview.png` shows every screen. Where
  `NOTES.md` shortens or changes text from the sketches below, the mockups win.

**What the watch knows today** (`docs/WATCH_PROTOCOL.md`):
- The sail date, and today's type, location, status and all-aboard time.
- Today's events with their star, featured and reservation flags and their
  lengths.
- It does **not** have arrive/depart times or anything about tomorrow. Items 5
  and 8 need the phone to send more (see Data at the end). As with the venues,
  the phone computes, and the watch only formats and stores.

### 8.1 Morning summary (item 5)

A one-screen card shown **instead of Home on the first open of the watch day**
(after 04:00 ship time). Any button dismisses it to Home. Down and Up also go on to
Today and My info as usual, so it never costs an extra press.

- **Opens that don't count:** an alert or the planned silent 04:00-05:00 sync
  wakeup (memory: silent morning sync) opening the app doesn't use up the summary.
  Only an open by the user does.
- **Getting it back:** a `Today's summary` row at the top of My info (proposal).
- **Stored:** it works without the phone. Everything on it is saved with the day.

Port day:

```
[St. Thomas     9:12a     DOCKED]      thin top bar
DAY 4 · PORT DAY                        small caps, muted
St. Thomas                              Gothic 24 bold
Docked 7:30a - 5:30p                    Gothic 18 bold (ship time)
All aboard 5:00p                        Gothic 18 bold, port accent
──────────
★ 4 starred today                       Gothic 18 bold
First 10:00a Zumba                      Gothic 14 bold, muted
1 clash                                 Gothic 14 bold, port accent (item 7; only if any)
```

- **Sea day:** `DAY 2 · SEA DAY`, then `At sea` (Gothic 24 bold), and no
  docked or all-aboard lines. The space goes to the first two starred items.
- **Embark day:** `DAY 1 · EMBARK`, the port, `Sails 4:00p`, `All aboard 3:30p`.
- **Debark day:** `LAST DAY · DEBARK`, the port, and `Arrive 6:00a`. No
  all-aboard. The phase 4 debark checklist can hang off this later.
- **Nothing starred:** `Nothing starred yet` plus the number of featured events
  when the featured switch is on (`6 featured today`).
- **Port times in ship time:** port times are shown in ship time, like the
  countdown. When the port's local time differs, add `Port time +1 h` (muted)
  under the docked line (decided in 8.6: only when the offset isn't 0).

**Tomorrow version:**
- Shown on the first open **after 20:00**. The same card with the label
  `TOMORROW · DAY 5 · PORT DAY`, and the top bar left label `Tomorrow`.
- Adds `Last chance: Hairspray` (item 8) when tomorrow holds a final
  performance.
- Once dismissed, it stays reachable from the same My info row until 04:00.

### 8.2 Days-to-sail countdown (item 6)

Home before the cruise (`day_kind` 2 with a future sail date). Today it shows
only the status, `SAILS MAR 6`. The watch counts the days itself from the sail
date, so it stays correct without the phone.

```
[Home           9:12a              ]
SAILS IN                                small caps, muted
78                                      large numerals (Leco 42 if available)
days                                    Gothic 18 bold
Sat Mar 6 · Port Canaveral              Gothic 18 bold, muted (placeholder date)
Harmony of the Seas                     Gothic 14 bold, muted
──────────
★ 3 starred so far                      Gothic 14 bold (stars made on the settings page)
```

- **Last 3 days:**
  - The card adds `Sync before you leave`, then `Works offline after a full sync`
    (sync-before-departure rule), with the last sync date from My info.
  - The day before, the number becomes `Tomorrow`.
- **Sail day:** the normal day (embark) begins at 04:00, and the morning summary
  takes over. Between midnight and 04:00 on the sail date the number reads
  `Today`.
- **No stars yet:** the last line reads `Nothing starred yet` (muted, no star).
- **After the cruise:** unchanged (`CRUISE ENDED`).

### 8.3 Clash warning (item 7)

**Clash:** two starred events or personal entries whose times overlap. An event
with no length lasts 30 minutes (the Today drop-off rule). Back-to-back is not a
clash. Only starred events and personal entries count, never unstarred ones.

Watch:
- **Starring something that clashes** (Hold Select):
  - a double short vibration instead of the single one;
  - a toast over the list for about 3 s: `Clashes with` / `1:00p Trivia`
    (Gothic 14 / 18 bold, port accent bar).
  - The star is still made; it's a warning, not a block.
- **Event details** of a clashing starred event: a line
  `Clashes with 1:00p Trivia` (Gothic 14 bold, port accent) under the time line.
  `+1 more` when there are several.
- **Today list:** a small drawn `!` in the port accent after the star, on both
  rows. Keep it or drop it depending on how it fits the 200 px row.
- **Home NEXT and the morning summary:** the count, `1 clash`.
- **Where it's computed:** the watch computes clashes itself from today's
  events, since stars can change with the phone away. Across the 04:00 boundary
  it isn't checked (rare).

Phone (settings page, Events tab):
- A warning-container chip `Clashes with Trivia 1:00p` on the event row, on both
  events.
- A filter chip `Clashes · N` after `To reserve`, hidden when N is 0.

As built (item 7):
- The watch's `1 clash` counts **pairs** of clashing items; the phone's
  `Clashes · N` counts the **items** it lists. Finished items don't count on
  either.
- Home shows the count under the NEXT card, and under the all-aboard countdown
  on port days.
- The settings page has no `To reserve` chip yet, so `Clashes · N` sits after
  `★ Starred` in the day chip row. Personal entries get the chip too.
- The toast doesn't say `+1 more`; details does.

### 8.4 Last-chance tag (item 8)

- **Rule:** the final performance of a **featured** show in the cruise, matched
  by title across all days, gets a `Last chance` tag.
  - A show with a single performance gets `Only show` instead (decided in 8.6),
    shown wherever `Last chance` shows, in the same style.
  - Personal entries and unfeatured events never get a tag.
- **Where it's worked out:** the phone works it out from the whole bundle and
  sends it as an event flag, since the watch only has today.

Where it shows:
- **Today row:** the second line becomes `Royal Theater · Last chance`, with
  `Last chance` in the port accent.
- **Event details:** a `Last chance` line in the port accent under the
  reservation line.
- **Home:** the featured card and the NEXT card get the same tag.
- **Tomorrow summary:** `Last chance: Hairspray` (8.1).
- **Settings page:** an outlined `Last chance` chip on the event row.

As built (item 8):
- The Today row reads `Last chance · Royal Theater` (tag first, per the
  mockup NOTES); on a NOW row `ends …` replaces it. On the cursor the tag takes
  the cursor text color.
- Home: a `Last chance` line (Gothic 14 bold, port accent) at the foot of the
  NEXT / FEATURED card, and the smaller items below it read
  `Last chance · Venue · 4 Mid` like Today rows.
- The settings page chip sits before the clash chip, and stays when a star tap
  updates the clash chips in place.
- The watch only reads the flags; the phone sets them in `slice.buildEvents`,
  so personal entries and unfeatured events never have them.

### 8.5 Data the phone would add (for the build PRs, not for Claude Design)

- **BEGIN:** `arrive` and `depart` in cruise minutes (−1 none), and a tomorrow
  block: `tmr_kind`, `tmr_location`, `tmr_arrive`, `tmr_depart`,
  `tmr_all_aboard`, `tmr_starred`, `tmr_first` (a short title), `tmr_last`
  (a last-chance title or empty). Plus the ship name for the countdown.
- **Watch store:** these are saved in the stored header so the summary and
  countdown work without the phone. That is a few dozen bytes, and it bumps the
  storage version.
- **Packed events:** `flags` bit 4 (16) = last chance, bit 5 (32) = only show.
  (Planned as bits 16 and 17, but `flags` is one byte.)
- `docs/WATCH_PROTOCOL.md` changes with each build PR. The bundle format doesn't
  change.

### 8.6 Decisions (owner, 2026-09-24)

1. **Replace Home or overlay it:** the summary **replaces Home** on the first
   user open after 04:00. Any button moves on to Home. Alert and silent-sync
   wakeup launches don't count as that open.
2. **My info row:** **add a `Today's summary` row** to My info. It reopens the
   summary, or the tomorrow card after 20:00.
3. **Port times:** show `Port time +1 h` **only when the offset isn't 0**.
4. **Tomorrow:** the tomorrow card shows on the **first open after 20:00**, and
   from the My info row.
5. **Single performances:** **`Only show` tag** (not no tag). Same places and
   style as `Last chance`; the phone sends it as a flag bit (8.5).
6. **Clash `!` marker:** **in the Today list too**, as well as on details and
   the toast. Only clashes between starred events (reserved ones included, since
   Reserved only applies to starred events) and personal entries are marked
   (8.3). Unstarred events never get one.
7. **Countdown details:** **show both** the ship name and the starred-so-far
   count.

---

## 9. Ship GPS (items 19-21)

**Status: designed and approved 2026-09-25.** Written from the Claude Design
pass and the owner's answers (9.9). Built so far: the planner (phone only) and
the place page's FROM block with the units setting (9.1, 9.7); the restroom
line, route screen, Home Select, hints and Help follow. The mockups and their
`NOTES.md` in `docs/mockups/gps/` are the final word on text and layout; the
sketches below are at watch size. Design canvas (private to the owner):
https://claude.ai/artifact/Cq3jrWKZAZE6qHxbqNVy6n

Fonts, drawn arrows, tokens and the thin top bar are as in §2-§4. All names,
decks and distances in the mockups are placeholders (cabin on deck 6, no
stateroom).

**Changed from the brief during design:** restrooms are **not** directory
places (9.3), and the route start follows a new rule (9.4).

### 9.1 Place page (items 19, 20a)

`WatchPlaceGpsLight`, `WatchPlaceGpsDark`, `WatchPlaceLongTop`,
`WatchPlaceLongScrolled`. Directory level 3, top bar `Place`.

```
Royal Theater                  Gothic 24 bold, wraps
Deck 5 · Fore                  Gothic 18 bold
Entertainment Place            Gothic 14 bold, muted (area)
Closest restroom · 30 m aft   Gothic 14 bold, muted
Hold Select for its route      Gothic 14 bold, sea accent
──────────
FROM YOUR CABIN                small caps, muted
↓1 deck · 160 m fore          Gothic 18 bold
Select for route ›             Gothic 14 bold, sea accent
──────────
LATER TODAY                    small caps, muted
Evening Show · 7:00p ★         events still to come there
```

- The FROM block replaces the old `↓1 deck from cabin` line: the deck change
  and the walking distance on one line. On the cabin's deck: `Your deck ·
  180 m fore`. The header names the route start (9.4).
- `Closest restroom` is measured from the venue, not the cabin. When the
  restroom is on another deck, the direction goes on its own line:
  `Closest restroom` / `↑1 deck · 20 m aft`.
- Long pages scroll, with ScrollLayer's content indicator.
- **Approximate spot** (the 19 venues with no spot on the plans): a muted
  `Spot approximate` line under the distance (`WatchGpsApprox`).
- **Ashore, or a venue not in the table:** no GPS lines at all, never "unknown"
  (`WatchGpsAshore`).
- **No cabin set on the Me tab:** no FROM block; a muted `Add your stateroom on
  the phone for walking directions`. The closest restroom still shows
  (`WatchGpsNoCabin`).
- **Phone away:** as today, `Connect your phone`; Select tries again.
- Distances use the unit set on the phone (9.7), rounded, with no `~` (9.9,
  decision 12): the Help section says once that every distance is approximate.

### 9.2 Route screen (item 21, option A)

`WatchRouteLight`, `WatchRouteDark`, `WatchRouteFromVenue`, `WatchRouteCrossing`,
`WatchRestroomRoute`, `WatchHomeRoute`. Its own screen, top bar `Route`.

Opened by:
- **Select** on a place page (route to that place);
- **Hold Select** on a place page (route to its closest restroom; header
  `CLOSEST TO ROYAL THEATER`, then the restroom's deck line and `Same deck as
  Royal Theater` under the steps);
- **Select on Home** (route to the NEXT event, 9.5);
- voice, later (9.6).

```
Royal Theater                  Gothic 24 bold (destination)
FROM YOUR CABIN                small caps, muted (the start, 9.4)
──────────
•  60 m fore                  Gothic 18 bold, one line per step
⟋  Fore stairs to Deck 5
•  40 m fore
◎  Royal Theater
──────────
↓1 deck · 100 m in all        Gothic 14 bold, muted
```

- **Step glyphs** (drawn, about 13 px, sea accent): dot = walk, double-headed
  arrow = cross the ship, square with ▲▼ = elevator, stair line = stairs,
  ring = arrive.
- About 3-6 short steps: `50 m aft`, `Aft elev to Deck 16`, `Fore stairs to
  Deck 5`.
- **Crossing step:** its own step whenever the route changes side:
  `Cross the ship` until port/starboard is confirmed, then `Cross to port` /
  `Cross to stbd`, and the arrive step may add `· port side`
  (`WatchGpsSideConfirmed`). Before confirmation no side word appears anywhere.
- **Same deck and area:** `Same area · your deck`, then one walk step and
  arrive (`WatchGpsSameArea`).
- **Loading:** `Finding route…`, muted and centered (`WatchGpsLoading`).
- **Phone away:** `Connect your phone` / `Select tries again`
  (`WatchGpsPhoneAway`).
- **Route safety** (rules for the planner, from the design review):
  - every step must be walkable as written: never a fore/aft run through cabin
    corridors that don't connect;
  - change sides only where the plans show a real link (stair or elevator
    lobby, promenade, open deck), always as its own step;
  - no crew-only doors, and no route that relies on a door or deck that may be
    closed at night;
  - when the planner isn't sure, show less (deck and fore/aft) rather than a
    guessed route.
- **Shown less** (a route that needs an unconfirmed link, or a spot that can't be
  placed on the walkways): `To Deck 16` (only with a deck change), then the
  overall `300 m aft`, then arrive; the summary drops `in all`. Wording to
  approve with the rest (`gpstext.js`).
- **Stairs** are named by where they are: `Fore` / `Aft stairs` beside the
  elevator banks, `Mid stairs` between them. With sides confirmed, the arrive
  step adds `· port side` or `· stbd side`.
- Option B (the steps inline on the place page, `WatchPlaceInlineTop`,
  `WatchPlaceInlineScrolled`) was mocked and not chosen.

### 9.3 Restrooms and elevator banks (item 20b)

`WatchElevatorPlace`, `WatchDeckWithRestrooms`, `WatchAreasWithAmenities`.

- **Restrooms are not listed in the directory** (26 of them would clutter every
  deck page). They're reached through a place page's `Closest restroom` line
  (Hold Select) and, later, by voice. `WatchRestroomPlace` is parked.
- **Elevator banks are directory places.** On a deck page they sit in their
  FORE / MID / AFT group as muted rows (`Fore elevators`). Browse by area gets
  an `Elevators` row (`Fore · Aft`) just before Ashore.
- **Elevator place page:** the name, `Aft · all decks but 1`, `STOPS AT` with a
  grid of deck chips (7 per row; the cabin's deck filled with the sea accent),
  then the FROM block and `Select for route`.

### 9.4 Where routes start

One rule for the Ship GPS and for the existing "From" lines on event details and
reminders (owner, 2026-09-26). Built in `src/pkjs/routestart.js`.

- **The cabin**, by default.
- **A starred event or personal entry** when it ends less than 15 minutes before
  the one you're going to, or overlaps it (the rule from item 3; no length counts
  as 30 minutes). For a route from where you are now (place pages), that's one
  that's on now or ended less than 15 minutes ago. A stop hours earlier doesn't
  count: a show ending at 9:00p doesn't start the route to an 11:00p event.
- **A spoken location** (`I'm at the Solarium`, 9.6) for **1.5 hours**, until a
  starred event or entry starts after it, and never past the **04:00 day
  change**. A stop that starts after you said where you were wins.
- The Route header and the place page's FROM block always name the start
  (`FROM YOUR CABIN`, `FROM SOLARIUM`, `FROM ROYAL THEATER`).
- The phone keeps the start and its timer (it already knows the starred events
  and the day boundary); the watch only shows the header it's sent.

### 9.5 Home and button hints

`WatchHomeSelect`, `WatchHomeTips`, `WatchHomeRoute`.

- The NEXT card keeps its one brief line (`Deck 4 Aft · ↓2`); no GPS line is
  added to it or to the reminder alert. A small sea-accent `Route ›` sits at the
  right end of that line, beside the Select button.
- **Select on Home** (unused today: Up = My info, Down = Today, hold Up = demo)
  opens the Route screen for the NEXT event.
- **Button hints:** labels beside each button over a grayed-out Home: Up
  `My info`; Select `Route to next` / `Hold: Ask by voice` (once voice exists);
  Down `Today`; Back `Exit`. They show for about 3 s on the **first 3 opens**,
  and again after an update adds a button; any press dismisses them. The watch
  counts opens in its own storage. The phone's Help section has an **Always show
  button hints** toggle (off by default). No `Buttons` row in My info.

### 9.6 Voice (concept, later)

`WatchVoice*`. Still under "Later" in the brief: nothing here is scheduled until
the airplane-mode dictation test in `docs/FUTURE_VOICE_QUERIES.md` passes on the
owner's phone.

- **Hold Select** on Home or on a Route screen starts dictation. (On place pages
  Hold Select is the restroom route.) Check it doesn't clash with any firmware
  long-press action. Top bar `Ask`.
- **Commands** (keyword matching on the phone against the venue table and its
  aliases):
  - `I'm at <venue>` / `I'm in cabin <number>`: set where you are (9.4);
  - `Closest restroom (from <venue>)`;
  - `How do I get from <A> to <B>` / `<A> to <B>`;
  - `How do I get to <B>` (from the current start);
  - `my cabin` works as A or B.
- **Only one-spot places can be a location:** landmark venues and cabins.
  Restrooms, elevators and stairs are refused (`There are 26 restrooms` / `Say a
  venue or a cabin number near you instead`); they're fine as destinations.
- **Always show what was heard and what it matched** (`HEARD`, `FROM` / `TO` or
  `YOU'RE AT`) before answering; Select confirms, Hold Select asks again.
- Screens for no match (with a `TRY` example) and phone away (`Voice is heard
  on the phone`).
- A spoken cabin number is used for routing only: never stored beyond the
  current start, and never in the usage log.

### 9.7 Phone settings page (not mocked)

All built into the local settings page, so they work offline.

- **Distance units:** feet, metres or steps. The phone converts and rounds;
  steps assume a stride (e.g. about 0.75 m, to check on board).
- **Port/starboard flip (test cruise):** flip the whole ship, or single decks,
  if the on-board check finds sides the wrong way round. It must reach every side
  word (`port`, `stbd`, crossing steps) and the planner. Only for the owner's
  test cruise: once the map is confirmed, fix the data and hide or remove it.
- **Help section:** voice commands with example phrases (and what can't be a
  location); the watch controls, every press and hold on every screen;
  useful-to-know notes (where routes start and when it resets, that every
  distance is approximate since distances carry no `~` (9.9, decision 12),
  `Spot approximate`, no side until confirmed, voice needs the phone nearby,
  the 04:00 day change); and the Always show button hints toggle. Keep it in
  step with the app as controls change.

### 9.8 Check before or while building

In the ship map and planner:
- The map gives each cabin and venue spot a port-starboard position (the
  crossing step depends on it). Unverified.
- The planner knows which cabin corridors connect and where the ship can be
  crossed. Unverified.
- The longest lines still fit in feet and steps (`530 ft fore`, `210 steps
  fore`).

On board (the owner's test cruise):
- Confirm port/starboard against one known cabin; use the flip settings if it's
  wrong on some or all decks.
- Walk routes from the cabin to far venues on both sides; tune the elevator-wait
  and stairs-per-deck costs.
- Main Dining Room: the nearest spot never sends you to another floor.
- Check a few approximate spots on foot.
- Walk a known distance to check the stride used for steps.

For the build PRs:
- New phone → watch strings go in `docs/WATCH_PROTOCOL.md` with each PR; the
  watch C code gets no ship knowledge.
- Home gains Select (and, with voice, Hold Select); place pages gain Hold
  Select. Update `docs/DESIGN.md`'s screen descriptions.

### 9.9 Decisions (owner, 2026-09-25)

1. **Route:** its own screen (option A), not inline.
2. **Restrooms:** not listed in the directory. Each venue's place page shows
   `Closest restroom`; Hold Select opens its route. Elevator banks stay listed.
3. **Units:** set in the phone settings: feet, metres or steps.
4. **Port/starboard:** test-cruise settings on the phone to flip the whole ship
   or single decks; no side shown until confirmed.
5. **Home:** keeps the current brief line; Select on Home opens the route to
   the NEXT event. No GPS line on the reminder alert.
6. **Crossing step:** added to routes (`Cross the ship`, then `Cross to port` /
   `Cross to stbd`), so a route never asks for an impossible walk.
7. **Route start:** a spoken location lasts 1.5 hours or until a starred event
   starts (its venue becomes the start); back to the cabin at 04:00.
8. **Button hints:** first 3 opens (and after an update adds a button), with an
   Always show toggle in the phone's Help section.
9. **Help section** in the phone settings (voice commands, controls, notes).
10. **Voice:** designed as a concept; stays under "Later" until the dictation
    test passes.
11. **Route start (2026-09-26):** the 15-minute rule, not "the last starred
    venue until 04:00" (9.4).
12. **No `~` on distances (2026-09-26):** every figure is approximate in an
    unofficial app, so the `~` on each one added nothing. Distances show as
    `160 m fore`; the Help section says once that they are approximate (9.7).
    The mockups still show `~`; this supersedes them.


## Mockup index

| File | Screen |
|---|---|
| `Cruise.dc.html` | Cruise tab with the Ship venues card |
| `Venues.dc.html` | Venue list: search, filters, group by (interactive) |
| `VenueEdit.dc.html` | Edit one venue, review mode (interactive) |
| `VenueStates.dc.html` | Reference sheet of row/field states |
| `EventsReserve.dc.html` | Events tab with Mark reserved (interactive) |
| `WatchEventLight/Dark/Ashore.dc.html` | Event details |
| `WatchHomeLight/Dark.dc.html` | Home NEXT (dark = long venue name) |
| `WatchReminder.dc.html` | Reminder alert with route from the previous venue |
| `WatchDirectory.dc.html`, `WatchDeck.dc.html` | Ship directory |
| `WatchResNeeded/ResReserved/ResHome.dc.html` | Reserved states on the watch |
| `../phase2/*.dc.html` | §8 daily view (see its `NOTES.md`) |
| `../gps/*.dc.html` | §9 Ship GPS (see its `NOTES.md`; `preview.png` shows every screen) |
