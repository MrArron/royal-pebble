#include "screens.h"
#include "codec.h"
#include "comm.h"
#include "data.h"
#include "fetch.h"
#include "lines.h"
#include "ui.h"
#include "usage.h"

// Ship directory (docs/DESIGN.md §10.1): decks (or areas), then one deck's
// or area's places, then one place with what's on there for the rest of today.
// The phone builds every page and sends one when a screen opens
// (docs/WATCH_PROTOCOL.md, Ship directory). Each screen keeps only its own
// page and nothing is stored, so without the phone the screen says so.

#define MAX_DEPTH 5
#define MAX_ROWS 40

#define HEADER_H 22
#define ITEM_H 30
#define ITEM2_H 44
#define EVENT_H 44
#define MESSAGE_H 84
#define INDICATOR_H 12

typedef struct {
  Window *window;
  Layer *top_bar;
  MenuLayer *menu;
  int32_t ref;
  char title[24];  // shown until the page arrives
  Fetch fetch;
  uint8_t *lines;  // the heading's card (lines.h), drawn as sent
  int lines_length;
  Layer *more_above;  // scroll indicators (place pages)
  Layer *more_below;
  bool indicators_on;
  DirRow *rows;
  int row_count;
} View;

// Open directory screens, bottom to top. Only the top one waits for a page.
static View *s_views[MAX_DEPTH];
static int s_depth;

static View *top_view(void) { return s_depth > 0 ? s_views[s_depth - 1] : NULL; }

// A place page's heading (a venue or an elevator bank) takes the cursor
// (drawn without the highlight), so the page opens at its top however tall the
// heading is; an area's heading doesn't.
static bool selectable(const DirRow *r) {
  return r->kind == DIR_ROW_ITEM || r->kind == DIR_ROW_EVENT ||
         (r->kind == DIR_ROW_PLACE && (r->flags & DIR_PLACE_PAGE));
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

static void state_changed(void *owner) {
  View *v = owner;
  if (v->menu) {
    menu_layer_reload_data(v->menu);
  }
}

static bool send_request(void *owner) { return comm_request_dir(((View *)owner)->ref); }

// Muted triangles under the top bar and at the bottom while a place page has
// more above or below (docs/mockups/gps/NOTES.md). The menu's scroll layer
// keeps them up to date.
static void set_indicators(View *v) {
#if defined(PBL_ROUND)
  // The scroll arc (more_above) instead, and the card in the body's column,
  // which the phone laid it out for (the list is wider).
  scroll_layer_set_frame(menu_layer_get_scroll_layer(v->menu),
                         BODY_FRAME(layer_get_bounds(window_get_root_layer(v->window))));
  layer_set_hidden(v->more_above, false);
#else
  set_scroll_indicators(menu_layer_get_scroll_layer(v->menu), v->more_above, v->more_below);
#endif
  v->indicators_on = true;
}

static void page_received(const DirPageMsg *page) {
  View *v = top_view();
  if (!v || v->fetch.state == FETCH_READY || page->ref != v->ref) {
    return;
  }
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
  free(v->lines);
  v->lines = page->lines_length > 0 ? malloc(page->lines_length) : NULL;
  v->lines_length = v->lines ? page->lines_length : 0;
  if (v->lines) {
    memcpy(v->lines, page->lines, v->lines_length);
    set_indicators(v);
#if defined(PBL_ROUND)
    // The page is one tall row: keep its top in view, not its middle.
    menu_layer_set_center_focused(v->menu, false);
#endif
  }
  top_bar_set(v->top_bar, BAND_INFO, BAND_LABEL, page->title);
  top_bar_set_right(v->top_bar, page->label, page->has_rel, page->rel);
  fetch_done(&v->fetch);
  menu_layer_set_selected_index(v->menu, MenuIndex(0, first_selectable(v)), MenuRowAlignNone, false);
}

static void request_failed(bool script_down) {
  View *v = top_view();
  if (v) {
    fetch_failed(&v->fetch, script_down);
  }
}

static void phone_up(void) {
  View *v = top_view();
  if (v) {
    fetch_phone_up(&v->fetch);
  }
}

// ---- Drawing -----------------------------------------------------------------

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

#if defined(PBL_ROUND)
// Round 2 (docs/mockups/round/Directory): a place's name with its second line
// under it, larger on the pill; an event's time above its title.
static void fill_round_row(RoundRow *r, char *top, size_t size, const DirRow *d) {
  *r = (RoundRow){.top = "", .top_color = g_theme->muted, .title = d->line1, .sub = d->line2, .big = true};
  if (d->kind == DIR_ROW_EVENT) {
    fmt_event_time(top, size, d);
    r->top = top;
    r->sub = "";
    r->big = false;
    r->icons = (d->flags & EVENT_STARRED) ? ROUND_ROW_STAR : 0;
  }
}
#endif

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
  if (v->fetch.state == FETCH_LOADING) {
    graphics_context_set_text_color(ctx, muted);
    graphics_draw_text(ctx, "Loading...", fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                       GRect(PAD, 20, w - 2 * PAD, 22), GTextOverflowModeTrailingEllipsis,
                       GTextAlignmentCenter, NULL);
    return;
  }
  graphics_context_set_text_color(ctx, text);
  graphics_draw_text(ctx, "Connect your phone", fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                     GRect(PAD, 4, w - 2 * PAD, 22), GTextOverflowModeTrailingEllipsis,
                     TEXT_ALIGN, NULL);
  graphics_context_set_text_color(ctx, muted);
  graphics_draw_text(ctx, "The ship directory comes from your phone. Select to try again.",
                     fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD), GRect(PAD, 26, w - 2 * PAD, 54),
                     GTextOverflowModeTrailingEllipsis, TEXT_ALIGN, NULL);
}

