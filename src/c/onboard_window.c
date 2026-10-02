#include "screens.h"
#include "data.h"
#include "onboard.h"
#include "ui.h"
#include "usage.h"

// Two confirmations share this window, both confirmed by Hold Down, with Back
// leaving things unchanged and Up and Select doing nothing.
//
// "On board?" (docs/DESIGN.md §4.4), opened by Hold Select on Home:
// after Hold Down, a short buzz and "On board" for about 2 s (any button
// closes it early), then Home. The top bar stays Home's.
//
// "Remove star?" (§6), opened by Hold Select on a starred event in Today or
// its details: Hold Down removes the star (toggle_star buzzes) and returns.
// The top bar stays the screen's it came from.

#define DONE_MS 2000
// Button heights in the body's coordinates (window minus the top bar).
#define BACK_CY EDGE_BACK_CY
#define DOWN_CY EDGE_DOWN_CY

static Window *s_window;
static Layer *s_top_bar;
static Layer *s_body;
static bool s_done;
static AppTimer *s_timer;
// "Remove star?": the event (-1 for "On board?"), and its start and a hash of
// its title, to notice a new slice moving it while the screen is open.
static int s_unstar = -1;
static int32_t s_unstar_start;
static uint32_t s_unstar_hash;
static GColor s_band;
static const char *s_name;

// No strlen on the watch: walks the title to its NUL.
static uint32_t title_hash(const char *t) {
  uint32_t h = 5381;
  for (int i = 0; i < TITLE_LEN && t[i]; i++) {
    h = h * 33 + (uint8_t)t[i];
  }
  return h;
}

// The event is still where it was, starred and not booked.
static bool unstar_valid(void) {
  if (s_unstar < 0 || s_unstar >= data_event_count()) {
    return false;
  }
  Event *e = data_event(s_unstar);
  return e->start == s_unstar_start && (e->flags & EVENT_STARRED) && !(e->flags & EVENT_BOOKED) &&
         title_hash(e->title) == s_unstar_hash;
}

static void draw_text(GContext *ctx, const char *text, const char *font, GColor color, int y,
                      int w, int h, GTextAlignment align) {
  graphics_context_set_text_color(ctx, color);
  graphics_draw_text(ctx, text, fonts_get_system_font(font), GRect(PAD, y, w - 2 * PAD, h),
                     GTextOverflowModeWordWrap, align, NULL);
}

// A button label drawn at the screen edge beside its button: a pill rounded on
// the inside, in Gothic 14 bold.
static void draw_pill(GContext *ctx, const char *text, GColor fill, GColor text_color, bool left,
                      int cy, int screen_w) {
  GFont font = fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD);
  int text_w = graphics_text_layout_get_content_size(text, font, GRect(0, 0, screen_w, 18),
                                                     GTextOverflowModeFill, GTextAlignmentLeft).w;
  int w = text_w + 12;
  GRect box = GRect(left ? 0 : screen_w - w, cy - 8, w, 16);
  graphics_context_set_fill_color(ctx, fill);
  graphics_fill_rect(ctx, box, 8, left ? GCornersRight : GCornersLeft);
  graphics_context_set_text_color(ctx, text_color);
  graphics_draw_text(ctx, text, font, GRect(box.origin.x + (left ? 5 : 7), box.origin.y - 2, text_w + 2, 18),
                     GTextOverflowModeFill, GTextAlignmentLeft, NULL);
}

static void draw_ask(GContext *ctx, int w) {
  draw_text(ctx, "On board?", FONT_KEY_GOTHIC_24_BOLD, g_theme->text, 30, w, 30, GTextAlignmentLeft);
  draw_divider(ctx, 62, w);
  draw_text(ctx, "Ends today's countdown", FONT_KEY_GOTHIC_18_BOLD, g_theme->text, 64, w, 44,
            GTextAlignmentLeft);
  draw_text(ctx, "All-aboard alerts off.\nUndo in My info.", FONT_KEY_GOTHIC_14_BOLD, g_theme->muted,
            86, w, 36, GTextAlignmentLeft);
  draw_pill(ctx, "Not yet", GColorDarkGray, GColorWhite, true, BACK_CY, w);
  draw_pill(ctx, "Hold: yes", g_theme->sea_accent, theme_is_dark() ? GColorBlack : GColorWhite, false,
            DOWN_CY, w);
}

