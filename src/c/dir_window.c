#include "screens.h"
#include "codec.h"
#include "comm.h"
#include "data.h"
#include "ui.h"

// Ship directory (docs/DESIGN_V1_1.md §3): decks (or areas), then one deck's
// or area's places, then one place with what's on there for the rest of today.
// The phone builds every page and sends one when a screen opens
// (docs/WATCH_PROTOCOL.md, Ship directory). Each screen keeps only its own
// page and nothing is stored, so without the phone the screen says so.

#define MAX_DEPTH 5
#define MAX_ROWS 40
#define REPLY_TIMEOUT_MS 8000
#define SEND_RETRY_MS 500
#define SEND_TRIES 4

#define HEADER_H 22
#define ITEM_H 30
#define ITEM2_H 44
#define EVENT_H 44
#define MESSAGE_H 84

typedef enum { STATE_LOADING, STATE_READY, STATE_NO_PHONE } State;

typedef struct {
  Window *window;
  Layer *top_bar;
  MenuLayer *menu;
  int32_t ref;
  char title[24];  // shown until the page arrives
  State state;
  int tries;
  AppTimer *timer;
  bool has_where;
  Where where;
  DirRow *rows;
  int row_count;
} View;

// Open directory screens, bottom to top. Only the top one waits for a page.
static View *s_views[MAX_DEPTH];
static int s_depth;

static View *top_view(void) { return s_depth > 0 ? s_views[s_depth - 1] : NULL; }

static bool selectable(const DirRow *r) {
  return r->kind == DIR_ROW_ITEM || r->kind == DIR_ROW_EVENT;
}

static int first_selectable(const View *v) {
  for (int row = 0; row < v->row_count; row++) {
    if (selectable(&v->rows[row])) {
      return row;
    }
  }
  return 0;
}

// ---- Asking the phone --------------------------------------------------------

static void set_state(View *v, State state) {
  v->state = state;
  if (v->menu) {
    menu_layer_reload_data(v->menu);
  }
}

static void cancel_timer(View *v) {
  if (v->timer) {
    app_timer_cancel(v->timer);
    v->timer = NULL;
  }
}

static void timed_out(void *context) {
  View *v = context;
  v->timer = NULL;
  if (v->state == STATE_LOADING) {
    set_state(v, STATE_NO_PHONE);
  }
}

// The outbox may be busy with star changes or a SAVED report: try again shortly.
static void send_request(void *context) {
  View *v = context;
  v->timer = NULL;
  if (!connection_service_peek_pebble_app_connection()) {
    set_state(v, STATE_NO_PHONE);
  } else if (comm_request_dir(v->ref)) {
    v->timer = app_timer_register(REPLY_TIMEOUT_MS, timed_out, v);
  } else if (++v->tries < SEND_TRIES) {
    v->timer = app_timer_register(SEND_RETRY_MS, send_request, v);
  } else {
    set_state(v, STATE_NO_PHONE);
  }
}

static void request(View *v) {
  cancel_timer(v);
  v->tries = 0;
  set_state(v, STATE_LOADING);
  send_request(v);
}

static void page_received(const DirPageMsg *page) {
  View *v = top_view();
  if (!v || v->state == STATE_READY || page->ref != v->ref) {
    return;
  }
  cancel_timer(v);
  // Count the whole rows, then keep exactly those.
  const uint8_t *end = page->rows ? page->rows + page->rows_length : NULL;
  const uint8_t *p = page->rows;
  DirRow row;
  int count = 0;
  while (p && count < MAX_ROWS && codec_read_dir_row(&p, end, &row)) {
    count++;
  }
  free(v->rows);
  v->rows = count > 0 ? malloc(count * sizeof(DirRow)) : NULL;
  if (!v->rows) {
    count = 0;
  }
  p = page->rows;
  for (int i = 0; i < count; i++) {
    codec_read_dir_row(&p, end, &v->rows[i]);
  }
  v->row_count = count;
  v->has_where = page->has_where;
  v->where = page->where;
  top_bar_set(v->top_bar, BAND_INFO, BAND_LABEL, page->title);
  top_bar_set_right(v->top_bar, page->label, page->has_rel, page->rel);
  set_state(v, STATE_READY);
  menu_layer_set_selected_index(v->menu, MenuIndex(0, first_selectable(v)), MenuRowAlignNone, false);
}

