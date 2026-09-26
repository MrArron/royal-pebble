#include "ui.h"
#include "data.h"

static const Theme LIGHT = {
  .bg = {GColorWhiteARGB8},
  .text = {GColorBlackARGB8},
  .muted = {GColorDarkGrayARGB8},          // #555555
  .divider = {GColorLightGrayARGB8},       // #AAAAAA
  .port_accent = {GColorWindsorTanARGB8},  // #AA5500
  .sea_accent = {GColorCobaltBlueARGB8},   // #0055AA
  .cursor_bg = {GColorCobaltBlueARGB8},
  .cursor_text = {GColorWhiteARGB8},
  .now_label = {GColorMidnightGreenARGB8},  // #005555
};

static const Theme DARK = {
  .bg = {GColorBlackARGB8},
  .text = {GColorWhiteARGB8},
  .muted = {GColorLightGrayARGB8},        // #AAAAAA
  .divider = {GColorDarkGrayARGB8},       // #555555
  .port_accent = {GColorChromeYellowARGB8},  // #FFAA00
  .sea_accent = {GColorVividCeruleanARGB8},  // #00AAFF
  .cursor_bg = {GColorVividCeruleanARGB8},
  .cursor_text = {GColorBlackARGB8},
  .now_label = {GColorMediumAquamarineARGB8},  // #55FFAA
};

// Everything in one quiet gray, for a screen behind Home's button hints (§9.5).
static const Theme FADED_LIGHT = {
  .bg = {GColorWhiteARGB8},
  .text = {GColorLightGrayARGB8},
  .muted = {GColorLightGrayARGB8},
  .divider = {GColorLightGrayARGB8},
  .port_accent = {GColorLightGrayARGB8},
  .sea_accent = {GColorLightGrayARGB8},
  .cursor_bg = {GColorLightGrayARGB8},
  .cursor_text = {GColorWhiteARGB8},
  .now_label = {GColorLightGrayARGB8},
};

static const Theme FADED_DARK = {
  .bg = {GColorBlackARGB8},
  .text = {GColorDarkGrayARGB8},
  .muted = {GColorDarkGrayARGB8},
  .divider = {GColorDarkGrayARGB8},
  .port_accent = {GColorDarkGrayARGB8},
  .sea_accent = {GColorDarkGrayARGB8},
  .cursor_bg = {GColorDarkGrayARGB8},
  .cursor_text = {GColorBlackARGB8},
  .now_label = {GColorDarkGrayARGB8},
};

const Theme *g_theme = &LIGHT;

void theme_set_dark(bool dark) { g_theme = dark ? &DARK : &LIGHT; }
bool theme_is_dark(void) { return g_theme == &DARK || g_theme == &FADED_DARK; }
const Theme *theme_faded(void) { return theme_is_dark() ? &FADED_DARK : &FADED_LIGHT; }

int now_minutes(void) {
  time_t now = time(NULL);
  struct tm *t = localtime(&now);
  return t->tm_hour * 60 + t->tm_min;
}

void fmt_clock(char *buf, size_t size, int minutes) {
  minutes %= 24 * 60;
  if (minutes < 0) {
    minutes += 24 * 60;
  }
  int h = minutes / 60;
  int m = minutes % 60;
  if (clock_is_24h_style()) {
    snprintf(buf, size, "%d:%02d", h, m);
  } else {
    char suffix = h < 12 ? 'a' : 'p';
    int h12 = h % 12 == 0 ? 12 : h % 12;
    snprintf(buf, size, "%d:%02d%c", h12, m, suffix);
  }
}

void fmt_duration(char *buf, size_t size, int minutes) {
  int h = minutes / 60;
  int m = minutes % 60;
  if (h == 0) {
    snprintf(buf, size, "%d min", m);
  } else if (m == 0) {
    snprintf(buf, size, "%d h", h);
  } else {
    snprintf(buf, size, "%d h %d min", h, m);
  }
}

// ---- Top bar ---------------------------------------------------------------

