#include "screens.h"
#include "data.h"
#include "ui.h"
#include "usage.h"

// Shown when an alert fires: the top bar says "Reminder" or "All aboard",
// then "IN 15 MIN", what it's about and, for reminders, where it is
// (docs/DESIGN_V1_1.md §2). The evening's "To reserve" alert lists tomorrow's
// starred events that still need a reservation (§5). Opened by a wakeup (app closed) it is the only
// screen the user asked for, so Back leaves the app; Select opens Home.

static Window *s_window;
static Layer *s_top_bar;
static Layer *s_layer;
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
static ReserveItem s_reserve[MAX_TO_RESERVE];
static int s_reserve_count;

static const char *top_label(uint8_t kind) {
  return kind == ALARM_ALL_ABOARD ? "All aboard" : kind == ALARM_TO_RESERVE ? "To reserve" : "Reminder";
}

// "From" directions under a divider (the phone decided which): "From Royal
// Theater:" over "↓1 deck · Fore → Mid", or "Same venue", or "Same area ·
// Deck 5". Returns the y below them.
static int draw_from(GContext *ctx, const Alarm *a, FromKind from, int y, int w) {
  GRect b = layer_get_bounds(s_layer);
  draw_divider(ctx, y, b.size.w);
  y += 4;
  GFont font = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
  if (from == FROM_ROUTE) {
    char label[32];
    snprintf(label, sizeof(label), "From %s:", a->from_venue);
    graphics_context_set_text_color(ctx, g_theme->muted);
    graphics_draw_text(ctx, label, fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD),
                       GRect(PAD, y, w, 16), GTextOverflowModeTrailingEllipsis,
                       GTextAlignmentLeft, NULL);
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
                     GTextAlignmentLeft, NULL);
  return y + 22;
}

// "TOMORROW", then each event as "7:00p Hairspray" over its venue, as many as
// fit, then "+ 2 more".
static void draw_to_reserve(GContext *ctx, GRect b) {
  int w = b.size.w - 2 * PAD;
  int y = 2;
  graphics_context_set_text_color(ctx, g_theme->sea_accent);
  graphics_draw_text(ctx, "TOMORROW", fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                     GRect(PAD, y, w, 22), GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  y += 24;
  int total = s_alarm.extra > s_reserve_count ? s_alarm.extra : s_reserve_count;
  int shown = 0;
  for (int i = 0; i < s_reserve_count; i++) {
    const ReserveItem *r = &s_reserve[i];
    int height = 22 + (r->venue[0] ? 18 : 0);
    // Keep room for the "+ N more" line when some are left out.
    int reserve = i + 1 < total ? 22 : 0;
    if (y + height + reserve > b.size.h) {
      break;
    }
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
                       GTextAlignmentLeft, NULL);
    y += 22;
    if (r->venue[0]) {
      graphics_context_set_text_color(ctx, g_theme->muted);
      graphics_draw_text(ctx, r->venue, fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD),
                         GRect(PAD, y - 2, w, 18), GTextOverflowModeTrailingEllipsis,
                         GTextAlignmentLeft, NULL);
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
                       GTextAlignmentLeft, NULL);
  }
}