static void request_failed(void) {
  View *v = top_view();
  if (v && v->state == STATE_LOADING) {
    cancel_timer(v);
    set_state(v, STATE_NO_PHONE);
  }
}

// ---- Drawing -----------------------------------------------------------------

static int text_height(const char *text, GFont font, int w, int max_h) {
  return graphics_text_layout_get_content_size(text, font, GRect(0, 0, w, max_h),
                                               GTextOverflowModeTrailingEllipsis,
                                               GTextAlignmentLeft).h;
}

// A heading: the name (up to two lines); on a place page, where it is, how far
// from the cabin and its area.
static int place_height(const View *v, const DirRow *r, int w) {
  int h = 2 + text_height(r->line1, fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD), w - 2 * PAD, 58) + 4;
  if (v->has_where && where_known(&v->where)) {
    h += 22;
  }
  if (v->has_where && where_has_rel(&v->where)) {
    h += 18;
  }
  if (r->line2[0]) {
    h += 18;
  }
  return h + 2;
}

static void draw_place(GContext *ctx, const View *v, const DirRow *r, int w) {
  GFont name_font = fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD);
  int name_h = text_height(r->line1, name_font, w - 2 * PAD, 58);
  int y = 2;
  graphics_context_set_text_color(ctx, g_theme->text);
  graphics_draw_text(ctx, r->line1, name_font, GRect(PAD, y - 4, w - 2 * PAD, name_h + 4),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  y += name_h + 4;
  if (v->has_where && where_known(&v->where)) {
    char loc[24];
    fmt_where(loc, sizeof(loc), &v->where);
    graphics_context_set_text_color(ctx, where_ashore(&v->where) ? g_theme->port_accent : g_theme->text);
    graphics_draw_text(ctx, loc, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                       GRect(PAD, y - 2, w - 2 * PAD, 22), GTextOverflowModeTrailingEllipsis,
                       GTextAlignmentLeft, NULL);
    y += 22;
    y += draw_rel_line(ctx, false, g_theme->muted, PAD, y - 2, w - 2 * PAD, &v->where) ? 18 : 0;
  }
  if (r->line2[0]) {
    graphics_context_set_text_color(ctx, g_theme->muted);
    graphics_draw_text(ctx, r->line2, fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD),
                       GRect(PAD, y - 2, w - 2 * PAD, 18), GTextOverflowModeTrailingEllipsis,
                       GTextAlignmentLeft, NULL);
  }
}

// "2:00p - 3:00p", "2:00p", "Now · until 3:00p" or "All day".
static void fmt_event_time(char *buf, size_t size, const DirRow *r) {
  if (r->start == NO_TIME) {
    snprintf(buf, size, "All day");
    return;
  }
  char start[8], end[8];
  fmt_clock(start, sizeof(start), r->start);
  fmt_clock(end, sizeof(end), r->start + r->minutes);
  int32_t now = data_ready() ? now_cruise() : NO_TIME;
  if (r->minutes > 0 && now != NO_TIME && now >= r->start && now < r->start + r->minutes) {
    snprintf(buf, size, "Now \xc2\xb7 until %s", end);
  } else if (r->minutes > 0) {
    snprintf(buf, size, "%s - %s", start, end);
  } else {
    snprintf(buf, size, "%s", start);
  }
}

static void draw_two_lines(GContext *ctx, const char *line1, const char *line2, int w,
                           GColor text, GColor muted) {
  graphics_context_set_text_color(ctx, text);
  graphics_draw_text(ctx, line1, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD), GRect(PAD, 0, w, 22),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  graphics_context_set_text_color(ctx, muted);
  graphics_draw_text(ctx, line2, fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD), GRect(PAD, 21, w, 18),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
}

