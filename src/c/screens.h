#pragma once
#include <pebble.h>
#include "data.h"

// Each screen redraws itself on refresh (called every minute and after data or
// theme changes). Refreshing a screen that isn't open does nothing.

void home_window_push(void);
void home_window_refresh(void);
void home_window_destroy(void);

void today_window_push(void);
void today_window_refresh(void);

void info_window_push(void);
void info_window_refresh(void);

// Ship directory page `ref` (0 = the decks), as sent by the phone. `title`
// shows in the top bar until the page arrives.
void dir_window_push(int32_t ref, const char *title);
void dir_window_refresh(void);

void details_window_push(int event_index);
void details_window_refresh(void);

// Alert for the given alert time (cruise minutes). from_wakeup: the app was
// opened by the alert, so Back leaves the app.
void alert_window_push(int32_t at, bool from_wakeup);
void alert_window_refresh(void);

bool alert_window_is_open(void);

// Starred events a re-sync moved or cancelled: buzzes and shows them one at a
// time. Waits while an alert is on screen and appears when it closes.
void notice_window_show(const Notice *notices, int count);
void notice_window_show_pending(void);
void notice_window_refresh(void);

// Hold Select anywhere an event is shown: toggle its star with a short buzz.
void toggle_star(int event_index);

// Demo data only: asks the phone for the next demo (port/sea, light/dark).
void demo_next(void);
