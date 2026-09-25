#include "screens.h"
#include "data.h"
#include "ui.h"

// Today list: events grouped by start time. The time shows on a group's first
// row only and dividers sit between groups. In-progress events show NOW, and
// finished ones drop off the list (checked every minute).

#define ROW_HEIGHT 44
#define TIME_COL_W 50
#define BANG_W 3
// Clash toast (docs/DESIGN_V1_1.md §8.3): at the bottom, so the row just
// starred stays in view.
#define TOAST_HEIGHT 46
#define TOAST_MS 3000

static Window *s_window;
static Layer *s_top_bar;
static MenuLayer *s_menu;
static Layer *s_toast;
static AppTimer *s_toast_timer;
static int s_toast_event;

enum { GROUP_UNTIMED = -3, GROUP_NOW = -2 };

// Event index for each list row: the events that haven't finished.
static int16_t s_rows[MAX_EVENTS];
static int s_row_count;

static void rebuild_rows(void) {
  int32_t now = now_cruise();
  s_row_count = 0;
  for (int i = 0; i < data_event_count() && s_row_count < MAX_EVENTS; i++) {
    if (!event_is_finished(data_event(i), now)) {
      s_rows[s_row_count++] = i;
    }
  }
}

static int32_t group_key(int row, int32_t now) {
  Event *e = data_event(s_rows[row]);
  if (!event_is_timed(e)) {
    return GROUP_UNTIMED;
  }
  return event_in_progress(e, now) ? GROUP_NOW : e->start;
}

static bool starts_group(int row, int32_t now) {
  return row == 0 || group_key(row, now) != group_key(row - 1, now);
}

// With nothing left, one row shows a message instead.
static uint16_t get_num_rows(MenuLayer *menu, uint16_t section, void *context) {
  return s_row_count > 0 ? s_row_count : 1;
}

static int16_t get_cell_height(MenuLayer *menu, MenuIndex *index, void *context) {
  return ROW_HEIGHT;
}

static int16_t get_separator_height(MenuLayer *menu, MenuIndex *index, void *context) {
  return 1;
}

// The separator's index is the row below it.
static void draw_separator(GContext *ctx, const Layer *cell, MenuIndex *index, void *context) {
  if (index->row > 0 && index->row < s_row_count && starts_group(index->row, now_cruise())) {
    GRect b = layer_get_bounds(cell);
    draw_divider(ctx, 0, b.size.w);
  }
}

