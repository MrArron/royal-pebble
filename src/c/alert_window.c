#include "screens.h"
#include "data.h"
#include "onboard.h"
#include "ui.h"
#include "usage.h"

// Shown when an alert fires: the top bar says "Reminder" or "All aboard",
// then "IN 15 MIN", what it's about and, for reminders, where it is
// (docs/DESIGN.md §7.2). A reminder whose event is in the day's data shows
// the event's details body with the "From" directions under the where lines
// (docs/DESIGN.md §8.1). The evening's "To reserve" alert lists
// tomorrow's starred events that still need a reservation (§8.3). A booked
// order's reminder counts down to its meeting time (§8.1), an arrive-early
// event's to its arrive-by time (docs/DESIGN.md §8.1).
// Opened by a wakeup (app closed) it is the only
// screen the user asked for, so Back leaves the app; Select opens Home.

static Window *s_window;
static Layer *s_top_bar;
static ScrollPage s_page;  // scrolls when the alert doesn't fit
#if defined(PBL_ROUND)
static Layer *s_edge;  // the whole screen, over the page: the time-ashore arc
#endif
static bool s_from_wakeup;

// A copy of the alert being shown. The phone sends a fresh plan as soon as the
// app starts, and that plan no longer contains an alert that has just fired.
static Alarm s_alarm;
static int s_count;  // alerts sharing this minute

// To reserve: the phone sends one alert per event (at most 5), all in the
// same minute, and each carries how many there are in all (`extra`).
#define MAX_TO_RESERVE 5
typedef struct {
  int32_t start;
  char title[ALARM_TITLE_LEN];
  char venue[ALARM_VENUE_LEN];
} ReserveItem;
// On the heap while an alert is open, not static: the app's code, data and
// static buffers must stay under 64 KB.
static ReserveItem *s_reserve;
static int s_reserve_count;

static const char *top_label(uint8_t kind) {
  return kind == ALARM_ALL_ABOARD ? "All aboard" : kind == ALARM_TO_RESERVE ? "To reserve" : "Reminder";
}

// "From" directions under a divider (the phone decided which): "From Royal
// Theater:" over "↓1 deck · Fore → Mid", or "Same venue", or "Same area ·
// Deck 5". Returns the y below them.
static int draw_from(GContext *ctx, const Alarm *a, FromKind from, int y, int w) {
  GRect b = layer_get_bounds(s_page.content);
  draw_divider(ctx, y, b.size.w);
  y += 4;
  GFont font = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
  if (from == FROM_ROUTE) {
    char label[32];
    snprintf(label, sizeof(label), "From %s:", a->from_venue);
    graphics_context_set_text_color(ctx, g_theme->muted);
    graphics_draw_text(ctx, label, fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD),
                       GRect(PAD, y, w, 16), GTextOverflowModeTrailingEllipsis,
                       TEXT_ALIGN, NULL);
    y += 16;
    return y + draw_route_line(ctx, g_theme->text, PAD, y, w, &a->where, alarm_from_pos(a));
  }
  char text[32];
  if (from == FROM_SAME_VENUE) {
    snprintf(text, sizeof(text), "Same venue");
  } else {
    snprintf(text, sizeof(text), "Same area \xc2\xb7 Deck %d", a->where.deck);
  }
  graphics_context_set_text_color(ctx, g_theme->text);
  graphics_draw_text(ctx, text, font, GRect(PAD, y, w, 22), GTextOverflowModeTrailingEllipsis,
                     TEXT_ALIGN, NULL);
  return y + 22;
}

