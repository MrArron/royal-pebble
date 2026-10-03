#pragma once
#include <pebble.h>

// A page of styled lines built on the phone (docs/WATCH_PROTOCOL.md, Page
// lines): a directory place card and the Route screen. The watch knows no
// wording or layout for them; it draws each line as sent.
//
// Each line: uint8 style, uint8 glyph, int8 space (px moved down before it),
// uint8 max_h (the text's wrap limit in px; a divider's inset), then its text
// as uint8 length and bytes.

// style: bits 0-1 the font, bit 2 centered, bits 3-5 the color token (the
// Theme field's index: 1 text, 2 muted, 4 port accent, 5 sea accent...; 3 bits
// so it stays inside Theme's 12 fields).
#define LINE_FONT_14 0
#define LINE_FONT_18 1
#define LINE_FONT_24 2
#define LINE_CENTER 4
#define LINE_COLOR(c) ((c) << 3)
#define LINE_TEXT 1
#define LINE_MUTED 2

// glyph: what is drawn with the text.
enum {
  LINE_PLAIN = 0,
  LINE_UP = 1,       // an up arrow before the text
  LINE_DOWN = 2,     // a down arrow before the text
  LINE_CHEVRON = 3,  // a `›` after the text
  LINE_DIVIDER = 4,  // a divider, max_h in from each side; no text
  LINE_CHIPS = 5,    // deck chips: the text's bytes are the cabin deck, then the decks
  LINE_STEP = 8,     // + a route step's glyph (0 walk ... 4 arrive), text after it
};

// One line's height in each font, as text_height() measures it; the phone
// lays out its pages with the same numbers (src/pkjs/pagelines.js, H).
#define LINE_H14 14
#define LINE_H18 18
#define LINE_H24 24

// The Route screen's dividers: full width on the Time 2, short on the Round 2
// (docs/mockups/round/Route).
#if defined(PBL_ROUND)
#define ROUTE_DIVIDER_INSET 37
#else
#define ROUTE_DIVIDER_INSET 8
#endif

// Draws the lines (ctx NULL: measures only) on a page `w` wide; returns the y
// below the last line.
int lines_draw(GContext *ctx, const uint8_t *p, int length, int w);
// Writes one line at p (the watch's own pages); returns the end.
uint8_t *lines_put(uint8_t *p, uint8_t style, uint8_t glyph, int8_t space, uint8_t max_h, const char *text);
