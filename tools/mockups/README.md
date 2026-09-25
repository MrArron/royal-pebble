# Mockup scripts

Scripts that made the §8 daily view mockups in `docs/mockups/phase2/`
(`docs/DESIGN_V1_1.md` §8). They're design tools only; nothing in the app uses
them.

- `gen_phase2_watch.py` writes the 18 watch mockups (light and dark).
- `gen_phase2_phone.py` writes `EventsClash.dc.html`. It copies the bottom nav
  from `docs/mockups/v1.1/EventsReserve.dc.html`.
- `check_fit.py` renders the `.dc.html` files in headless Chromium with a small
  stand-in for the Claude Design runtime. It saves a PNG of each and prints each
  text line's width in watch pixels (1×), flagging `OVER` (past x = 192, i.e.
  8 px padding), `2LINES`, `TRUNC` (ellipsis) and `BELOW` (off the screen).
  The top bar's right label always shows `OVER`, since it sits at the bar's own
  7 px padding; ignore that one.

```
python tools/mockups/gen_phase2_watch.py
python tools/mockups/gen_phase2_phone.py
pip install playwright && python -m playwright install chromium
python tools/mockups/check_fit.py "docs/mockups/phase2/*.dc.html" <scratch folder>
```

Widths are measured in Roboto Condensed, the mockups' stand-in for Gothic.
Check the widest lines against the real fonts in the emulator.
