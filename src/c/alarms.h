#pragma once
#include <pebble.h>

// Schedules watch wakeups for the alert plan (all-aboard warnings and event
// reminders) so they fire with the app closed and the phone away. The watch
// allows 8 wakeups per app, at least a minute apart, so only the next 7 alert
// times are scheduled; every launch (including one caused by a wakeup)
// schedules the next batch. The wakeup cookie is the alert time in cruise
// minutes.
//
// The eighth is the silent morning sync (docs/DESIGN.md §8.5): about
// 04:30 ship time on the cruise's days, cookie SYNC_COOKIE.

#define SYNC_COOKIE (-2)

void alarms_schedule(void);
