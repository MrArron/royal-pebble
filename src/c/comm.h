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

// A ship directory page from the phone (docs/WATCH_PROTOCOL.md, Ship
// directory). `rows` points into the message and is only valid in the handler.
typedef struct {
  int32_t ref;
  char title[24];     // top bar, left
  char label[24];     // top bar, right (when there is no rel)
  bool has_rel;
  int8_t rel;         // decks from the cabin, for the top bar
  bool has_where;
  Where where;        // place pages: where the place is
  bool has_gps;       // place pages: the Ship GPS lines
  DirGps gps;
  bool has_bank;      // elevator bank pages
  DirBank bank;
  const uint8_t *rows;
  int rows_length;
} DirPageMsg;

typedef void (*CommDirPageHandler)(const DirPageMsg *page);
typedef void (*CommDirFailedHandler)(void);

// Handlers for directory pages and for a request the phone didn't get.
void comm_set_dir_handlers(CommDirPageHandler on_page, CommDirFailedHandler on_failed);
// Asks the phone for directory page `ref`; false if the outbox was busy.
bool comm_request_dir(int32_t ref);

// A Route screen from the phone (docs/WATCH_PROTOCOL.md, Route screen) for
// place page `ref`, to its closest restroom when `rest`. `data` points into the
// message and is only valid in the handler.
typedef struct {
  int32_t ref;
  bool rest;
  const uint8_t *data;
  int length;
} RoutePageMsg;

typedef void (*CommRoutePageHandler)(const RoutePageMsg *page);

// Handlers for route pages and for a request the phone didn't get.
void comm_set_route_handlers(CommRoutePageHandler on_page, CommDirFailedHandler on_failed);
// Asks the phone for the route to place page `ref` (or to its closest restroom);
// false if the outbox was busy.
bool comm_request_route(int32_t ref, bool rest);
