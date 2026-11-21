# Appstore assets

Images for the Pebble appstore listing (`docs/STORE_LISTING.md` §5).

- `art/icon-144.png`, `art/icon-80.png`: the app icon, concept C3b (chosen
  2026-11-21): a Pebble Time 2 whose screen shows a cruise ship bow-on, with
  a sun in the Pebble logo's coral.
- `art/banner-720x320.png`: listing banner with that icon.
- `concepts/`: three icon concepts and `sheet.png` (A: a ship whose hull is
  a Pebble Time 2; B: the Android app's ship-on-wave icon with a watch as the
  cabin; C: a watch whose screen shows that ship), drawn by
  `tools/store/make_icon_concepts.py`. The owner preferred C; its two
  refinements (`c1-original-icon`, `c2-smooth-waves`, `c3-bow-on` and the
  chosen `c3b-bow-on-narrow`) are drawn by `tools/store/icon_c.js`
  (Playwright), with `c-variants-sheet.png`.
- `screenshots/`: not yet taken. Five per watch, 200×228 (Pebble Time 2) and
  260×260 (Pebble Round 2), from the demo cruise only, no watch frame.

The art is original and uses no Royal Caribbean or Pebble logo (only the
logo's coral for the sun). Regenerate everything with
`node tools/store/icon_c.js` (Playwright). Never put a screenshot here that
shows a real booking, cabin or sail date.