// "TOMORROW", then each event as "7:00p Hairspray" over its venue, then
// "+ 2 more" for those the phone didn't send. Returns the y below it.
static int draw_to_reserve(GContext *ctx, GRect b) {
  int w = b.size.w - 2 * PAD;
  int y = 2;
  graphics_context_set_text_color(ctx, g_theme->sea_accent);
  graphics_draw_text(ctx, "TOMORROW", fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                     GRect(PAD, y, w, 22), GTextOverflowModeTrailingEllipsis, TEXT_ALIGN, NULL);
  y += 24;
  int total = s_alarm.extra > s_reserve_count ? s_alarm.extra : s_reserve_count;
  int shown = 0;
  for (int i = 0; i < s_reserve_count; i++) {
    const ReserveItem *r = &s_reserve[i];
    char buf[ALARM_TITLE_LEN + 12];
    if (r->start != NO_TIME) {
      char time_buf[8];
      fmt_clock(time_buf, sizeof(time_buf), r->start);
      snprintf(buf, sizeof(buf), "%s %s", time_buf, r->title);
    } else {
      snprintf(buf, sizeof(buf), "%s", r->title);
    }
    graphics_context_set_text_color(ctx, g_theme->text);
    graphics_draw_text(ctx, buf, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                       GRect(PAD, y, w, 22), GTextOverflowModeTrailingEllipsis,
                       TEXT_ALIGN, NULL);
    y += 22;
    if (r->venue[0]) {
      graphics_context_set_text_color(ctx, g_theme->muted);
      graphics_draw_text(ctx, r->venue, fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD),
                         GRect(PAD, y - 2, w, 18), GTextOverflowModeTrailingEllipsis,
                         TEXT_ALIGN, NULL);
      y += 18;
    }
    shown++;
  }
  if (total > shown) {
    char more[24];
    snprintf(more, sizeof(more), "+ %d more", total - shown);
    graphics_context_set_text_color(ctx, g_theme->port_accent);
    graphics_draw_text(ctx, more, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                       GRect(PAD, y, w, 22), GTextOverflowModeTrailingEllipsis,
                       TEXT_ALIGN, NULL);
    y += 22;
  }
  return y;
}

// A booked order's reminder below its title, when its event isn't in the
// day's data (see update_proc): "Meet 8:45a", "Starts 9:00a ·
// ends 11:30a", "Ashore" (or just "9:00a · Ashore" without a meeting time),
// then "✓ Booked · 2 guests" under a divider. Returns the y below it.
static int draw_booked(GContext *ctx, const Alarm *a, int y, int w) {
  GFont f18 = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
  GFont f14 = fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD);
  char start_buf[8], line[48];
  fmt_clock(start_buf, sizeof(start_buf), a->ref);
  if (a->booked.meet_before) {
    char meet_buf[8];
    fmt_clock(meet_buf, sizeof(meet_buf), a->ref - a->booked.meet_before);
    snprintf(line, sizeof(line), "Meet %s", meet_buf);
    graphics_context_set_text_color(ctx, g_theme->text);
    graphics_draw_text(ctx, line, f18, GRect(PAD, y, w, 22), GTextOverflowModeTrailingEllipsis,
                       TEXT_ALIGN, NULL);
    y += 22;
    if (a->extra > 0) {
      char end_buf[8];
      fmt_clock(end_buf, sizeof(end_buf), a->ref + a->extra);
      snprintf(line, sizeof(line), "Starts %s \xc2\xb7 ends %s", start_buf, end_buf);
    } else {
      snprintf(line, sizeof(line), "Starts %s", start_buf);
    }
    graphics_context_set_text_color(ctx, g_theme->muted);
    graphics_draw_text(ctx, line, f14, GRect(PAD, y - 2, w, 18), GTextOverflowModeTrailingEllipsis,
                       TEXT_ALIGN, NULL);
    y += 16;
    graphics_context_set_text_color(ctx, g_theme->port_accent);
    graphics_draw_text(ctx, "Ashore", f18, GRect(PAD, y, w, 22), GTextOverflowModeTrailingEllipsis,
                       TEXT_ALIGN, NULL);
    y += 22;
  } else {
    snprintf(line, sizeof(line), "%s \xc2\xb7 Ashore", start_buf);
    graphics_context_set_text_color(ctx, g_theme->muted);
    graphics_draw_text(ctx, line, f18, GRect(PAD, y, w, 22), GTextOverflowModeTrailingEllipsis,
                       TEXT_ALIGN, NULL);
    y += 22;
  }
  GRect b = layer_get_bounds(s_page.content);
  draw_divider(ctx, y + 3, b.size.w);
  y += 6;
  // "✓ Booked · 2 guests" in one run (both parts are sea accent, Gothic 14 bold).
  snprintf(line, sizeof(line), a->booked.guests ? "Booked \xc2\xb7 %d guest%s" : "Booked",
           a->booked.guests, a->booked.guests == 1 ? "" : "s");
  draw_checked(ctx, line, false, CHECKED_X(b.size.w), y, g_theme->sea_accent);
  return y + 18;
}

