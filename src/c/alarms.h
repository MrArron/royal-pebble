#pragma once
#include <pebble.h>

// Schedules watch wakeups for the alert plan (all-aboard warnings and event
// reminders) so they fire with the app closed and the phone away. The watch
// allows 8 wakeups per app, at least a minute apart, so only the next 8 alert
// times are scheduled; every launch (including one caused by a wakeup)
// schedules the next batch. The wakeup cookie is the alert time in cruise
// minutes.

void alarms_schedule(void);
