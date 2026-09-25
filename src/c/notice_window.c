#include "screens.h"
#include "data.h"
#include "ui.h"

// Shown when a re-sync moved or cancelled starred events: "Schedule" in the top
// bar, then "MOVED" with the new and old time, like the alert screen. Also when
// starred events or alerts didn't fit in the watch's storage (NOTICE_SAVED). Up and Down step
// through several; Select or Back closes. It never covers an alert: while one
// is open the notices wait and appear when it closes.

static Window *s_window;
static Layer *s_top_bar;
static Layer *s_layer;
static Notice s_notices[MAX_NOTICES];
static int s_count;
static int s_index;
static bool s_pending;

static const char *const WEEKDAYS[] = {"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"};

// "9:30p", "Thu 9:30p" when not on today's watch day, or "All day".
static void fmt_when(char *buf, size_t size, int32_t t) {
  if (t == NO_TIME) {
    snprintf(buf, size, "All day");
    return;
  }
  char clock[8];
  fmt_clock(clock, sizeof(clock), t);
  int32_t day = cruise_day_index(t);
  if (data_ready() && day != cruise_day_index(now_cruise())) {
    int32_t days = data_meta()->sail_days + day;  // 1970-01-01 was a Thursday
    snprintf(buf, size, "%s %s", WEEKDAYS[((days + 4) % 7 + 7) % 7], clock);
  } else {
    snprintf(buf, size, "%s", clock);
  }
}

// "9:30p · Studio B", or just one of them.
static void fmt_line(char *buf, size_t size, const char *prefix, const char *when,
                     const char *venue) {
  if (when[0] && venue[0]) {
    snprintf(buf, size, "%s%s \xc2\xb7 %s", prefix, when, venue);
  } else {
    snprintf(buf, size, "%s%s%s", prefix, when, venue);
  }
}

static void draw_more(GContext *ctx, GRect b);

// "PHONE NEEDED": starred events or alerts from `from` on aren't saved on the
// watch, so the app needs the phone before then to have them all.
static void draw_saved(GContext *ctx, GRect b, const Notice *n) {
  int w = b.size.w - 2 * PAD;
  graphics_context_set_text_color(ctx, g_theme->port_accent);
  graphics_draw_text(ctx, "PHONE NEEDED", fonts_get_system_font(FONT_KEY_GOTHIC_28_BOLD),
                     GRect(PAD, 2, w, 34), GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentLeft, NULL);
  char when[16], text[96];
  fmt_when(when, sizeof(when), n->from);
  snprintf(text, sizeof(text), "Starred events and alerts from %s on aren't saved on the watch", when);
  GFont title_font = fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD);
  GRect title_box = GRect(PAD, 36, w, 86);
  GSize size = graphics_text_layout_get_content_size(text, title_font, title_box,
                                                     GTextOverflowModeWordWrap, GTextAlignmentLeft);
  graphics_context_set_text_color(ctx, g_theme->text);
  graphics_draw_text(ctx, text, title_font, title_box, GTextOverflowModeWordWrap,
                     GTextAlignmentLeft, NULL);
  snprintf(text, sizeof(text), "Open Royal Pebble near your phone before %s and none are missed.", when);
  graphics_context_set_text_color(ctx, g_theme->muted);
  graphics_draw_text(ctx, text, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                     GRect(PAD, 36 + size.h + 6, w, 66), GTextOverflowModeWordWrap,
                     GTextAlignmentLeft, NULL);
}

static void update_proc(Layer *layer, GContext *ctx) {
  GRect b = layer_get_bounds(layer);
  Notice *n = &s_notices[s_index];
  int w = b.size.w - 2 * PAD;
  if (n->kind == NOTICE_SAVED) {
    draw_saved(ctx, b, n);
    draw_more(ctx, b);
    return;
  }

  const char *head = n->kind == NOTICE_MOVED ? "MOVED"
                     : n->kind == NOTICE_CHECK ? "CHECK TIMES" : "CANCELLED";
  graphics_context_set_text_color(ctx, g_theme->port_accent);
  graphics_draw_text(ctx, head, fonts_get_system_font(FONT_KEY_GOTHIC_28_BOLD),
                     GRect(PAD, 2, w, 34), GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentLeft, NULL);

  int y = 36;
  GFont title_font = fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD);
  GRect title_box = GRect(PAD, y, w, 58);
  GSize size = graphics_text_layout_get_content_size(n->title, title_font, title_box,
                                                     GTextOverflowModeTrailingEllipsis,
                                                     GTextAlignmentLeft);
  graphics_context_set_text_color(ctx, g_theme->text);
  graphics_draw_text(ctx, n->title, title_font, title_box, GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentLeft, NULL);
  y += size.h + 4;

  char from[16], to[16], first[64], second[64];
  fmt_when(from, sizeof(from), n->from);
  fmt_when(to, sizeof(to), n->to);
  if (n->kind == NOTICE_MOVED) {
    fmt_line(first, sizeof(first), "Now ", to, n->venue);
    // Only what changed: the old time, the old venue, or both.
    fmt_line(second, sizeof(second), "Was ", n->from != n->to ? from : "", n->old_venue);
  } else {
    fmt_line(first, sizeof(first), "Was ", from, n->venue);
    snprintf(second, sizeof(second), "%s", n->kind == NOTICE_CHECK
             ? "New times: star one again" : "Star removed");
  }
  GFont bold = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
  GFont regular = fonts_get_system_font(FONT_KEY_GOTHIC_18);
  bool moved = n->kind == NOTICE_MOVED;
  graphics_context_set_text_color(ctx, moved ? g_theme->text : g_theme->muted);
  graphics_draw_text(ctx, first, moved ? bold : regular, GRect(PAD, y, w, 22),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  y += 24;
  graphics_context_set_text_color(ctx, moved ? g_theme->muted : g_theme->text);
  graphics_draw_text(ctx, second, moved ? regular : bold, GRect(PAD, y, w, 22),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);

  draw_more(ctx, b);
}

