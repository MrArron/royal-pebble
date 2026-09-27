# Royal Pebble — Phase 4 design (event data)

Scope: brief items 32-37 (`docs/PROJECT_BRIEF.md`, Phase 4), planned in
`docs/PHASE4_PLAN.md`. Builds on `docs/DESIGN.md`, `docs/DESIGN_V1_1.md` and
`docs/DESIGN_PHASE3.md`, which stay the record for the existing screens, color
tokens, fonts, drawn glyphs (★ ✓ ↑↓ `!`), the thin top bar and the wording rules.
This file only lists what Phase 4 adds or changes. The data behind it is in
`docs/DATA_FORMAT.md` (Event details, Shore excursions) and
`docs/WATCH_PROTOCOL.md` (Packed events, Alerts).

- `docs/mockups/phase4/*.dc.html`: the Phase 4 screens as Claude Design
  component files (400×456 at 2× for the watch, 390×844 for the phone), made by
  `tools/mockups/gen_phase4.py`. `preview.html` beside them shows them all
  without the canvas runtime. `NOTES.md` there lists the files.
- All data in the mockups is placeholder (a Nassau and Perfect Day at CocoCay
  sailing, made-up events and counts). No real stateroom.
- Where a mockup and this file differ, this file wins.

| Item | Status |
|---|---|
| 32 Venue codes | No screens (phone matching only, §1) |
| 33 Ages and the age filters | **Approved 2026-09-27** (§2) |
| 34 Arrive-early times | **Approved 2026-09-27** (§3) |
| 35 Short descriptions, 6 notes | **Approved 2026-09-27** (§4) |
| 36 Stable ids for re-sync | No screens (§5) |
| 37 Shore excursions | **Approved 2026-09-27** (§6) |
| 38 Login download | Not designed yet (its own docs PR, `PHASE4_PLAN.md` PR I) |

---

## 1. Venue codes

Nothing changes on screen. An event whose venue title is blank but whose code
is in the venue table shows the table's name everywhere a venue shows (the wine
tasting reads `Vintages`, not an empty line).

## 2. Ages

### 2.1 Event details (`Watch4DetailsLight/Dark`, `Watch4TagsLight/Dark`)

The details page gains up to three lines between the time and the existing
clash and reservation lines. The page already scrolls with the muted triangle
(`docs/DESIGN_PHASE3.md` §22.3).

```
[Event          9:12p        AT SEA]
Late Night Comedy                        Gothic 24 bold, wraps
Comedy Live                              Gothic 18 bold, muted
Deck 4 · Fore                            Gothic 18 bold
↓5 decks from cabin                      Gothic 14 bold, muted
10:00p - 11:00p · 1 h                    Gothic 18 bold
Arrive by 9:45p                          Gothic 18 bold          (§3)
Ages 18+                                 Gothic 18 bold, port accent
Bring SeaPass · Sign up at venue         Gothic 14 bold, muted, wraps (§4)
Clashes with 10:00p Trivia               (as today)
Reservation needed / Not reserved yet    (as today)
──────────
★ Starred / Hold Select to star
```

- Age wording: `Ages 18+` (minimum only), `Ages 17 & under` (maximum only),
  `Ages 13-17` (both). No line without an age.
- Port accent, like `Reservation needed`: it's a condition on joining.
- Each new line is left out when its value is missing, so an event without
  Phase 4 data looks exactly as today.

### 2.2 Lists and Home

No change on the watch. Today rows, Home's NEXT card and the morning summary
don't show ages or tags: they have no room, and the details page is one click
away.

### 2.3 Settings page, Events tab (`Phone4Events`)