// "From" directions in the details body (details_draw_event's after_where),
// closed by a second divider so the times below read as the event's again.
static int draw_from_in_details(GContext *ctx, int y) {
  GRect b = layer_get_bounds(s_page.content);
  y = draw_from(ctx, &s_alarm, alarm_from_kind(&s_alarm), y + 3, b.size.w - 2 * PAD);
  draw_divider(ctx, y + 3, b.size.w);
  return y + 6;
}

// "+ 2 more" when other alerts share this minute, then fits the page.
static void draw_more(GContext *ctx, int count, int y, int w) {
  if (count > 1) {
    char more[24];
    snprintf(more, sizeof(more), "+ %d more", count - 1);
    graphics_context_set_text_color(ctx, g_theme->text);
    graphics_draw_text(ctx, more, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                       GRect(PAD, y, w, 22), GTextOverflowModeTrailingEllipsis,
                       TEXT_ALIGN, NULL);
    y += 22;
  }
  scroll_page_fit(&s_page, y);
}

#if defined(PBL_ROUND)
// Round 2 (docs/mockups/round/AlertAllAboard): an all-aboard alert for today's
// all-aboard time shows Home's countdown and its time-ashore arc.
static bool shows_arc(void) {
  return s_alarm.kind == ALARM_ALL_ABOARD && data_ready() && data_day()->all_aboard == s_alarm.ref &&
         s_alarm.ref > now_cruise();
}

static void edge_update_proc(Layer *layer, GContext *ctx) {
  if (shows_arc()) {
    draw_ashore_arc(ctx, now_cruise());
    graphics_context_set_text_color(ctx, g_theme->sea_accent);
    graphics_draw_text(ctx, "Select: Home", fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD),
                       GRect(PAD, 202, 260 - 2 * PAD, 18), GTextOverflowModeTrailingEllipsis,
                       TEXT_ALIGN, NULL);
  }
}
#endif

