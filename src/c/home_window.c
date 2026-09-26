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
// its deck in short form ("Studio B · 4 Mid"), after "Last chance · " when
// tagged, and " · ✓ Reserved" when marked (§5). Items that don't fit above
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
    const char *tag = event_final_tag(e);
    bool reserved = (e->flags & EVENT_STARRED) && (e->flags & EVENT_RESERVATION) &&
                    (e->flags & EVENT_RESERVED);
    int height = 22 + (venue_line[0] || tag || reserved ? 16 : 0);
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
    // Room is kept for "✓ Reserved"; the venue gets the ellipsis.
    int mark_w = reserved ? reserved_width(false) + 12 : 0;
    int x = PAD;
    if (venue_line[0] || tag) {
      x = draw_tagged_line(ctx, tag, g_theme->port_accent, venue_line, g_theme->muted, small,
                           GRect(PAD, y + 20, width - 2 * PAD - mark_w, 18));
    }
    if (reserved) {
      if (x > PAD) {
        graphics_context_set_text_color(ctx, g_theme->muted);
        graphics_draw_text(ctx, " \xc2\xb7 ", small, GRect(x, y + 20, 12, 18),
                           GTextOverflowModeFill, GTextAlignmentLeft, NULL);
        x += 10;
      }
      draw_reserved(ctx, false, x, y + 20, g_theme->sea_accent);
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
  if (event_not_reserved(e->flags)) {
    graphics_context_set_text_color(ctx, g_theme->port_accent);
    graphics_draw_text(ctx, "Not reserved", fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                       GRect(PAD, y, width - 2 * PAD, 22), GTextOverflowModeTrailingEllipsis,
                       GTextAlignmentLeft, NULL);
    y += 20;
  }
  const char *tag = event_final_tag(e);
  if (tag) {
    graphics_context_set_text_color(ctx, g_theme->port_accent);
    graphics_draw_text(ctx, tag, fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD),
                       GRect(PAD, y, width - 2 * PAD, 18), GTextOverflowModeTrailingEllipsis,
                       GTextAlignmentLeft, NULL);
    y += 16;
  }
  return y + 4;
}

// ---- Days to sail (docs/DESIGN_V1_1.md §8.2) --------------------------------

// Before the cruise, Home counts the days itself from the sail date, so it
// stays right without the phone until the embark day starts at 04:00.
static bool sail_ahead(void) {
  return data_ready() && data_day()->kind == DAY_NONE && data_day()->index < 0 &&
         cruise_day_index(now_cruise()) < 0;
}

// Calendar days until the sail date: 1 the day before, 0 after midnight on it.
static int days_to_sail(void) {
  int32_t now = now_cruise();
  return now >= 0 ? 0 : (int)((-now + MINUTES_PER_DAY - 1) / MINUTES_PER_DAY);
}

