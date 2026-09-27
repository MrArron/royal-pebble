#pragma once
#include <pebble.h>

// Asking the phone for one page, for screens that need it (ship directory,
// Route): sends the request, retries while the outbox is busy, waits for the
// phone script when the app has just opened, and gives up to "no phone" when no
// page comes. The screen draws from `state` and is told each time it changes.

typedef enum { FETCH_LOADING, FETCH_READY, FETCH_NO_PHONE } FetchState;

typedef struct {
  FetchState state;
  int8_t tries;
  bool waiting;  // loading, until the phone script is up
  bool waited;   // this request has waited once already
  AppTimer *timer;
  // Sends the request; false if the outbox was busy.
  bool (*send)(void *owner);
  // Called after every state change, to redraw.
  void (*changed)(void *owner);
  void *owner;
} Fetch;

// Starts (or restarts) a request: FETCH_LOADING.
void fetch_start(Fetch *f);
// The page arrived: FETCH_READY.
void fetch_done(Fetch *f);
// comm's "the phone didn't get the request" handler.
void fetch_failed(Fetch *f, bool script_down);
// comm's "the phone spoke" handler: a request waiting for the script goes again.
void fetch_phone_up(Fetch *f);
// Stops its timer (the screen is closing).
void fetch_cancel(Fetch *f);