static void draw_row(GContext *ctx, const Layer *cell, MenuIndex *index, void *context) {
  GRect b = layer_get_bounds(cell);
  bool highlighted = menu_cell_layer_is_highlighted(cell);
  GColor muted = highlighted ? g_theme->cursor_text : g_theme->muted;
  if (s_row_count == 0) {
    graphics_context_set_text_color(ctx, muted);
    graphics_draw_text(ctx, data_event_count() > 0 ? "Nothing left today" : "No events today",
                       fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD), GRect(PAD, 10, b.size.w - 2 * PAD, 22),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
    return;
  }

  int32_t now = now_cruise();
  Event *e = data_event(s_rows[index->row]);
  bool in_progress = event_in_progress(e, now);
  bool past = event_is_past(e, now);  // a no-length event just after its start
  GColor text = highlighted ? g_theme->cursor_text : (past ? g_theme->muted : g_theme->text);

  if (starts_group(index->row, now)) {
    char time_buf[8];
    const char *label = time_buf;
    GColor label_color = text;
    if (!event_is_timed(e)) {
      label = "ALL DAY";
      label_color = muted;
    } else if (in_progress) {
      label = "NOW";
      label_color = highlighted ? g_theme->cursor_text : g_theme->now_label;
    } else {
      fmt_clock(time_buf, sizeof(time_buf), e->start);
    }
    graphics_context_set_text_color(ctx, label_color);
    graphics_draw_text(ctx, label, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                       GRect(PAD, 1, TIME_COL_W, 22), GTextOverflowModeTrailingEllipsis,
                       GTextAlignmentLeft, NULL);
  }

  int x = PAD + TIME_COL_W;
  int w = b.size.w - x - PAD;
  // Icons from the right: the clash "!", then the star before it.
  int icons_right = b.size.w - PAD;
  if (data_clashes_with(s_rows[index->row], now, NULL) > 0) {
    draw_bang(ctx, GPoint(icons_right - BANG_W, 6), 12,
              highlighted ? g_theme->cursor_text : g_theme->port_accent);
    icons_right -= BANG_W + 4;
    w -= BANG_W + 4;
  }
  if (e->flags & EVENT_STARRED) {
    draw_star(ctx, GPoint(icons_right - 6, 12),
              highlighted ? g_theme->cursor_text : g_theme->sea_accent);
    w -= 16;
  }

  graphics_context_set_text_color(ctx, text);
  graphics_draw_text(ctx, e->title, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                     GRect(x, 1, w, 22), GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentLeft, NULL);

  // "ends 1:00p · Venue" while it's on, else "Last chance · Venue" (the tag in
  // the port accent) or just the venue.
  char sub[VENUE_LEN + 20];
  const char *tag = NULL;
  if (in_progress) {
    char end_buf[8];
    fmt_clock(end_buf, sizeof(end_buf), event_end(e));
    snprintf(sub, sizeof(sub), "ends %s \xc2\xb7 %s", end_buf, e->venue);
  } else {
    snprintf(sub, sizeof(sub), "%s", e->venue);
    tag = event_final_tag(e);
  }
  draw_tagged_line(ctx, tag, highlighted ? g_theme->cursor_text : g_theme->port_accent, sub, muted,
                   fonts_get_system_font(FONT_KEY_GOTHIC_14), GRect(x, 22, b.size.w - x - PAD, 18));
}

static void select_click(MenuLayer *menu, MenuIndex *index, void *context) {
  if (index->row < s_row_count) {
    details_window_push(s_rows[index->row]);
  }
}

