# Phase 3 mockups (DESIGN_PHASE3.md)

**Item 22: approved 2026-09-26. Item 23: designed with the owner (one open question). Items 24-28: first drafts.** The same format as `docs/mockups/phase2`:
Claude Design component files, 400×456 (2×) for the watch and 390×844 for the
phone, with inline styles and Roboto Condensed standing in for Gothic. They
need the canvas runtime to render. Open the canvas
(https://claude.ai/artifact/8duBBQWuFmwggUrAp8HMA4, pages "Item 22 (final)" and "Items 23–28 (draft)").
There is no `preview.png` yet.

Where a file and `docs/DESIGN_PHASE3.md` differ, the doc wins (it has the rules
for missing fields).

## Files

| File | Screen |
|---|---|
| `WatchExcTodayLight` | Today with a booked excursion on the cursor (`Meet 8:45a · ✓ Booked`) |
| `WatchExcDetailsLight/Dark` | Excursion details: port, Ashore, times, meet and guests, ✓ Booked, locked star |
| `WatchExcHomeLight` | Port-day Home: the countdown with the excursion as the next item |
| `WatchExcReminderLight` | Reminder at the meet time |
| `WatchEmbarkHomeALight/Dark` | Embark Home, the terminal arrival card (**chosen**) |
| `WatchEmbarkHomeBLight` | Embark Home option B, **not taken** (kept for the record) |
| `WatchEmbarkSummaryLight` | Morning summary, embark day, with `Terminal arrival` |
| `WatchOnboardHintLight` | Port Home with `Hold Select: I'm on board` |
| `WatchOnboardAskLight/Dark` | The `On board?` confirmation after Hold Select (`Hold: yes` beside Down, `Not yet` beside Back) |
| `WatchOnboardConfirmLight` | The 2 s on-board confirmation |
| `WatchOnboardHomeLight` | Port day Home after the flag (NEXT card, `on board` label) |
| `WatchEmbarkOnboardHomeLight` | Embark day Home after the flag |
| `WatchInfoOnboardLight` | My info with the undo row on the cursor |
| `PhoneEventsBooked` | Settings page Events day list with the FROM YOUR BOOKING card |
| **Item 23** | |
| `Watch23PortCardLight/Dark` | Port day card at 10:05a: time-ashore bar, excursion in blue, 30-min red window ahead |
| `Watch23WarningLight/Dark` | 4:10p, inside the warning window: red warning sign, bar mostly gone |
| `Watch23TenderLight` | Tender day: no watch notice, 60-min red window |
| `Phone23DaysTender` | Days tab: Royal's all-aboard with 5-min shift, warning period, tender notice |
| **Items 24-28 (drafts)** | |
| `Phone24Me` | Me tab: digits-only stateroom, deck/stairs filled, Edited chip |
| `Phone24Ready` | Cruise tab: Ready to sail check, one item left |
| `Phone24Search` | Events tab: search across all days |
| `Watch26RemoveStarLight/Dark` | Remove star? confirmation |
| `Phone27Casino` | Filters tab: Hide casino events |
| `Phone28Share` | Cruise tab: Share my plan |
| `Phone28Import` | Import review, Review each |

## Placeholders

Sail from Galveston, day 7 at Perfect Day at CocoCay, `Beach Day at Perfect Day
CocoCay` 9:00a-11:30a, meet 8:45a, 2 guests. Deck and venue values as in v1.1.
Event names are made up. `[ROOM #]` stands in for the stateroom; the muster
station `B4` is the `DATA_FORMAT.md` example.

## Widths to check in the emulator

A line is 184 px at 1× (200 minus 8 px padding each side), and a Today second
line is 134 px. Check these: `Meet 8:45a · ✓ Booked` on a Today row,
`9:00a - 11:30a · 2 h 30`, `Starts 9:00a · ends 11:30a`,
`Hold Select: I'm on board`, `Terminal arrival 11:30a`, and `TERMINAL ARRIVAL`
next to the port accent. `11:30a` in Bitham 42 is wider than the countdown's
`8:25`; if it doesn't fit, drop the `a`/`p` into Gothic 24 beside the digits.