static void update_proc(Layer *layer, GContext *ctx) {
  GRect b = layer_get_bounds(layer);
#if defined(PBL_ROUND)
  if (shows_arc()) {
    scroll_page_fit(&s_page, draw_countdown(ctx, 2, b.size.w, now_cruise()));
    return;
  }
#endif
  if (s_alarm.kind == ALARM_TO_RESERVE) {
    scroll_page_fit(&s_page, draw_to_reserve(ctx, b));
    return;
  }
  Alarm *a = &s_alarm;
  int count = s_count;
  bool all_aboard = a->kind == ALARM_ALL_ABOARD;
  bool booked = !all_aboard && (a->from & ALARM_BOOKED);
  // A booked order counts down to its meeting time when it has one, an event
  // that asks to come early to its arrive-by time (docs/DESIGN.md §8.1).
  int before = booked ? a->booked.meet_before : all_aboard ? 0 : a->early;
  int left = (int)(a->ref - before - now_cruise());
  int w = b.size.w - 2 * PAD;
  int y = 2;

  // "MEET IN 15 MIN" (booked, or Ashore) or "ARRIVE IN 15 MIN" then.
  const char *meet = !before ? "" : booked || where_ashore(&a->where) ? "MEET " : "ARRIVE ";
  char when[24];
  if (left <= 0) {
    snprintf(when, sizeof(when), "%s%s", meet, meet[0] || all_aboard ? "NOW" : "STARTING NOW");
  } else if (left < 60) {
    snprintf(when, sizeof(when), "%sIN %d MIN", meet, left);
  } else {
    snprintf(when, sizeof(when), "%sIN %d H %d MIN", meet, left / 60, left % 60);
  }
  // All-aboard stays loud: large, in the port accent.
  graphics_context_set_text_color(ctx, all_aboard ? g_theme->port_accent : g_theme->sea_accent);
  graphics_draw_text(ctx, when,
                     fonts_get_system_font(all_aboard ? FONT_KEY_GOTHIC_28_BOLD
                                                      : FONT_KEY_GOTHIC_18_BOLD),
                     GRect(PAD, y, w, 34), GTextOverflowModeTrailingEllipsis,
                     TEXT_ALIGN, NULL);
  y += all_aboard ? 34 : 22;

  // Every reminder shows what its event's details page shows, with its "From"
  // directions under the where lines (the owner, 2026-09-26 and 09-27). An
  // event that isn't in the day's data (tomorrow's, say) falls back to the
  // alert's own fields below.
  int index = !all_aboard && data_ready() ? data_event_for_alarm(a) : -1;
  if (index >= 0) {
    bool from = !booked && alarm_from_kind(a) != FROM_NONE;
    y = details_draw_event(ctx, index, b.size.w, y, from ? draw_from_in_details : NULL) + 4;
    draw_more(ctx, count, y, w);
    return;
  }

  GFont title_font = fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD);
  GRect title_box = GRect(PAD, y, w, 58);
  GSize size = graphics_text_layout_get_content_size(a->title, title_font, title_box,
                                                     GTextOverflowModeTrailingEllipsis,
                                                     TEXT_ALIGN);
  graphics_context_set_text_color(ctx, g_theme->text);
  graphics_draw_text(ctx, a->title, title_font, title_box, GTextOverflowModeTrailingEllipsis,
                     TEXT_ALIGN, NULL);
  y += size.h + 4;

  if (booked) {
    y = draw_booked(ctx, a, y, w) + 4;
    draw_more(ctx, count, y, w);
    return;
  }

  char ref_buf[8], detail[48];
  fmt_clock(ref_buf, sizeof(ref_buf), a->ref);
  if (all_aboard && a->extra != 0) {
    char local_buf[8];
    fmt_clock(local_buf, sizeof(local_buf), a->ref + a->extra);
    snprintf(detail, sizeof(detail), "%s ship \xc2\xb7 %s local", ref_buf, local_buf);
  } else if (all_aboard) {
    snprintf(detail, sizeof(detail), "All aboard %s", ref_buf);
  } else if (a->venue[0]) {
    snprintf(detail, sizeof(detail), "%s \xc2\xb7 %s", ref_buf, a->venue);
  } else {
    snprintf(detail, sizeof(detail), "%s", ref_buf);
  }
  graphics_context_set_text_color(ctx, g_theme->muted);
  graphics_draw_text(ctx, detail, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                     GRect(PAD, y, w, 22), GTextOverflowModeTrailingEllipsis,
                     TEXT_ALIGN, NULL);
  y += 22;
  if (before) {
    // "Arrive by 9:45p" ("Meet" Ashore) under the time, as on the details page.
    fmt_clock(ref_buf, sizeof(ref_buf), a->ref - before);
    snprintf(detail, sizeof(detail), "%s %s", meet[0] == 'M' ? "Meet" : "Arrive by", ref_buf);
    graphics_context_set_text_color(ctx, g_theme->text);
    graphics_draw_text(ctx, detail, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                       GRect(PAD, y, w, 22), GTextOverflowModeTrailingEllipsis,
                       TEXT_ALIGN, NULL);
    y += 22;
  }

  if (!all_aboard) {
    char where[24];
    fmt_where(where, sizeof(where), &a->where);
    if (where[0]) {
      graphics_context_set_text_color(ctx, where_ashore(&a->where) ? g_theme->port_accent
                                                                    : g_theme->text);
      graphics_draw_text(ctx, where, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                         GRect(PAD, y, w, 22), GTextOverflowModeTrailingEllipsis,
                         TEXT_ALIGN, NULL);
      y += 22;
      FromKind from = alarm_from_kind(a);
      if (from == FROM_NONE) {
        y += draw_rel_line(ctx, false, g_theme->muted, PAD, y, w, &a->where);
      } else {
        y = draw_from(ctx, a, from, y + 3, w);
      }
    }
  }
  if (!all_aboard && (a->from & ALARM_NOT_RESERVED)) {
    graphics_context_set_text_color(ctx, g_theme->port_accent);
    graphics_draw_text(ctx, "Not reserved", fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                       GRect(PAD, y, w, 22), GTextOverflowModeTrailingEllipsis,
                       TEXT_ALIGN, NULL);
    y += 20;
  }
  y += 4;

  draw_more(ctx, count, y, w);
}

static time_t s_shown_at;

static void log_closed(ButtonId button) {
  usage_press(button, 0, -1);
  usage_add(USAGE_ALERT_CLOSED, button == BUTTON_ID_SELECT ? 1 : 0,
            (int16_t)(time(NULL) - s_shown_at), s_alarm.at, 0);
}

static void back_click(ClickRecognizerRef recognizer, void *context) {
  log_closed(BUTTON_ID_BACK);
  if (s_from_wakeup) {
    window_stack_pop_all(true);  // back to whatever the user was doing
  } else {
    window_stack_pop(true);
  }
}

