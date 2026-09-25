#include "screens.h"
#include "data.h"
#include "ui.h"

// Morning summary (docs/DESIGN_V1_1.md §8.1, mockups in docs/mockups/phase2):
// one card with the day, its port times and what's starred. It replaces Home
// on the first open by the user of each watch day; from 20:00 the first open
// shows tomorrow's card instead. Alert launches don't count. My info reopens
// it. Everything on it is stored with the slice, so it works without the phone.

// The last card shown by itself: {sail days, watch day * 2 (+ 1 for tomorrow's
// card)}.
#define KEY_SUMMARY_SEEN 6
#define EVENING (20 * 60)

typedef struct {
  int32_t sail_days;
  int32_t stamp;
} SummarySeen;

static Window *s_window;
static Layer *s_top_bar;
static Layer *s_body;
static bool s_tomorrow;
static bool s_from_home;
static bool s_user_open;

// No strcmp on the watch: compares up to the NUL by hand.
static bool text_is(const char *a, const char *b) {
  for (; *a && *a == *b; a++, b++) {
  }
  return *a == *b;
}

// The slice is today's and today is part of the cruise.
static bool today_known(void) {
  return data_ready() && data_day()->kind != DAY_NONE &&
         cruise_day_index(now_cruise()) == data_day()->index;
}

static bool is_evening(void) {
  return now_cruise() >= data_day()->index * MINUTES_PER_DAY + EVENING;
}

bool summary_available(void) { return today_known(); }

bool summary_shows_tomorrow(void) {
  return today_known() && is_evening() && data_tomorrow()->kind != DAY_NONE;
}

void summary_set_user_open(bool user_open) { s_user_open = user_open; }

void summary_check(void) {
  if (!s_user_open || !today_known() || !home_window_is_top()) {
    return;
  }
  bool tomorrow = is_evening();
  if (tomorrow && data_tomorrow()->kind == DAY_NONE) {
    return;  // the last evening: nothing to show
  }
  int32_t want = data_day()->index * 2 + (tomorrow ? 1 : 0);
  SummarySeen seen = {.sail_days = 0, .stamp = INT32_MIN};
  if (persist_get_size(KEY_SUMMARY_SEEN) == (int)sizeof(seen)) {
    persist_read_data(KEY_SUMMARY_SEEN, &seen, sizeof(seen));
  }
  s_user_open = false;
  if (seen.sail_days == data_meta()->sail_days && seen.stamp >= want) {
    return;
  }
  seen = (SummarySeen){.sail_days = data_meta()->sail_days, .stamp = want};
  persist_write_data(KEY_SUMMARY_SEEN, &seen, sizeof(seen));
  summary_window_push(tomorrow, true);
}

// ---- Drawing ---------------------------------------------------------------

// The day a card is about: today, or tomorrow from the phone's tomorrow block.
typedef struct {
  int32_t index;
  DayKind kind;
  const char *status;
  const char *location;
  int32_t arrive;
  int32_t depart;
  int32_t all_aboard;
  int16_t local_offset;  // today only; tomorrow's isn't sent
} CardDay;

static CardDay card_day(void) {
  const Day *d = data_day();
  if (!s_tomorrow) {
    return (CardDay){d->index, d->kind, d->status, d->location, d->arrive, d->depart,
                     d->all_aboard, d->local_offset};
  }
  const Tomorrow *t = data_tomorrow();
  return (CardDay){d->index + 1, t->kind, t->status, t->location, t->arrive, t->depart,
                   t->all_aboard, 0};
}