// Loading or no phone, drawn over the cursor's highlight: it isn't a choice.
static void draw_message(GContext *ctx, const View *v, GRect b) {
  int w = b.size.w;
  GColor text = g_theme->text;
  GColor muted = g_theme->muted;
  graphics_context_set_fill_color(ctx, g_theme->bg);
  graphics_fill_rect(ctx, b, 0, GCornerNone);
  if (v->state == STATE_LOADING) {
    graphics_context_set_text_color(ctx, muted);
    graphics_draw_text(ctx, "Loading...", fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                       GRect(PAD, 20, w - 2 * PAD, 22), GTextOverflowModeTrailingEllipsis,
                       GTextAlignmentCenter, NULL);
    return;
  }
  graphics_context_set_text_color(ctx, text);
  graphics_draw_text(ctx, "Connect your phone", fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                     GRect(PAD, 4, w - 2 * PAD, 22), GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentLeft, NULL);
  graphics_context_set_text_color(ctx, muted);
  graphics_draw_text(ctx, "The ship directory comes from your phone. Select to try again.",
                     fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD), GRect(PAD, 26, w - 2 * PAD, 54),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
}

static uint16_t get_num_rows(MenuLayer *menu, uint16_t section, void *context) {
  View *v = context;
  return v->state == STATE_READY && v->row_count > 0 ? v->row_count : 1;
}

static int16_t get_cell_height(MenuLayer *menu, MenuIndex *index, void *context) {
  View *v = context;
  if (v->state != STATE_READY || index->row >= v->row_count) {
    return MESSAGE_H;
  }
  const DirRow *r = &v->rows[index->row];
  switch (r->kind) {
    case DIR_ROW_HEADER: return HEADER_H;
    case DIR_ROW_EVENT: return EVENT_H;
    case DIR_ROW_PLACE:
      return place_height(v, r, layer_get_bounds(menu_layer_get_layer(menu)).size.w);
    default: return r->line2[0] ? ITEM2_H : ITEM_H;
  }
}

static int16_t get_separator_height(MenuLayer *menu, MenuIndex *index, void *context) {
  return 1;
}

// A divider between two rows the cursor can reach; none around headers. The
// separator's index is the row below it.
static void draw_separator(GContext *ctx, const Layer *cell, MenuIndex *index, void *context) {
  View *v = context;
  if (v->state == STATE_READY && index->row > 0 && index->row < v->row_count &&
      selectable(&v->rows[index->row]) && selectable(&v->rows[index->row - 1])) {
    draw_divider(ctx, 0, layer_get_bounds(cell).size.w);
  }
}

static void draw_row(GContext *ctx, const Layer *cell, MenuIndex *index, void *context) {
  View *v = context;
  int w = layer_get_bounds(cell).size.w;
  bool highlighted = menu_cell_layer_is_highlighted(cell);
  GColor text = highlighted ? g_theme->cursor_text : g_theme->text;
  GColor muted = highlighted ? g_theme->cursor_text : g_theme->muted;
  if (v->state != STATE_READY || index->row >= v->row_count) {
    draw_message(ctx, v, layer_get_bounds(cell));
    return;
  }
  const DirRow *r = &v->rows[index->row];
  switch (r->kind) {
    case DIR_ROW_HEADER:
      graphics_context_set_text_color(ctx, muted);
      graphics_draw_text(ctx, r->line1, fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD),
                         GRect(PAD, 4, w - 2 * PAD, 18), GTextOverflowModeTrailingEllipsis,
                         GTextAlignmentLeft, NULL);
      break;
    case DIR_ROW_PLACE:
      draw_place(ctx, v, r, w);
      break;
    case DIR_ROW_EVENT: {
      int text_w = w - 2 * PAD;
      if (r->flags & EVENT_STARRED) {
        draw_star(ctx, GPoint(w - PAD - 6, 12), highlighted ? g_theme->cursor_text : g_theme->sea_accent);
        text_w -= 16;
      }
      char time_buf[32];
      fmt_event_time(time_buf, sizeof(time_buf), r);
      draw_two_lines(ctx, r->line1, time_buf, text_w, text, muted);
      break;
    }
    default:
      // Rows that open nothing ("Nothing else on here") are muted.
      if (r->line2[0]) {
        draw_two_lines(ctx, r->line1, r->line2, w - 2 * PAD, r->ref ? text : muted, muted);
      } else {
        graphics_context_set_text_color(ctx, r->ref ? text : muted);
        graphics_draw_text(ctx, r->line1, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                           GRect(PAD, 2, w - 2 * PAD, 22), GTextOverflowModeTrailingEllipsis,
                           GTextAlignmentLeft, NULL);
      }
      break;
  }
}

