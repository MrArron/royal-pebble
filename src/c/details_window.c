#include "screens.h"
#include "data.h"
#include "ui.h"
#include "usage.h"

// Event details: title, venue, deck and position, time and duration,
// arrive-by, age and what-to-bring tags (docs/DESIGN.md §7.6),
// reservation, last chance, star state (docs/DESIGN.md §7.2, §7.3, §7.5).
// Hold Select toggles the star; Select toggles Reserved on a starred event
// that needs a reservation. A booked order (docs/DESIGN.md §7.7) shows
// its meeting time, guests and "✓ Booked", and its star is locked. The page
// scrolls when it doesn't fit.

static Window *s_window;
static Layer *s_top_bar;
static ScrollPage s_page;
static int s_index;

static int draw_line(GContext *ctx, const char *text, const char *font_key, GColor color,
                     int x, int y, int w, int max_h) {
  GFont font = fonts_get_system_font(font_key);
  GRect box = GRect(x, y, w, max_h);
  GSize size = graphics_text_layout_get_content_size(text, font, box,
                                                     GTextOverflowModeTrailingEllipsis,
                                                     GTextAlignmentLeft);
  graphics_context_set_text_color(ctx, color);
  graphics_draw_text(ctx, text, font, box, GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft,
                     NULL);
  return y + size.h;
}

// What-to-bring tags (docs/WATCH_PROTOCOL.md, Packed events), in bit order.
static const char *const TAG_TEXTS[8] = {
  "Bring SeaPass", "Weather permitting", "Sign up at venue", "Waiver needed", "Athletic shoes",
  "Swimwear or active wear", "Limited spots, come early", "Meeting spot on phone",
};

// Phase 4 lines under the time (docs/DESIGN.md §7.6):
// "Arrive by 9:45p" (or "Meet 9:00a" ashore), "Ages 18+" and the tags. Each
// is left out when the phone sent nothing for it.
static int draw_event_info(GContext *ctx, const Event *e, int y, int w) {
  char line[32];
  if (e->early && event_is_timed(e)) {
    char at_buf[8];
    fmt_clock(at_buf, sizeof(at_buf), e->start - e->early);
    snprintf(line, sizeof(line), "%s %s", where_ashore(&e->where) ? "Meet" : "Arrive by", at_buf);
    y = draw_line(ctx, line, FONT_KEY_GOTHIC_18_BOLD, g_theme->text, PAD, y - 2, w, 22) + 2;
  }
  if (e->age_min || e->age_max) {
    if (e->age_min && e->age_max) {
      snprintf(line, sizeof(line), "Ages %d-%d", e->age_min, e->age_max);
    } else if (e->age_min) {
      snprintf(line, sizeof(line), "Ages %d+", e->age_min);
    } else {
      snprintf(line, sizeof(line), "Ages %d & under", e->age_max);
    }
    y = draw_line(ctx, line, FONT_KEY_GOTHIC_18_BOLD, g_theme->port_accent, PAD, y - 2, w, 22) + 2;
  }
  if (e->tags) {
    // All eight with separators take 171 bytes.
    char tags[176];
    int n = 0;
    tags[0] = '\0';
    for (int i = 0; i < 8; i++) {
      if ((e->tags & (1 << i)) && n >= 0 && n < (int)sizeof(tags)) {
        n += snprintf(tags + n, sizeof(tags) - n, "%s%s", n ? " \xc2\xb7 " : "", TAG_TEXTS[i]);
      }
    }
    y = draw_line(ctx, tags, FONT_KEY_GOTHIC_14_BOLD, g_theme->muted, PAD, y - 2, w, 90) + 2;
  }
  return y;
}

