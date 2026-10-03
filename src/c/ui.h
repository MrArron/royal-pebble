#pragma once
#include <pebble.h>
#include "data.h"
#include "layout.h"

// Shared look: theme tokens, top bar, time formatting (docs/DESIGN.md).

typedef struct {
  GColor bg;
  GColor text;
  GColor muted;
  GColor divider;
  GColor port_accent;
  GColor sea_accent;
  GColor cursor_bg;
  GColor cursor_text;
  GColor now_label;
  // The time-ashore bar (docs/DESIGN.md §2, §4.2).
  GColor sea_pale;
  GColor warn;
  GColor warn_pale;
} Theme;

extern const Theme *g_theme;
void theme_set_dark(bool dark);
bool theme_is_dark(void);
// The current theme all in gray; swap it into g_theme for one draw.
const Theme *theme_faded(void);

// Top bar band colors (same in both themes).
#define BAND_PORT GColorFromHEX(0x005555)
#define BAND_SEA GColorFromHEX(0x000055)
#define BAND_INFO GColorFromHEX(0x555555)
#define BAND_LABEL GColorFromHEX(0xAAFFFF)
#define BAND_LABEL_INFO GColorWhite

// Current ship time in minutes after midnight.
int now_minutes(void);

// "1:00p" or "13:00", following the watch's 12/24h setting. Wraps past midnight.
void fmt_clock(char *buf, size_t size, int minutes);
// "45 min", "1 h", "1 h 30 min".
void fmt_duration(char *buf, size_t size, int minutes);

// Top bar, one line (docs/DESIGN.md §3): the screen's name on the left,
// ship time in the center, the day's status in small caps on the right (left
// out when it doesn't fit or repeats the name).
Layer *top_bar_create(GRect frame, GColor band, GColor label, const char *name);
void top_bar_set(Layer *bar, GColor band, GColor label, const char *name);
// Replaces the day's status on the right with `text`, or with the decks from
// the cabin ("↓1 deck", "your deck") when has_rel.
void top_bar_set_right(Layer *bar, const char *text, bool has_rel, int rel);
void top_bar_destroy(Layer *bar);

void draw_star(GContext *ctx, GPoint center, GColor color);
void draw_divider(GContext *ctx, int y, int width);
// Drawn "!" clash marker (docs/mockups/phase2/NOTES.md): a bar and a dot, `h`
// tall (12 beside Gothic 18, 24 on the toast).
void draw_bang(GContext *ctx, GPoint top_left, int h, GColor color);
// Drawn check mark (text fonts have no ✓), `size` wide and tall.
void draw_check(GContext *ctx, GPoint top_left, int size, GColor color);
// "✓ Reserved" (docs/DESIGN.md §7.3) in Gothic 18 bold (`large`) or 14 bold,
// on a text line starting at y. Returns its width.
int draw_reserved(GContext *ctx, bool large, int x, int y, GColor color);
// The width draw_reserved would take.
int reserved_width(bool large);
// The same for any text: "✓ Booked" (docs/DESIGN.md §7.7).
int draw_checked(GContext *ctx, const char *text, bool large, int x, int y, GColor color);
int checked_width(const char *text, bool large);
// The x to give draw_checked for a line on a page `width` wide: PAD on the
// Time 2; on the Round 2 the negative width, which centers the line.
#if defined(PBL_ROUND)
#define CHECKED_X(width) (-(width))
#else
#define CHECKED_X(width) PAD
#endif
// "1 clash" in Gothic 14 bold, port accent. Draws nothing and returns 0 when
// there are none; otherwise returns the line height.
int draw_clash_count(GContext *ctx, int x, int y, int w, int32_t now);
// "Last chance" or "Only show" for a featured show's final performance
// (docs/DESIGN.md §7.5), else NULL.
const char *event_final_tag(const Event *e);
// One line: `tag` in `tag_color`, then " · rest" in `rest_color` (just `rest`
// when `tag` is NULL). The tag is never cut; the rest gets the ellipsis.
// Returns the x where the text ends.
int draw_tagged_line(GContext *ctx, const char *tag, GColor tag_color, const char *rest,
                     GColor rest_color, GFont font, GRect box);

// ---- Where a venue is (docs/DESIGN.md §7.2) ------------------------------

bool where_known(const Where *w);  // a deck or Ashore
bool where_ashore(const Where *w);
bool where_has_rel(const Where *w);
// "Deck 4 · Mid", "Decks 3-5 · Fore", "Deck 5" or "Ashore"; "" when not known.
void fmt_where(char *buf, size_t size, const Where *w);
// Home's short form before the arrow: "Deck 4 Aft"; "Ashore"; "" when not known.
void fmt_where_short(char *buf, size_t size, const Where *w);
// List items: "Studio B · 4 Mid", "Studio B · 3-5 Fore", "Beach · Ashore", or
// just the venue.
void fmt_venue_where(char *buf, size_t size, const char *venue, const Where *w);

// Draws `before`, then a drawn up/down arrow (dir > 0 up, < 0 down, 0 none)
// and `after`, on one line in Gothic 18 bold (large) or 14 bold. Returns the
// line height.
int draw_arrow_line(GContext *ctx, bool large, GColor color, int x, int y, int w,
                    const char *before, int dir, const char *after);
// The line under the deck line: "↓2 decks from cabin" or "On your cabin deck".
// Draws nothing and returns 0 without a cabin deck.
int draw_rel_line(GContext *ctx, bool large, GColor color, int x, int y, int w,
                  const Where *where);
