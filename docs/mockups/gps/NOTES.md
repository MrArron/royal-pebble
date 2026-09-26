# Ship GPS: mockups (DESIGN_V1_1.md §9)

**Status: approved 2026-09-25,** with the owner's answers in §9.9. The mockups
are the final word on text and layout where they differ from the sketches in
§9.

Same format as `docs/mockups/v1.1` and `docs/mockups/phase2`: Claude Design
component files, 400×456 (2×), inline styles, Roboto Condensed standing in for
Gothic. They need the canvas runtime to render; `preview.png` shows all of them.
Design canvas (private to the owner):
https://claude.ai/artifact/Cq3jrWKZAZE6qHxbqNVy6n

All data is placeholder: cabin on deck 6, made-up distances and step counts,
and no stateroom (`Cabin 9150` on the voice screen is an invented number).
Distances are shown in metres; the owner picks feet, metres or steps in the
phone settings (§9.7).

## Files

| File | Screen |
|---|---|
| `WatchPlaceGpsLight/Dark` | Place page with Closest restroom, FROM YOUR CABIN distance, Select for route |
| `WatchPlaceLongTop/Scrolled` | Longest name and every line (restroom on another deck, approximate spot), first screen and scrolled |
| `WatchRouteLight/Dark` | Route screen (option A): stairs route, elevator route |
| `WatchRouteFromVenue` | Route whose start is a venue (`FROM ROYAL THEATER`) |
| `WatchRouteCrossing` | Crossing step before port/starboard is confirmed (`Cross the ship`) |
| `WatchRestroomRoute` | Route to a venue's closest restroom (Hold Select on the place page) |
| `WatchElevatorPlace` | Elevator bank place page with the decks it stops at |
| `WatchDeckWithRestrooms` | Deck page with elevator banks listed (no restrooms, despite the file name) |
| `WatchAreasWithAmenities` | Browse by area with an `Elevators` row (no Restrooms row) |
| `WatchGpsSideConfirmed` | Route after port/starboard is confirmed (`Cross to port`, `· port side`) |
| `WatchGpsApprox` | Place with an approximate spot |
| `WatchGpsAshore` | Ashore place: no GPS lines |
| `WatchGpsNoCabin` | No cabin set: no FROM block |
| `WatchGpsSameArea` | Shortest route, same deck and area |
| `WatchGpsLoading` | Route still loading |
| `WatchGpsPhoneAway` | Route with the phone away |
| `WatchHomeSelect` | Home NEXT card with the `Route ›` hint (Select opens the route) |
| `WatchHomeTips` | Home with button hints |
| `WatchHomeRoute` | Route to the NEXT event, opened from Home |
| `WatchVoice*` (8 files) | Voice concept (later): confirm, route result, closest restroom, set location by venue and by cabin, refused many-spot place, no match, phone away |
| `WatchPlaceInlineTop/Scrolled` | Option B, inline route on the place page. **Not chosen**; reference only |
| `WatchRestroomPlace` | Restroom as a place page. **Parked** (restrooms aren't directory places) |

## Font stand-ins (2× mockup → watch)

As in §2: 48 px = Gothic 24 bold, 34 px = Gothic 18 bold, 26–30 px = Gothic 14
bold. Muted = `#555555` light / `#AAAAAA` dark.

## Drawn shapes

- ↑ ↓ arrows and the star as in v1.1.
- **New: `›` chevron** after `Select for route` and on Home's `Route ›`, in the
  sea accent, the height of the digits beside it.
- **New route step glyphs**, about 13 px at watch size, sea accent: filled dot =
  walk; double-headed arrow = cross the ship; rounded square with up and down
  triangles = elevator; stair line = stairs; ring with a dot = arrive.
- **New: scroll indicator** on long place pages: small muted triangles at the
  bottom (more below) and under the top bar (more above), as ScrollLayer's
  content indicator.
- **New: elevator deck chips**, 7 per row, 2 px divider border; the cabin's deck
  is filled with the sea accent.
- **New: button hint labels** (`WatchHomeTips`): black (Up, Down), sea accent
  (Select) and gray (Back) labels with a pointer toward the button, over a
  grayed-out Home.

## Tokens

No new tokens. The directory top bar stays `#555555`; Home keeps the day's band.
Voice screens use the directory's gray bar with the label `Ask`.

## Text fit

Checked with `tools/mockups/check_fit.py` (2026-09-25). Nothing is cut off or
wider than the screen. The flags that did come up are expected:
- `2LINES` on rows with a star, where the drawn star is counted as a line
  (widths are fine), and on text meant to wrap (long names, quotes, hints).
- `OVER` on the top bar's right label (as the README says) and on Home's
  `Route ›`, which sits at the same 7 px padding as that label.
- `BELOW` on the deck page's last row: that list scrolls.

Check the widest lines in the emulator with the real fonts, in all three units:
`Closest restroom · ~30 m aft`, `↓1 deck · ~160 m fore`, `Fore stairs to
Deck 5`, `CLOSEST TO ROYAL THEATER`.

## Wording added in the design pass

Approved with the designs, but easy to change: `Your deck · ~50 m aft`, `Spot
approximate`, `Near Aft elevators` (parked page), `Add your stateroom on the
phone for walking directions`, the route summary (`↓1 deck · ~100 m in all`),
`Cross the ship` / `Cross to port`, `Finding route…`, `Hold Select for its
route`, `CLOSEST TO <VENUE>`, `Same area · your deck`, the button hint labels,
and the voice screens (`HEARD`, `YOU'RE AT`, `Select: routes start here`,
`There are 26 restrooms`, `No place matched`, `Voice is heard on the phone`).
