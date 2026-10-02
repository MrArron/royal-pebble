#pragma once
#include <pebble.h>

// Per-platform layout numbers (docs/DESIGN.md §15). The Pebble Time 2
// (emery, 200x228 rectangle) keeps its numbers exactly, so its binary doesn't
// change; the Pebble Round 2 (gabbro, 260x260 round) gets numbers that keep
// every screen inside the circle (docs/mockups/round/NOTES.md). Round-only
// drawing sits under #ifdef PBL_ROUND, so it costs the Time 2 nothing.
//
// Round 2 geometry: the circle has radius 130. The top bar is a 30 px band
// with the time, then one small-caps line (the screen's name and the day's
// status) on the background. The body is a 184 px wide column from y 48 to
// 220 whose corners stay inside the circle (the 184x184 inscribed square,
// a little shorter to clear the top bar).

#if defined(PBL_ROUND)

#define TOP_BAR_HEIGHT 48     // band plus the label line under it
#define TOP_BAND_HEIGHT 30    // the colored band with the time
#define BODY_INSET_X 38       // the body column's left and right inset
#define BODY_INSET_BOTTOM 40  // below the body: the circle's narrow bottom
#define TEXT_ALIGN GTextAlignmentCenter
// Home's button hints: the labels' layer is inset like the body, and each
// label sits at its button's height (window coordinates). Round 2 buttons:
// Back on the left, Up, Select and Down down the right side.
#define HINTS_INSET_X 30
#define HINT_UP_CY 70
#define HINT_SELECT_CY 130
#define HINT_DOWN_CY 190
#define HINT_BACK_CY 130
// "On board?" and "Remove star?" button labels (body coordinates): along the
// bottom of the body until the round screen gets its own layout.
#define EDGE_BACK_CY 160
#define EDGE_DOWN_CY 160
// Home's first line (body coordinates): right under the label line, so the
// port-day countdown's last line ("3 clashes") still fits.
#define HOME_TOP 0
// Home's body is wider than the 184 px column (docs/mockups/round/Main):
// its centered lines are short at the top and the circle widens below.
#define HOME_INSET_X 25

#else

#define TOP_BAR_HEIGHT 22
#define TOP_BAND_HEIGHT 22
#define BODY_INSET_X 0
#define BODY_INSET_BOTTOM 0
#define TEXT_ALIGN GTextAlignmentLeft
#define HINTS_INSET_X 0
#define HINT_UP_CY 46
#define HINT_SELECT_CY 114
#define HINT_DOWN_CY 187
#define HINT_BACK_CY 46
#define EDGE_BACK_CY (46 - TOP_BAR_HEIGHT)
#define EDGE_DOWN_CY (187 - TOP_BAR_HEIGHT)
#define HOME_TOP 4

#endif

// Side padding of text inside the body.
#define PAD 8

// Today's rows (docs/DESIGN.md §6): height and the time column's width.
#define TODAY_ROW_HEIGHT 44
#define TODAY_TIME_COL_W 50

// The top bar's frame in a window whose root bounds are `b`.
#define TOP_BAR_FRAME(b) GRect(0, 0, (b).size.w, TOP_BAR_HEIGHT)
// The body's frame under the top bar.
#define BODY_FRAME(b)                                                     \
  GRect(BODY_INSET_X, TOP_BAR_HEIGHT, (b).size.w - 2 * BODY_INSET_X, \
        (b).size.h - TOP_BAR_HEIGHT - BODY_INSET_BOTTOM)

// Home's body: the body on the Time 2, a wider column on the Round 2.
#if defined(PBL_ROUND)
#define HOME_FRAME(b)                                                     \
  GRect(HOME_INSET_X, TOP_BAR_HEIGHT, (b).size.w - 2 * HOME_INSET_X, \
        (b).size.h - TOP_BAR_HEIGHT - BODY_INSET_BOTTOM)
#else
#define HOME_FRAME(b) BODY_FRAME(b)
#endif
