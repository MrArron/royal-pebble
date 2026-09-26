#include "screens.h"
#include "codec.h"
#include "comm.h"
#include "ui.h"
#include "usage.h"

// Route screen (docs/DESIGN_V1_1.md §9.2): the walking route to a place, from
// a place to its closest restroom, or to Home's NEXT event (§9.5), one line
// per step with a drawn glyph.
// The phone works out every line (docs/WATCH_PROTOCOL.md, Route screen); the
// watch only draws them and keeps nothing once the screen closes.

#define REPLY_TIMEOUT_MS 8000
#define SEND_RETRY_MS 500
#define SEND_TRIES 4
// The phone script takes 10-16 s to start after the app opens (owner's logs).
#define SCRIPT_WAIT_MS 25000

#define STEPS_MAX 8
#define TEXT_LEN 40
#define LEAD_LEN 64
#define GPS_LEN 32
#define INDICATOR_H 12
#define GLYPH_W 13
#define GLYPH_GAP 6

// Step glyphs, as the phone numbers them (gpstext.js).
enum { GLYPH_WALK = 0, GLYPH_CROSS = 1, GLYPH_ELEVATOR = 2, GLYPH_STAIRS = 3, GLYPH_ARRIVE = 4 };

typedef enum { STATE_LOADING, STATE_READY, STATE_NO_PHONE } State;

typedef struct {
  uint8_t glyph;
  char text[TEXT_LEN];
} Step;

static Window *s_window;
static Layer *s_top_bar;
static ScrollLayer *s_scroll;
static Layer *s_content;
static Layer *s_more_above;
static Layer *s_more_below;

static int32_t s_ref;
static bool s_rest;
static int32_t s_start;          // the event's start (Home's NEXT), else NO_TIME
static char s_venue[VENUE_LEN];  // the event's venue, as the phone is asked
static State s_state;
static int s_tries;
static bool s_waiting;           // loading, until the phone script is up
static bool s_waited;            // this request has waited once already
static AppTimer *s_timer;

static uint8_t s_flags;         // 1: shown less (not drawn differently yet)
static int8_t s_small_decks;
static char s_title[TEXT_LEN];   // the destination
static char s_header[GPS_LEN];   // "FROM YOUR CABIN", "CLOSEST TO ROYAL THEATER"
static char s_lead[LEAD_LEN];    // "Same area · your deck", or a message
static char s_big[GPS_LEN];      // a restroom's "Deck 5 · Fore"
static char s_small[TEXT_LEN];   // "100 m in all", "Same deck as Royal Theater"
static char s_event[TITLE_LEN + 8];  // "12:00p Name That Tune Trivia" (event routes)
static Step s_steps[STEPS_MAX];
static int s_count;

// ---- Layout ------------------------------------------------------------------

static int text_height(const char *text, GFont font, int w, int max_h) {
  return graphics_text_layout_get_content_size(text, font, GRect(0, 0, w, max_h),
                                               GTextOverflowModeTrailingEllipsis,
                                               GTextAlignmentLeft).h;
}

static void draw_text(GContext *ctx, const char *text, GFont font, GColor color, GRect box,
                      GTextAlignment align) {
  graphics_context_set_text_color(ctx, color);
  graphics_draw_text(ctx, text, font, box, GTextOverflowModeTrailingEllipsis, align, NULL);
}

// A small filled triangle, `rows` tall, pointing up (dir > 0) or down.
static void fill_triangle(GContext *ctx, int cx, int y, int rows, int dir) {
  for (int i = 0; i < rows; i++) {
    int half = dir > 0 ? i : rows - 1 - i;
    graphics_fill_rect(ctx, GRect(cx - half, y + i, 2 * half + 1, 1), 0, GCornerNone);
  }
}

