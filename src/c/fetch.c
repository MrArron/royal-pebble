#include "fetch.h"

#define REPLY_TIMEOUT_MS 8000
#define SEND_RETRY_MS 500
#define SEND_TRIES 4
// The phone script takes 10-16 s to start after the app opens (owner's logs).
#define SCRIPT_WAIT_MS 25000

static void set_state(Fetch *f, FetchState state) {
  f->state = state;
  f->changed(f->owner);
}

void fetch_cancel(Fetch *f) {
  if (f->timer) {
    app_timer_cancel(f->timer);
    f->timer = NULL;
  }
}

static void timed_out(void *context) {
  Fetch *f = context;
  f->timer = NULL;
  f->waiting = false;
  if (f->state == FETCH_LOADING) {
    set_state(f, FETCH_NO_PHONE);
  }
}

// The outbox may be busy with star changes or a SAVED report: try again shortly.
static void send_request(void *context) {
  Fetch *f = context;
  f->timer = NULL;
  if (!connection_service_peek_pebble_app_connection()) {
    set_state(f, FETCH_NO_PHONE);
  } else if (f->send(f->owner)) {
    f->timer = app_timer_register(REPLY_TIMEOUT_MS, timed_out, f);
  } else if (++f->tries < SEND_TRIES) {
    f->timer = app_timer_register(SEND_RETRY_MS, send_request, f);
  } else {
    set_state(f, FETCH_NO_PHONE);
  }
}

void fetch_start(Fetch *f) {
  fetch_cancel(f);
  f->tries = 0;
  f->waiting = f->waited = false;
  set_state(f, FETCH_LOADING);
  send_request(f);
}

void fetch_done(Fetch *f) {
  fetch_cancel(f);
  f->waiting = false;
  set_state(f, FETCH_READY);
}

// A request sent before the phone script is up (right after the app opens)
// waits for it, still loading, and goes again when the phone first speaks.
void fetch_failed(Fetch *f, bool script_down) {
  if (f->state != FETCH_LOADING) {
    return;
  }
  fetch_cancel(f);
  if (script_down && !f->waited) {
    f->waiting = f->waited = true;
    f->timer = app_timer_register(SCRIPT_WAIT_MS, timed_out, f);
  } else {
    f->waiting = false;
    set_state(f, FETCH_NO_PHONE);
  }
}

void fetch_phone_up(Fetch *f) {
  if (f->waiting && f->state == FETCH_LOADING) {
    fetch_cancel(f);
    f->waiting = false;
    f->tries = 0;
    f->timer = app_timer_register(SEND_RETRY_MS, send_request, f);
  }
}