// The cursor skips headers and a place's heading.
static void selection_will_change(MenuLayer *menu, MenuIndex *new_index, MenuIndex old_index,
                                  void *context) {
  View *v = context;
  if (v->state != STATE_READY) {
    return;
  }
  int step = new_index->row >= old_index.row ? 1 : -1;
  for (int row = new_index->row; row >= 0 && row < v->row_count; row += step) {
    if (selectable(&v->rows[row])) {
      new_index->row = row;
      return;
    }
  }
  *new_index = old_index;
}

static void select_click(MenuLayer *menu, MenuIndex *index, void *context) {
  View *v = context;
  if (v->state == STATE_NO_PHONE) {
    request(v);
  } else if (v->state == STATE_READY && index->row < v->row_count) {
    const DirRow *r = &v->rows[index->row];
    if (r->kind == DIR_ROW_ITEM && r->ref != 0) {
      dir_window_push(r->ref, r->line1);
    }
  }
}

// ---- Window ------------------------------------------------------------------

static void window_load(Window *window) {
  View *v = window_get_user_data(window);
  Layer *root = window_get_root_layer(window);
  GRect b = layer_get_bounds(root);
  window_set_background_color(window, g_theme->bg);

  v->top_bar = top_bar_create(GRect(0, 0, b.size.w, TOP_BAR_HEIGHT), BAND_INFO, BAND_LABEL, v->title);
  top_bar_set_right(v->top_bar, "", false, 0);
  layer_add_child(root, v->top_bar);

  v->menu = menu_layer_create(GRect(0, TOP_BAR_HEIGHT, b.size.w, b.size.h - TOP_BAR_HEIGHT));
  menu_layer_set_callbacks(v->menu, v, (MenuLayerCallbacks){
    .get_num_rows = get_num_rows,
    .get_cell_height = get_cell_height,
    .get_separator_height = get_separator_height,
    .draw_separator = draw_separator,
    .draw_row = draw_row,
    .select_click = select_click,
    .selection_will_change = selection_will_change,
  });
  menu_layer_set_normal_colors(v->menu, g_theme->bg, g_theme->text);
  menu_layer_set_highlight_colors(v->menu, g_theme->cursor_bg, g_theme->cursor_text);
  menu_layer_set_click_config_onto_window(v->menu, window);
  layer_add_child(root, menu_layer_get_layer(v->menu));
  request(v);
}

static void window_unload(Window *window) {
  View *v = window_get_user_data(window);
  cancel_timer(v);
  menu_layer_destroy(v->menu);
  top_bar_destroy(v->top_bar);
  free(v->rows);
  for (int i = 0; i < s_depth; i++) {
    if (s_views[i] == v) {
      for (int j = i; j + 1 < s_depth; j++) {
        s_views[j] = s_views[j + 1];
      }
      s_depth--;
      break;
    }
  }
  if (s_depth == 0) {
    comm_set_dir_handlers(NULL, NULL);
  }
  window_destroy(window);
  free(v);
}

void dir_window_push(int32_t ref, const char *title) {
  if (s_depth >= MAX_DEPTH) {
    return;
  }
  View *v = malloc(sizeof(View));
  if (!v) {
    return;
  }
  memset(v, 0, sizeof(View));
  v->ref = ref;
  strncpy(v->title, title, sizeof(v->title) - 1);
  v->window = window_create();
  window_set_user_data(v->window, v);
  window_set_window_handlers(v->window, (WindowHandlers){
    .load = window_load,
    .unload = window_unload,
  });
  s_views[s_depth++] = v;
  comm_set_dir_handlers(page_received, request_failed);
  window_stack_push(v->window, true);
}

void dir_window_refresh(void) {
  for (int i = 0; i < s_depth; i++) {
    View *v = s_views[i];
    if (v->menu) {
      // The theme may have changed (settings page).
      window_set_background_color(v->window, g_theme->bg);
      menu_layer_set_normal_colors(v->menu, g_theme->bg, g_theme->text);
      menu_layer_set_highlight_colors(v->menu, g_theme->cursor_bg, g_theme->cursor_text);
      layer_mark_dirty(v->top_bar);
      layer_mark_dirty(menu_layer_get_layer(v->menu));
    }
  }
}
