#include "screens.h"
#include "codec.h"
#include "comm.h"
#include "ui.h"
#include "usage.h"

// Ask (docs/DESIGN_V1_1.md §9.6): Hold Select on Home or a Route screen starts
// the Pebble app's dictation; the transcript goes to the phone, which matches
// it and answers with a card (docs/WATCH_PROTOCOL.md, Voice). The watch knows
// no places or wording: it draws the phone's rows. Only what it must say with
// the phone away or silent is written here.
//
// Select does the card's action (open a route, or confirm, such as "I'm at"),
// or asks again when there is none; Hold Select asks again; Back closes.

#define ROWS_MAX 4
#define LABEL_LEN 16
#define VALUE_LEN 64
#define HINT_LEN 48
#define REPLY_WAIT_MS 10000
#define SEND_RETRY_MS 500
#define SEND_TRIES 5

// Card actions (the phone's first byte).
enum { ACT_NONE = 0, ACT_ROUTE = 1, ACT_CONFIRM = 2 };

typedef struct {
  ScrollPage page;
  Layer *top_bar;
  AppTimer *timer;       // waiting for the phone's card, or retrying the send
  int send_tries;
  uint8_t action;
  uint8_t flags;         // ACT_ROUTE: 1 = the restroom route from place `ref`
  int32_t ref;
  uint8_t count;
  char label[ROWS_MAX][LABEL_LEN];
  char value[ROWS_MAX][VALUE_LEN];
  char hint[HINT_LEN];
  char title[VALUE_LEN / 2];   // ACT_ROUTE: shown on the Route screen until its page comes
  char header[VALUE_LEN / 2];
  char heard[VALUE_LEN * 4];   // the transcript, kept to resend
} Card;

// On the heap while the screen is open (static data must stay under 64 KB).
static Window *s_window;
static Card *s_card;
static DictationSession *s_session;
static int32_t s_seq;

// ---- Drawing -------------------------------------------------------------------

static void content_update(Layer *layer, GContext *ctx) {
  Card *c = s_card;
  int w = layer_get_bounds(layer).size.w;
  GFont value_font = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
  int y = 2;
  for (int i = 0; i < c->count; i++) {
    if (c->label[i][0]) {
      draw_label(ctx, c->label[i], y, w);
      y += 14;
    }
    int h = text_height(c->value[i], value_font, w - 2 * PAD, 66);
    graphics_context_set_text_color(ctx, g_theme->text);
    graphics_draw_text(ctx, c->value[i], value_font, GRect(PAD, y - 2, w - 2 * PAD, h + 4),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
    y += h + 5;
    draw_divider(ctx, y, w);
    y += 4;
  }
  if (c->hint[0]) {
    graphics_context_set_text_color(ctx, g_theme->sea_accent);
    int h = text_height(c->hint, fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD), w - 2 * PAD, 48);
    graphics_draw_text(ctx, c->hint, fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD),
                       GRect(PAD, y, w - 2 * PAD, h + 2), GTextOverflowModeTrailingEllipsis,
                       GTextAlignmentLeft, NULL);
    y += h + 2;
  }
  scroll_page_fit(&c->page, y);
}

// Replaces the card with one row (no label when `label` is NULL) and a hint.
static void set_card(const char *label, const char *value, const char *hint) {
  Card *c = s_card;
  c->action = ACT_NONE;
  c->count = value ? 1 : 0;
  snprintf(c->label[0], LABEL_LEN, "%s", label ? label : "");
  snprintf(c->value[0], VALUE_LEN, "%s", value ? value : "");
  snprintf(c->hint, HINT_LEN, "%s", hint);
  if (c->page.content) {
    scroll_page_top(&c->page);
  }
}

// ---- Phone -------------------------------------------------------------------

static void stop_timer(void) {
  if (s_card->timer) {
    app_timer_cancel(s_card->timer);
    s_card->timer = NULL;
  }
}

static void no_reply(void *context) {
  s_card->timer = NULL;
  snprintf(s_card->hint, HINT_LEN, "No answer from the phone. Hold Select to ask again");
  layer_mark_dirty(s_card->page.content);
}

// Sends the transcript (or, with `heard` empty, the confirm); retried while the
// outbox is busy, then waits for the phone's card.
static void send_now(void *context) {
  Card *c = s_card;
  c->timer = NULL;
  if (comm_send_voice(s_seq, c->heard[0] ? c->heard : NULL)) {
    if (c->heard[0]) {
      c->timer = app_timer_register(REPLY_WAIT_MS, no_reply, NULL);
    } else {
      // Confirmed: done.
      vibes_short_pulse();
      window_stack_remove(s_window, true);
    }
  } else if (++c->send_tries < SEND_TRIES) {
    c->timer = app_timer_register(SEND_RETRY_MS, send_now, NULL);
  } else if (c->heard[0]) {
    no_reply(NULL);
  } else {
    snprintf(c->hint, HINT_LEN, "Phone busy. Select to try again");
    layer_mark_dirty(c->page.content);
  }
}

static void send(void) {
  stop_timer();
  s_card->send_tries = 0;
  send_now(NULL);
}