The row's details line adds the age after the venue: `Sports Court · Ages
12-17`. The same goes for search results and the place pages' event lists.

### 2.4 Settings page, Filters tab (`Phone4Filters`)

A new **AGES** heading above CATEGORIES, with two switches, both off by
default (the owner chose these names on review, 2026-09-27):

- **Hide Adult only events** — sub-line `18+ and 21+ · 31 events`. For a
  teen's watch.
- **Hide Teen and Kid only events** — sub-line `17 and under · 14 events`. For
  adults cruising without kids.

The note under them: `Events you star always show. Events with no age listed
never hide. Casino games are in the Casino category below.`

They aren't categories (an event has one category but can have an age limit in
any of them), so they sit apart from the category list, unlike Casino
(`docs/DESIGN_PHASE3.md` §27). They hide events wherever a hidden category does:
lists, Today, search results marked `Hidden on watch`, the morning summary
counts and the Ready to sail count. Starred and booked events always reach the
watch.

## 3. Arrive-early times

### 3.1 Event details

`Arrive by 9:45p` (Gothic 18 bold) right under the time line: the start minus
`early`. Ashore (a picked shore excursion, §6) it reads `Meet 9:00a` instead,
the wording booked excursions use. Untimed events never have one.

### 3.2 Reminder (`Watch4ReminderLight`)

A starred event with `early` reminds `reminder_lead` minutes before the
arrive-by time and counts down to it:

```
[Reminder       9:30p        AT SEA]
ARRIVE IN 15 MIN                         sea accent (MEET IN 15 MIN ashore)
Late Night Comedy
Comedy Live                              muted
Deck 4 · Fore
↓5 decks from cabin                      (or the "From" block, §22.9)
──────────
10:00p - 11:00p · 1 h
Arrive by 9:45p
Ages 18+
Bring SeaPass · Sign up at venue
```

The body is the details body, as on every reminder (`docs/DESIGN_PHASE3.md`
§22.9), so the new lines appear there too. The fallback card (event not in
the watch's day data) shows `Arrive by 9:45p` under its time line, from the
alarm's own `early` byte.

### 3.3 Settings page

The row's details line adds `Arrive 15 min early` after the age: `Comedy Live ·
Ages 18+ · Arrive 15 min early`.

## 4. Notes and tags

### 4.1 Watch

One line of tags under the age line (Gothic 14 bold, muted, wraps), joined
with ` · `, in bit order:

`Bring SeaPass` · `Weather permitting` · `Sign up at venue` · `Waiver needed` ·
`Athletic shoes` · `Swimwear or active wear` · `Limited spots, come early` ·
`Meeting spot on phone`

The texts are fixed on the watch (`docs/WATCH_PROTOCOL.md`, Packed events).
`Limited spots, come early` is left out when `Arrive by` shows. A busy event
(`Watch4TagsLight`, four tags) takes two lines.

### 4.2 Settings page (`Phone4Events`)

Under the row's details, a `Notes · 2 ▾` toggle (primary color) opens the
event's full notes as a bulleted list: Royal's advisements and restrictions and
a short description that says more than the title. Collapsed by default;
opening one doesn't open the others. Rows without notes have no toggle.

## 5. Stable ids

No screens. The existing re-sync messages (`Moved`, `Check the times`,
`Cancelled`) don't change; `pid` only makes the matching better.

## 6. Shore excursions

### 6.1 Settings page (`Phone4Excursions`)

**Booked activities** on the Cruise tab becomes **Booked activities and
excursions**. Its screen:

- The intro: `Pick the sessions you booked in the Royal app. Picked ones are
  starred and go to your watch; the rest stay off it.`
- One card per day and kind, in day order: `DAY 4 · NASSAU · SHORE EXCURSIONS`,
  then that day's activities as today.
- Each session row: time, title, a sub-line and a `Pick` button (`✓ Picked`
  once picked; tap again to unpick). Excursion sub-line: `Meet 9:00a · 2 h 30 ·
  Ages 6+`, leaving out what's missing. All-day rentals: `All day from 9:00a`.
- Picking stars the session and marks it reserved, like a paid class today.
- An excursion that's also in login data (`mine.orders`, same title, date and
  time) shows once, in the FROM YOUR BOOKING card (`docs/DESIGN_PHASE3.md`
  §22.7), not in this list.

### 6.2 Watch (`Watch4ExcursionLight/Dark`)

A picked excursion is an ordinary starred, reserved event placed at the day's
port, Ashore:

```
[Event          8:05a        DOCKED]
Snorkel and Beach Break
Perfect Day at CocoCay                   muted (the day's port)
Ashore                                   port accent
9:30a - 12:00p · 2 h 30
Meet 9:00a
Ages 6+                                  port accent
Swimwear or active wear · Weather permitting
✓ Reserved                               sea accent
──────────
★ Starred
Select: not reserved
```

Unlike a booked order, its star isn't locked: the user picked it, so they can
unstar it on the watch or the phone. Its reminder counts down to the meeting
time (`MEET IN 15 MIN`). An all-day rental shows at its listed time with no
end (`9:00a`), like any event of unknown length.

## 7. For the build PRs (not design)

- **The alarm byte comes with the event bytes.** Both change the saved blob, so
  PR D adds the four event bytes and the alarm's `early` byte together (the
  phone sends 0 until PR F), and the storage version goes to 9 once.
- PR D draws §2.1, §3.1 and §4.1; PR F the reminder timing and §3.2; PR E the
  filters (§2.4); PR G §6.
- The new detail lines must avoid `strlen()` and `strtol()` like the rest of
  the watch code: the texts are fixed strings and the numbers are bytes.
- Check the widest tag lines against the real Gothic 14 font in the emulator;
  the mockups use Roboto Condensed.