// A step's glyph (docs/mockups/gps/NOTES.md), about 13 px in the sea accent,
// on a Gothic 18 bold line whose top is at y: dot = walk, double-headed arrow
// = cross the ship, square with ▲▼ = elevator, stair line = stairs, ring with
// a dot = arrive.
static void draw_glyph(GContext *ctx, int glyph, int x, int y) {
  GColor color = g_theme->sea_accent;
  int top = y + 6;
  GPoint c = GPoint(x + GLYPH_W / 2, top + GLYPH_W / 2);
  graphics_context_set_fill_color(ctx, color);
  graphics_context_set_stroke_color(ctx, color);
  graphics_context_set_stroke_width(ctx, 2);
  switch (glyph) {
    case GLYPH_WALK:
      graphics_fill_circle(ctx, c, 3);
      break;
    case GLYPH_CROSS:
      graphics_draw_line(ctx, GPoint(x + 1, c.y), GPoint(x + GLYPH_W - 2, c.y));
      graphics_draw_line(ctx, GPoint(x + 1, c.y), GPoint(x + 4, c.y - 3));
      graphics_draw_line(ctx, GPoint(x + 1, c.y), GPoint(x + 4, c.y + 3));
      graphics_draw_line(ctx, GPoint(x + GLYPH_W - 2, c.y), GPoint(x + GLYPH_W - 5, c.y - 3));
      graphics_draw_line(ctx, GPoint(x + GLYPH_W - 2, c.y), GPoint(x + GLYPH_W - 5, c.y + 3));
      break;
    case GLYPH_ELEVATOR:
      graphics_context_set_stroke_width(ctx, 1);
      graphics_draw_round_rect(ctx, GRect(x + 1, top, GLYPH_W - 2, GLYPH_W), 2);
      graphics_draw_round_rect(ctx, GRect(x + 2, top + 1, GLYPH_W - 4, GLYPH_W - 2), 1);
      fill_triangle(ctx, c.x, top + 3, 3, 1);
      fill_triangle(ctx, c.x, top + GLYPH_W - 6, 3, -1);
      break;
    case GLYPH_STAIRS:
      // Four treads rising to the right, 2 px thick, drawn as rectangles so
      // they stay crisp (a thick line blurs into a slope).
      for (int i = 0; i < 4; i++) {
        int tx = x + 3 * i;
        int ty = top + 10 - 3 * i;
        graphics_fill_rect(ctx, GRect(tx, ty, 4, 2), 0, GCornerNone);
        if (i < 3) {
          graphics_fill_rect(ctx, GRect(tx + 2, ty - 3, 2, 3), 0, GCornerNone);
        }
      }
      break;
    default:  // GLYPH_ARRIVE
      graphics_draw_circle(ctx, c, 5);
      graphics_fill_circle(ctx, c, 2);
      break;
  }
  graphics_context_set_stroke_width(ctx, 1);
}

// "2 decks · 100 m in all" (the arrow is drawn before it), or just the text.
static void fmt_decks(char *buf, size_t size, int decks, const char *text) {
  int n = decks < 0 ? -decks : decks;
  if (n) {
    snprintf(buf, size, "%d %s \xc2\xb7 %s", n, n == 1 ? "deck" : "decks", text);
  } else {
    snprintf(buf, size, "%s", text);
  }
}