static uint16_t get_num_rows(MenuLayer *menu, uint16_t section, void *context) {
  View *v = context;
  return v->fetch.state == FETCH_READY && v->row_count > 0 ? v->row_count : 1;
}

static int16_t get_cell_height(MenuLayer *menu, MenuIndex *index, void *context) {
  View *v = context;
  if (v->fetch.state != FETCH_READY || index->row >= v->row_count) {
    return MESSAGE_H;
  }
  const DirRow *r = &v->rows[index->row];
#if defined(PBL_ROUND)
  if (r->kind == DIR_ROW_ITEM || r->kind == DIR_ROW_EVENT) {
    RoundRow round;
    char top[32];
    fill_round_row(&round, top, sizeof(top), r);
    // Under a card the selection isn't centered and rows keep their height.
    return round_row_height(&round, !v->lines && menu_layer_is_index_selected(menu, index));
  }
#endif
  switch (r->kind) {
    case DIR_ROW_HEADER: return HEADER_H;
    case DIR_ROW_EVENT: return EVENT_H;
    case DIR_ROW_PLACE:
      return lines_draw(NULL, v->lines, v->lines_length, layer_get_bounds(menu_layer_get_layer(menu)).size.w);
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
  if (v->fetch.state == FETCH_READY && index->row > 0 && index->row < v->row_count &&
      selectable(&v->rows[index->row]) && selectable(&v->rows[index->row - 1])) {
#if defined(PBL_ROUND)
    round_divider(ctx, cell, v->menu, index);
#else
    draw_divider(ctx, 0, layer_get_bounds(cell).size.w);
#endif
  }
}

static void draw_row(GContext *ctx, const Layer *cell, MenuIndex *index, void *context) {
  View *v = context;
  int w = layer_get_bounds(cell).size.w;
  bool highlighted = menu_cell_layer_is_highlighted(cell);
  GColor text = highlighted ? g_theme->cursor_text : g_theme->text;
  GColor muted = highlighted ? g_theme->cursor_text : g_theme->muted;
  if (v->fetch.state != FETCH_READY || index->row >= v->row_count) {
    draw_message(ctx, v, layer_get_bounds(cell));
    return;
  }
  const DirRow *r = &v->rows[index->row];
#if defined(PBL_ROUND)
  if (r->kind == DIR_ROW_ITEM || r->kind == DIR_ROW_EVENT) {
    RoundRow round;
    char top[32];
    fill_round_row(&round, top, sizeof(top), r);
    round_row_draw(ctx, cell, &round, highlighted);
    return;
  }
#endif
  switch (r->kind) {
    case DIR_ROW_HEADER:
      graphics_context_set_text_color(ctx, muted);
      graphics_draw_text(ctx, r->line1, fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD),
                         GRect(PAD, 4, w - 2 * PAD, 18), GTextOverflowModeTrailingEllipsis,
                         TEXT_ALIGN, NULL);
      break;
    case DIR_ROW_PLACE:
      // Drawn over the cursor's highlight: the heading only keeps the page's top in view.
      graphics_context_set_fill_color(ctx, g_theme->bg);
      graphics_fill_rect(ctx, layer_get_bounds(cell), 0, GCornerNone);
      lines_draw(ctx, v->lines, v->lines_length, w);
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
      // Rows that open nothing ("Nothing else on here") are muted, and so are
      // elevator banks.
      if (!r->ref || (r->flags & DIR_ITEM_MUTED)) {
        text = muted;
      }
      if (r->line2[0]) {
        draw_two_lines(ctx, r->line1, r->line2, w - 2 * PAD, text, muted);
      } else {
        graphics_context_set_text_color(ctx, text);
        graphics_draw_text(ctx, r->line1, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                           GRect(PAD, 2, w - 2 * PAD, 22), GTextOverflowModeTrailingEllipsis,
                           GTextAlignmentLeft, NULL);
      }
      break;
  }
}