// "Remove star?", the title (up to two lines) and "9:00p · On Air".
static void draw_unstar(GContext *ctx, int w) {
  draw_text(ctx, "Remove star?", FONT_KEY_GOTHIC_24_BOLD, g_theme->text, 30, w, 30, GTextAlignmentLeft);
  draw_divider(ctx, 62, w);
  if (unstar_valid()) {
    Event *e = data_event(s_unstar);
    GFont font = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
    GRect box = GRect(PAD, 64, w - 2 * PAD, 44);
    graphics_context_set_text_color(ctx, g_theme->text);
    graphics_draw_text(ctx, e->title, font, box, GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
    int y = 64 + graphics_text_layout_get_content_size(e->title, font, box, GTextOverflowModeTrailingEllipsis,
                                                        GTextAlignmentLeft).h + 4;
    char time_buf[8] = "";
    if (e->start != NO_TIME) {
      fmt_clock(time_buf, sizeof(time_buf), e->start);
    }
    char buf[8 + VENUE_LEN + 4];
    snprintf(buf, sizeof(buf), "%s%s%s", time_buf, time_buf[0] && e->venue[0] ? " \xc2\xb7 " : "", e->venue);
    draw_text(ctx, buf, FONT_KEY_GOTHIC_14_BOLD, g_theme->muted, y, w, 18, GTextAlignmentLeft);
  }
  draw_pill(ctx, "Keep", GColorDarkGray, GColorWhite, true, BACK_CY, w);
  draw_pill(ctx, "Hold: remove", g_theme->port_accent, theme_is_dark() ? GColorBlack : GColorWhite, false,
            DOWN_CY, w);
}

static void draw_done(GContext *ctx, int w, int h) {
  int y = (h - 10 - 112) / 2;
  // A drawn check, about 36 px (text fonts have no ✓).
  int x = (w - 36) / 2;
  graphics_context_set_stroke_color(ctx, g_theme->sea_accent);
  graphics_context_set_stroke_width(ctx, 5);
  graphics_draw_line(ctx, GPoint(x + 4, y + 18), GPoint(x + 14, y + 28));
  graphics_draw_line(ctx, GPoint(x + 14, y + 28), GPoint(x + 32, y + 8));
  graphics_context_set_stroke_width(ctx, 1);
  y += 36;
  draw_text(ctx, "On board", FONT_KEY_GOTHIC_28_BOLD, g_theme->text, y, w, 34, GTextAlignmentCenter);
  y += 36;
  draw_text(ctx, "All-aboard alert off", FONT_KEY_GOTHIC_18_BOLD, g_theme->muted, y, w, 22,
            GTextAlignmentCenter);
  y += 22;
  draw_text(ctx, "Undo in My info", FONT_KEY_GOTHIC_14_BOLD, g_theme->muted, y, w, 18,
            GTextAlignmentCenter);
}

static void body_update_proc(Layer *layer, GContext *ctx) {
  GRect b = layer_get_bounds(layer);
  if (s_unstar >= 0) {
    draw_unstar(ctx, b.size.w);
  } else if (s_done) {
    draw_done(ctx, b.size.w, b.size.h);
  } else {
    draw_ask(ctx, b.size.w);
  }
}

static void close_done(void) {
  if (s_timer) {
    app_timer_cancel(s_timer);
    s_timer = NULL;
  }
  if (s_window) {
    window_stack_remove(s_window, true);
  }
}

static void done_timer_fired(void *data) {
  s_timer = NULL;
  close_done();
}

static void done_click(ClickRecognizerRef recognizer, void *context) {
  usage_press(click_recognizer_get_button_id(recognizer), 0, -1);
  close_done();
}

static void done_click_config(void *context) {
  window_single_click_subscribe(BUTTON_ID_UP, done_click);
  window_single_click_subscribe(BUTTON_ID_SELECT, done_click);
  window_single_click_subscribe(BUTTON_ID_DOWN, done_click);
}

static void nothing_click(ClickRecognizerRef recognizer, void *context) {
  usage_press(click_recognizer_get_button_id(recognizer), USAGE_NOTHING, -1);
}

static void down_long_click(ClickRecognizerRef recognizer, void *context) {
  usage_press(BUTTON_ID_DOWN, USAGE_LONG, -1);
  if (s_unstar >= 0) {
    // The refresh that follows sees the star gone and closes the screen.
    if (unstar_valid()) {
      toggle_star(s_unstar);
    }
    onboard_window_refresh();
    return;
  }
  onboard_set(true);
  vibes_short_pulse();
  s_done = true;
  usage_screen_detail(SCREEN_ONBOARD, 1);
  window_set_click_config_provider(s_window, done_click_config);
  layer_mark_dirty(s_body);
  home_window_refresh();
  info_window_refresh();
  s_timer = app_timer_register(DONE_MS, done_timer_fired, NULL);
}

static void ask_click_config(void *context) {
  window_single_click_subscribe(BUTTON_ID_UP, nothing_click);
  window_single_click_subscribe(BUTTON_ID_SELECT, nothing_click);
  window_single_click_subscribe(BUTTON_ID_DOWN, nothing_click);
  window_long_click_subscribe(BUTTON_ID_DOWN, 700, down_long_click, NULL);
}

static void apply_style(void) {
  const Day *day = data_day();
  window_set_background_color(s_window, g_theme->bg);
  if (s_unstar >= 0) {
    top_bar_set(s_top_bar, s_band, BAND_LABEL, s_name);
  } else {
    top_bar_set(s_top_bar, day->kind == DAY_PORT ? BAND_PORT : BAND_SEA, BAND_LABEL, day->location);
  }
}

static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect b = layer_get_bounds(root);
  s_top_bar = top_bar_create(TOP_BAR_FRAME(b), BAND_PORT, BAND_LABEL, "");
  layer_add_child(root, s_top_bar);
  s_body = layer_create(BODY_FRAME(b));
  layer_set_update_proc(s_body, body_update_proc);
  layer_add_child(root, s_body);
  apply_style();
}

