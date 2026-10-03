#include "lines.h"
#include "codec.h"
#include "ui.h"

#define TEXT_MAX 64
#define GLYPH_W 13
#define GLYPH_GAP 6
#define CHIPS_PER_ROW 7
#define CHIP_GAP 3
#define CHIP_H 20

static const char *const FONTS[] = {FONT_KEY_GOTHIC_14_BOLD, FONT_KEY_GOTHIC_18_BOLD, FONT_KEY_GOTHIC_24_BOLD,
                                    FONT_KEY_GOTHIC_14_BOLD};

// A small filled triangle, `rows` tall, pointing up (dir > 0) or down.
static void fill_triangle(GContext *ctx, int cx, int y, int rows, int dir) {
  for (int i = 0; i < rows; i++) {
    int half = dir > 0 ? i : rows - 1 - i;
    graphics_fill_rect(ctx, GRect(cx - half, y + i, 2 * half + 1, 1), 0, GCornerNone);
  }
}

// A route step's glyph (docs/mockups/gps/NOTES.md), about 13 px in the sea
// accent, beside a Gothic 18 bold line whose box top is at y: dot = walk,
// double-headed arrow = cross the ship, square with ▲▼ = elevator, stair line
// = stairs, ring with a dot = arrive.
static void draw_glyph(GContext *ctx, int glyph, int x, int y) {
  GColor color = g_theme->sea_accent;
  int top = y + 6;
  GPoint c = GPoint(x + GLYPH_W / 2, top + GLYPH_W / 2);
  graphics_context_set_fill_color(ctx, color);
  graphics_context_set_stroke_color(ctx, color);
  graphics_context_set_stroke_width(ctx, 2);
  switch (glyph) {
    case 0:  // walk
      graphics_fill_circle(ctx, c, 3);
      break;
    case 1:  // cross the ship
      graphics_draw_line(ctx, GPoint(x + 1, c.y), GPoint(x + GLYPH_W - 2, c.y));
      graphics_draw_line(ctx, GPoint(x + 1, c.y), GPoint(x + 4, c.y - 3));
      graphics_draw_line(ctx, GPoint(x + 1, c.y), GPoint(x + 4, c.y + 3));
      graphics_draw_line(ctx, GPoint(x + GLYPH_W - 2, c.y), GPoint(x + GLYPH_W - 5, c.y - 3));
      graphics_draw_line(ctx, GPoint(x + GLYPH_W - 2, c.y), GPoint(x + GLYPH_W - 5, c.y + 3));
      break;
    case 2:  // elevator
      graphics_context_set_stroke_width(ctx, 1);
      graphics_draw_round_rect(ctx, GRect(x + 1, top, GLYPH_W - 2, GLYPH_W), 2);
      graphics_draw_round_rect(ctx, GRect(x + 2, top + 1, GLYPH_W - 4, GLYPH_W - 2), 1);
      fill_triangle(ctx, c.x, top + 3, 3, 1);
      fill_triangle(ctx, c.x, top + GLYPH_W - 6, 3, -1);
      break;
    case 3:  // stairs
      // Four treads rising to the right, 2 px thick, drawn as rectangles so
      // they stay crisp (a thick line blurs into a slope).
      for (int i = 0; i < 4; i++) {
        int tx = x + 3 * i;
        int ty = top + 10 - 3 * i;
        graphics_fill_rect(ctx, GRect(tx, ty, 4, 2), 0, GCornerNone);
        if (i < 3) {
          graphics_fill_rect(ctx, GRect(tx + 2, ty - 3, 2, 3), 0, GCornerNone);
        }
      }
      break;
    default:  // arrive
      graphics_draw_circle(ctx, c, 5);
      graphics_fill_circle(ctx, c, 2);
      break;
  }
  graphics_context_set_stroke_width(ctx, 1);
}

