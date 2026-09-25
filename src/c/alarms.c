#include "alarms.h"
#include "data.h"

#define MAX_WAKEUPS 8

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
      continue;
    }
    APP_LOG(APP_LOG_LEVEL_DEBUG, "Wakeup %d in %d min (cruise minute %d)", (int)id,
            (int)(a->at - now), (int)a->at);
    scheduled++;
  }
  APP_LOG(APP_LOG_LEVEL_INFO, "Scheduled %d wakeups from %d alerts", scheduled, data_alarm_count());
}