static int arrow_width(bool large);

typedef struct {
  GColor band;
  GColor label;
  char name[24];
  bool custom;     // `right` (or the rel) replaces the day's status
  bool has_rel;
  int8_t rel;
  char right[24];
} TopBarData;

static bool same_ignoring_case(const char *a, const char *b) {
  for (; *a && *b; a++, b++) {
    char x = *a >= 'a' && *a <= 'z' ? *a - 'a' + 'A' : *a;
    char y = *b >= 'a' && *b <= 'z' ? *b - 'a' + 'A' : *b;
    if (x != y) {
      return false;
    }
  }
  return *a == *b;
}

static GSize text_size(const char *text, GFont font) {
  return graphics_text_layout_get_content_size(text, font, GRect(0, 0, 200, 30),
                                               GTextOverflowModeTrailingEllipsis,
                                               GTextAlignmentLeft);
}

static void top_bar_update_proc(Layer *layer, GContext *ctx) {
  TopBarData *data = layer_get_data(layer);
  GRect b = layer_get_bounds(layer);
  graphics_context_set_fill_color(ctx, data->band);
  graphics_fill_rect(ctx, b, 0, GCornerNone);

  const int pad = 7;
  const int gap = 6;
  const int y = 1;
  GFont font = fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD);

  // The time is centered and always shown; the labels get what's left.
  char ship_time[8];
  fmt_clock(ship_time, sizeof(ship_time), now_minutes());
  int time_w = text_size(ship_time, font).w;
  int time_x = (b.size.w - time_w) / 2;
  graphics_context_set_text_color(ctx, GColorWhite);
  graphics_draw_text(ctx, ship_time, font, GRect(time_x - 2, y, time_w + 4, 18),
                     GTextOverflowModeFill, GTextAlignmentCenter, NULL);
  graphics_draw_text(ctx, data->name, font, GRect(pad, y, time_x - gap - pad, 18),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);

  int right_x = time_x + time_w + gap;
  int right_w = b.size.w - pad - right_x;
  if (data->custom && data->has_rel) {
    // "↓1 deck" with a drawn arrow, or "your deck", against the right edge.
    int n = data->rel < 0 ? -data->rel : data->rel;
    char text[16];
    snprintf(text, sizeof(text), n == 0 ? "your deck" : n == 1 ? "%d deck" : "%d decks", n);
    int arrow_w = n == 0 ? 0 : arrow_width(false) + 1;
    int w = arrow_w + text_size(text, font).w;
    if (w <= right_w) {
      draw_arrow_line(ctx, false, data->label, b.size.w - pad - w, y, w + 2, "", data->rel, text);
    }
    return;
  }
  const char *status = data->custom ? data->right : data_ready() ? data_day()->status : "";
  if (status[0] && !same_ignoring_case(status, data->name) && text_size(status, font).w <= right_w) {
    graphics_context_set_text_color(ctx, data->label);
    graphics_draw_text(ctx, status, font, GRect(right_x, y, right_w, 18),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentRight, NULL);
  }
}

void top_bar_set(Layer *bar, GColor band, GColor label, const char *name) {
  TopBarData *data = layer_get_data(bar);
  data->band = band;
  data->label = label;
  strncpy(data->name, name, sizeof(data->name) - 1);
  data->name[sizeof(data->name) - 1] = '\0';
  layer_mark_dirty(bar);
}

void top_bar_set_right(Layer *bar, const char *text, bool has_rel, int rel) {
  TopBarData *data = layer_get_data(bar);
  data->custom = true;
  data->has_rel = has_rel;
  data->rel = (int8_t)rel;
  strncpy(data->right, text, sizeof(data->right) - 1);
  data->right[sizeof(data->right) - 1] = '\0';
  layer_mark_dirty(bar);
}

Layer *top_bar_create(GRect frame, GColor band, GColor label, const char *name) {
  Layer *bar = layer_create_with_data(frame, sizeof(TopBarData));
  layer_set_update_proc(bar, top_bar_update_proc);
  top_bar_set(bar, band, label, name);
  return bar;
}