// The decks an elevator bank stops at, 7 chips a row; the cabin's deck is
// filled with the sea accent (docs/DESIGN.md §10.2). `d` is the cabin deck,
// then the decks. Returns the height.
static int draw_chips(GContext *ctx, const char *d, int y, int w) {
  int count = codec_str_len(d, TEXT_MAX) - 1;
  int chip_w = (w - 2 * PAD - (CHIPS_PER_ROW - 1) * CHIP_GAP) / CHIPS_PER_ROW;
  for (int i = 0; ctx && i < count; i++) {
    GRect r = GRect(PAD + (i % CHIPS_PER_ROW) * (chip_w + CHIP_GAP), y + (i / CHIPS_PER_ROW) * (CHIP_H + CHIP_GAP),
                    chip_w, CHIP_H);
    bool cabin = d[i + 1] == d[0];
    graphics_context_set_fill_color(ctx, cabin ? g_theme->sea_accent : g_theme->divider);
    graphics_fill_rect(ctx, r, 0, GCornerNone);
    if (!cabin) {
      graphics_context_set_fill_color(ctx, g_theme->bg);
      graphics_fill_rect(ctx, grect_inset(r, GEdgeInsets(2)), 0, GCornerNone);
    }
    char num[4];
    snprintf(num, sizeof(num), "%d", (uint8_t)d[i + 1]);
    graphics_context_set_text_color(ctx, cabin ? g_theme->bg : g_theme->text);
    graphics_draw_text(ctx, num, fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD),
                       GRect(r.origin.x, r.origin.y + 1, r.size.w, CHIP_H - 2), GTextOverflowModeTrailingEllipsis,
                       GTextAlignmentCenter, NULL);
  }
  return (count + CHIPS_PER_ROW - 1) / CHIPS_PER_ROW * (CHIP_H + CHIP_GAP);
}

int lines_draw(GContext *ctx, const uint8_t *p, int length, int w) {
  const uint8_t *end = p + length;
  char text[TEXT_MAX];
  int y = 0;
  while (p + 4 < end) {
    uint8_t style = p[0];
    uint8_t glyph = p[1];
    int max_h = p[3];
    y += (int8_t)p[2];
    p += 4;
    if (!codec_read_str(&p, end, text, sizeof(text))) {
      break;
    }
    GFont font = fonts_get_system_font(FONTS[style & 3]);
    GColor color = (GColor){.argb = ((const uint8_t *)g_theme)[(style >> 3) & 15]};
    GTextAlignment align = (style & LINE_CENTER) ? GTextAlignmentCenter : GTextAlignmentLeft;
    int x = PAD;
    int tw = w - 2 * PAD;
    if (glyph == LINE_DIVIDER) {
      if (ctx) {
        graphics_context_set_stroke_color(ctx, g_theme->divider);
        graphics_draw_line(ctx, GPoint(max_h, y), GPoint(w - max_h, y));
      }
      continue;
    }
    if (glyph == LINE_CHIPS) {
      y += draw_chips(ctx, text, y, w);
      continue;
    }
    if (glyph >= LINE_STEP) {
      x += GLYPH_W + GLYPH_GAP;
      tw -= GLYPH_W + GLYPH_GAP;
      align = GTextAlignmentLeft;
    }
    int h = text[0] ? text_height(text, font, tw, max_h) : 0;
    if (ctx && text[0]) {
      graphics_context_set_text_color(ctx, color);
      if (glyph == LINE_UP || glyph == LINE_DOWN) {
        draw_arrow_line(ctx, (style & 3) != LINE_FONT_14, color, x, y, tw, "", glyph == LINE_UP ? 1 : -1, text);
      } else {
        if (glyph == LINE_CHEVRON) {
          int cw = graphics_text_layout_get_content_size(text, font, GRect(0, 0, tw, max_h),
                                                         GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft).w;
          if (align == GTextAlignmentCenter) {
            x = (w - cw - 8) / 2;
            align = GTextAlignmentLeft;
          }
          draw_chevron(ctx, color, x + cw + 4, y);
        } else if (glyph >= LINE_STEP) {
          draw_glyph(ctx, glyph - LINE_STEP, PAD, y);
        }
        graphics_draw_text(ctx, text, font, GRect(x, y, tw, h + 4), GTextOverflowModeTrailingEllipsis, align, NULL);
      }
    }
    y += h;
  }
  return y;
}

uint8_t *lines_put(uint8_t *p, uint8_t style, uint8_t glyph, int8_t space, uint8_t max_h, const char *text) {
  p[0] = style;
  p[1] = glyph;
  p[2] = (uint8_t)space;
  p[3] = max_h;
  return codec_write_str(p + 4, text, TEXT_MAX - 1);
}