// A reminder's route from the previous venue, in Gothic 18 bold:
// "↓1 deck · Fore → Mid", "Same deck · Mid" (from and to positions the same),
// "↑2 decks" (no position). `to` is the venue's Where relative to the previous
// venue; from_pos is the previous venue's position (0 none, 1-3 Fore/Mid/Aft).
// Returns the line height.
int draw_route_line(GContext *ctx, GColor color, int x, int y, int w, const Where *to,
                    int from_pos);
// Home: "Deck 4 Aft · ↓2" ("· your deck" on the cabin deck). Returns 0 when
// the place isn't known.
int draw_where_short(GContext *ctx, bool large, GColor color, int x, int y, int w,
                     const Where *where);
// A drawn `›` for a Gothic 14 bold line whose text box starts at y
// (docs/mockups/gps/NOTES.md). About 4 px wide.
void draw_chevron(GContext *ctx, GColor color, int x, int y);
// Height of `text` wrapped to `w` (at most max_h), left-aligned with trailing
// ellipsis.
int text_height(const char *text, GFont font, int w, int max_h);
// ---- Scrolling pages ----------------------------------------------------------

// A page whose content scrolls with Up/Down when it doesn't fit, with a scroll
// bar on the right edge (an arc on the Round 2) while it does.
// The content layer's update proc draws, then calls scroll_page_fit with the
// y where its content ends; the page resizes itself when that changes.
typedef struct {
  ScrollLayer *scroll;
  Layer *content;
  Layer *bar;  // scroll_bar_create
  AppTimer *fit_timer;
  int height;    // content height in use
  int wanted;    // content height the last draw asked for
  int scroll_y;  // for the usage log
  bool quiet;    // moving it ourselves: not the user's scroll
} ScrollPage;

// `frame` is the page below the top bar, in `root`. `clicks` subscribes the
// window's other buttons (Up and Down scroll).
void scroll_page_create(ScrollPage *p, Window *window, Layer *root, GRect frame,
                        LayerUpdateProc update, ClickConfigProvider clicks);
void scroll_page_fit(ScrollPage *p, int bottom);
// Back to the top (new content).
void scroll_page_top(ScrollPage *p);
// Follows the theme and redraws.
void scroll_page_refresh(ScrollPage *p);
void scroll_page_destroy(ScrollPage *p);

// The scroll position on the right edge, beside Up and Down: a thin bar on the
// Time 2, a short arc on the Round 2 (docs/mockups/round/NOTES.md). A
// full-window layer that follows `scroll`, drawn only while it scrolls.
Layer *scroll_bar_create(GRect window_bounds, ScrollLayer *scroll);

// ---- Selection pill (docs/mockups/round/NOTES.md) ----------------------------

// The cursor is a rounded pill: inset 4 px from the edges on the Time 2, as
// wide as the list's column on the Round 2. Lists turn the menu's own
// highlight off (the background color) and draw it in their rows.
#if defined(PBL_ROUND)
#define PILL_INSET 0
#define PILL_RADIUS 14
#else
#define PILL_INSET 4
#define PILL_RADIUS 8
#endif
#define LIST_CURSOR_BG g_theme->bg
// Fills `r` with the cursor color and rounded corners.
void fill_pill(GContext *ctx, GRect r);
// The pill behind a list row (Time 2).
#define PILL_ROW(b) GRect(PILL_INSET, 0, (b).size.w - 2 * PILL_INSET, (b).size.h)

// A small-caps label ("STATEROOM") in Gothic 14 bold, muted, on a page `width`
// wide (My info, Ask).
void draw_label(GContext *ctx, const char *text, int y, int width);
// A sea-accent button hint with its `›` (Home's `Route ›`), right-aligned so
// it ends at `right`, on a Gothic 14 bold line at y. Returns its width.
int draw_hint_right(GContext *ctx, const char *text, int right, int y);

// ---- Round 2 lists and scroll arc (docs/mockups/round/NOTES.md) -------------

#if defined(PBL_ROUND)
// Lists are wider than the body: the selected row's pill sits 12 px in from
// the screen's edge (docs/mockups/round/Today, Directory).
#define LIST_INSET_X 12
#define LIST_FRAME(b)                                                     \
  GRect(LIST_INSET_X, TOP_BAR_HEIGHT, (b).size.w - 2 * LIST_INSET_X, \
        (b).size.h - TOP_BAR_HEIGHT - BODY_INSET_BOTTOM)

// One row of a round list: centered lines; the selected row on a rounded pill
// with a larger title, the others smaller and muted. `top` goes above the
// title ("12:00p", "NOW · ends 12:45") in top_color, with a star (icons bit
// 0) and a clash "!" (bit 1) after it; `sub` goes under it ("Booked" with a
// check mark when sub_checked).
typedef struct {
  const char *top;
  GColor top_color;
  const char *title;
  const char *sub;
  uint8_t icons;
  bool big;  // the selected title in Gothic 24 (directory), else 18
  bool sub_checked;
} RoundRow;
#define ROUND_ROW_STAR 1
#define ROUND_ROW_BANG 2

int round_row_height(const RoundRow *r, bool selected);
void round_row_draw(GContext *ctx, const Layer *cell, const RoundRow *r, bool selected);
// A short centered divider between two rows, none beside the selected row.
// The separator's index is the row below it.
void round_divider(GContext *ctx, const Layer *cell, MenuLayer *menu, const MenuIndex *index);
#else
#define LIST_FRAME(b) BODY_FRAME(b)
#endif