static void update_proc(Layer *layer, GContext *ctx) {
  GRect b = layer_get_bounds(layer);
  if (s_alarm.kind == ALARM_TO_RESERVE) {
    draw_to_reserve(ctx, b);
    return;
  }
  Alarm *a = &s_alarm;
  int count = s_count;
  bool all_aboard = a->kind == ALARM_ALL_ABOARD;
  int left = (int)(a->ref - now_cruise());
  int w = b.size.w - 2 * PAD;
  int y = 2;

  char when[24];
  if (left <= 0) {
    strncpy(when, all_aboard ? "NOW" : "STARTING NOW", sizeof(when) - 1);
    when[sizeof(when) - 1] = 0;
  } else if (left < 60) {
    snprintf(when, sizeof(when), "IN %d MIN", left);
  } else {
    snprintf(when, sizeof(when), "IN %d H %d MIN", left / 60, left % 60);
  }
  // All-aboard stays loud: large, in the port accent.
  graphics_context_set_text_color(ctx, all_aboard ? g_theme->port_accent : g_theme->sea_accent);
  graphics_draw_text(ctx, when,
                     fonts_get_system_font(all_aboard ? FONT_KEY_GOTHIC_28_BOLD
                                                      : FONT_KEY_GOTHIC_18_BOLD),
                     GRect(PAD, y, w, 34), GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentLeft, NULL);
  y += all_aboard ? 34 : 22;

  GFont title_font = fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD);
  GRect title_box = GRect(PAD, y, w, 58);
  GSize size = graphics_text_layout_get_content_size(a->title, title_font, title_box,
                                                     GTextOverflowModeTrailingEllipsis,
                                                     GTextAlignmentLeft);
  graphics_context_set_text_color(ctx, g_theme->text);
  graphics_draw_text(ctx, a->title, title_font, title_box, GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentLeft, NULL);
  y += size.h + 4;

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
                     GTextAlignmentLeft, NULL);
  y += 22;

  if (!all_aboard) {
    char where[24];
    fmt_where(where, sizeof(where), &a->where);
    if (where[0]) {
      graphics_context_set_text_color(ctx, where_ashore(&a->where) ? g_theme->port_accent
                                                                    : g_theme->text);
      graphics_draw_text(ctx, where, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                         GRect(PAD, y, w, 22), GTextOverflowModeTrailingEllipsis,
                         GTextAlignmentLeft, NULL);
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
                       GTextAlignmentLeft, NULL);
    y += 20;
  }
  y += 4;

  if (count > 1) {
    char more[24];
    snprintf(more, sizeof(more), "+ %d more", count - 1);
    graphics_context_set_text_color(ctx, g_theme->text);
    graphics_draw_text(ctx, more, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                       GRect(PAD, y, w, 22), GTextOverflowModeTrailingEllipsis,
                       GTextAlignmentLeft, NULL);
  }
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
  s_top_bar = top_bar_create(GRect(0, 0, b.size.w, TOP_BAR_HEIGHT), port ? BAND_PORT : BAND_SEA,
                             BAND_LABEL, top_label(s_alarm.kind));
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
  if (s_layer) {
    // The theme may have changed (settings page).
    window_set_background_color(s_window, g_theme->bg);
    layer_mark_dirty(s_top_bar);
    layer_mark_dirty(s_layer);
  }
}

void alert_window_push(int32_t at, bool from_wakeup) {
  int count = 0;
  int old_reserve_count = s_reserve_count;
  s_reserve_count = 0;
  for (int i = 0; i < data_alarm_count(); i++) {
    Alarm *a = data_alarm(i);
    if (a->at == at) {
      if (count == 0) {
        s_alarm = *a;
      }
      count++;
      if (a->kind == ALARM_TO_RESERVE && s_reserve_count < MAX_TO_RESERVE) {
        ReserveItem *r = &s_reserve[s_reserve_count++];
        r->start = a->ref;
        memcpy(r->title, a->title, sizeof(r->title));
        memcpy(r->venue, a->venue, sizeof(r->venue));
      }
    }
  }
  if (count == 0) {
    s_reserve_count = old_reserve_count;  // keep what's on screen
    APP_LOG(APP_LOG_LEVEL_WARNING, "No alert found for %d", (int)at);
    return;
  }
  s_count = count;
  buzz(s_alarm.kind == ALARM_ALL_ABOARD);
  if (s_window) {
    s_from_wakeup = s_from_wakeup || from_wakeup;
    top_bar_set(s_top_bar, data_ready() && data_day()->kind == DAY_PORT ? BAND_PORT : BAND_SEA,
                BAND_LABEL, top_label(s_alarm.kind));
    layer_mark_dirty(s_layer);
    return;
  }
  s_from_wakeup = from_wakeup;
  s_shown_at = time(NULL);
  s_window = window_create();
  window_set_click_config_provider(s_window, click_config);
  window_set_window_handlers(s_window, (WindowHandlers){
    .load = window_load,
    .appear = window_appear,
    .unload = window_unload,
  });
  window_stack_push(s_window, true);
}