// A card from the phone: uint8 action, uint8 flags, int32 ref, uint8 rows,
// then per row a label and a value, then the hint, and for a route its title
// and header (strings: uint8 length, UTF-8 bytes).
static void card_received(int32_t seq, const uint8_t *p, int length) {
  Card *c = s_card;
  const uint8_t *end = p + length;
  if (seq != s_seq || length < 7) {
    return;
  }
  stop_timer();
  c->action = p[0];
  c->flags = p[1];
  c->ref = codec_read_int32(p + 2);
  int count = p[6] < ROWS_MAX ? p[6] : ROWS_MAX;
  p += 7;
  c->count = 0;
  c->hint[0] = c->title[0] = c->header[0] = '\0';
  while (c->count < count && codec_read_str(&p, end, c->label[c->count], LABEL_LEN) &&
         codec_read_str(&p, end, c->value[c->count], VALUE_LEN)) {
    c->count++;
  }
  if (codec_read_str(&p, end, c->hint, HINT_LEN) && c->action == ACT_ROUTE &&
      codec_read_str(&p, end, c->title, sizeof(c->title))) {
    codec_read_str(&p, end, c->header, sizeof(c->header));
  }
  vibes_short_pulse();
  scroll_page_top(&c->page);
}

// ---- Dictation ---------------------------------------------------------------

static void close_empty(void *context) {
  if (s_window && s_card->count == 0) {
    window_stack_remove(s_window, false);
  }
}

static void dictated(DictationSession *session, DictationSessionStatus status, char *text, void *context) {
  usage_add(USAGE_VOICE, (uint8_t)status, (int16_t)(status == DictationSessionStatusSuccess ? codec_str_len(text, 255) : 0),
            (int32_t)heap_bytes_free(), s_seq);
  if (!s_card) {
    return;
  }
  if (status != DictationSessionStatusSuccess) {
    // Cancelled, or the system has already shown why: a card that was only
    // waiting to be filled closes; one from earlier stays as it was.
    // Closed from a timer, not inside the session's own callback (closing
    // destroys the session).
    if (s_card->count == 0 && !s_card->hint[0]) {
      app_timer_register(0, close_empty, NULL);
    }
    return;
  }
  s_seq++;
  snprintf(s_card->heard, sizeof(s_card->heard), "%s", text);
  set_card("HEARD", text, "Matching on the phone...");
  send();
}

static void listen(void) {
  if (!connection_service_peek_pebble_app_connection()) {
    set_card(NULL, "Voice is heard on the phone", "Bring the phone nearby, then hold Select to ask");
    return;
  }
  if (!s_session) {
    s_session = dictation_session_create(0, dictated, NULL);
    if (!s_session) {
      set_card(NULL, "Voice isn't available", "");
      return;
    }
    // The phone shows what it heard and matched: no second confirm step.
    dictation_session_enable_confirmation(s_session, false);
  }
  stop_timer();
  usage_add(USAGE_VOICE, 255, 0, (int32_t)heap_bytes_free(), s_seq);
  dictation_session_start(s_session);
}

// ---- Window ------------------------------------------------------------------

static void select_click(ClickRecognizerRef recognizer, void *context) {
  Card *c = s_card;
  usage_press(BUTTON_ID_SELECT, 0, c->action);
  if (c->action == ACT_ROUTE) {
    int32_t ref = c->ref;
    bool rest = c->flags & 1;
    char title[sizeof(c->title)], header[sizeof(c->header)];
    snprintf(title, sizeof(title), "%s", c->title);
    snprintf(header, sizeof(header), "%s", c->header);
    // The Route screen takes this screen's place (and replaces an open one).
    window_stack_remove(s_window, false);
    route_window_close();
    route_window_push(ref, rest, title, header);
  } else if (c->action == ACT_CONFIRM) {
    c->heard[0] = '\0';
    send();
  } else {
    listen();
  }
}

static void select_long_click(ClickRecognizerRef recognizer, void *context) {
  usage_press(BUTTON_ID_SELECT, USAGE_LONG, -1);
  listen();
}

static void click_config(void *context) {
  window_single_click_subscribe(BUTTON_ID_SELECT, select_click);
  window_long_click_subscribe(BUTTON_ID_SELECT, 700, select_long_click, NULL);
}

static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect b = layer_get_bounds(root);
  window_set_background_color(window, g_theme->bg);
  s_card->top_bar = top_bar_create(GRect(0, 0, b.size.w, TOP_BAR_HEIGHT), BAND_INFO, BAND_LABEL_INFO, "Ask");
  top_bar_set_right(s_card->top_bar, "", false, 0);
  layer_add_child(root, s_card->top_bar);
  scroll_page_create(&s_card->page, window, root, GRect(0, TOP_BAR_HEIGHT, b.size.w, b.size.h - TOP_BAR_HEIGHT),
                     content_update, click_config);
}

static void window_unload(Window *window) {
  comm_set_voice_handler(NULL);
  stop_timer();
  scroll_page_destroy(&s_card->page);
  top_bar_destroy(s_card->top_bar);
  window_destroy(window);
  s_window = NULL;
  free(s_card);
  s_card = NULL;
  // The session holds the dictation UI's memory; free it with the screen.
  if (s_session) {
    dictation_session_destroy(s_session);
    s_session = NULL;
  }
}

static void window_appear(Window *window) { usage_screen(SCREEN_ASK, s_seq); }

void ask_window_refresh(void) {
  if (s_window) {
    window_set_background_color(s_window, g_theme->bg);
    layer_mark_dirty(s_card->top_bar);
    scroll_page_refresh(&s_card->page);
  }
}

void ask_window_push(void) {
  if (!s_window) {
    s_card = calloc(1, sizeof(Card));
    if (!s_card) {
      return;
    }
    s_window = window_create();
    window_set_window_handlers(s_window, (WindowHandlers){
      .load = window_load,
      .appear = window_appear,
      .unload = window_unload,
    });
    comm_set_voice_handler(card_received);
    window_stack_push(s_window, true);
  }
  listen();
}
