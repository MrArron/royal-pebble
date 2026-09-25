#include "screens.h"
#include "data.h"
#include "ui.h"

// Home: port day before all-aboard shows the all-aboard countdown, then the
// next two starred events (topped up with the next items); otherwise the next
// starred event (or a featured one), then the next two items.

static Window *s_window;
static Layer *s_top_bar;
static Layer *s_body;

// The event shown large in the sea-day layout, or -1.
static int find_headline(int32_t now, bool *featured) {
  int count = data_event_count();
  for (int pass = 0; pass < 2; pass++) {
    uint8_t want = pass == 0 ? (EVENT_STARRED | EVENT_PERSONAL) : EVENT_FEATURED;
    if (pass == 1 && !data_meta()->show_featured) {
      break;
    }
    for (int i = 0; i < count; i++) {
      Event *e = data_event(i);
      if ((e->flags & want) && event_is_timed(e) && !event_is_past(e, now)) {
        *featured = pass == 1;
        return i;
      }
    }
  }
  return -1;
}

#define NEXT_ITEMS 2

static bool is_upcoming(const Event *e, int32_t now) { return event_is_timed(e) && e->start >= now; }

// Picks the next NEXT_ITEMS upcoming events after `skip`, in time order. With
// `starred_first`, starred events and personal entries of the day come first
// and other events only fill the rest.
static int pick_next_items(int *out, int32_t now, int skip, bool starred_first) {
  int n = 0;
  int count = data_event_count();
  if (starred_first) {
    for (int i = 0; i < count && n < NEXT_ITEMS; i++) {
      Event *e = data_event(i);
      if (i != skip && is_upcoming(e, now) && (e->flags & (EVENT_STARRED | EVENT_PERSONAL))) {
        out[n++] = i;
      }
    }
  }
  for (int i = 0; i < count && n < NEXT_ITEMS; i++) {
    bool taken = i == skip;
    for (int j = 0; j < n; j++) {
      taken = taken || out[j] == i;
    }
    if (!taken && is_upcoming(data_event(i), now)) {
      // Events are sorted by start, so keep `out` in time order.
      int pos = n++;
      while (pos > 0 && out[pos - 1] > i) {
        out[pos] = out[pos - 1];
        pos--;
      }
      out[pos] = i;
    }
  }
  return n;
}