// The cursor skips headers and a place's heading.
static void skip_unselectable(View *v, MenuIndex *new_index, MenuIndex old_index) {
  if (v->fetch.state != FETCH_READY) {
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

static void selection_will_change(MenuLayer *menu, MenuIndex *new_index, MenuIndex old_index,
                                  void *context) {
  skip_unselectable(context, new_index, old_index);
  usage_move(old_index.row, new_index->row);
}

static void select_click(MenuLayer *menu, MenuIndex *index, void *context) {
  View *v = context;
  uint8_t nothing = USAGE_NOTHING;
  if (v->fetch.state == FETCH_NO_PHONE) {
    nothing = 0;
    fetch_start(&v->fetch);
  } else if (v->fetch.state == FETCH_READY && index->row < v->row_count) {
    const DirRow *r = &v->rows[index->row];
    if (r->kind == DIR_ROW_ITEM && r->ref != 0) {
      nothing = 0;
      usage_press(BUTTON_ID_SELECT, 0, index->row);
      dir_window_push(r->ref, r->line1);
      return;
    } else if (r->kind == DIR_ROW_PLACE && (r->flags & DIR_PLACE_ROUTE)) {
      nothing = 0;
      usage_press(BUTTON_ID_SELECT, 0, index->row);
      route_window_push(v->ref, false, r->line1, r->line2);
      return;
    }
  }
  usage_press(BUTTON_ID_SELECT, nothing, index->row);
}

// On a place page's heading: the route to its closest restroom.
static void select_long_click(MenuLayer *menu, MenuIndex *index, void *context) {
  View *v = context;
  bool rest = v->fetch.state == FETCH_READY && index->row < v->row_count &&
              v->rows[index->row].kind == DIR_ROW_PLACE && (v->rows[index->row].flags & DIR_PLACE_REST);
  usage_press(BUTTON_ID_SELECT, USAGE_LONG | (rest ? 0 : USAGE_NOTHING), index->row);
  if (rest) {
    route_window_push(v->ref, true, "Restroom", "");
  }
}

// ---- Window ------------------------------------------------------------------

static void window_load(Window *window) {
  View *v = window_get_user_data(window);
  Layer *root = window_get_root_layer(window);
  GRect b = layer_get_bounds(root);
  window_set_background_color(window, g_theme->bg);

  v->top_bar = top_bar_create(TOP_BAR_FRAME(b), BAND_INFO, BAND_LABEL, v->title);
  top_bar_set_right(v->top_bar, "", false, 0);
  layer_add_child(root, v->top_bar);

  v->menu = menu_layer_create(LIST_FRAME(b));
  menu_layer_set_callbacks(v->menu, v, (MenuLayerCallbacks){
    .get_num_rows = get_num_rows,
    .get_cell_height = get_cell_height,
    .get_separator_height = get_separator_height,
    .draw_separator = draw_separator,
    .draw_row = draw_row,
    .select_click = select_click,
    .select_long_click = select_long_click,
    .selection_will_change = selection_will_change,
  });
  menu_layer_set_normal_colors(v->menu, g_theme->bg, g_theme->text);
  menu_layer_set_highlight_colors(v->menu, LIST_CURSOR_BG, g_theme->cursor_text);
  menu_layer_set_click_config_onto_window(v->menu, window);
  layer_add_child(root, menu_layer_get_layer(v->menu));
#if defined(PBL_ROUND)
  // Place pages: the scroll arc, shown when the card arrives (more_below stays NULL).
  v->more_above = scroll_arc_create(b, menu_layer_get_scroll_layer(v->menu));
  layer_set_hidden(v->more_above, true);
  layer_add_child(root, v->more_above);
#else
  v->more_above = layer_create(GRect(BODY_INSET_X, TOP_BAR_HEIGHT, b.size.w - 2 * BODY_INSET_X, INDICATOR_H));
  v->more_below = layer_create(GRect(BODY_INSET_X, b.size.h - BODY_INSET_BOTTOM - INDICATOR_H,
                                     b.size.w - 2 * BODY_INSET_X, INDICATOR_H));
  layer_add_child(root, v->more_above);
  layer_add_child(root, v->more_below);
#endif
  fetch_start(&v->fetch);
}

static void window_unload(Window *window) {
  View *v = window_get_user_data(window);
  fetch_cancel(&v->fetch);
  menu_layer_destroy(v->menu);
  layer_destroy(v->more_above);
#if !defined(PBL_ROUND)
  layer_destroy(v->more_below);
#endif
  top_bar_destroy(v->top_bar);
  free(v->rows);
  free(v->lines);
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
    comm_set_dir_handlers(NULL, NULL, NULL);
  }
  window_destroy(window);
  free(v);
}

static void window_appear(Window *window) {
  View *v = window_get_user_data(window);
  usage_screen(SCREEN_DIR, v->ref);
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
  v->fetch = (Fetch){.send = send_request, .changed = state_changed, .owner = v};
  v->window = window_create();
  window_set_user_data(v->window, v);
  window_set_window_handlers(v->window, (WindowHandlers){
    .load = window_load,
    .appear = window_appear,
    .unload = window_unload,
  });
  s_views[s_depth++] = v;
  comm_set_dir_handlers(page_received, request_failed, phone_up);
  window_stack_push(v->window, true);
}

void dir_window_refresh(void) {
  for (int i = 0; i < s_depth; i++) {
    View *v = s_views[i];
    if (v->menu) {
      // The theme may have changed (settings page).
      window_set_background_color(v->window, g_theme->bg);
      menu_layer_set_normal_colors(v->menu, g_theme->bg, g_theme->text);
      menu_layer_set_highlight_colors(v->menu, LIST_CURSOR_BG, g_theme->cursor_text);
      if (v->indicators_on) {
        set_indicators(v);
      }
      layer_mark_dirty(v->top_bar);
      layer_mark_dirty(menu_layer_get_layer(v->menu));
    }
  }
}
