#include "screens.h"
#include "data.h"
#include "ui.h"

// Event details: title, venue, deck and position, time and duration,
// reservation, star state (docs/DESIGN_V1_1.md §2).
// Hold Select toggles the star.

static Window *s_window;
static Layer *s_top_bar;
static Layer *s_body;
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

static void body_update_proc(Layer *layer, GContext *ctx) {
  GRect b = layer_get_bounds(layer);
  Event *e = data_event(s_index);
  int w = b.size.w - 2 * PAD;
  int y = 4;

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
    y += draw_rel_line(ctx, false, g_theme->muted, PAD, y, w, &e->where);
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

  if (e->flags & EVENT_RESERVATION) {
    y = draw_line(ctx, "Reservation needed", FONT_KEY_GOTHIC_14_BOLD, g_theme->port_accent,
                  PAD, y, w, 18) + 2;
  }

  draw_divider(ctx, y + 4, b.size.w);
  y += 8;
  if (e->flags & EVENT_STARRED) {
    draw_star(ctx, GPoint(PAD + 6, y + 12), g_theme->sea_accent);
    draw_line(ctx, "Starred", FONT_KEY_GOTHIC_18_BOLD, g_theme->sea_accent, PAD + 16, y,
              w - 16, 22);
  } else {
    draw_line(ctx, "Hold Select to star", FONT_KEY_GOTHIC_18, g_theme->muted, PAD, y, w, 22);
  }
}

static void select_long_click(ClickRecognizerRef recognizer, void *context) {
  toggle_star(s_index);
}

static void click_config(void *context) {
  window_long_click_subscribe(BUTTON_ID_SELECT, 500, select_long_click, NULL);
}

static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect b = layer_get_bounds(root);
  const Day *day = data_day();
  window_set_background_color(window, g_theme->bg);

  s_top_bar = top_bar_create(GRect(0, 0, b.size.w, TOP_BAR_HEIGHT),
                             day->kind == DAY_PORT ? BAND_PORT : BAND_SEA, BAND_LABEL, "Event");
  layer_add_child(root, s_top_bar);
  s_body = layer_create(GRect(0, TOP_BAR_HEIGHT, b.size.w, b.size.h - TOP_BAR_HEIGHT));
  layer_set_update_proc(s_body, body_update_proc);
  layer_add_child(root, s_body);
}

static void window_unload(Window *window) {
  layer_destroy(s_body);
  top_bar_destroy(s_top_bar);
  s_body = NULL;
  s_top_bar = NULL;
  window_destroy(window);
  s_window = NULL;
}

void details_window_refresh(void) {
  if (s_body) {
    layer_mark_dirty(s_top_bar);
    layer_mark_dirty(s_body);
  }
}

void details_window_push(int event_index) {
  s_index = event_index;
  s_window = window_create();
  window_set_click_config_provider(s_window, click_config);
  window_set_window_handlers(s_window, (WindowHandlers){
    .load = window_load,
    .unload = window_unload,
  });
  window_stack_push(s_window, true);
}
