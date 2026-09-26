#pragma once
#include <pebble.h>

// The watch's part of the usage log (docs/WATCH_PROTOCOL.md, "Usage log"):
// small fixed records, queued in the watch's storage and sent to the phone,
// which turns them into text. Nothing here formats text.

enum {
  USAGE_OPEN = 1,
  USAGE_CLOSE = 2,
  USAGE_SCREEN = 3,
  USAGE_BUTTON = 4,
  USAGE_ALERTS_SCHEDULED = 5,
  USAGE_ALERT_FIRED = 6,
  USAGE_ALERT_CLOSED = 7,
  USAGE_ALERTS_MISSED = 8,
  USAGE_WAKEUP_ERROR = 9,
  USAGE_BATTERY = 10,
  USAGE_PHONE = 11,
  USAGE_MSG_ERROR = 12,
  USAGE_STORAGE_ERROR = 13,
};

// Screens, for USAGE_SCREEN and USAGE_BUTTON.
typedef enum {
  SCREEN_NONE = 0,
  SCREEN_HOME = 1,
  SCREEN_SUMMARY = 2,
  SCREEN_TODAY = 3,
  SCREEN_DETAILS = 4,
  SCREEN_INFO = 5,
  SCREEN_DIR = 6,
  SCREEN_ROUTE = 7,
  SCREEN_ROUTE_REST = 8,
  SCREEN_ROUTE_EVENT = 9,
  SCREEN_ALERT = 10,
  SCREEN_NOTICE = 11,
} UsageScreen;

// USAGE_BUTTON's `a`: the button (0 Back, 1 Up, 2 Select, 3 Down) plus these.
#define USAGE_LONG 16
#define USAGE_NOTHING 32

// USAGE_MSG_ERROR's `x`.
#define USAGE_MSG_NOT_DELIVERED 0
#define USAGE_MSG_DROPPED 1
#define USAGE_MSG_BUSY 2

// USAGE_STORAGE_ERROR's `x`.
#define USAGE_STORE_SCHEDULE 0
#define USAGE_STORE_STARS 1
#define USAGE_STORE_LOG 2
#define USAGE_STORE_OTHER 3

// Loads the queue saved on the watch. Call first, so any entry has a home.
void usage_init(void);
// Logs the open: `reason` the launch reason, `from_storage` whether the
// schedule was loaded from the watch's storage.
void usage_opened(AppLaunchReason reason, bool from_storage);
// Logs the close and the last screen view, and saves the queue.
void usage_deinit(void);

void usage_add(uint8_t code, uint8_t x, int16_t a, int32_t b, int32_t c);

// A screen came on top (its window's appear), with its detail. Ends the view
// of the screen before it.
void usage_screen(UsageScreen screen, int32_t detail);
// Changes the current screen's detail (Home's card once the slice arrives).
void usage_screen_detail(UsageScreen screen, int32_t detail);
// Up or Down moved something on the current screen.
void usage_scroll(void);
// A list's cursor moved from `old_row` to `new_row` (Up or Down): a scroll and
// a press, when it moved.
void usage_move(int old_row, int new_row);
// A button press on the current screen: logged while the phone is connected,
// and always when it did nothing (`flags` has USAGE_NOTHING). `row` is the
// cursor's row, or -1.
void usage_press(ButtonId button, uint8_t flags, int32_t row);

// Battery as logged: the percent, +256 charging, +512 plugged in.
int16_t usage_battery(void);

// Every minute: the hourly battery entry and the lowest free memory.
void usage_tick(void);
// The phone connected or went away.
void usage_connection(bool connected);

// AppMessage results for a LOG message (comm.c).
void usage_sent(void);
void usage_send_failed(void);

// Alert times in the stored plan that passed since the app was last closed
// without opening it (`launch_at`: the alert this launch is for, or NO_TIME).
void usage_check_missed(int32_t launch_at);
