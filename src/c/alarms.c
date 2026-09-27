#include "alarms.h"
#include "data.h"
#include "onboard.h"
#include "usage.h"

// The watch allows 8 per app; one is kept for the morning sync.
#define MAX_WAKEUPS 7

// Morning sync (docs/DESIGN_PHASE3.md §25): 04:30 ship time, or 5 minutes
// later at a time while an alert is within a minute of it, up to 04:55.
#define SYNC_AT (4 * 60 + 30)
#define SYNC_STEP 5
#define SYNC_LAST (4 * 60 + 55)
// With no sync for this many days, the chain stops (the phone may be gone).
#define SYNC_STALE_DAYS 7
// Test builds only: the sync fires this many minutes after scheduling, on any
// day. 0 in real builds.
#define SYNC_TEST_MINUTES 0

// What the usage log last heard about, so it logs only changes.
static int s_logged_count = -1;
static int32_t s_logged_first;
static int32_t s_logged_last;
static int32_t s_logged_sync = INT32_MIN;

// Whether the morning of watch day `day` is in the cruise, as far as the
// slice knows.
static bool sync_day_wanted(int32_t day) {
  int32_t known = data_day()->index;
  if (day <= known) {
    return data_day()->kind != DAY_NONE;
  }
  // Past tomorrow the slice is out of date: keep trying for a while.
  return data_tomorrow()->kind != DAY_NONE && day - known <= SYNC_STALE_DAYS;
}

static bool near_alert(int32_t at) {
  for (int i = 0; i < data_alarm_count(); i++) {
    int32_t d = data_alarm(i)->at - at;
    if (d >= -1 && d <= 1) {
      return true;
    }
  }
  return false;
}

static void schedule_sync(time_t minute_start, int32_t now) {
  int32_t day = cruise_day_index(now);
  int32_t at = day * MINUTES_PER_DAY + SYNC_AT;
  if (at <= now + 1) {
    day++;
    at += MINUTES_PER_DAY;
  }
  int32_t last = day * MINUTES_PER_DAY + SYNC_LAST;
  if (SYNC_TEST_MINUTES) {
    at = now + SYNC_TEST_MINUTES;
    last = at + SYNC_LAST - SYNC_AT;
  } else if (!sync_day_wanted(day)) {
    last = at - 1;  // none
  }
  int status = 0;
  int32_t done = NO_TIME;
  for (; at <= last; at += SYNC_STEP) {
    if (near_alert(at)) {
      continue;
    }
    WakeupId id = wakeup_schedule(minute_start + (time_t)(at - now) * 60, SYNC_COOKIE, false);
    if (id >= 0) {
      done = at;
      break;
    }
    status = id;
    if (id != E_RANGE) {
      break;  // E_RANGE: another app's wakeup is within a minute; try later
    }
  }
  if (done != s_logged_sync) {
    s_logged_sync = done;
    usage_add(USAGE_SYNC, SYNC_SCHEDULED, done == NO_TIME ? (int16_t)status : 0, done, 0);
  }
}

void alarms_schedule(void) {
  wakeup_cancel_all();
  if (!data_ready()) {
    return;
  }

  // Wakeups take real timestamps; alerts are in cruise minutes. Anchor both to
  // the start of the current minute.
  time_t now_t = time(NULL);
  time_t minute_start = now_t - localtime(&now_t)->tm_sec;
  int32_t now = now_cruise();

  int scheduled = 0;
  int32_t last = INT32_MIN;
  int32_t first_at = NO_TIME;
  int32_t last_at = NO_TIME;
  for (int i = 0; i < data_alarm_count() && scheduled < MAX_WAKEUPS; i++) {
    Alarm *a = data_alarm(i);
    // Alerts are sorted; several in the same minute share one wakeup. On
    // board, the day's all-aboard warnings are off (§22.6).
    if (a->at <= now || a->at == last || onboard_silences(a)) {
      continue;
    }
    last = a->at;
    time_t when = minute_start + (time_t)(a->at - now) * 60;
    WakeupId id = wakeup_schedule(when, a->at, true);
    if (id == E_RANGE) {
      // Another app has a wakeup within a minute of this one; go a minute later.
      id = wakeup_schedule(when + 60, a->at, true);
    }
    if (id < 0) {
      APP_LOG(APP_LOG_LEVEL_WARNING, "Wakeup at %d not scheduled: %d", (int)a->at, (int)id);
      usage_add(USAGE_WAKEUP_ERROR, 0, (int16_t)id, a->at, 0);
      continue;
    }
    if (scheduled == 0) {
      first_at = a->at;
    }
    last_at = a->at;
    APP_LOG(APP_LOG_LEVEL_DEBUG, "Wakeup %d in %d min (cruise minute %d)", (int)id,
            (int)(a->at - now), (int)a->at);
    scheduled++;
  }
  APP_LOG(APP_LOG_LEVEL_INFO, "Scheduled %d wakeups from %d alerts", scheduled, data_alarm_count());
  if (scheduled != s_logged_count || first_at != s_logged_first || last_at != s_logged_last) {
    s_logged_count = scheduled;
    s_logged_first = first_at;
    s_logged_last = last_at;
    usage_add(USAGE_ALERTS_SCHEDULED, (uint8_t)scheduled, (int16_t)data_alarm_count(), first_at, last_at);
  }
  schedule_sync(minute_start, now);
}