static void draw_more(GContext *ctx, GRect b) {
  int w = b.size.w - 2 * PAD;
  if (s_count > 1) {
    char more[48];
    snprintf(more, sizeof(more), "%d of %d%s", s_index + 1, s_count,
             s_index + 1 < s_count ? " \xc2\xb7 Down for next" : "");
    graphics_context_set_text_color(ctx, g_theme->muted);
    graphics_draw_text(ctx, more, fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD),
                       GRect(PAD, b.size.h - 22, w, 18), GTextOverflowModeTrailingEllipsis,
                       GTextAlignmentLeft, NULL);
  }
}

static void step(int delta) {
  int next = s_index + delta;
  if (next >= 0 && next < s_count) {
    s_index = next;
    layer_mark_dirty(s_layer);
  }
}

static void up_click(ClickRecognizerRef recognizer, void *context) { step(-1); }
static void down_click(ClickRecognizerRef recognizer, void *context) { step(1); }
static void close_click(ClickRecognizerRef recognizer, void *context) {
  window_stack_remove(s_window, true);
}

static void click_config(void *context) {
  window_single_click_subscribe(BUTTON_ID_UP, up_click);
  window_single_click_subscribe(BUTTON_ID_DOWN, down_click);
  window_single_click_subscribe(BUTTON_ID_SELECT, close_click);
  window_single_click_subscribe(BUTTON_ID_BACK, close_click);
}

static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect b = layer_get_bounds(root);
  window_set_background_color(window, g_theme->bg);
  s_top_bar = top_bar_create(GRect(0, 0, b.size.w, TOP_BAR_HEIGHT), BAND_INFO, BAND_LABEL_INFO,
                             "Schedule");
  layer_add_child(root, s_top_bar);
  s_layer = layer_create(GRect(0, TOP_BAR_HEIGHT, b.size.w, b.size.h - TOP_BAR_HEIGHT));
  layer_set_update_proc(s_layer, update_proc);
  layer_add_child(root, s_layer);
}

static void window_unload(Window *window) {
  layer_destroy(s_layer);
  top_bar_destroy(s_top_bar);
  s_layer = NULL;
  s_top_bar = NULL;
  window_destroy(window);
  s_window = NULL;
}

void notice_window_refresh(void) {
  if (s_layer) {
    // The theme may have changed (settings page).
    window_set_background_color(s_window, g_theme->bg);
    layer_mark_dirty(s_top_bar);
    layer_mark_dirty(s_layer);
  }
}

void notice_window_show_pending(void) {
  if (!s_pending) {
    return;
  }
  s_pending = false;
  static const uint32_t segments[] = {150, 100, 150, 100, 150};
  vibes_enqueue_custom_pattern((VibePattern){.durations = segments,
                                             .num_segments = ARRAY_LENGTH(segments)});
  if (s_window) {
    window_set_background_color(s_window, g_theme->bg);
    layer_mark_dirty(s_layer);
    return;
  }
  s_window = window_create();
  window_set_click_config_provider(s_window, click_config);
  window_set_window_handlers(s_window, (WindowHandlers){
    .load = window_load,
    .unload = window_unload,
  });
  window_stack_push(s_window, true);
}

void notice_window_show(const Notice *notices, int count) {
  // Added to any still on screen or waiting (a storage notice and a re-sync's
  // notices can arrive together).
  if (!s_window && !s_pending) {
    s_count = 0;
    s_index = 0;
  }
  for (int i = 0; i < count && s_count < MAX_NOTICES; i++) {
    s_notices[s_count++] = notices[i];
  }
  s_pending = count > 0;
  if (!alert_window_is_open()) {
    notice_window_show_pending();
  }
}
