#pragma once
#include <pebble.h>
#include "data.h"

// "I'm on board" (docs/DESIGN_PHASE3.md §22.6): on embark and port days the
// user says they're back on the ship. Home then shows the sea-day layout and
// the day's all-aboard warnings are off. Watch-only, kept in its own
// persistent key, and over at the 04:00 day boundary.

// The flag is set for the current watch day.
bool onboard_is_set(void);
// When it was set (cruise minutes); NO_TIME when it isn't.
int32_t onboard_since(void);
// Sets or clears it for the current watch day, logs it, and schedules the
// wakeups again (an undo re-arms the all-aboard warnings still ahead).
void onboard_set(bool on);
// The alert is an all-aboard warning for the day the flag is set on, so it
// doesn't buzz.
bool onboard_silences(const Alarm *a);