void top_bar_destroy(Layer *bar) { layer_destroy(bar); }

// ---- Drawing helpers -------------------------------------------------------

static const GPathInfo STAR_PATH_INFO = {
  .num_points = 10,
  .points = (GPoint[]){
    {0, -6}, {2, -2}, {6, -2}, {3, 1}, {4, 6},
    {0, 3}, {-4, 6}, {-3, 1}, {-6, -2}, {-2, -2},
  },
};

void draw_star(GContext *ctx, GPoint center, GColor color) {
  static GPath *s_star_path;
  if (!s_star_path) {
    s_star_path = gpath_create(&STAR_PATH_INFO);
  }
  gpath_move_to(s_star_path, center);
  graphics_context_set_fill_color(ctx, color);
  gpath_draw_filled(ctx, s_star_path);
}

void draw_bang(GContext *ctx, GPoint top_left, int h, GColor color) {
  int stroke = h / 4;
  int bar = h * 5 / 8;
  graphics_context_set_fill_color(ctx, color);
  graphics_fill_rect(ctx, GRect(top_left.x, top_left.y, stroke, bar), 1, GCornersAll);
  graphics_fill_rect(ctx, GRect(top_left.x, top_left.y + h - stroke, stroke, stroke), 1, GCornersAll);
}

void draw_check(GContext *ctx, GPoint o, int size, GColor color) {
  graphics_context_set_stroke_color(ctx, color);
  graphics_context_set_stroke_width(ctx, 2);
  GPoint low = GPoint(o.x + size * 3 / 8, o.y + size - 1);
  graphics_draw_line(ctx, GPoint(o.x, o.y + size / 2), low);
  graphics_draw_line(ctx, low, GPoint(o.x + size - 1, o.y + 1));
  graphics_context_set_stroke_width(ctx, 1);
}

#define CHECK_GAP 4

static int check_size(bool large) { return large ? 11 : 9; }

static GFont reserved_font(bool large) {
  return fonts_get_system_font(large ? FONT_KEY_GOTHIC_18_BOLD : FONT_KEY_GOTHIC_14_BOLD);
}

int reserved_width(bool large) {
  return check_size(large) + CHECK_GAP + text_size("Reserved", reserved_font(large)).w;
}