int details_draw_event(GContext *ctx, int index, int width, int y,
                       int (*after_where)(GContext *ctx, int y)) {
  Event *e = data_event(index);
  int w = width - 2 * PAD;

  y = draw_line(ctx, e->title, FONT_KEY_GOTHIC_24_BOLD, g_theme->text, PAD, y, w, 84) + 4;
  if (e->venue[0]) {
    y = draw_line(ctx, e->venue, FONT_KEY_GOTHIC_18_BOLD, g_theme->muted, PAD, y, w, 22);
  }
  // Deck and position, then how far from the cabin (left out when unknown).
  char where[24];
  fmt_where(where, sizeof(where), &e->where);
  if (where[0]) {
    y = draw_line(ctx, where, FONT_KEY_GOTHIC_18_BOLD,
                  where_ashore(&e->where) ? g_theme->port_accent : g_theme->text, PAD, y, w, 22);
    if (after_where) {
      y = after_where(ctx, y);
    } else {
      y += draw_rel_line(ctx, false, g_theme->muted, PAD, y, w, &e->where);
    }
  }
  y += 2;

  char when[48];
  if (!event_is_timed(e)) {
    snprintf(when, sizeof(when), "Any time today");
  } else {
    char start_buf[8];
    fmt_clock(start_buf, sizeof(start_buf), e->start);
    if (e->minutes > 0) {
      char end_buf[8], dur[16];
      fmt_clock(end_buf, sizeof(end_buf), event_end(e));
      fmt_duration(dur, sizeof(dur), e->minutes);
      snprintf(when, sizeof(when), "%s - %s \xc2\xb7 %s", start_buf, end_buf, dur);
    } else {
      snprintf(when, sizeof(when), "%s", start_buf);
    }
  }
  y = draw_line(ctx, when, FONT_KEY_GOTHIC_18_BOLD, g_theme->text, PAD, y, w, 22) + 2;
  y = draw_event_info(ctx, e, y, w);

  bool booked = (e->flags & EVENT_BOOKED) != 0;
  if (booked) {
    // "Meet 8:45a · 2 guests", then "✓ Booked".
    char meet[40] = "";
    int n = 0;
    if (e->booked.meet_before && event_is_timed(e)) {
      char meet_buf[8];
      fmt_clock(meet_buf, sizeof(meet_buf), e->start - e->booked.meet_before);
      n = snprintf(meet, sizeof(meet), "Meet %s", meet_buf);
    }
    if (e->booked.guests && n >= 0 && n < (int)sizeof(meet)) {
      snprintf(meet + n, sizeof(meet) - n, "%s%d guest%s", n ? " \xc2\xb7 " : "", e->booked.guests,
               e->booked.guests == 1 ? "" : "s");
    }
    if (meet[0]) {
      y = draw_line(ctx, meet, FONT_KEY_GOTHIC_14_BOLD, g_theme->muted, PAD, y - 2, w, 18) + 2;
    }
    draw_checked(ctx, "Booked", true, PAD, y, g_theme->sea_accent);
    y += 22;
  }

  // "Clashes with 1:00p Trivia · +1 more", on up to two lines.
  int first;
  int clashes = data_clashes_with(index, now_cruise(), &first);
  if (clashes > 0) {
    Event *o = data_event(first);
    char start_buf[8], more[24] = "", line[TITLE_LEN + 48];
    fmt_clock(start_buf, sizeof(start_buf), o->start);
    if (clashes > 1) {
      snprintf(more, sizeof(more), " \xc2\xb7 +%d more", clashes - 1);
    }
    snprintf(line, sizeof(line), "Clashes with %s %s%s", start_buf, o->title, more);
    y = draw_line(ctx, line, FONT_KEY_GOTHIC_14_BOLD, g_theme->port_accent, PAD, y - 2, w, 32) + 2;
  }

  // Starred: "Not reserved yet" or "✓ Reserved"; unstarred: the plain note.
  bool track = (e->flags & EVENT_STARRED) && (e->flags & EVENT_RESERVATION);
  if (track && (e->flags & EVENT_RESERVED)) {
    draw_reserved(ctx, true, PAD, y, g_theme->sea_accent);
    y += 22;
  } else if (track) {
    y = draw_line(ctx, "Not reserved yet", FONT_KEY_GOTHIC_18_BOLD, g_theme->port_accent, PAD, y, w, 22) + 2;
  } else if (e->flags & EVENT_RESERVATION) {
    y = draw_line(ctx, "Reservation needed", FONT_KEY_GOTHIC_14_BOLD, g_theme->port_accent,
                  PAD, y, w, 18) + 2;
  }
  const char *tag = event_final_tag(e);
  if (tag) {
    y = draw_line(ctx, tag, FONT_KEY_GOTHIC_14_BOLD, g_theme->port_accent, PAD, y, w, 18) + 2;
  }
  return y;
}