// Each item: "1:00p Title" (starred ones with a star), then the venue with
// its deck in short form ("Studio B · 4 Mid"). Items that don't fit above
// `bottom` are left out.
static void draw_next_items(GContext *ctx, int y, int width, int bottom, int32_t now, int skip,
                            bool starred_first) {
  GFont bold = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
  GFont small = fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD);
  int items[NEXT_ITEMS];
  int shown = pick_next_items(items, now, skip, starred_first);
  for (int k = 0; k < shown; k++) {
    Event *e = data_event(items[k]);
    char venue_line[VENUE_LEN + 20];
    fmt_venue_where(venue_line, sizeof(venue_line), e->venue, &e->where);
    int height = 22 + (venue_line[0] ? 16 : 0);
    if (y + height > bottom) {
      break;
    }
    char time_buf[8];
    fmt_clock(time_buf, sizeof(time_buf), e->start);
    graphics_context_set_text_color(ctx, g_theme->text);
    int time_w = graphics_text_layout_get_content_size(time_buf, bold, GRect(0, 0, width, 22),
                                                       GTextOverflowModeTrailingEllipsis,
                                                       GTextAlignmentLeft).w;
    graphics_draw_text(ctx, time_buf, bold, GRect(PAD, y, time_w + 2, 22),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
    int text_x = PAD + time_w + 4;
    if (e->flags & EVENT_STARRED) {
      draw_star(ctx, GPoint(text_x + 6, y + 12), g_theme->sea_accent);
      text_x += 15;
    }
    graphics_draw_text(ctx, e->title, bold, GRect(text_x, y, width - text_x - PAD, 22),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
    if (venue_line[0]) {
      graphics_context_set_text_color(ctx, g_theme->muted);
      graphics_draw_text(ctx, venue_line, small, GRect(PAD, y + 20, width - 2 * PAD, 18),
                         GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
    }
    y += height + 2;
  }
  if (shown == 0) {
    graphics_context_set_text_color(ctx, g_theme->muted);
    graphics_draw_text(ctx, "Nothing else today", fonts_get_system_font(FONT_KEY_GOTHIC_18),
                       GRect(PAD, y, width - 2 * PAD, 22), GTextOverflowModeTrailingEllipsis,
                       GTextAlignmentLeft, NULL);
  }
}

static int draw_countdown(GContext *ctx, int y, int width, int32_t now) {
  const Day *day = data_day();
  int left = (int)(day->all_aboard - now);

  graphics_context_set_text_color(ctx, g_theme->port_accent);
  graphics_draw_text(ctx, "ALL ABOARD IN", fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                     GRect(PAD, y, width - 2 * PAD, 22), GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentLeft, NULL);
  y += 18;

  char count_buf[16];
  snprintf(count_buf, sizeof(count_buf), "%d:%02d", left / 60, left % 60);
  graphics_context_set_text_color(ctx, g_theme->text);
  graphics_draw_text(ctx, count_buf, fonts_get_system_font(FONT_KEY_BITHAM_42_BOLD),
                     GRect(PAD, y, width - 2 * PAD, 50), GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentLeft, NULL);
  y += 50;

  char ship_buf[8], local_buf[8], both[40];
  fmt_clock(ship_buf, sizeof(ship_buf), day->all_aboard);
  fmt_clock(local_buf, sizeof(local_buf), day->all_aboard + day->local_offset);
  snprintf(both, sizeof(both), "%s ship \xc2\xb7 %s local", ship_buf, local_buf);
  graphics_context_set_text_color(ctx, g_theme->muted);
  graphics_draw_text(ctx, both, fonts_get_system_font(FONT_KEY_GOTHIC_18),
                     GRect(PAD, y, width - 2 * PAD, 22), GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentLeft, NULL);
  return y + 26;
}

static int draw_headline(GContext *ctx, int y, int width, int32_t now, int index, bool featured) {
  GFont label_font = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
  if (index < 0) {
    graphics_context_set_text_color(ctx, g_theme->muted);
    graphics_draw_text(ctx, "Nothing starred today", fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD),
                       GRect(PAD, y, width - 2 * PAD, 30), GTextOverflowModeTrailingEllipsis,
                       GTextAlignmentLeft, NULL);
    return y + 36;
  }

  Event *e = data_event(index);
  char label[40];
  const char *kind = featured ? "FEATURED" : "NEXT";
  if (event_in_progress(e, now)) {
    char end_buf[8];
    fmt_clock(end_buf, sizeof(end_buf), event_end(e));
    snprintf(label, sizeof(label), "NOW \xc2\xb7 UNTIL %s", end_buf);
  } else {
    int wait = (int)(e->start - now);
    if (wait < 60) {
      snprintf(label, sizeof(label), "%s \xc2\xb7 IN %d MIN", kind, wait);
    } else {
      snprintf(label, sizeof(label), "%s \xc2\xb7 IN %d H %d MIN", kind, wait / 60, wait % 60);
    }
  }

  int label_x = PAD;
  if (!featured) {
    draw_star(ctx, GPoint(PAD + 6, y + 12), g_theme->sea_accent);
    label_x += 16;
  }
  graphics_context_set_text_color(ctx, g_theme->sea_accent);
  graphics_draw_text(ctx, label, label_font, GRect(label_x, y, width - label_x - PAD, 22),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  y += 22;

  GFont title_font = fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD);
  GRect title_box = GRect(PAD, y, width - 2 * PAD, 56);
  GSize title_size = graphics_text_layout_get_content_size(
      e->title, title_font, title_box, GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft);
  graphics_context_set_text_color(ctx, g_theme->text);
  graphics_draw_text(ctx, e->title, title_font, title_box, GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentLeft, NULL);
  y += title_size.h + 4;

  // "12:00p · On Air" (a long venue wraps to a second line), then the deck in
  // short form: "Deck 4 Aft · ↓2".
  char time_buf[8], detail[48];
  fmt_clock(time_buf, sizeof(time_buf), e->start);
  if (e->venue[0]) {
    snprintf(detail, sizeof(detail), "%s \xc2\xb7 %s", time_buf, e->venue);
  } else {
    snprintf(detail, sizeof(detail), "%s", time_buf);
  }
  GFont detail_font = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
  GRect detail_box = GRect(PAD, y, width - 2 * PAD, 40);
  GSize detail_size = graphics_text_layout_get_content_size(
      detail, detail_font, detail_box, GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft);
  graphics_context_set_text_color(ctx, g_theme->muted);
  graphics_draw_text(ctx, detail, detail_font, detail_box, GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentLeft, NULL);
  y += detail_size.h + 2;
  y += draw_where_short(ctx, false, g_theme->muted, PAD, y, width - 2 * PAD, &e->where);
  return y + 4;
}

// Big muted message with a smaller line under it.
static void draw_message(GContext *ctx, int width, const char *title, const char *hint) {
  graphics_context_set_text_color(ctx, g_theme->text);
  graphics_draw_text(ctx, title, fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD),
                     GRect(PAD, 10, width - 2 * PAD, 60), GTextOverflowModeWordWrap,
                     GTextAlignmentLeft, NULL);
  graphics_context_set_text_color(ctx, g_theme->muted);
  graphics_draw_text(ctx, hint, fonts_get_system_font(FONT_KEY_GOTHIC_18),
                     GRect(PAD, 44, width - 2 * PAD, 100), GTextOverflowModeWordWrap,
                     GTextAlignmentLeft, NULL);
}