// "Clashes with" / "1:00p Adults Only Trivia" beside a large "!".
static void toast_update_proc(Layer *layer, GContext *ctx) {
  GRect b = layer_get_bounds(layer);
  if (s_toast_event >= data_event_count()) {
    return;  // a new slice arrived meanwhile
  }
  graphics_context_set_fill_color(ctx, g_theme->bg);
  graphics_fill_rect(ctx, b, 0, GCornerNone);
  graphics_context_set_fill_color(ctx, g_theme->port_accent);
  graphics_fill_rect(ctx, GRect(0, 0, b.size.w, 4), 0, GCornerNone);
  draw_bang(ctx, GPoint(PAD, 12), 24, g_theme->port_accent);

  int x = PAD + 6 + 8;
  int w = b.size.w - x - PAD;
  graphics_context_set_text_color(ctx, g_theme->port_accent);
  graphics_draw_text(ctx, "Clashes with", fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD),
                     GRect(x, 4, w, 18), GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  Event *e = data_event(s_toast_event);
  char time_buf[8], buf[TITLE_LEN + 8];
  fmt_clock(time_buf, sizeof(time_buf), e->start);
  snprintf(buf, sizeof(buf), "%s %s", time_buf, e->title);
  graphics_context_set_text_color(ctx, g_theme->text);
  graphics_draw_text(ctx, buf, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                     GRect(x, 18, w, 22), GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
}

static void hide_toast(void *context) {
  s_toast_timer = NULL;
  layer_set_hidden(s_toast, true);
}

static void select_long_click(MenuLayer *menu, MenuIndex *index, void *context) {
  if (index->row >= s_row_count) {
    return;
  }
  int clash = toggle_star(s_rows[index->row]);
  if (clash >= 0 && s_toast) {
    s_toast_event = clash;
    layer_set_hidden(s_toast, false);
    layer_mark_dirty(s_toast);
    if (s_toast_timer) {
      app_timer_reschedule(s_toast_timer, TOAST_MS);
    } else {
      s_toast_timer = app_timer_register(TOAST_MS, hide_toast, NULL);
    }
  }
}

// Row of the first timed event that hasn't started yet or is on now (past the
// all-day items at the top).
static int first_current_row(void) {
  int32_t now = now_cruise();
  for (int row = 0; row < s_row_count; row++) {
    Event *e = data_event(s_rows[row]);
    if (event_is_timed(e) && !event_is_past(e, now)) {
      return row;
    }
  }
  return 0;
}

// Row showing event `event_index`, or the next one after it if it dropped off.
static int row_for_event(int event_index) {
  for (int row = 0; row < s_row_count; row++) {
    if (s_rows[row] >= event_index) {
      return row;
    }
  }
  return s_row_count > 0 ? s_row_count - 1 : 0;
}

static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect b = layer_get_bounds(root);
  window_set_background_color(window, g_theme->bg);

  s_top_bar = top_bar_create(GRect(0, 0, b.size.w, TOP_BAR_HEIGHT), BAND_SEA, BAND_LABEL, "Today");
  layer_add_child(root, s_top_bar);

  s_menu = menu_layer_create(GRect(0, TOP_BAR_HEIGHT, b.size.w, b.size.h - TOP_BAR_HEIGHT));
  menu_layer_set_callbacks(s_menu, NULL, (MenuLayerCallbacks){
    .get_num_rows = get_num_rows,
    .get_cell_height = get_cell_height,
    .get_separator_height = get_separator_height,
    .draw_separator = draw_separator,
    .draw_row = draw_row,
    .select_click = select_click,
    .select_long_click = select_long_click,
  });
  menu_layer_set_normal_colors(s_menu, g_theme->bg, g_theme->text);
  menu_layer_set_highlight_colors(s_menu, g_theme->cursor_bg, g_theme->cursor_text);
  menu_layer_set_click_config_onto_window(s_menu, window);
  rebuild_rows();
  menu_layer_set_selected_index(s_menu, MenuIndex(0, first_current_row()), MenuRowAlignTop, false);
  layer_add_child(root, menu_layer_get_layer(s_menu));

  s_toast = layer_create(GRect(0, b.size.h - TOAST_HEIGHT, b.size.w, TOAST_HEIGHT));
  layer_set_update_proc(s_toast, toast_update_proc);
  layer_set_hidden(s_toast, true);
  layer_add_child(root, s_toast);
}

static void window_unload(Window *window) {
  if (s_toast_timer) {
    app_timer_cancel(s_toast_timer);
    s_toast_timer = NULL;
  }
  layer_destroy(s_toast);
  s_toast = NULL;
  menu_layer_destroy(s_menu);
  top_bar_destroy(s_top_bar);
  s_menu = NULL;
  s_top_bar = NULL;
  window_destroy(window);
  s_window = NULL;
}

void today_window_refresh(void) {
  if (s_menu) {
    // Keep the cursor on the same event while finished ones drop off above it.
    int row = menu_layer_get_selected_index(s_menu).row;
    int selected = row < s_row_count ? s_rows[row] : 0;
    rebuild_rows();
    menu_layer_reload_data(s_menu);
    menu_layer_set_selected_index(s_menu, MenuIndex(0, row_for_event(selected)), MenuRowAlignNone, false);
    // The theme may have changed (settings page).
    window_set_background_color(s_window, g_theme->bg);
    menu_layer_set_normal_colors(s_menu, g_theme->bg, g_theme->text);
    menu_layer_set_highlight_colors(s_menu, g_theme->cursor_bg, g_theme->cursor_text);
    layer_mark_dirty(s_top_bar);
  }
}

void today_window_push(void) {
  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers){
    .load = window_load,
    .unload = window_unload,
  });
  window_stack_push(s_window, true);
}
