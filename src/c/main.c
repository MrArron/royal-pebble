#include <pebble.h>
#include "alarms.h"
#include "comm.h"
#include "data.h"
#include "screens.h"
#include "stars.h"
#include "store.h"
#include "ui.h"
#include "usage.h"

// Cruise Watch for the Pebble Time 2 (emery).
//
// Avoid strtol() and strlen() in this codebase: both have faulted on real
// Pebble Time 2 hardware. Walk strings to the NUL by hand and have the phone
// send numbers as integers. snprintf/strncpy/strftime are known to work.

// Watch day we last asked the phone about, so a rollover asks only once.
static int32_t s_requested_day = INT32_MIN;

// Morning sync (docs/DESIGN.md §8.5): opened by its wakeup, the app shows
// Home without a buzz, takes the slice the phone sends when the app starts, and
// closes. It stays open when a notice came or the user left Home.
#define SYNC_WAIT_MS 60000
// After the slice: time for notices, the storage report and the usage log.
#define SYNC_LINGER_MS 5000
static bool s_syncing;
static bool s_sync_phone;      // the phone was connected while waiting
static uint8_t s_sync_outcome; // SYNC_SCHEDULED until the slice comes
static time_t s_sync_since;
static int16_t s_sync_secs;    // until the slice came, or the wait
static AppTimer *s_sync_timer;

bool sync_in_progress(void) { return s_syncing; }

// Logs the outcome; returns whether the app should stay open. `closing`: the
// user closed the app before the sync was over.
static bool sync_end(bool closing) {
  s_syncing = false;
  if (s_sync_outcome == SYNC_SCHEDULED) {
    s_sync_outcome = s_sync_phone ? SYNC_TIMED_OUT : SYNC_NO_PHONE;
    s_sync_secs = (int16_t)(time(NULL) - s_sync_since);
  }
  bool stay = !closing && !home_window_is_top();
  usage_add(USAGE_SYNC, s_sync_outcome, s_sync_secs, 0, closing ? 2 : stay ? 1 : 0);
  return stay;
}

static void sync_close(void *context) {
  s_sync_timer = NULL;
  if (!sync_end(false)) {
    window_stack_pop_all(false);
  }
}

static void refresh_all(void) {
  home_window_refresh();
  today_window_refresh();
  info_window_refresh();
  dir_window_refresh();
  route_window_refresh();
  details_window_refresh();
  alert_window_refresh();
  notice_window_refresh();
  summary_window_refresh();
  onboard_window_refresh();
  ask_window_refresh();
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
  // Reserved only applies to starred events that need a reservation (§7.3).
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
  if (s_syncing && s_sync_outcome == SYNC_SCHEDULED) {
    s_sync_outcome = SYNC_DONE;
    s_sync_secs = (int16_t)(time(NULL) - s_sync_since);
    app_timer_reschedule(s_sync_timer, SYNC_LINGER_MS);
  }
}

static void notices_received(const Notice *notices, int count) {
  notice_window_show(notices, count);
}

// Back in touch with the phone: send star changes made while it was away.
static void app_connection_handler(bool connected) {
  usage_connection(connected);
  if (connected) {
    s_sync_phone = true;
    stars_send();
  }
}

// For the usage log: the alert's kind and how late its wakeup came.
static void log_alert_fired(int32_t at, bool opened_app) {
  int kind = 255;
  for (int i = 0; i < data_alarm_count(); i++) {
    if (data_alarm(i)->at == at) {
      kind = data_alarm(i)->kind;
      break;
    }
  }
  time_t t = time(NULL);
  int32_t late = (now_cruise() - at) * 60 + localtime(&t)->tm_sec;
  late = late > INT16_MAX ? INT16_MAX : late < INT16_MIN ? INT16_MIN : late;
  usage_add(USAGE_ALERT_FIRED, (uint8_t)kind, (int16_t)late, at, opened_app ? 1 : 0);
}

static void wakeup_handler(WakeupId id, int32_t cookie) {
  if (cookie == SYNC_COOKIE) {
    // Already open: the phone is likely near, so just ask it.
    usage_add(USAGE_SYNC, SYNC_WHILE_OPEN, 0, 0, 0);
    comm_request_slice();
    alarms_schedule();
    return;
  }
  log_alert_fired(cookie, false);
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
  usage_tick();
  refresh_all();
}

static void init(void) {
  data_init();  // first: everything else reads the slice header
  usage_init();
  stars_init();
  bool stored = store_load();
  if (stored) {
    theme_set_dark(data_meta()->dark_theme);
  }
  comm_init(slice_received, notices_received);
  wakeup_service_subscribe(wakeup_handler);
  connection_service_subscribe((ConnectionHandlers){.pebble_app_connection_handler = app_connection_handler});

  WakeupId id;
  int32_t cookie;
  AppLaunchReason reason = launch_reason();
  bool by_wakeup = reason == APP_LAUNCH_WAKEUP && wakeup_get_launch_event(&id, &cookie);
  bool by_alert = by_wakeup && cookie != SYNC_COOKIE;
  usage_opened(by_wakeup && !by_alert ? (AppLaunchReason)USAGE_LAUNCH_SYNC : reason, stored);
  usage_check_missed(by_alert ? cookie : NO_TIME);
  home_window_push();
  if (by_alert) {
    log_alert_fired(cookie, true);
    alert_window_push(cookie, true);
  } else if (by_wakeup) {
    s_syncing = true;
    s_sync_phone = connection_service_peek_pebble_app_connection();
    s_sync_since = time(NULL);
    s_sync_timer = app_timer_register(SYNC_WAIT_MS, sync_close, NULL);
  }
  // Only an open by the user uses up the day's summary, not an alert.
  summary_set_user_open(reason == APP_LAUNCH_USER || reason == APP_LAUNCH_QUICK_LAUNCH);
  summary_check();
  // After the summary, which may open over Home: the hints wait for Home.
  if (reason == APP_LAUNCH_USER || reason == APP_LAUNCH_QUICK_LAUNCH) {
    home_window_arm_hints();
  }
  alarms_schedule();
  tick_timer_service_subscribe(MINUTE_UNIT, tick_handler);
}

static void deinit(void) {
  // Closed with Back before the sync was over.
  if (s_syncing) {
    sync_end(true);
  }
  usage_deinit();
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
