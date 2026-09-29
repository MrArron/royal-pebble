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
// An open by the user: Home shows its button hints (§9.5) if they're due, as
// soon as it is on top with its data.
void home_window_arm_hints(void);

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

// "On board?" (docs/DESIGN_PHASE3.md §22.6), from Hold Select on Home.
void onboard_window_push(void);
void onboard_window_refresh(void);
// "Remove star?" (§26) for starred event `event_index`, from Hold Select in
// Today or event details; shares the "On board?" window. `band` and `name`: the
// top bar of the screen it opens from. Closes itself if the event goes away.
void unstar_window_push(int event_index, GColor band, const char *name);

// Ship directory page `ref` (0 = the decks), as sent by the phone. `title`
// shows in the top bar until the page arrives.
void dir_window_push(int32_t ref, const char *title);
void dir_window_refresh(void);

// Route screen (docs/DESIGN_V1_1.md §9.2) for place page `ref`: to the place,
// or with `rest` from it to its closest restroom. `title` and `header` show
// until the phone's page arrives.
void route_window_push(int32_t ref, bool rest, const char *title, const char *header);
// The Route screen to event `e` (Home's NEXT, §9.5), with its time and title
// under the steps.
void route_window_push_event(const Event *e);
void route_window_refresh(void);
// Closes the Route screen if it's open (a voice route replaces it).
void route_window_close(void);

// Ask (docs/DESIGN_V1_1.md §9.6): starts dictation and shows the phone's
// answer; from Hold Select on Home and Route screens. Pushed again while open,
// it asks again.
void ask_window_push(void);
void ask_window_refresh(void);

void details_window_push(int event_index);
// Draws event `index` as its details page does (title down to the tags, not the
// star line) at y on a page `width` wide. Returns the y below it. Also used by
// reminders, which pass `after_where` to draw their "From" directions under the
// where lines in place of the decks-from-cabin line (NULL keeps that line).
int details_draw_event(GContext *ctx, int index, int width, int y,
                       int (*after_where)(GContext *ctx, int y));
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

// Hold Select anywhere an event is shown stars it (removing a star asks first,
// unstar_window_push): toggles the star with a short buzz, or a double one
// when the new star clashes. Returns the earliest item it now
// clashes with, or -1.
int toggle_star(int event_index);

// Select on event details: toggle Reserved on a starred event that needs a
// reservation (docs/DESIGN_V1_1.md §5), with a short buzz. Returns false (and
// does nothing) for other events.
bool toggle_reserved(int event_index);

// The silent morning sync is running (docs/DESIGN_PHASE3.md §25): notices show
// without a buzz, and keep the app open.
bool sync_in_progress(void);

// Demo data only: asks the phone for the next demo (port/sea, light/dark).
void demo_next(void);
