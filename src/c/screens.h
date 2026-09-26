#pragma once
#include <pebble.h>
#include "data.h"

// Each screen redraws itself on refresh (called every minute and after data or
// theme changes). Refreshing a screen that isn't open does nothing.

void home_window_push(void);
void home_window_refresh(void);
void home_window_destroy(void);
// Home is the screen on top (nothing opened over it).
bool home_window_is_top(void);

// Morning summary (docs/DESIGN_V1_1.md §8.1). The launch sets whether the user
// opened the app (alerts don't count); summary_check then shows today's card,
// or tomorrow's from 20:00, over Home the first time each is due, once the
// slice is today's.
void summary_set_user_open(bool user_open);
void summary_check(void);
// For My info: whether there's a card for today, and whether it's tomorrow's.
bool summary_available(void);
bool summary_shows_tomorrow(void);
// from_home: shown in place of Home, so Up and Down go on to My info and Today.
void summary_window_push(bool tomorrow, bool from_home);
void summary_window_refresh(void);

void today_window_push(void);
void today_window_refresh(void);

void info_window_push(void);
void info_window_refresh(void);

// Ship directory page `ref` (0 = the decks), as sent by the phone. `title`
// shows in the top bar until the page arrives.
void dir_window_push(int32_t ref, const char *title);
void dir_window_refresh(void);

// Route screen (docs/DESIGN_V1_1.md �9.2) for place page `ref`: to the place,
// or with `rest` from it to its closest restroom. `title` and `header` show
// until the phone's page arrives.
void route_window_push(int32_t ref, bool rest, const char *title, const char *header);
void route_window_refresh(void);

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

// Hold Select anywhere an event is shown: toggle its star with a short buzz,
// or a double one when the new star clashes. Returns the earliest item it now
// clashes with, or -1.
int toggle_star(int event_index);

// Select on event details: toggle Reserved on a starred event that needs a
// reservation (docs/DESIGN_V1_1.md §5), with a short buzz. Returns false (and
// does nothing) for other events.
bool toggle_reserved(int event_index);

// Demo data only: asks the phone for the next demo (port/sea, light/dark).
void demo_next(void);