int draw_reserved(GContext *ctx, bool large, int x, int y, GColor color) {
  int size = check_size(large);
  // On the capitals of the text beside it.
  draw_check(ctx, GPoint(x, y + (large ? 7 : 5)), size, color);
  int text_x = x + size + CHECK_GAP;
  int w = text_size("Reserved", reserved_font(large)).w;
  graphics_context_set_text_color(ctx, color);
  graphics_draw_text(ctx, "Reserved", reserved_font(large), GRect(text_x, y, w + 2, large ? 22 : 18),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  return text_x + w - x;
}

int draw_clash_count(GContext *ctx, int x, int y, int w, int32_t now) {
  int n = data_clash_count(now);
  if (n == 0) {
    return 0;
  }
  char buf[16];
  snprintf(buf, sizeof(buf), "%d clash%s", n, n == 1 ? "" : "es");
  graphics_context_set_text_color(ctx, g_theme->port_accent);
  graphics_draw_text(ctx, buf, fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD), GRect(x, y, w, 18),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  return 16;
}

const char *event_final_tag(const Event *e) {
  return (e->flags & EVENT_LAST_CHANCE) ? "Last chance"
         : (e->flags & EVENT_ONLY_SHOW) ? "Only show" : NULL;
}

int draw_tagged_line(GContext *ctx, const char *tag, GColor tag_color, const char *rest,
                     GColor rest_color, GFont font, GRect box) {
  int x = box.origin.x;
  if (tag) {
    int tag_w = graphics_text_layout_get_content_size(tag, font, box, GTextOverflowModeTrailingEllipsis,
                                                      GTextAlignmentLeft).w;
    graphics_context_set_text_color(ctx, tag_color);
    graphics_draw_text(ctx, tag, font, GRect(x, box.origin.y, tag_w + 2, box.size.h),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
    if (!rest[0]) {
      return x + tag_w;
    }
    x += tag_w;
  }
  char buf[64];
  snprintf(buf, sizeof(buf), "%s%s", tag ? " \xc2\xb7 " : "", rest);
  GRect rest_box = GRect(x, box.origin.y, box.origin.x + box.size.w - x, box.size.h);
  graphics_context_set_text_color(ctx, rest_color);
  graphics_draw_text(ctx, buf, font, rest_box, GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  return x + graphics_text_layout_get_content_size(buf, font, rest_box, GTextOverflowModeTrailingEllipsis,
                                                   GTextAlignmentLeft).w;
}

void draw_divider(GContext *ctx, int y, int width) {
  graphics_context_set_stroke_color(ctx, g_theme->divider);
  graphics_draw_line(ctx, GPoint(PAD, y), GPoint(width - PAD, y));
}

// ---- Where a venue is ------------------------------------------------------

static const char *const POSITIONS[] = {"", "Fore", "Mid", "Aft"};

bool where_ashore(const Where *w) { return (w->bits & WHERE_ASHORE) != 0; }
bool where_known(const Where *w) { return w->deck > 0 || where_ashore(w); }
bool where_has_rel(const Where *w) { return w->deck > 0 && (w->bits & WHERE_REL) != 0; }

static const char *where_position(const Where *w) { return POSITIONS[w->bits & WHERE_POS_MASK]; }

// "4" or "3-5".
static void fmt_decks(char *buf, size_t size, const Where *w) {
  if (w->deck_to > w->deck) {
    snprintf(buf, size, "%d-%d", w->deck, w->deck_to);
  } else {
    snprintf(buf, size, "%d", w->deck);
  }
}

// "Deck 4<sep>Mid" with the given separator before the position.
static void fmt_deck_pos(char *buf, size_t size, const Where *w, const char *sep) {
  char decks[8];
  fmt_decks(decks, sizeof(decks), w);
  const char *pos = where_position(w);
  snprintf(buf, size, "%s %s%s%s", w->deck_to > w->deck ? "Decks" : "Deck", decks,
           pos[0] ? sep : "", pos);
}

void fmt_where(char *buf, size_t size, const Where *w) {
  buf[0] = '\0';
  if (where_ashore(w)) {
    snprintf(buf, size, "Ashore");
  } else if (w->deck > 0) {
    fmt_deck_pos(buf, size, w, " \xc2\xb7 ");
  }
}

void fmt_where_short(char *buf, size_t size, const Where *w) {
  buf[0] = '\0';
  if (where_ashore(w)) {
    snprintf(buf, size, "Ashore");
  } else if (w->deck > 0) {
    fmt_deck_pos(buf, size, w, " ");
  }
}

void fmt_venue_where(char *buf, size_t size, const char *venue, const Where *w) {
  char place[16] = "";
  if (where_ashore(w)) {
    snprintf(place, sizeof(place), "Ashore");
  } else if (w->deck > 0) {
    char decks[8];
    fmt_decks(decks, sizeof(decks), w);
    const char *pos = where_position(w);
    snprintf(place, sizeof(place), "%s%s%s", decks, pos[0] ? " " : "", pos);
  }
  if (venue[0] && place[0]) {
    snprintf(buf, size, "%s \xc2\xb7 %s", venue, place);
  } else {
    snprintf(buf, size, "%s%s", venue, place);
  }
}

// Arrow sizes per font: the digits' cap height, where their baseline sits
// below the top of the text box (checked in the emulator), and the width. For
// the right arrow: the row the middle of the lowercase letters sits on, its
// width and how many steps each arm of its head has.
typedef struct {
  int cap;
  int baseline;
  int width;
  int middle;
  int right_width;
  int right_arms;
} ArrowMetrics;

static ArrowMetrics arrow_metrics(bool large) {
  // Gothic 18 bold: digits are 11 rows ending 18 px down, lowercase letters
  // 8 rows ending there too (measured on the reminder's route line).
  if (large) {
    return (ArrowMetrics){.cap = 11, .baseline = 18, .width = 10,
                          .middle = 14, .right_width = 11, .right_arms = 3};
  }
  // Gothic 14 bold (the right arrow isn't used at this size yet).
  return (ArrowMetrics){.cap = 10, .baseline = 13, .width = 8,
                        .middle = 10, .right_width = 9, .right_arms = 2};
}

static int arrow_width(bool large) { return arrow_metrics(large).width; }

// A right arrow centered on the lowercase letters: a 2 px shaft and a head
// whose arms are 2 px wide steps, like draw_arrow() turned on its side.
static void draw_right_arrow(GContext *ctx, int x, int y, ArrowMetrics m, GColor color) {
  int top = y + m.middle - 1;  // the shaft's upper row
  int tip = x + m.right_width - 1;
  graphics_context_set_fill_color(ctx, color);
  graphics_fill_rect(ctx, GRect(x, top, m.right_width, 2), 0, GCornerNone);
  for (int i = 1; i <= m.right_arms; i++) {
    graphics_fill_rect(ctx, GRect(tip - i - 1, top - i, 2, 1), 0, GCornerNone);
    graphics_fill_rect(ctx, GRect(tip - i - 1, top + 1 + i, 2, 1), 0, GCornerNone);
  }
}

// An up or down arrow standing on the baseline, `m.cap` tall: a 2 px stem and
// a head whose arms are 2 px tall steps, drawn pixel by pixel so it stays crisp.
static void draw_arrow(GContext *ctx, int x, int y, ArrowMetrics m, int dir, GColor color) {
  int stem_x = x + (m.width - 2) / 2;
  int top = y + m.baseline - m.cap;
  int tip = dir > 0 ? top : top + m.cap - 1;
  int away = dir > 0 ? 1 : -1;  // from the tip toward the tail
  graphics_context_set_fill_color(ctx, color);
  graphics_fill_rect(ctx, GRect(stem_x, top, 2, m.cap), 0, GCornerNone);
  for (int i = 1; i <= (m.width - 2) / 2; i++) {
    int row = tip + away * i;
    int rect_y = away > 0 ? row : row - 1;
    graphics_fill_rect(ctx, GRect(stem_x - i, rect_y, 1, 2), 0, GCornerNone);
    graphics_fill_rect(ctx, GRect(stem_x + 1 + i, rect_y, 1, 2), 0, GCornerNone);
  }
}

int draw_arrow_line(GContext *ctx, bool large, GColor color, int x, int y, int w,
                    const char *before, int dir, const char *after) {
  GFont font = fonts_get_system_font(large ? FONT_KEY_GOTHIC_18_BOLD : FONT_KEY_GOTHIC_14_BOLD);
  ArrowMetrics m = arrow_metrics(large);
  int height = large ? 20 : 16;
  int right = x + w;
  graphics_context_set_text_color(ctx, color);
  if (before[0]) {
    graphics_draw_text(ctx, before, font, GRect(x, y, right - x, height),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
    x += text_size(before, font).w;
  }
  if (dir != 0 && x + m.width < right) {
    draw_arrow(ctx, x, y, m, dir, color);
    x += m.width + 1;
  }
  if (after[0] && x < right) {
    graphics_draw_text(ctx, after, font, GRect(x, y, right - x, height),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  }
  return height;
}

static int abs_int(int n) { return n < 0 ? -n : n; }

int draw_rel_line(GContext *ctx, bool large, GColor color, int x, int y, int w,
                  const Where *where) {
  if (!where_has_rel(where)) {
    return 0;
  }
  int n = abs_int(where->rel);
  if (n == 0) {
    return draw_arrow_line(ctx, large, color, x, y, w, "On your cabin deck", 0, "");
  }
  char text[24];
  snprintf(text, sizeof(text), "%d %s from cabin", n, n == 1 ? "deck" : "decks");
  return draw_arrow_line(ctx, large, color, x, y, w, "", where->rel, text);
}

// Draws `text` at *x and moves *x past it; nothing once the line is full.
static void draw_run(GContext *ctx, GFont font, const char *text, int *x, int y, int right,
                     int height) {
  if (!text[0] || *x >= right) {
    return;
  }
  graphics_draw_text(ctx, text, font, GRect(*x, y, right - *x, height),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  *x += text_size(text, font).w;
}

int draw_route_line(GContext *ctx, GColor color, int x, int y, int w, const Where *to,
                    int from_pos) {
  GFont font = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
  ArrowMetrics m = arrow_metrics(true);
  const int height = 20;
  int right = x + w;
  graphics_context_set_text_color(ctx, color);

  char decks[16];
  int n = abs_int(to->rel);
  if (n == 0) {
    snprintf(decks, sizeof(decks), "Same deck");
  } else {
    if (x + m.width < right) {
      draw_arrow(ctx, x, y, m, to->rel, color);
      x += m.width + 1;
    }
    snprintf(decks, sizeof(decks), "%d %s", n, n == 1 ? "deck" : "decks");
  }
  draw_run(ctx, font, decks, &x, y, right, height);

  from_pos &= WHERE_POS_MASK;
  int to_pos = to->bits & WHERE_POS_MASK;
  const char *from = POSITIONS[from_pos];
  const char *pos = POSITIONS[to_pos];
  if (!to_pos) {
    return height;
  }
  draw_run(ctx, font, " \xc2\xb7 ", &x, y, right, height);
  if (from_pos && from_pos != to_pos) {
    draw_run(ctx, font, from, &x, y, right, height);
    if (x + 2 + m.right_width + 2 < right) {
      draw_right_arrow(ctx, x + 2, y, m, color);
      x += 2 + m.right_width + 2;
    }
  }
  draw_run(ctx, font, pos, &x, y, right, height);
  return height;
}

int draw_where_short(GContext *ctx, bool large, GColor color, int x, int y, int w,
                     const Where *where) {
  if (!where_known(where)) {
    return 0;
  }
  char place[24], before[40];
  fmt_where_short(place, sizeof(place), where);
  if (!where_has_rel(where)) {
    return draw_arrow_line(ctx, large, color, x, y, w, place, 0, "");
  }
  int n = abs_int(where->rel);
  if (n == 0) {
    snprintf(before, sizeof(before), "%s \xc2\xb7 your deck", place);
    return draw_arrow_line(ctx, large, color, x, y, w, before, 0, "");
  }
  char count[8];
  snprintf(before, sizeof(before), "%s \xc2\xb7 ", place);
  snprintf(count, sizeof(count), "%d", n);
  return draw_arrow_line(ctx, large, color, x, y, w, before, where->rel, count);
}

void draw_chevron(GContext *ctx, GColor color, int x, int y) {
  graphics_context_set_stroke_color(ctx, color);
  graphics_context_set_stroke_width(ctx, 2);
  graphics_draw_line(ctx, GPoint(x, y + 5), GPoint(x + 3, y + 8));
  graphics_draw_line(ctx, GPoint(x + 3, y + 8), GPoint(x, y + 11));
  graphics_context_set_stroke_width(ctx, 1);
}

int draw_hint_right(GContext *ctx, const char *text, int right, int y) {
  GFont font = fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD);
  int text_w = text_size(text, font).w;
  int w = text_w + 4 + 5;
  int x = right - w;
  graphics_context_set_text_color(ctx, g_theme->sea_accent);
  graphics_draw_text(ctx, text, font, GRect(x, y, text_w + 2, 16), GTextOverflowModeFill,
                     GTextAlignmentLeft, NULL);
  draw_chevron(ctx, g_theme->sea_accent, x + text_w + 4, y);
  return w;
}