// Draws one line and returns the y below it.
static int line(GContext *ctx, const char *text, const char *font_key, GColor color, int x, int y,
                int w, int height) {
  graphics_context_set_text_color(ctx, color);
  graphics_draw_text(ctx, text, fonts_get_system_font(font_key), GRect(x, y, w, height),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  return y + height;
}

// "DAY 4 · PORT DAY", "DAY 1 · EMBARK", "LAST DAY · DEBARK", "DAY 2 · SEA DAY".
static void fmt_day_label(char *buf, size_t size, const CardDay *day) {
  if (text_is(day->status, "DEBARK")) {
    snprintf(buf, size, "LAST DAY \xc2\xb7 DEBARK");
  } else if (text_is(day->status, "EMBARK")) {
    snprintf(buf, size, "DAY %d \xc2\xb7 EMBARK", (int)day->index + 1);
  } else {
    snprintf(buf, size, "DAY %d \xc2\xb7 %s", (int)day->index + 1,
             day->kind == DAY_SEA ? "SEA DAY" : "PORT DAY");
  }
}

// Port times in ship time: "Docked 7:30a - 5:30p", "Sails 4:00p", "Arrive
// 6:00a". Empty when there are none.
static void fmt_port_times(char *buf, size_t size, const CardDay *day) {
  char a[8], d[8];
  fmt_clock(a, sizeof(a), day->arrive);
  fmt_clock(d, sizeof(d), day->depart);
  bool has_a = day->arrive != NO_TIME;
  bool has_d = day->depart != NO_TIME;
  buf[0] = '\0';
  if (text_is(day->status, "EMBARK") || (has_d && !has_a)) {
    if (has_d) {
      snprintf(buf, size, "%s %s", text_is(day->status, "EMBARK") ? "Sails" : "Departs", d);
    }
  } else if (text_is(day->status, "DEBARK") || (has_a && !has_d)) {
    if (has_a) {
      snprintf(buf, size, "Arrive %s", a);
    }
  } else if (has_a && has_d) {
    snprintf(buf, size, "%s %s - %s", text_is(day->status, "DOCKED") ? "Docked" : "In port", a, d);
  }
}

// The top half: label, place, port times, port time offset and all-aboard.
static int draw_day(GContext *ctx, const CardDay *day, int y, int w) {
  char buf[48];
  fmt_day_label(buf, sizeof(buf), day);
  y = line(ctx, buf, FONT_KEY_GOTHIC_14_BOLD, g_theme->muted, PAD, y, w, 16);
  y = line(ctx, day->kind == DAY_SEA ? "At sea" : day->location, FONT_KEY_GOTHIC_24_BOLD,
           g_theme->text, PAD, y - 4, w, 30);
  if (day->kind == DAY_SEA) {
    return y;
  }
  fmt_port_times(buf, sizeof(buf), day);
  if (buf[0]) {
    y = line(ctx, buf, FONT_KEY_GOTHIC_18_BOLD, g_theme->text, PAD, y - 4, w, 22);
  }
  if (day->local_offset != 0) {
    char amount[16];
    int off = day->local_offset;
    fmt_duration(amount, sizeof(amount), off < 0 ? -off : off);
    snprintf(buf, sizeof(buf), "Port time %c%s", off < 0 ? '-' : '+', amount);
    y = line(ctx, buf, FONT_KEY_GOTHIC_14_BOLD, g_theme->muted, PAD, y - 2, w, 16);
  }
  if (day->all_aboard != NO_TIME) {
    char t[8];
    fmt_clock(t, sizeof(t), day->all_aboard);
    snprintf(buf, sizeof(buf), "All aboard %s", t);
    y = line(ctx, buf, FONT_KEY_GOTHIC_18_BOLD, g_theme->port_accent, PAD, y - 2, w, 22);
  }
  return y;
}

// "★ 4 starred today", or "Nothing starred yet" and the featured count.
static int draw_count(GContext *ctx, int starred, int featured, const char *when, int y, int w) {
  char buf[40];
  if (starred > 0) {
    draw_star(ctx, GPoint(PAD + 6, y + 12), g_theme->sea_accent);
    snprintf(buf, sizeof(buf), "%d starred %s", starred, when);
    return line(ctx, buf, FONT_KEY_GOTHIC_18_BOLD, g_theme->text, PAD + 16, y, w - 16, 22);
  }
  y = line(ctx, "Nothing starred yet", FONT_KEY_GOTHIC_18_BOLD, g_theme->text, PAD, y, w, 22);
  if (featured > 0 && data_meta()->show_featured) {
    snprintf(buf, sizeof(buf), "%d featured %s", featured, when);
    y = line(ctx, buf, FONT_KEY_GOTHIC_14_BOLD, g_theme->muted, PAD, y - 2, w, 16);
  }
  return y;
}

static bool is_starred(const Event *e) { return (e->flags & (EVENT_STARRED | EVENT_PERSONAL)) != 0; }

// Today: the count, then the first starred item still to come ("First
// 10:00a Zumba Class"; "Next" once one has finished). Sea days have room for
// two, each with its venue line.
static void draw_today_plan(GContext *ctx, int y, int w, int bottom, bool sea) {
  int32_t now = now_cruise();
  int starred = 0, featured = 0, before = 0;
  int items[2];
  int n = 0;
  for (int i = 0; i < data_event_count(); i++) {
    Event *e = data_event(i);
    featured += (e->flags & EVENT_FEATURED) != 0;
    if (!is_starred(e)) {
      continue;
    }
    starred++;
    if (!event_is_timed(e)) {
      continue;
    }
    if (event_is_finished(e, now)) {
      before++;
    } else if (n < (sea ? 2 : 1)) {
      items[n++] = i;
    }
  }
  y = draw_count(ctx, starred, featured, "today", y, w);
  char time_buf[8], buf[TITLE_LEN + 16];
  for (int k = 0; k < n; k++) {
    Event *e = data_event(items[k]);
    fmt_clock(time_buf, sizeof(time_buf), e->start);
    if (!sea) {
      snprintf(buf, sizeof(buf), "%s %s %s", before ? "Next" : "First", time_buf, e->title);
      y = line(ctx, buf, FONT_KEY_GOTHIC_14_BOLD, g_theme->muted, PAD, y - 2, w, 16);
      break;
    }
    char venue_line[VENUE_LEN + 20];
    fmt_venue_where(venue_line, sizeof(venue_line), e->venue, &e->where);
    int height = 22 + (venue_line[0] ? 16 : 0);
    if (y + height > bottom) {
      return;
    }
    snprintf(buf, sizeof(buf), "%s %s", time_buf, e->title);
    y = line(ctx, buf, FONT_KEY_GOTHIC_18_BOLD, g_theme->text, PAD, y + 2, w, 22);
    if (venue_line[0]) {
      y = line(ctx, venue_line, FONT_KEY_GOTHIC_14_BOLD, g_theme->muted, PAD, y - 3, w, 16);
    }
  }
  // "1 clash" (item 7), when there's room.
  if (y + 14 <= bottom) {
    draw_clash_count(ctx, PAD, y - 2, w, now);
  }
}

// Tomorrow: the count, the first starred item and a show to catch.
static void draw_tomorrow_plan(GContext *ctx, int y, int w) {
  const Tomorrow *t = data_tomorrow();
  y = draw_count(ctx, t->starred, t->featured, "tomorrow", y, w);
  char buf[SHORT_TITLE_LEN + 24];
  if (t->starred > 0 && t->first_start != NO_TIME) {
    char time_buf[8];
    fmt_clock(time_buf, sizeof(time_buf), t->first_start);
    snprintf(buf, sizeof(buf), "First %s %s", time_buf, t->first);
    y = line(ctx, buf, FONT_KEY_GOTHIC_14_BOLD, g_theme->muted, PAD, y - 2, w, 16);
  }
  if (t->last_kind != FINAL_NONE && t->last[0]) {
    snprintf(buf, sizeof(buf), "%s: %s", t->last_kind == FINAL_ONLY_SHOW ? "Only show" : "Last chance",
             t->last);
    line(ctx, buf, FONT_KEY_GOTHIC_14_BOLD, g_theme->port_accent, PAD, y, w, 16);
  }
}

static void body_update_proc(Layer *layer, GContext *ctx) {
  GRect b = layer_get_bounds(layer);
  int w = b.size.w - 2 * PAD;
  if (!data_ready()) {
    return;
  }
  CardDay day = card_day();
  int y = draw_day(ctx, &day, 2, w);
  draw_divider(ctx, y + 4, b.size.w);
  y += 8;
  if (s_tomorrow) {
    draw_tomorrow_plan(ctx, y, w);
  } else {
    draw_today_plan(ctx, y, w, b.size.h, day.kind == DAY_SEA);
  }
}

// ---- Window ----------------------------------------------------------------

static void apply_style(void) {
  CardDay day = card_day();
  window_set_background_color(s_window, g_theme->bg);
  top_bar_set(s_top_bar, day.kind == DAY_SEA ? BAND_SEA : BAND_PORT, BAND_LABEL,
              s_tomorrow ? "Tomorrow" : data_day()->location);
  if (s_tomorrow) {
    // Today's status would be wrong on a card about tomorrow.
    top_bar_set_right(s_top_bar, "", false, 0);
  }
}

static void close_then(void (*next)(void)) {
  window_stack_remove(s_window, next == NULL);
  if (next) {
    next();
  }
}

// Any button leaves. Opened in place of Home, Up and Down go on to My info and
// Today as they would from Home.
static void select_click(ClickRecognizerRef recognizer, void *context) { close_then(NULL); }
static void up_click(ClickRecognizerRef recognizer, void *context) {
  close_then(s_from_home ? info_window_push : NULL);
}
static void down_click(ClickRecognizerRef recognizer, void *context) {
  close_then(s_from_home ? today_window_push : NULL);
}

static void click_config(void *context) {
  window_single_click_subscribe(BUTTON_ID_SELECT, select_click);
  window_single_click_subscribe(BUTTON_ID_UP, up_click);
  window_single_click_subscribe(BUTTON_ID_DOWN, down_click);
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
  window_destroy(window);
  s_window = NULL;
}

void summary_window_refresh(void) {
  if (s_body) {
    apply_style();
    layer_mark_dirty(s_body);
  }
}

void summary_window_push(bool tomorrow, bool from_home) {
  if (s_window) {
    return;
  }
  s_tomorrow = tomorrow;
  s_from_home = from_home;
  s_window = window_create();
  window_set_click_config_provider(s_window, click_config);
  window_set_window_handlers(s_window, (WindowHandlers){
    .load = window_load,
    .unload = window_unload,
  });
  // In place of Home: no slide-in, so it reads as the first screen.
  window_stack_push(s_window, !from_home);
}
