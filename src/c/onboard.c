#include "onboard.h"
#include "alarms.h"
#include "usage.h"

#define KEY_ONBOARD 9

typedef struct {
  int32_t sail_days;  // the cruise it belongs to
  int32_t day;        // watch day it was set on
  int32_t since;      // cruise minutes
} OnboardState;

static bool read_state(OnboardState *state) {
  if (!data_ready() || persist_get_size(KEY_ONBOARD) != (int)sizeof(*state)) {
    return false;
  }
  persist_read_data(KEY_ONBOARD, state, sizeof(*state));
  return state->sail_days == data_meta()->sail_days;
}

bool onboard_is_set(void) {
  OnboardState state;
  return read_state(&state) && state.day == cruise_day_index(now_cruise());
}

int32_t onboard_since(void) {
  OnboardState state;
  return onboard_is_set() && read_state(&state) ? state.since : NO_TIME;
}

void onboard_set(bool on) {
  int32_t now = now_cruise();
  if (on) {
    OnboardState state = {
      .sail_days = data_meta()->sail_days,
      .day = cruise_day_index(now),
      .since = now,
    };
    int written = persist_write_data(KEY_ONBOARD, &state, sizeof(state));
    if (written != (int)sizeof(state)) {
      usage_add(USAGE_STORAGE_ERROR, USAGE_STORE_OTHER, (int16_t)written, KEY_ONBOARD, 0);
    }
  } else {
    persist_delete(KEY_ONBOARD);
  }
  usage_add(USAGE_ONBOARD, on ? 1 : 0, 0, now, 0);
  alarms_schedule();
}

bool onboard_silences(const Alarm *a) {
  if (a->kind != ALARM_ALL_ABOARD) {
    return false;
  }
  OnboardState state;
  // The warning belongs to the day of its all-aboard time (`ref`). Not only
  // today: the next morning's missed-alert check still has to skip them (#98).
  return read_state(&state) && cruise_day_index(a->ref) == state.day;
}