static void body_update_proc(Layer *layer, GContext *ctx) {
  GRect b = layer_get_bounds(layer);
  Event *e = data_event(s_index);
  int w = b.size.w - 2 * PAD;
  int y = details_draw_event(ctx, s_index, b.size.w, 4, NULL);

  // The star and what Select does.
  draw_divider(ctx, y + 4, b.size.w);
  y += 8;
  if (e->flags & EVENT_STARRED) {
    bool track = (e->flags & EVENT_RESERVATION) != 0;
    draw_star(ctx, GPoint(PAD + 6, y + 12), g_theme->sea_accent);
    y = draw_line(ctx, "Starred", FONT_KEY_GOTHIC_18_BOLD, g_theme->sea_accent, PAD + 16, y,
                  w - 16, 22);
    if (e->flags & EVENT_BOOKED) {
      y = draw_line(ctx, "From your booking", FONT_KEY_GOTHIC_14_BOLD, g_theme->muted, PAD, y, w, 18);
    } else if (track) {
      y = draw_line(ctx, (e->flags & EVENT_RESERVED) ? "Select: not reserved" : "Select: mark reserved",
                    FONT_KEY_GOTHIC_14_BOLD, g_theme->muted, PAD, y, w, 18);
    }
  } else {
    y = draw_line(ctx, "Hold Select to star", FONT_KEY_GOTHIC_18, g_theme->muted, PAD, y, w, 22);
  }
  scroll_page_fit(&s_page, y);
}

static void select_click(ClickRecognizerRef recognizer, void *context) {
  bool done = toggle_reserved(s_index);
  usage_press(BUTTON_ID_SELECT, done ? 0 : USAGE_NOTHING, -1);
}

static void select_long_click(ClickRecognizerRef recognizer, void *context) {
  // The star is locked on a booked order: cancel it in the Royal app and sync.
  bool locked = (data_event(s_index)->flags & EVENT_BOOKED) != 0;
  usage_press(BUTTON_ID_SELECT, USAGE_LONG | (locked ? USAGE_NOTHING : 0), -1);
  if (locked) {
    return;
  }
  if (data_event(s_index)->flags & EVENT_STARRED) {
    unstar_window_push(s_index, data_day()->kind == DAY_PORT ? BAND_PORT : BAND_SEA, "Event");
  } else {
    toggle_star(s_index);
  }
}

// "Excursion" or "Booking" for a booked order, else "Event".
static const char *top_name(const Event *e) {
  if (!(e->flags & EVENT_BOOKED)) {
    return "Event";
  }
  return e->booked.kind == BOOKED_EXCURSION ? "Excursion" : "Booking";
}

static void click_config(void *context) {
  window_single_click_subscribe(BUTTON_ID_SELECT, select_click);
  window_long_click_subscribe(BUTTON_ID_SELECT, 500, select_long_click, NULL);
}

static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect b = layer_get_bounds(root);
  const Day *day = data_day();
  window_set_background_color(window, g_theme->bg);

  s_top_bar = top_bar_create(TOP_BAR_FRAME(b),
                             day->kind == DAY_PORT ? BAND_PORT : BAND_SEA, BAND_LABEL,
                             top_name(data_event(s_index)));
  layer_add_child(root, s_top_bar);
  scroll_page_create(&s_page, window, root, BODY_FRAME(b),
                     body_update_proc, click_config);
}

static void window_unload(Window *window) {
  scroll_page_destroy(&s_page);
  top_bar_destroy(s_top_bar);
  s_top_bar = NULL;
  window_destroy(window);
  s_window = NULL;
}

void details_window_refresh(void) {
  if (s_top_bar) {
    // The theme may have changed (settings page).
    window_set_background_color(s_window, g_theme->bg);
    layer_mark_dirty(s_top_bar);
    scroll_page_refresh(&s_page);
  }
}

static void window_appear(Window *window) {
  usage_screen(SCREEN_DETAILS, s_index < data_event_count() ? data_event(s_index)->start : NO_TIME);
}

void details_window_push(int event_index) {
  s_index = event_index;
  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers){
    .load = window_load,
    .appear = window_appear,
    .unload = window_unload,
  });
  window_stack_push(s_window, true);
}
