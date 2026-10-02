# Pebble Round 2 mockups (G1)

**Status: approved by the owner 2026-10-02.** Home timeline: the arc along the
bottom edge (the straight-bar file is kept for reference, not chosen). Scope
widened the same day: the Pebble Time 2 gets matching style updates (the
`PT2*` files, PR G6a in the Round 2 phase plan).

Same format as the other folders: Claude Design component files with inline
styles, Roboto Condensed standing in for Gothic. Round 2 screens are drawn at
2x, 520x520 for the 260x260 display; Time 2 screens at 400x456. They need the
canvas runtime to render. Design canvas (private to the owner):
https://claude.ai/artifact/EcfjLk3iM5eiNiL8TdSnsv

When a file and `docs/DESIGN.md` differ, the doc wins once the screens are
built. All data is placeholder: `9150` is a made-up cabin, `Sat Mar 6` a
made-up sail date.

## Round rules

- Top band: the time only, centered. The screen name and context label move to
  one small-caps line under it (`COCOCAY · DOCKED`, `TODAY · AT SEA`).
- Body column 420 px wide (2x) between y 110 and 410. Lines above and below
  are centered and short. Each artboard's `safe` tweak shows the 184x184
  inscribed square.
- All text is centered. Lists keep the selected row in the middle; the time
  sits on the row's first line.
- Selection is a rounded pill (28 px radius at 2x) inset from the edge; rows
  above and below are smaller (titles 28 px instead of 34 at 2x) and muted.
- Icons on the selected row (star, clash `!`) draw in the cursor text color.
- Home timeline: an arc along the bottom edge, radius 242 (2x), 16 px stroke,
  from 140° to 40° (SVG angles, y down), same colors as the Time 2 bar
  (DESIGN.md §4.2), now tick as a radial line in the text color. Start and
  end times sit just above the arc ends. The all-aboard alert shows the same
  arc.
- Long pages show their scroll position as a short arc on the right edge
  (beside Up/Down), track `divider` 4 px, thumb `muted` 8 px, instead of the
  content triangles.
- Home shows one next item, not two. `Route ›` becomes a bottom hint.
- Edge labels (On board?) sit on the bezel beside their button. Check the Round
  2's real button positions before G3.
- At most one short hint at the bottom; the phone sends shorter gabbro wording
  (`Select: route` / `Hold: ask again` on two lines, G7).
- Light and dark themes unchanged; same color tokens as DESIGN.md §2.

## Time 2 matching updates (G6a)

- Selection: a rounded pill (16 px radius at 2x) inset 4 px each side instead
  of the full-width bar (Today, My info, directory and other lists).
- Long pages: a thin scroll bar on the right edge (track `divider` 2 px, thumb
  `muted` 6 px) instead of the top and bottom triangles.
- All-aboard alert: the Home time-ashore bar and its end times under the
  countdown.
- Already as built: star and clash `!` turn `cursor_text` on the selected row.
- Every change costs Time 2 bytes (about 1.5 KB left at 1.5.9): build them as
  shared `ui.c` helpers used by both platforms and state the cost in the PR.

## Files

| File | Screen |
|---|---|
| `Main` | Round Home, NEXT card, sea day (light) |
| `HomeNextDark` | Round Home, NEXT card (dark) |
| `HomePortArc` | Round Home, port day, timeline arc (chosen) |
| `HomePortBar` | Round Home, port day, straight bar (not chosen, reference) |
| `HomePortArcDark` | Round Home, arc in the warning window with the warning sign (dark) |
| `DaysToSail` | Round Home, days to sail |
| `MorningSummary` | Round morning summary, port day |
| `Today` | Round Today list, pill selection, muted neighbors |
| `Event` | Round event details, scroll arc |
| `AlertReminder` | Round reminder with "From" directions, scroll arc |
| `AlertAllAboard` | Round all-aboard alert with the timeline arc |
| `AlertToReserve` | Round to-reserve alert |
| `NoticeSchedule` | Round schedule change |
| `ClashToast` | Round clash toast over Today |
| `MyInfo` | Round My info |
| `Directory` | Round directory, deck list |
| `Place` | Round place page, scroll arc |
| `Route` | Round route from Home |
| `VoiceCard` | Round Ask card, two-line hint |
| `OnBoard` | Round On board? with edge labels |
| `PhoneAway` | Round Ask with the phone away |
| `DictationFailed` | Round Ask, no answer from the phone |
| `PT2Today` | Time 2 Today, pill selection |
| `PT2MyInfo` | Time 2 My info, pill selection |
| `PT2Directory` | Time 2 directory, pill selection |
| `PT2Event` | Time 2 event details, right-edge scroll bar |
| `PT2AlertAllAboard` | Time 2 all-aboard alert with the time-ashore bar |