static void select_click(ClickRecognizerRef recognizer, void *context) {
  log_closed(BUTTON_ID_SELECT);
  window_stack_pop(true);  // Home is underneath
}

static void click_config(void *context) {
  window_single_click_subscribe(BUTTON_ID_BACK, back_click);
  window_single_click_subscribe(BUTTON_ID_SELECT, select_click);
}

static void window_appear(Window *window) { usage_screen(SCREEN_ALERT, s_alarm.at); }

static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect b = layer_get_bounds(root);
  window_set_background_color(window, g_theme->bg);
  bool port = data_ready() && data_day()->kind == DAY_PORT;
  s_top_bar = top_bar_create(TOP_BAR_FRAME(b), port ? BAND_PORT : BAND_SEA,
                             BAND_LABEL, top_label(s_alarm.kind));
  layer_add_child(root, s_top_bar);
  scroll_page_create(&s_page, window, root, BODY_FRAME(b),
                     update_proc, click_config);
#if defined(PBL_ROUND)
  s_edge = layer_create(b);
  layer_set_update_proc(s_edge, edge_update_proc);
  layer_add_child(root, s_edge);
#endif
}

static void window_unload(Window *window) {
#if defined(PBL_ROUND)
  layer_destroy(s_edge);
#endif
  scroll_page_destroy(&s_page);
  top_bar_destroy(s_top_bar);
  s_top_bar = NULL;
  window_destroy(window);
  s_window = NULL;
  free(s_reserve);
  s_reserve = NULL;
  s_reserve_count = 0;
  notice_window_show_pending();
}

bool alert_window_is_open(void) { return s_window != NULL; }

static void buzz(bool all_aboard) {
  if (all_aboard) {
    static const uint32_t segments[] = {600, 200, 600, 200, 600};
    vibes_enqueue_custom_pattern((VibePattern){.durations = segments,
                                               .num_segments = ARRAY_LENGTH(segments)});
  } else {
    vibes_double_pulse();
  }
}

void alert_window_refresh(void) {
  if (s_top_bar) {
    // The theme may have changed (settings page).
    window_set_background_color(s_window, g_theme->bg);
    layer_mark_dirty(s_top_bar);
    scroll_page_refresh(&s_page);
#if defined(PBL_ROUND)
    layer_mark_dirty(s_edge);
#endif
  }
}

void alert_window_push(int32_t at, bool from_wakeup) {
  int count = 0;
  int old_reserve_count = s_reserve_count;
  s_reserve_count = 0;
  if (!s_reserve) {
    s_reserve = malloc(MAX_TO_RESERVE * sizeof(ReserveItem));
    if (!s_reserve) {
      APP_LOG(APP_LOG_LEVEL_ERROR, "No memory for events to reserve");
    }
  }
  for (int i = 0; i < data_alarm_count(); i++) {
    Alarm *a = data_alarm(i);
    if (a->at == at && !onboard_silences(a)) {
      if (count == 0) {
        s_alarm = *a;
      }
      count++;
      if (a->kind == ALARM_TO_RESERVE && s_reserve && s_reserve_count < MAX_TO_RESERVE) {
        ReserveItem *r = &s_reserve[s_reserve_count++];
        r->start = a->ref;
        memcpy(r->title, a->title, sizeof(r->title));
        memcpy(r->venue, a->venue, sizeof(r->venue));
      }
    }
  }
  if (count == 0) {
    s_reserve_count = old_reserve_count;  // keep what's on screen
    if (!s_window) {
      free(s_reserve);
      s_reserve = NULL;
    }
    APP_LOG(APP_LOG_LEVEL_WARNING, "No alert found for %d", (int)at);
    return;
  }
  s_count = count;
  buzz(s_alarm.kind == ALARM_ALL_ABOARD);
  if (s_window) {
    s_from_wakeup = s_from_wakeup || from_wakeup;
    top_bar_set(s_top_bar, data_ready() && data_day()->kind == DAY_PORT ? BAND_PORT : BAND_SEA,
                BAND_LABEL, top_label(s_alarm.kind));
    scroll_page_top(&s_page);  // a new alert: from its top
#if defined(PBL_ROUND)
    layer_mark_dirty(s_edge);
#endif
    return;
  }
  s_from_wakeup = from_wakeup;
  s_shown_at = time(NULL);
  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers){
    .load = window_load,
    .appear = window_appear,
    .unload = window_unload,
  });
  window_stack_push(s_window, true);
}