// The whole page: destination, header, then the steps (or loading / no phone),
// then the summary. Draws when ctx isn't NULL; returns the height.
static int layout(GContext *ctx, int w) {
  GFont name_font = fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD);
  GFont large = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
  GFont small = fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD);
  int tw = w - 2 * PAD;
  int y = 2;
  int h = text_height(s_title, name_font, tw, 58);
  if (ctx) {
    draw_text(ctx, s_title, name_font, g_theme->text, GRect(PAD, y - 4, tw, h + 4), GTextAlignmentLeft);
  }
  y += h + 2;
  if (s_header[0]) {
    if (ctx) {
      draw_text(ctx, s_header, small, g_theme->muted, GRect(PAD, y - 2, tw, 18), GTextAlignmentLeft);
    }
    y += 18;
  }
  y += 2;
  if (ctx) {
    draw_divider(ctx, y, w);
  }
  y += 5;

  if (s_state == STATE_LOADING) {
    if (ctx) {
      draw_text(ctx, "Finding route\xe2\x80\xa6", large, g_theme->muted, GRect(PAD, y + 26, tw, 22),
                GTextAlignmentCenter);
    }
    return y + 60;
  }
  if (s_state == STATE_NO_PHONE) {
    if (ctx) {
      draw_text(ctx, "Connect your phone", large, g_theme->text, GRect(PAD, y + 16, tw, 22), GTextAlignmentCenter);
      draw_text(ctx, "Select tries again", small, g_theme->muted, GRect(PAD, y + 38, tw, 18), GTextAlignmentCenter);
    }
    return y + 60;
  }

  if (s_lead[0]) {
    h = text_height(s_lead, large, tw, 66);
    if (ctx) {
      draw_text(ctx, s_lead, large, g_theme->text, GRect(PAD, y - 4, tw, h + 4), GTextAlignmentLeft);
    }
    y += h + 2;
  }
  int step_x = PAD + GLYPH_W + GLYPH_GAP;
  int step_w = w - step_x - PAD;
  for (int i = 0; i < s_count; i++) {
    h = text_height(s_steps[i].text, large, step_w, 44);
    if (ctx) {
      draw_glyph(ctx, s_steps[i].glyph, PAD, y - 4);
      draw_text(ctx, s_steps[i].text, large, g_theme->text, GRect(step_x, y - 4, step_w, h + 4), GTextAlignmentLeft);
    }
    y += h + 2;
  }
  if (s_big[0] || s_small[0] || s_event[0]) {
    y += 2;
    if (ctx) {
      draw_divider(ctx, y, w);
    }
    y += 5;
    if (s_big[0]) {
      if (ctx) {
        draw_text(ctx, s_big, large, g_theme->text, GRect(PAD, y - 4, tw, 22), GTextAlignmentLeft);
      }
      y += 20;
    }
    if (s_small[0]) {
      if (ctx) {
        char text[56];
        fmt_decks(text, sizeof(text), s_small_decks, s_small);
        draw_arrow_line(ctx, false, g_theme->muted, PAD, y - 2, tw, "", s_small_decks, text);
      }
      y += 18;
    }
    if (s_event[0]) {
      h = text_height(s_event, small, tw, 34);
      if (ctx) {
        draw_text(ctx, s_event, small, g_theme->muted, GRect(PAD, y - 2, tw, h + 2), GTextAlignmentLeft);
      }
      y += h;
    }
  }
  return y + 4;
}

static void content_update(Layer *layer, GContext *ctx) {
  layout(ctx, layer_get_bounds(layer).size.w);
}

// The content's scroll position as the user left it, for the usage log.
static int s_scroll_y;
static bool s_relayout;

static void offset_changed(ScrollLayer *scroll, void *context) {
  int y = scroll_layer_get_content_offset(scroll).y;
  if (!s_relayout && y != s_scroll_y) {
    usage_move(-s_scroll_y, -y);  // down makes the offset more negative
  }
  s_scroll_y = y;
}

// Sizes the content to the page and goes back to its top.
static void relayout(void) {
  if (!s_scroll) {
    return;
  }
  GRect frame = layer_get_frame(scroll_layer_get_layer(s_scroll));
  int h = layout(NULL, frame.size.w);
  layer_set_frame(s_content, GRect(0, 0, frame.size.w, h));
  scroll_layer_set_content_size(s_scroll, GSize(frame.size.w, h));
  s_relayout = true;
  scroll_layer_set_content_offset(s_scroll, GPointZero, false);
  s_relayout = false;
  s_scroll_y = 0;
  layer_mark_dirty(s_content);
}

// ---- Asking the phone --------------------------------------------------------

static void set_state(State state) {
  s_state = state;
  relayout();
}

static void cancel_timer(void) {
  if (s_timer) {
    app_timer_cancel(s_timer);
    s_timer = NULL;
  }
}

static void timed_out(void *context) {
  s_timer = NULL;
  s_waiting = false;
  if (s_state == STATE_LOADING) {
    set_state(STATE_NO_PHONE);
  }
}