static const char *const WEEKDAYS[] = {"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"};
static const char *const MONTHS[] = {"Jan", "Feb", "Mar", "Apr", "May", "Jun",
                                     "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};

// "Sat Mar 6 · Galveston", without the weekday when that doesn't fit.
static void fmt_sail_line(char *buf, size_t size, GFont font, int width) {
  // Month and day from days since 1970-01-01 (Howard Hinnant's civil_from_days).
  int32_t z = data_meta()->sail_days + 719468;
  int32_t era = (z >= 0 ? z : z - 146096) / 146097;
  int32_t doe = z - era * 146097;
  int32_t yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  int32_t doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  int32_t mp = (5 * doy + 2) / 153;
  int day = (int)(doy - (153 * mp + 2) / 5 + 1);
  int month = (int)(mp < 10 ? mp + 3 : mp - 9);
  int weekday = (int)((data_meta()->sail_days % 7 + 11) % 7);  // 1970-01-01 was a Thursday

  const char *port = data_meta()->sail_port;
  const char *sep = port[0] ? " \xc2\xb7 " : "";
  snprintf(buf, size, "%s %s %d%s%s", WEEKDAYS[weekday], MONTHS[month - 1], day, sep, port);
  int w = graphics_text_layout_get_content_size(buf, font, GRect(0, 0, 400, 30),
                                                GTextOverflowModeTrailingEllipsis,
                                                GTextAlignmentLeft).w;
  if (w > width) {
    snprintf(buf, size, "%s %d%s%s", MONTHS[month - 1], day, sep, port);
  }
}

static void draw_line(GContext *ctx, const char *text, GFont font, GColor color, int x, int y,
                      int w, int h) {
  graphics_context_set_text_color(ctx, color);
  graphics_draw_text(ctx, text, font, GRect(x, y, w, h), GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentLeft, NULL);
}

static void draw_sail_countdown(GContext *ctx, int width) {
  GFont small = fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD);
  GFont medium = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
  int w = width - 2 * PAD;
  int days = days_to_sail();
  int y = 2;

  draw_line(ctx, days > 1 ? "SAILS IN" : "SAILS", small, g_theme->muted, PAD, y, w, 18);
  y += 16;
  if (days > 1) {
    char count[8];
    snprintf(count, sizeof(count), "%d", days);
    GFont big = fonts_get_system_font(FONT_KEY_LECO_42_NUMBERS);
    int count_w = graphics_text_layout_get_content_size(count, big, GRect(0, 0, w, 50),
                                                        GTextOverflowModeFill,
                                                        GTextAlignmentLeft).w;
    draw_line(ctx, count, big, g_theme->text, PAD, y, count_w + 2, 50);
    draw_line(ctx, "days", medium, g_theme->text, PAD + count_w + 6, y + 31, w - count_w - 6, 22);
    y += 50;
  } else {
    draw_line(ctx, days == 1 ? "Tomorrow" : "Today", fonts_get_system_font(FONT_KEY_GOTHIC_28_BOLD),
              g_theme->text, PAD, y - 4, w, 34);
    y += 30;
  }

  char sail[48];
  fmt_sail_line(sail, sizeof(sail), medium, w);
  draw_line(ctx, sail, medium, g_theme->muted, PAD, y, w, 22);
  y += 20;
  if (data_meta()->ship_name[0]) {
    draw_line(ctx, data_meta()->ship_name, small, g_theme->muted, PAD, y, w, 18);
    y += 16;
  }
  draw_divider(ctx, y + 4, width);
  y += 8;

  // The last 3 days: the sync-before-departure reminder.
  if (days <= 3) {
    draw_line(ctx, "Sync before you leave", medium, g_theme->port_accent, PAD, y, w, 22);
    y += 20;
    draw_line(ctx, "Works offline after a full sync", small, g_theme->muted, PAD, y, w, 18);
    y += 16;
    const char *last_sync = data_my_info()->last_sync;
    if (last_sync[0]) {
      char line[40];
      snprintf(line, sizeof(line), "Last sync %s", last_sync);
      draw_line(ctx, line, small, g_theme->muted, PAD, y, w, 18);
      y += 16;
    }
    y += 2;
  }

  uint8_t starred = data_meta()->cruise_starred;
  if (starred == 0) {
    draw_line(ctx, "Nothing starred yet", small, g_theme->muted, PAD, y, w, 18);
  } else {
    char line[32];
    snprintf(line, sizeof(line), "%d starred so far", starred);
    draw_star(ctx, GPoint(PAD + 6, y + 9), g_theme->sea_accent);
    draw_line(ctx, line, small, g_theme->text, PAD + 16, y, w - 16, 18);
  }
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
  if (sail_ahead()) {
    draw_sail_countdown(ctx, b.size.w);
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
  y += draw_clash_count(ctx, PAD, y - 4, b.size.w - 2 * PAD, now);

  draw_divider(ctx, y, b.size.w);
  draw_next_items(ctx, y + 4, b.size.w, b.size.h, now, skip, countdown);
}

static void apply_style(void) {
  const Day *day = data_day();
  window_set_background_color(s_window, g_theme->bg);
  // The countdown names the ship and date itself, so the bar just says Home.
  bool counting = sail_ahead();
  top_bar_set(s_top_bar, day->kind == DAY_PORT ? BAND_PORT : BAND_SEA, BAND_LABEL,
              counting ? "Home"
              : data_ready() ? day->location
                             : (connection_service_peek_pebble_app_connection() ? "Loading..." : "No phone"));
  top_bar_set_right(s_top_bar, counting || !data_ready() ? "" : day->status, false, 0);
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
