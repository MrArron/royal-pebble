# Ship map tools (Ship GPS)

These build the phone's ship map data for the Ship GPS (brief items 19-21) from
Royal's own deck-plan SVGs. The watch gets no map data; the phone companion
turns it into short strings.

| Generated file | What | Built by |
|---|---|---|
| `src/pkjs/data/cabins-HM.js` | 2,855 cabins, stored as runs | `extract_cabins.py` |
| `src/pkjs/data/places-HM.js` | venue spots, elevator banks, stairwells, restroom symbols | `extract_places.py` + `build_places.js` |
| `src/pkjs/data/walkways-HM.js` | walkable corridors per deck, lobby and stair nodes, restrooms | `build_walkways.py` |

Harmony uses deck plans profile 2396 (sailings from May 21, 2026), length overall
362.1 m. Don't edit the generated files by hand: change the inputs and rebuild.

## Mapped ships

| Code | Ship | Deck plans profile | Status |
|---|---|---|---|
| `HM` | Harmony of the Seas | 2396 (sailings from May 21, 2026) | In the app; port/starboard to confirm on board |

When a ship is added here, add it to every other list of GPS ships too: the
root README (Ships with Ship GPS), the settings page's Help section (`NAMES`
in `src/pkjs/shipmap.js`), and the store listing once there is one.

**Contributions welcome.** To map another Royal Caribbean ship, follow
Rebuilding below with its ship name and profile, read "Other ships" under
Things to know, and open a pull request with the generated files, its paths
and overrides files, and the tests passing. Keep downloads to one fetch per
deck: these are Royal's servers.

## Coordinates

Every spot is `{deck, a, x}` in metres:
- `a` is the distance aft of the bow;
- `x` is the distance from the centreline, negative = port.

Each SVG is drawn in its own frame. The decks are lined up on the two elevator
banks, which stack straight up the ship (forward at a = 115.8, aft at a = 239.3).
The banks are also the Fore / Mid / Aft split used by the venue table.

## Rebuilding

Run from the repo root. The downloads and working files (`tools/shipmap/decks/`,
`tools/shipmap/out/`) are git-ignored.

1. `python tools/shipmap/fetch_deck_svgs.py harmony-of-the-seas 2396 tools/shipmap/decks/HM`
   downloads every deck once. Be gentle with Royal's servers: no repeated fetches.
2. `python tools/shipmap/extract_cabins.py tools/shipmap/decks/HM HM 362.1 src/pkjs/data/cabins-HM.js`
   builds the cabins. It checks every cabin is within about 1.2 m of the plan and
   writes a `.check.json` beside the output; don't commit that file.
3. `python tools/shipmap/extract_places.py tools/shipmap/decks/HM HM 362.1 tools/shipmap/out`
   reads the venue labels. They are drawn as letter shapes, so the script renders
   them in Chromium and reads them with Tesseract OCR. It writes
   `out/labels.json` and `out/review/deck-N.png` for checking by eye.
   It needs `playwright`, `opencv-python`, `pytesseract` and the `tesseract` binary.
4. `node tools/shipmap/build_places.js tools/shipmap/out/labels.json tools/shipmap/places-HM.overrides.json src/pkjs/data/places-HM.js`
   matches the labels to the venue table (names and aliases). It prints any
   label it couldn't match and any venue with no spot; Harmony has 0 unmatched and
   18 without a spot; the overrides' `add` list places those from Royal's app
   plan (see below), leaving 2 (shown as `Spot approximate`). `places-HM.overrides.json`
   holds the hand-checked fixes.
5. `sh tools/shipmap/build.sh` builds the walkway graph from
   `walkways-HM.paths.json` (hand-drawn walkable paths, read from the plans).
   - It attaches every elevator lobby door and stairwell to the graph.
   - It finds the restroom symbols (men's and women's symbols a few metres apart
     count as one restroom: 28 symbols, 23 restrooms). The one in the deck 14
     kids' area is tagged `kids`.
   - It prints a report and writes review images (`out/review/deck-N.png`: blue
     corridors, magenta where the sides meet, dashed orange uncertain links).

Then run `node test/pkjs/shipmap-data.test.js` and `node test/pkjs/cabins.test.js`.

## Things to know

- **Port and starboard** are read from the plans as top views and have not been
  checked on board. If they're wrong, flip the sign in `X()` in the extractors
  and rebuild (the app will also get test-cruise flip settings).
- **Uncertain links.** 58 walkway edges are marked `'?'`: doors and walkways the
  plans don't show clearly. Each has a reason in `walkways-HM.paths.json`. Routes
  should use them only when nothing certain connects, and say so.
- **Where the sides connect.** On decks 7, 9-12 and 14 the middle is open between
  the elevator banks (Central Park) and aft of the aft bank (above the
  Boardwalk), so port and starboard only meet at the lobbies and in the forward
  cabin block. Deck 8 (the park floor) and deck 6 (the Boardwalk) can be
  crossed.
- **Venue spots** are label centres, the middle of each room, not its door. For
  big rooms the door can be 10-15 m away. That's fine for `~` distances.
- **Restrooms.** Use the ones in `walkways-HM.js`. The `restrooms` list in
  `places-HM.js` is the raw symbol read: it misses two (deck 5 aft port, deck 16
  aft) and counts pairs twice.
- **Single-deck stairs** (theatre and pod stairs) are listed as the plans draw
  them; they don't connect decks.
- **Royal app plan (2026-09-26).** Screenshots of the deck plans in Royal's
  Android app (decks 2, 5, 6, 8, 14, 15; bow at the top) name rooms the SVGs
  leave blank. They are schematic, so their spots were scaled onto the SVG frame
  by the venues both show: about 5 m out, up to ~15 m on decks 6 and 14. They
  agree with the data's orientation: bow at a = 0, port (1xx-3xx cabins) at
  negative x, as a top view. Still to check on board.
  - Medical Center (deck 2, about a = 216.5, x = -10.5, port side just forward
    of the aft elevators) stays approximate: deck 2 has no walkways yet.
  - Where the app differs from the SVGs, and the guesses made to place
    rooms, are listed in `conflicts-HM.json` (see Conflicts below).
- **Refits** change the plans: rebuild from the new profile.

## Conflicts

`conflicts-HM.json` lists every place where the sources disagree (the SVG
scrape, the Royal app screenshots, any later scrape), plus guesses made to fill
gaps. Each entry says what each source shows, which value the data uses now, and
the question to answer on board.

- **Every new scrape** (a new SVG profile, more app screenshots, another ship
  source) is compared with the data. Each difference becomes an entry here;
  the data isn't changed to match the new source until it's confirmed.
- **Settled only in person.** The owner checks the open entries during the
  sailing on the settings page's Me > Map check card (brief, "Map check"),
  and copies the notes afterwards. When an entry is confirmed, set `status` to
  `confirmed` with `truth`, fix the overrides or the venue table, and rebuild.
- **After any change here**, run `node tools/shipmap/build_conflicts.js`: it
  bundles the open entries into `src/pkjs/data/conflicts-HM.js` for the card
  (the data test fails until it's up to date).
- `node test/pkjs/shipmap-data.test.js` checks the file: ids, statuses, and
  that every venue named is in the venue table.
- **Other ships:** fetch that ship's SVGs, check `BANK_GAP` in
  `extract_cabins.py` (it expects Oasis-class spacing), add overrides, and draw
  a new paths file.
