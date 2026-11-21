# Appstore assets

Images for the Pebble appstore listing (`docs/STORE_LISTING.md` §5).

- `art/icon-144.png`, `art/icon-80.png`: large and small app icons (drafts).
- `art/banner-720x320.png`: listing banner (draft).
- `concepts/`: three icon concepts and `sheet.png` (A: a ship whose hull is
  a Pebble Time 2; B: the Android app's ship-on-wave icon with a watch as the
  cabin; C: a watch whose screen shows that ship), drawn by
  `tools/store/make_icon_concepts.py`.
- `screenshots/`: not yet taken. Five per watch, 200×228 (Pebble Time 2) and
  260×260 (Pebble Round 2), from the demo cruise only, no watch frame.

The art is original (a pebble with a ship's wake) and uses no Royal Caribbean
or Pebble logo. Regenerate it with `python3 tools/store/make_store_art.py`
(needs Pillow). Never put a screenshot here that shows a real booking, cabin
or sail date.
