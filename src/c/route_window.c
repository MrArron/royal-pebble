#include "screens.h"
#include "comm.h"
#include "fetch.h"
#include "lines.h"
#include "ui.h"
#include "usage.h"

// Route screen (docs/DESIGN.md §10.3): the walking route to a place, from
// a place to its closest restroom, or to Home's NEXT event (§4.1), one line
// per step with a drawn glyph.
// The phone builds the whole page as lines (docs/WATCH_PROTOCOL.md, Route
// screen); the watch only draws them and keeps nothing once the screen closes.

static Window *s_window;
static Layer *s_top_bar;
static ScrollPage s_page;

static int32_t s_ref;
static bool s_rest;
static int32_t s_start;          // the event's start (Home's NEXT), else NO_TIME
static Fetch s_fetch;

// On the heap while the screen is open (static data must stay under 64 KB:
// docs/PLAN.md).
typedef struct {
  char venue[VENUE_LEN];  // the event's venue, as the phone is asked
  char title[40];         // the destination, until the page comes
  char header[32];        // "FROM YOUR CABIN", "CLOSEST TO ROYAL THEATER"
  uint8_t *lines;         // the phone's page
  int length;
} Route;
static Route *s_r;

// ---- Drawing -----------------------------------------------------------------

// Until the page comes: the destination, the header and a divider, then
// `Finding route…` or, with the phone away, `Connect your phone`. Laid out as
// the phone lays out its pages (src/pkjs/pagelines.js). Returns the length.
static int own_lines(uint8_t *buf) {
  uint8_t *p = lines_put(buf, LINE_FONT_24 | LINE_COLOR(LINE_TEXT), LINE_PLAIN, -2, 58, s_r->title);
  int8_t divider = 8;
#if !defined(PBL_ROUND)
  if (s_r->header[0]) {
    p = lines_put(p, LINE_FONT_14 | LINE_COLOR(LINE_MUTED), LINE_PLAIN, 4, LINE_H14, s_r->header);
    divider = 22 - LINE_H14;
  }
#endif
  p = lines_put(p, 0, LINE_DIVIDER, divider, ROUTE_DIVIDER_INSET, "");
  if (s_fetch.state == FETCH_NO_PHONE) {
    p = lines_put(p, LINE_FONT_18 | LINE_CENTER | LINE_COLOR(LINE_TEXT), LINE_PLAIN, 21, LINE_H18,
                  "Connect your phone");
    p = lines_put(p, LINE_FONT_14 | LINE_CENTER | LINE_COLOR(LINE_MUTED), LINE_PLAIN, 22 - LINE_H18, LINE_H14,
                  "Select tries again");
  } else {
    p = lines_put(p, LINE_FONT_18 | LINE_CENTER | LINE_COLOR(LINE_MUTED), LINE_PLAIN, 31, LINE_H18,
                  "Finding route\xe2\x80\xa6");
  }
  return p - buf;
}

static void content_update(Layer *layer, GContext *ctx) {
  int w = layer_get_bounds(layer).size.w;
  int y;
  if (s_fetch.state == FETCH_READY) {
    y = lines_draw(ctx, s_r->lines, s_r->length, w);
  } else {
    uint8_t buf[160];
    y = lines_draw(ctx, buf, own_lines(buf), w);
  }
  scroll_page_fit(&s_page, y);
}

// ---- Asking the phone --------------------------------------------------------

static void state_changed(void *owner) { scroll_page_top(&s_page); }

static bool send_request(void *owner) { return comm_request_route(s_ref, s_rest, s_start, s_r->venue); }

static void page_received(const RoutePageMsg *page) {
  if (!s_window || s_fetch.state == FETCH_READY || page->ref != s_ref || page->rest != s_rest ||
      page->start != s_start) {
    return;
  }
  free(s_r->lines);
  s_r->lines = malloc(page->length);
  if (!s_r->lines) {
    return;
  }
  memcpy(s_r->lines, page->lines, page->length);
  s_r->length = page->length;
#if defined(PBL_ROUND)
  // The header sits in the top bar's label line (docs/mockups/round/Route).
  top_bar_set_right(s_top_bar, page->label, false, 0);
#endif
  fetch_done(&s_fetch);
}