// The outbox may be busy with star changes or a SAVED report: try again shortly.
static void send_request(void *context) {
  s_timer = NULL;
  if (!connection_service_peek_pebble_app_connection()) {
    set_state(STATE_NO_PHONE);
  } else if (s_start != NO_TIME ? comm_request_event_route(s_start, s_venue) : comm_request_route(s_ref, s_rest)) {
    s_timer = app_timer_register(REPLY_TIMEOUT_MS, timed_out, NULL);
  } else if (++s_tries < SEND_TRIES) {
    s_timer = app_timer_register(SEND_RETRY_MS, send_request, NULL);
  } else {
    set_state(STATE_NO_PHONE);
  }
}

static void request(void) {
  cancel_timer();
  s_tries = 0;
  s_waiting = s_waited = false;
  set_state(STATE_LOADING);
  send_request(NULL);
}

// uint8 flags, int8 decks, five texts, uint8 count, then each step's uint8
// glyph and text. Stops at the first step that isn't whole.
static void page_received(const RoutePageMsg *page) {
  if (!s_window || s_state == STATE_READY || page->ref != s_ref || page->rest != s_rest ||
      page->start != s_start || page->length < 2) {
    return;
  }
  const uint8_t *p = page->data;
  const uint8_t *end = p + page->length;
  s_flags = p[0];
  s_small_decks = (int8_t)p[1];
  p += 2;
  if (!codec_read_str(&p, end, s_title, sizeof(s_title)) ||
      !codec_read_str(&p, end, s_header, sizeof(s_header)) ||
      !codec_read_str(&p, end, s_lead, sizeof(s_lead)) ||
      !codec_read_str(&p, end, s_big, sizeof(s_big)) ||
      !codec_read_str(&p, end, s_small, sizeof(s_small))) {
    return;
  }
  int count = p < end ? *p++ : 0;
  s_count = 0;
  while (s_count < count && s_count < STEPS_MAX && p < end) {
    Step *st = &s_steps[s_count];
    st->glyph = *p++;
    if (!codec_read_str(&p, end, st->text, sizeof(st->text))) {
      break;
    }
    s_count++;
  }
  cancel_timer();
  s_waiting = false;
  set_state(STATE_READY);
}

// A request sent before the phone script is up (right after the app opens)
// waits for it, still loading, and goes again when the phone first speaks.
static void request_failed(bool script_down) {
  if (s_state != STATE_LOADING) {
    return;
  }
  cancel_timer();
  if (script_down && !s_waited) {
    s_waiting = s_waited = true;
    s_timer = app_timer_register(SCRIPT_WAIT_MS, timed_out, NULL);
  } else {
    s_waiting = false;
    set_state(STATE_NO_PHONE);
  }
}

static void phone_up(void) {
  if (s_waiting && s_state == STATE_LOADING) {
    cancel_timer();
    s_waiting = false;
    s_tries = 0;
    s_timer = app_timer_register(SEND_RETRY_MS, send_request, NULL);
  }
}

// ---- Window ------------------------------------------------------------------

static void select_click(ClickRecognizerRef recognizer, void *context) {
  usage_press(BUTTON_ID_SELECT, s_state == STATE_NO_PHONE ? 0 : USAGE_NOTHING, -1);
  if (s_state == STATE_NO_PHONE) {
    request();
  }
}

static void click_config(void *context) {
  window_single_click_subscribe(BUTTON_ID_SELECT, select_click);
}

// Muted triangles under the top bar and at the bottom while there's more
// above or below, as on place pages.
static void set_indicators(void) {
  ContentIndicator *ci = scroll_layer_get_content_indicator(s_scroll);
  const ContentIndicatorDirection dirs[2] = {ContentIndicatorDirectionUp, ContentIndicatorDirectionDown};
  Layer *layers[2] = {s_more_above, s_more_below};
  for (int i = 0; i < 2; i++) {
    const ContentIndicatorConfig config = {
      .layer = layers[i],
      .times_out = false,
      .alignment = GAlignCenter,
      .colors = {.foreground = g_theme->muted, .background = g_theme->bg},
    };
    content_indicator_configure_direction(ci, dirs[i], &config);
  }
}