static void window_appear(Window *window) {
  if (s_unstar >= 0) {
    usage_screen(SCREEN_UNSTAR, s_unstar_start);
  } else {
    usage_screen(SCREEN_ONBOARD, s_done ? 1 : 0);
  }
}

static void window_unload(Window *window) {
  if (s_timer) {
    app_timer_cancel(s_timer);
    s_timer = NULL;
  }
  layer_destroy(s_body);
  top_bar_destroy(s_top_bar);
  s_body = NULL;
  s_top_bar = NULL;
  window_destroy(window);
  s_window = NULL;
  s_unstar = -1;
}

void onboard_window_refresh(void) {
  if (s_unstar >= 0 && s_window && !unstar_valid()) {
    // Removed, or a new slice moved or changed the event: back to the list.
    if (window_stack_contains_window(s_window)) {
      window_stack_remove(s_window, true);
    }
    return;
  }
  if (s_body) {
    apply_style();
    layer_mark_dirty(s_top_bar);
    layer_mark_dirty(s_body);
  }
}

static void push(void) {
  s_window = window_create();
  window_set_click_config_provider(s_window, ask_click_config);
  window_set_window_handlers(s_window, (WindowHandlers){
    .load = window_load,
    .appear = window_appear,
    .unload = window_unload,
  });
  window_stack_push(s_window, true);
}

void onboard_window_push(void) {
  if (s_window) {
    return;
  }
  s_done = false;
  s_unstar = -1;
  push();
}

void unstar_window_push(int event_index, GColor band, const char *name) {
  if (s_window) {
    return;
  }
  Event *e = data_event(event_index);
  s_done = false;
  s_unstar = event_index;
  s_unstar_start = e->start;
  s_unstar_hash = title_hash(e->title);
  s_band = band;
  s_name = name;
  push();
}