static void request_failed(bool script_down) { fetch_failed(&s_fetch, script_down); }

static void phone_up(void) { fetch_phone_up(&s_fetch); }

// ---- Window ------------------------------------------------------------------

static void select_click(ClickRecognizerRef recognizer, void *context) {
  usage_press(BUTTON_ID_SELECT, s_fetch.state == FETCH_NO_PHONE ? 0 : USAGE_NOTHING, -1);
  if (s_fetch.state == FETCH_NO_PHONE) {
    fetch_start(&s_fetch);
  }
}

static void select_long_click(ClickRecognizerRef recognizer, void *context) {
  usage_press(BUTTON_ID_SELECT, USAGE_LONG, -1);
  ask_window_push();
}

static void click_config(void *context) {
  window_single_click_subscribe(BUTTON_ID_SELECT, select_click);
  window_long_click_subscribe(BUTTON_ID_SELECT, 700, select_long_click, NULL);
}

static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect b = layer_get_bounds(root);
  window_set_background_color(window, g_theme->bg);

  s_top_bar = top_bar_create(TOP_BAR_FRAME(b), BAND_INFO, BAND_LABEL, "Route");
#if defined(PBL_ROUND)
  top_bar_set_right(s_top_bar, s_r->header, false, 0);
#else
  top_bar_set_right(s_top_bar, "", false, 0);
#endif
  layer_add_child(root, s_top_bar);
  scroll_page_create(&s_page, window, root, BODY_FRAME(b), content_update, click_config);
  fetch_start(&s_fetch);
}

static void window_unload(Window *window) {
  fetch_cancel(&s_fetch);
  comm_set_route_handlers(NULL, NULL, NULL);
  scroll_page_destroy(&s_page);
  top_bar_destroy(s_top_bar);
  window_destroy(window);
  s_window = NULL;
  free(s_r->lines);
  free(s_r);
  s_r = NULL;
}

static void window_appear(Window *window) {
  if (s_start != NO_TIME) {
    usage_screen(SCREEN_ROUTE_EVENT, s_start);
  } else {
    usage_screen(s_rest ? SCREEN_ROUTE_REST : SCREEN_ROUTE, s_ref);
  }
}

// Opens the screen (unless one is open or there's no memory); `venue` is
// asked for with an event's `start`.
static void push(int32_t ref, bool rest, int32_t start, const char *title, const char *header) {
  if (s_window || !(s_r = calloc(1, sizeof(Route)))) {
    return;
  }
  s_fetch = (Fetch){.send = send_request, .changed = state_changed};
  s_ref = ref;
  s_rest = rest;
  s_start = start;
  snprintf(s_r->venue, sizeof(s_r->venue), "%s", title);
  snprintf(s_r->title, sizeof(s_r->title), "%s", title);
  snprintf(s_r->header, sizeof(s_r->header), "%s", header);
  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers){
    .load = window_load,
    .appear = window_appear,
    .unload = window_unload,
  });
  comm_set_route_handlers(page_received, request_failed, phone_up);
  window_stack_push(s_window, true);
}

void route_window_push(int32_t ref, bool rest, const char *title, const char *header) {
  push(ref, rest, NO_TIME, title, header);
}

void route_window_push_event(const Event *e) { push(0, false, e->start, e->venue, ""); }

void route_window_close(void) {
  if (s_window) {
    window_stack_remove(s_window, false);
  }
}

void route_window_refresh(void) {
  if (!s_window) {
    return;
  }
  // The theme may have changed (settings page).
  window_set_background_color(s_window, g_theme->bg);
  layer_mark_dirty(s_top_bar);
  scroll_page_refresh(&s_page);
}
