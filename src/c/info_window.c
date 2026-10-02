#include "screens.h"
#include "data.h"
#include "onboard.h"
#include "ui.h"
#include "usage.h"

// My info: while the user is on board (docs/DESIGN.md §4.4), an undo
// row first; then the day's summary (docs/DESIGN.md §5), the stateroom
// (with deck and stairs), muster station, dining room, ship clock note, last sync, and the
// way into the ship directory. Up and Down move the cursor between the undo
// row, the summary and the directory, Select opens it (or undoes); the screen
// scrolls up a little for the directory.

static Window *s_window;
static Layer *s_top_bar;
static Layer *s_body;

enum { ROW_ONBOARD, ROW_SUMMARY, ROW_DIRECTORY };
static int s_cursor;
#define SUMMARY_ROW_HEIGHT 32
#define ONBOARD_ROW_HEIGHT 58

static bool row_available(int row) {
  return row == ROW_DIRECTORY || (row == ROW_SUMMARY ? summary_available() : onboard_is_set());
}

// ON BOARD / Since 2:40p / Select: back ashore, filled when under the cursor.
static void draw_onboard(GContext *ctx, int y, int width, bool selected) {
  if (selected) {
    graphics_context_set_fill_color(ctx, g_theme->cursor_bg);
    graphics_fill_rect(ctx, GRect(0, y, width, ONBOARD_ROW_HEIGHT - 2), 0, GCornerNone);
  } else {
    draw_divider(ctx, y + ONBOARD_ROW_HEIGHT - 3, width);
  }
  GColor text = selected ? g_theme->cursor_text : g_theme->text;
  GColor muted = selected ? g_theme->cursor_text : g_theme->muted;
  GFont small = fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD);
  graphics_context_set_text_color(ctx, muted);
  graphics_draw_text(ctx, "ON BOARD", small, GRect(PAD, y + 1, width - 2 * PAD, 16),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  char since[8], line[24];
  fmt_clock(since, sizeof(since), onboard_since());
  snprintf(line, sizeof(line), "Since %s", since);
  graphics_context_set_text_color(ctx, text);
  graphics_draw_text(ctx, line, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                     GRect(PAD, y + 14, width - 2 * PAD, 22), GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentLeft, NULL);
  graphics_context_set_text_color(ctx, muted);
  graphics_draw_text(ctx, "Select: back ashore", small, GRect(PAD, y + 35, width - 2 * PAD, 16),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
}

// A row Select opens, filled when under the cursor.
static void draw_button(GContext *ctx, const char *text, int y, int width, bool selected) {
  GRect button = GRect(PAD, y, width - 2 * PAD, 28);
  if (selected) {
    graphics_context_set_fill_color(ctx, g_theme->cursor_bg);
    graphics_fill_rect(ctx, button, 4, GCornersAll);
  } else {
    graphics_context_set_stroke_color(ctx, g_theme->divider);
    graphics_draw_round_rect(ctx, button, 4);
  }
  graphics_context_set_text_color(ctx, selected ? g_theme->cursor_text : g_theme->text);
  graphics_draw_text(ctx, text, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                     GRect(button.origin.x + 8, button.origin.y + 2, button.size.w - 16, 22),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
}

// Label above a single-line value; returns the y after its divider.
static int draw_row(GContext *ctx, const char *label, const char *value, int y, int width) {
  draw_label(ctx, label, y, width);
  graphics_context_set_text_color(ctx, g_theme->text);
  graphics_draw_text(ctx, value, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                     GRect(PAD, y + 12, width - 2 * PAD, 22), GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentLeft, NULL);
  draw_divider(ctx, y + 37, width);
  return y + 40;
}

static void body_update_proc(Layer *layer, GContext *ctx) {
  GRect b = layer_get_bounds(layer);
  const MyInfo *info = data_my_info();
  int w = b.size.w;
  bool summary = summary_available();
  bool onboard = onboard_is_set();
  // A row that went away (the flag cleared at 04:00) moves the cursor down.
  while (!row_available(s_cursor)) {
    s_cursor++;
  }
  // The content ends with the directory button, 242 px below the rows above.
  int top = onboard ? ONBOARD_ROW_HEIGHT : 0;
  int content = 242 + top + (summary ? SUMMARY_ROW_HEIGHT : 0);
  int scroll = s_cursor == ROW_DIRECTORY && content > b.size.h ? content - b.size.h : 0;
  int y = 2 - scroll;
  if (onboard) {
    draw_onboard(ctx, y - 2, w, s_cursor == ROW_ONBOARD);
    y += ONBOARD_ROW_HEIGHT;
  }
  if (summary) {
    draw_button(ctx, summary_shows_tomorrow() ? "Tomorrow's summary" : "Today's summary", y, w,
                s_cursor == ROW_SUMMARY);
    y += SUMMARY_ROW_HEIGHT;
  }

  draw_label(ctx, "STATEROOM", y, w);
  graphics_context_set_text_color(ctx, g_theme->text);
  graphics_draw_text(ctx, info->stateroom, fonts_get_system_font(FONT_KEY_GOTHIC_28_BOLD),
                     GRect(PAD, y + 10, 80, 32), GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentLeft, NULL);
  char where[48];
  snprintf(where, sizeof(where), "%s \xc2\xb7 %s", info->deck, info->stairs);
  graphics_context_set_text_color(ctx, g_theme->muted);
  graphics_draw_text(ctx, where, fonts_get_system_font(FONT_KEY_GOTHIC_18),
                     GRect(PAD + 70, y + 18, w - 2 * PAD - 70, 22),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentRight, NULL);
  draw_divider(ctx, y + 45, w);
  y += 48;

  y = draw_row(ctx, "MUSTER STATION", info->muster, y, w);
  y = draw_row(ctx, "DINING ROOM", info->dining, y, w);
  y = draw_row(ctx, "SHIP CLOCK", info->clock_note, y, w);

  y = draw_row(ctx, "LAST SYNC", info->last_sync, y, w);

  draw_button(ctx, "Ship directory", y + 2, w, s_cursor == ROW_DIRECTORY);
}

static void select_click(ClickRecognizerRef recognizer, void *context) {
  usage_press(BUTTON_ID_SELECT, 0, s_cursor);
  if (s_cursor == ROW_ONBOARD && onboard_is_set()) {
    // Back ashore: the row goes away and Home shows the countdown again if
    // its time hasn't passed (§4.4).
    onboard_set(false);
    vibes_short_pulse();
    s_cursor = ROW_SUMMARY;
    layer_mark_dirty(s_body);
    home_window_refresh();
  } else if (s_cursor == ROW_SUMMARY && summary_available()) {
    summary_window_push(summary_shows_tomorrow(), false);
  } else {
    dir_window_push(0, "Ship");
  }
}

static void move_click(ClickRecognizerRef recognizer, void *context) {
  int step = click_recognizer_get_button_id(recognizer) == BUTTON_ID_UP ? -1 : 1;
  int cursor = s_cursor + step;
  while (cursor >= ROW_ONBOARD && cursor <= ROW_DIRECTORY && !row_available(cursor)) {
    cursor += step;
  }
  if (cursor >= ROW_ONBOARD && cursor <= ROW_DIRECTORY) {
    usage_move(s_cursor, cursor);
    s_cursor = cursor;
    layer_mark_dirty(s_body);
  }
}

static void click_config(void *context) {
  window_single_click_subscribe(BUTTON_ID_SELECT, select_click);
  window_single_click_subscribe(BUTTON_ID_UP, move_click);
  window_single_click_subscribe(BUTTON_ID_DOWN, move_click);
}

static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect b = layer_get_bounds(root);
  window_set_background_color(window, g_theme->bg);

  s_top_bar = top_bar_create(GRect(0, 0, b.size.w, TOP_BAR_HEIGHT), BAND_INFO, BAND_LABEL_INFO,
                             "My Info");
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

void info_window_refresh(void) {
  if (s_body) {
    // The theme may have changed (settings page).
    window_set_background_color(s_window, g_theme->bg);
    layer_mark_dirty(s_top_bar);
    layer_mark_dirty(s_body);
  }
}

static void window_appear(Window *window) { usage_screen(SCREEN_INFO, 0); }

void info_window_push(void) {
  s_cursor = ROW_ONBOARD;
  s_window = window_create();
  window_set_click_config_provider(s_window, click_config);
  window_set_window_handlers(s_window, (WindowHandlers){
    .load = window_load,
    .appear = window_appear,
    .unload = window_unload,
  });
  window_stack_push(s_window, true);
}
