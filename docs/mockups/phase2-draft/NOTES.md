# Phase 2 daily view: draft mockups (DESIGN_V1_1.md §8)

**Status: draft, not approved.** Nothing here is decided. The owner confirms
§8.6 first.

Same format as `docs/mockups/v1.1`: Claude Design component files, 400×456 (2×),
inline styles, Roboto Condensed standing in for Gothic. `preview.png` shows all
of them rendered, since the files need the canvas runtime.

The scripts that made them, and the text-width check, are in `tools/mockups/`.

## Files

| File | Screen |
|---|---|
| `WatchSummaryPortLight/Dark` | Morning summary, port day (with `Port time +1 h` and `1 clash`) |
| `WatchSummarySeaLight/Dark` | Morning summary, sea day (the first two starred items) |
| `WatchSummaryTomorrowLight/Dark` | Evening tomorrow card with `Last chance:` |
| `WatchCountdownFarLight/Dark` | Home before the cruise, 78 days out |
| `WatchCountdownLastLight/Dark` | Home the day before sailing (`Tomorrow`, sync reminder) |
| `WatchClashToastLight/Dark` | Today list just after starring a clashing event |
| `WatchClashDetailsLight/Dark` | Event details of a starred event that clashes |
| `WatchLastChanceTodayLight/Dark` | Today row with the tag |
| `WatchLastChanceDetailsLight/Dark` | Event details with the tag (reserved and starred) |
| `EventsClash` | Phone Events tab: clash chips, `Clashes · N` filter, `Last chance` chip (interactive: star events to see clashes change) |

All data is placeholder: sail date Sat Mar 6, Galveston, deck values as in v1.1
(cabin on deck 6), and no stateroom.

## Font stand-ins (2× mockup → watch)

As in §2, plus two sizes that are new here:

| Mockup | Watch |
|---|---|
| 84 px | Leco 42 numbers (fallback: Bitham 42 bold, as on the port countdown) |
| 56 px | Gothic 28 bold (`Tomorrow`: Leco has digits only) |

Today rows follow `today_window.c`: 44 px rows, a 50 px time column, a Gothic 18
bold title, and a Gothic 14 (regular) second line.

## Drawn shapes

- Star, ↓ arrow and ✓ as in v1.1.
- **New: `!` clash marker.** A rounded bar plus a dot in the port accent, at the
  digit cap height of the font beside it (12 px next to Gothic 18), with a 3 px
  stroke (the bold digit stroke). On the list cursor it takes the cursor text
  color, like the star. The toast uses a 24 px version.

## Tokens

No new tokens. The clash marker, toast bar and `Last chance` use the port
accent. The toast background is the theme background. The phone clash chip uses
warning container (with a `!` so it reads differently from `Reservation needed`).
The phone `Last chance` chip is outlined.

The phone settings page has only a light scheme in `DESIGN.md`, so `EventsClash`
is light only. A dark phone version would need a new set of dark tokens.

## Text that was shortened or changed

Widths are in the stand-in font at 1×. A line has 184 px (200 minus 8 px padding
each side); a Today second line has 134 px. Check the real Gothic in the
emulator.

| Brief | Mockup | Why |
|---|---|---|
| `Royal Theater · Last chance` (141 px, Today row) | `Last chance · Royal Thea…` | Too wide. With the tag first it's never cut; the venue gets the ellipsis. Matches `ends 1:00p · Venue`. On a NOW row, `ends …` replaces the tag. |
| `Clashes with 1:00p Trivia` (a long title is 248 px with `+1 more`) | Wraps to at most 2 lines, with an ellipsis after that | One line doesn't fit real titles |
| Toast `Clashes with` / `1:00p Trivia` | Same split; the second line gets an ellipsis | 1:00p Adults Only Trivia is 164 px, so it fits |
| `SAILS IN` / `Tomorrow` | `SAILS` / `Tomorrow` | Reads better. Not a width fix. |
| `TOMORROW · DAY 5 · PORT DAY` (168 px, fits) | `DAY 5 · PORT DAY` | The top bar already says Tomorrow. Either one fits. |
| `Sat Mar 6 · Port Canaveral` (178 px) | Drop the weekday when it doesn't fit: `Mar 6 · Fort Lauderdale` | Too close to 184 px |

Widest lines that fit (check these in the emulator): `11:30a Adults Only Trivia`
171 px, toast `1:00p Adults Only Trivia` 164, `Last chance: Broadway Nights` 157,
`Works offline after a full sync` 154, `Docked 10:30a - 11:30p` 162.

## Smaller choices made in the mockups

- **Countdown:** `days` sits beside the number, on its baseline.
- **Tomorrow card:** the band follows tomorrow's kind (port teal). There's no
  right label, since today's status would be wrong on a card about tomorrow.
- **Tomorrow card:** no `Port time` line and no clash count. §8.5 sends no
  tomorrow offset or events.
- **Toast:** sits at the bottom so the row that was just starred stays visible.
  The double vibration isn't shown.
- **Phone filter chips:** with `Clashes · N` added they no longer fit one row
  (All, Starred, To reserve and Clashes add up to about 378 px, with 328 px
  available), so they wrap to a second row. The alternative is a scrolling row
  like the day chips, but that would hide Clashes off-screen.

## §8.6: recommendations (shown in the mockups; alternatives noted)

1. **Replace Home** on the first open (as proposed). It costs no press, since any
   button goes on. Alternative: an overlay over Home.
2. **Add the `Today's summary` row** to My info. Without it, one accidental press
   loses the card for the day. Alternative: no way back.
3. **Show `Port time +1 h` only when the offset isn't 0.** Home already shows
   ship and local time for all-aboard, so this matches. Alternative: ship time
   only.
4. **Tomorrow card on the first open after 20:00** (as proposed), plus the My
   info row. Alternative: My info only.
5. **No tag for single performances.** Many featured events happen once, so
   `Only show` would be everywhere, and the tag matters most when a show repeats
   and you might plan to catch it later. Alternative: `Only show` (133 px on a
   Today row, fits).
6. **Keep the `!` in the Today list.** Otherwise a clash is invisible while
   browsing. It costs about 7 px of title width (titles already cut with an
   ellipsis). Alternative: only on details and the toast.
7. **Show both** the ship name and the starred-so-far count on the countdown.
   There's plenty of room (the far card is half empty), and the count nudges
   planning before the trip. Alternative: leave them out for a cleaner card.
