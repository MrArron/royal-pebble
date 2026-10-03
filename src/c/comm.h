#pragma once
#include <pebble.h>
#include "data.h"
#include "stars.h"

// AppMessage link to the phone companion (docs/WATCH_PROTOCOL.md).

typedef void (*CommSliceHandler)(void);
typedef void (*CommNoticeHandler)(const Notice *notices, int count);

// Opens AppMessage; `on_slice` runs after each complete slice arrives,
// `on_notices` when the phone reports starred events a re-sync changed.
void comm_init(CommSliceHandler on_slice, CommNoticeHandler on_notices);
void comm_deinit(void);

void comm_request_slice(void);
// Sends the queued star changes; false if the outbox was busy.
bool comm_send_star_changes(const StarChange *changes, int count);
// Tells the phone the first starred event or alert time that didn't fit in the
// watch's storage (NO_TIME: everything fit), the bytes saved and the storage
// limit, for its settings page.
void comm_send_saved(int32_t cutoff, int bytes);
void comm_demo_next(void);
// Sends usage log entries (16 bytes each, docs/WATCH_PROTOCOL.md) and how many
// the queue lost since the last send; false if the outbox was busy.
bool comm_send_log(const uint8_t *entries, int length, int32_t dropped);

// A ship directory page from the phone (docs/WATCH_PROTOCOL.md, Ship
// directory). `rows` points into the message and is only valid in the handler.
typedef struct {
  int32_t ref;
  char title[24];     // top bar, left
  char label[24];     // top bar, right (when there is no rel)
  bool has_rel;
  int8_t rel;         // decks from the cabin, for the top bar
  const uint8_t *lines;  // the heading's card (lines.h), NULL for none
  int lines_length;
  const uint8_t *rows;
  int rows_length;
} DirPageMsg;

typedef void (*CommDirPageHandler)(const DirPageMsg *page);
// A request the phone didn't get. `script_down`: the phone is connected but its
// script isn't running (yet: it takes a few seconds after the app opens).
typedef void (*CommDirFailedHandler)(bool script_down);
// Any message from the phone: its script is up.
typedef void (*CommPhoneUpHandler)(void);

// Handlers for directory pages, a request the phone didn't get and any message
// from the phone.
void comm_set_dir_handlers(CommDirPageHandler on_page, CommDirFailedHandler on_failed,
                           CommPhoneUpHandler on_phone_up);
// Asks the phone for directory page `ref`; false if the outbox was busy.
bool comm_request_dir(int32_t ref);

// A Route screen from the phone (docs/WATCH_PROTOCOL.md, Route screen) for
// place page `ref`, to its closest restroom when `rest`, or to the event that
// starts at `start` (NO_TIME for a place page): its lines (lines.h) and the top
// bar's right label. `lines` points into the message and is only valid in the
// handler.
typedef struct {
  int32_t ref;
  bool rest;
  int32_t start;
  char label[24];
  const uint8_t *lines;
  int length;
} RoutePageMsg;

typedef void (*CommRoutePageHandler)(const RoutePageMsg *page);

// Handlers for route pages, a request the phone didn't get and any message
// from the phone.
void comm_set_route_handlers(CommRoutePageHandler on_page, CommDirFailedHandler on_failed,
                             CommPhoneUpHandler on_phone_up);
// Asks the phone for the route to place page `ref` (or to its closest
// restroom), or with `start` not NO_TIME to the event at `start` (cruise
// minutes) at `venue` (Home's NEXT); false if the outbox was busy.
bool comm_request_route(int32_t ref, bool rest, int32_t start, const char *venue);

// Voice (docs/WATCH_PROTOCOL.md, Voice): sends the transcript for voice turn
// `seq` with the watch's `state` bits (1: on board today, 2: 24-hour clock), or with `text` NULL
// confirms the turn's card (Select on "I'm at..."). False if the outbox was busy.
bool comm_send_voice(int32_t seq, const char *text, int32_t state);
// The phone's card for turn `seq`; `card` points into the message and is only
// valid in the handler. NULL stops them.
typedef void (*CommVoiceHandler)(int32_t seq, const uint8_t *card, int length);
void comm_set_voice_handler(CommVoiceHandler handler);
