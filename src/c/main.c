#include <pebble.h>
#include "alarms.h"
#include "comm.h"
#include "data.h"
#include "screens.h"
#include "stars.h"
#include "store.h"
#include "ui.h"

// Cruise Watch for the Pebble Time 2 (emery).
//
// Avoid strtol() and strlen() in this codebase: both have faulted on real
// Pebble Time 2 hardware. Walk strings to the NUL by hand and have the phone
// send numbers as integers. snprintf/strncpy/strftime are known to work.

// Watch day we last asked the phone about, so a rollover asks only once.
static int32_t s_requested_day = INT32_MIN;

static void refresh_all(void) {
  home_window_refresh();
  today_window_refresh();
  info_window_refresh();
  dir_window_refresh();
  details_window_refresh();
  alert_window_refresh();
  notice_window_refresh();
  summary_window_refresh();
}

// After each save: tell the phone what didn't fit (for its settings page), and
// the user once, so they bring the phone back in time.
static void after_save(void) {
  int32_t cutoff = store_cutoff();
  if (connection_service_peek_pebble_app_connection()) {
    comm_send_saved(cutoff, store_saved_bytes());
  }
  if (store_should_warn()) {
    Notice n = {.kind = NOTICE_SAVED, .from = cutoff, .to = cutoff};
    notice_window_show(&n, 1);
  }
}

int toggle_star(int event_index) {
  Event *e = data_event(event_index);
  e->flags ^= EVENT_STARRED;
  bool on = (e->flags & EVENT_STARRED) != 0;
  // A clash is a warning, not a block: the star is still made.
  int clash = -1;
  if (on) {
    data_clashes_with(event_index, now_cruise(), &clash);
  }
  if (!(e->flags & EVENT_PERSONAL)) {
    data_set_reminder(e, on);
  }
  // Queued until the phone confirms it, so it survives the phone being away.
  stars_record(e, false, on);
  stars_send();
  store_save();
  alarms_schedule();
  if (clash >= 0) {
    vibes_double_pulse();
  } else {
    vibes_short_pulse();
  }
  refresh_all();
  after_save();
  return clash;
}

bool toggle_reserved(int event_index) {
  Event *e = data_event(event_index);
  // Reserved only applies to starred events that need a reservation (§5).
  if (!(e->flags & EVENT_STARRED) || !(e->flags & EVENT_RESERVATION)) {
    return false;
  }
  e->flags ^= EVENT_RESERVED;
  data_update_reminder(e);
  stars_record(e, true, (e->flags & EVENT_RESERVED) != 0);
  stars_send();
  store_save();
  vibes_short_pulse();
  refresh_all();
  after_save();
  return true;
}

void demo_next(void) {
  if (data_meta()->is_demo) {
    comm_demo_next();
  }
}

static void slice_received(void) {
  theme_set_dark(data_meta()->dark_theme);
  s_requested_day = data_day()->index;
  // Star changes the phone hasn't confirmed yet stay on this slice too.
  stars_apply();
  store_save();
  alarms_schedule();
  refresh_all();
  // A launch with yesterday's slice (or none) shows the summary once today's arrives.
  summary_check();
  stars_send();
  after_save();
}

static void notices_received(const Notice *notices, int count) {
  notice_window_show(notices, count);
}

// Back in touch with the phone: send star changes made while it was away.
static void app_connection_handler(bool connected) {
  if (connected) {
    stars_send();
  }
}

static void wakeup_handler(WakeupId id, int32_t cookie) {
  alert_window_push(cookie, false);
  alarms_schedule();
}

static void tick_handler(struct tm *tick_time, TimeUnits units_changed) {
  // At 04:00 ship time the watch day changes: ask the phone for the new slice.
  if (data_ready()) {
    int32_t today = cruise_day_index(now_cruise());
    if (today != data_day()->index && today != s_requested_day) {
      s_requested_day = today;
      comm_request_slice();
    }
  }
  refresh_all();
}

static void init(void) {
  stars_init();
  if (store_load()) {
    theme_set_dark(data_meta()->dark_theme);
  }
  comm_init(slice_received, notices_received);
  wakeup_service_subscribe(wakeup_handler);
  connection_service_subscribe((ConnectionHandlers){.pebble_app_connection_handler = app_connection_handler});
  home_window_push();

  WakeupId id;
  int32_t cookie;
  AppLaunchReason reason = launch_reason();
  if (reason == APP_LAUNCH_WAKEUP && wakeup_get_launch_event(&id, &cookie)) {
    alert_window_push(cookie, true);
  }
  // Only an open by the user uses up the day's summary, not an alert.
  summary_set_user_open(reason == APP_LAUNCH_USER || reason == APP_LAUNCH_QUICK_LAUNCH);
  summary_check();
  alarms_schedule();
  tick_timer_service_subscribe(MINUTE_UNIT, tick_handler);
}

static void deinit(void) {
  tick_timer_service_unsubscribe();
  connection_service_unsubscribe();
  comm_deinit();
  home_window_destroy();
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}
