#pragma once
#include <pebble.h>
#include "data.h"

// Stars changed on the watch, kept until the phone confirms it saved them
// (docs/WATCH_PROTOCOL.md, "Star changes"). Events are identified by content
// (start, title, venue), not by their index in a slice, so a change made on a
// stored slice with the phone away still finds its event later.

#define MAX_STAR_CHANGES 8
// Packed size of one change at most (docs/WATCH_PROTOCOL.md).
#define STAR_CHANGE_MAX_BYTES (19 + 1 + (SHORT_TITLE_LEN - 1) + 1 + (SHORT_VENUE_LEN - 1))

// StarChange.on: bit 0 the new state; bit 1 set when the change is to the
// event's Reserved mark (§5) rather than its star. Both share the queue.
#define STAR_CHANGE_ON 1
#define STAR_CHANGE_RESERVED 2

typedef struct {
  int32_t seq;        // increases with every change; the phone acks up to one
  int32_t at;         // when it was made: time(NULL), seconds since 1970 UTC
  int32_t sail_days;  // the cruise it belongs to (SliceMeta.sail_days)
  int32_t start;      // cruise minutes; NO_TIME for untimed entries
  int16_t day;        // watch day of the slice it was made on (for untimed)
  uint8_t on;         // STAR_CHANGE_ bits
  char title[SHORT_TITLE_LEN];
  char venue[SHORT_VENUE_LEN];
} StarChange;

// Loads the queue saved on the watch.
void stars_init(void);

// Queues a change to the event's star, or with `reserved` to its Reserved mark
// (one entry per event and kind; the latest wins).
void stars_record(const Event *e, bool reserved, bool on);

// Applies queued changes to the current slice (flags and reminders), so a slice
// from the phone that doesn't know about them yet doesn't undo them.
void stars_apply(void);

// Sends the queue to the phone, if there is anything to send.
void stars_send(void);

// Sending failed; tries again in a few seconds (a few times at most).
void stars_send_failed(void);

// The phone saved every change up to `seq`.
void stars_ack(int32_t seq);
