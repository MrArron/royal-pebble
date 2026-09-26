#pragma once
#include <pebble.h>
#include "data.h"

// Shared look: theme tokens, top bar, time formatting (docs/DESIGN.md).

#define TOP_BAR_HEIGHT 22
#define PAD 8

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

// Top bar, one line (docs/DESIGN_V1_1.md §4): the screen's name on the left,
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
// "✓ Reserved" (docs/DESIGN_V1_1.md §5) in Gothic 18 bold (`large`) or 14 bold,
// on a text line starting at y. Returns its width.
int draw_reserved(GContext *ctx, bool large, int x, int y, GColor color);
// The width draw_reserved would take.
int reserved_width(bool large);
// "1 clash" in Gothic 14 bold, port accent. Draws nothing and returns 0 when
// there are none; otherwise returns the line height.
int draw_clash_count(GContext *ctx, int x, int y, int w, int32_t now);
// "Last chance" or "Only show" for a featured show's final performance
// (docs/DESIGN_V1_1.md §8.4), else NULL.
const char *event_final_tag(const Event *e);
// One line: `tag` in `tag_color`, then " · rest" in `rest_color` (just `rest`
// when `tag` is NULL). The tag is never cut; the rest gets the ellipsis.
// Returns the x where the text ends.
int draw_tagged_line(GContext *ctx, const char *tag, GColor tag_color, const char *rest,
                     GColor rest_color, GFont font, GRect box);

// ---- Where a venue is (docs/DESIGN_V1_1.md §2) ------------------------------

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
// A sea-accent button hint with its `›` (Home's `Route ›`), right-aligned so
// it ends at `right`, on a Gothic 14 bold line at y. Returns its width.
int draw_hint_right(GContext *ctx, const char *text, int right, int y);
