#include "screens.h"
#include "data.h"
#include "ui.h"
#include "usage.h"

// My info: the day's summary (docs/DESIGN_V1_1.md §8.1) at the top, then the
// stateroom (with deck and stairs), muster station, ship clock note, last sync,
// and the way into the ship directory. Up and Down move the cursor between the
// summary and the directory, Select opens it; the screen scrolls up a little
// for the directory.

static Window *s_window;
static Layer *s_top_bar;
static Layer *s_body;

enum { ROW_SUMMARY, ROW_DIRECTORY };
static int s_cursor;
#define SUMMARY_ROW_HEIGHT 32

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

static void draw_label(GContext *ctx, const char *text, int y, int width) {
  graphics_context_set_text_color(ctx, g_theme->muted);
  graphics_draw_text(ctx, text, fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD),
                     GRect(PAD, y, width - 2 * PAD, 16), GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentLeft, NULL);
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
  if (!summary) {
    s_cursor = ROW_DIRECTORY;
  }
  // The content ends with the directory button, 202 px below the rows above.
  int content = 202 + (summary ? SUMMARY_ROW_HEIGHT : 0);
  int scroll = s_cursor == ROW_DIRECTORY && content > b.size.h ? content - b.size.h : 0;
  int y = 2 - scroll;
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
  y = draw_row(ctx, "SHIP CLOCK", info->clock_note, y, w);

  y = draw_row(ctx, "LAST SYNC", info->last_sync, y, w);

  draw_button(ctx, "Ship directory", y + 2, w, s_cursor == ROW_DIRECTORY);
}

static void select_click(ClickRecognizerRef recognizer, void *context) {
  usage_press(BUTTON_ID_SELECT, 0, s_cursor);
  if (s_cursor == ROW_SUMMARY && summary_available()) {
    summary_window_push(summary_shows_tomorrow(), false);
  } else {
    dir_window_push(0, "Ship");
  }
}

static void move_click(ClickRecognizerRef recognizer, void *context) {
  int cursor = click_recognizer_get_button_id(recognizer) == BUTTON_ID_UP ? ROW_SUMMARY : ROW_DIRECTORY;
  if (cursor != s_cursor && (cursor == ROW_DIRECTORY || summary_available())) {
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
  s_cursor = ROW_SUMMARY;
  s_window = window_create();
  window_set_click_config_provider(s_window, click_config);
  window_set_window_handlers(s_window, (WindowHandlers){
    .load = window_load,
    .appear = window_appear,
    .unload = window_unload,
  });
  window_stack_push(s_window, true);
}