static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect b = layer_get_bounds(root);
  window_set_background_color(window, g_theme->bg);

  s_top_bar = top_bar_create(GRect(0, 0, b.size.w, TOP_BAR_HEIGHT), BAND_INFO, BAND_LABEL, "Route");
  top_bar_set_right(s_top_bar, "", false, 0);
  layer_add_child(root, s_top_bar);

  s_scroll = scroll_layer_create(GRect(0, TOP_BAR_HEIGHT, b.size.w, b.size.h - TOP_BAR_HEIGHT));
  scroll_layer_set_shadow_hidden(s_scroll, true);
  scroll_layer_set_callbacks(s_scroll, (ScrollLayerCallbacks){.click_config_provider = click_config,
                                                              .content_offset_changed_handler = offset_changed});
  scroll_layer_set_click_config_onto_window(s_scroll, window);
  s_content = layer_create(GRect(0, 0, b.size.w, b.size.h));
  layer_set_update_proc(s_content, content_update);
  scroll_layer_add_child(s_scroll, s_content);
  layer_add_child(root, scroll_layer_get_layer(s_scroll));

  s_more_above = layer_create(GRect(0, TOP_BAR_HEIGHT, b.size.w, INDICATOR_H));
  s_more_below = layer_create(GRect(0, b.size.h - INDICATOR_H, b.size.w, INDICATOR_H));
  layer_add_child(root, s_more_above);
  layer_add_child(root, s_more_below);
  set_indicators();
  request();
}

static void window_unload(Window *window) {
  cancel_timer();
  comm_set_route_handlers(NULL, NULL, NULL);
  layer_destroy(s_more_above);
  layer_destroy(s_more_below);
  layer_destroy(s_content);
  scroll_layer_destroy(s_scroll);
  s_scroll = NULL;
  top_bar_destroy(s_top_bar);
  window_destroy(window);
  s_window = NULL;
}

static void push(int32_t ref, bool rest, const char *title, const char *header);

static void window_appear(Window *window) {
  if (s_start != NO_TIME) {
    usage_screen(SCREEN_ROUTE_EVENT, s_start);
  } else {
    usage_screen(s_rest ? SCREEN_ROUTE_REST : SCREEN_ROUTE, s_ref);
  }
}

void route_window_push(int32_t ref, bool rest, const char *title, const char *header) {
  if (s_window) {
    return;
  }
  s_start = NO_TIME;
  s_venue[0] = s_event[0] = '\0';
  push(ref, rest, title, header);
}

void route_window_push_event(const Event *e) {
  if (s_window) {
    return;
  }
  s_start = e->start;
  snprintf(s_venue, sizeof(s_venue), "%s", e->venue);
  char time_buf[8];
  fmt_clock(time_buf, sizeof(time_buf), e->start);
  snprintf(s_event, sizeof(s_event), "%s %s", time_buf, e->title);
  push(0, false, e->venue, "");
}

static void push(int32_t ref, bool rest, const char *title, const char *header) {
  s_ref = ref;
  s_rest = rest;
  s_count = 0;
  s_flags = 0;
  s_small_decks = 0;
  s_lead[0] = s_big[0] = s_small[0] = '\0';
  snprintf(s_title, sizeof(s_title), "%s", title);
  snprintf(s_header, sizeof(s_header), "%s", header);
  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers){
    .load = window_load,
    .appear = window_appear,
    .unload = window_unload,
  });
  comm_set_route_handlers(page_received, request_failed, phone_up);
  window_stack_push(s_window, true);
}

void route_window_refresh(void) {
  if (!s_window || !s_scroll) {
    return;
  }
  // The theme may have changed (settings page).
  window_set_background_color(s_window, g_theme->bg);
  set_indicators();
  layer_mark_dirty(s_top_bar);
  layer_mark_dirty(s_content);
}