static void body_update_proc(Layer *layer, GContext *ctx) {
  GRect b = layer_get_bounds(layer);
  const Day *day = data_day();
  if (!data_ready()) {
    bool connected = connection_service_peek_pebble_app_connection();
    draw_message(ctx, b.size.w, connected ? "Loading..." : "Phone not connected",
                 connected ? "Getting today's schedule from your phone."
                           : "Royal Pebble needs your phone nearby to load the schedule.");
    return;
  }
  if (cruise_day_index(now_cruise()) > day->index) {
    // A new day started while the phone was away; don't show yesterday.
    draw_message(ctx, b.size.w, "Connect your phone",
                 "Today's schedule comes from your phone. Alerts and reminders still work.");
    return;
  }
  if (day->kind == DAY_NONE) {
    draw_message(ctx, b.size.w, "No cruise today", day->status);
    return;
  }

  int32_t now = now_cruise();
  int y = 4;
  int skip = -1;
  bool countdown = day->kind == DAY_PORT && day->all_aboard != NO_TIME && day->all_aboard > now;

  if (countdown) {
    y = draw_countdown(ctx, y, b.size.w, now);
  } else {
    bool featured = false;
    skip = find_headline(now, &featured);
    y = draw_headline(ctx, y, b.size.w, now, skip, featured);
  }

  draw_divider(ctx, y, b.size.w);
  draw_next_items(ctx, y + 4, b.size.w, b.size.h, now, skip, countdown);
}

static void apply_style(void) {
  const Day *day = data_day();
  window_set_background_color(s_window, g_theme->bg);
  top_bar_set(s_top_bar, day->kind == DAY_PORT ? BAND_PORT : BAND_SEA, BAND_LABEL,
              data_ready() ? day->location
                           : (connection_service_peek_pebble_app_connection() ? "Loading..." : "No phone"));
}

static void up_click(ClickRecognizerRef recognizer, void *context) { info_window_push(); }
static void down_click(ClickRecognizerRef recognizer, void *context) { today_window_push(); }
static void up_long_click(ClickRecognizerRef recognizer, void *context) { demo_next(); }

static void click_config(void *context) {
  window_single_click_subscribe(BUTTON_ID_UP, up_click);
  window_single_click_subscribe(BUTTON_ID_DOWN, down_click);
  window_long_click_subscribe(BUTTON_ID_UP, 700, up_long_click, NULL);
}

static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect b = layer_get_bounds(root);
  s_top_bar = top_bar_create(GRect(0, 0, b.size.w, TOP_BAR_HEIGHT), BAND_SEA, BAND_LABEL, "");
  layer_add_child(root, s_top_bar);
  s_body = layer_create(GRect(0, TOP_BAR_HEIGHT, b.size.w, b.size.h - TOP_BAR_HEIGHT));
  layer_set_update_proc(s_body, body_update_proc);
  layer_add_child(root, s_body);
  apply_style();
}

static void window_unload(Window *window) {
  layer_destroy(s_body);
  top_bar_destroy(s_top_bar);
  s_body = NULL;
  s_top_bar = NULL;
}

void home_window_refresh(void) {
  if (s_top_bar) {
    apply_style();
    layer_mark_dirty(s_body);
  }
}

void home_window_push(void) {
  s_window = window_create();
  window_set_click_config_provider(s_window, click_config);
  window_set_window_handlers(s_window, (WindowHandlers){
    .load = window_load,
    .unload = window_unload,
  });
  window_stack_push(s_window, true);
}

void home_window_destroy(void) { window_destroy(s_window); }

bool home_window_is_top(void) { return s_window && window_stack_get_top_window() == s_window; }
