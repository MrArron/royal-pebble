#include "alarms.h"
#include "data.h"
#include "usage.h"

#define MAX_WAKEUPS 8

// What the usage log last heard about, so it logs only changes.
static int s_logged_count = -1;
static int32_t s_logged_first;
static int32_t s_logged_last;

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
    // Alerts are sorted; several in the same minute share one wakeup.
    if (a->at <= now || a->at == last) {
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
}
