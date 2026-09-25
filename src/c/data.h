#pragma once
#include <pebble.h>

// Today's slice of the cruise, as sent by the phone companion
// (docs/WATCH_PROTOCOL.md).
//
// Times are "cruise minutes": minutes since 00:00 ship time on the sail date, so
// anything crossing midnight is just a larger number. A watch day runs from
// 04:00 to 04:00 ship time. The watch clock is assumed to be ship time.

#define MAX_EVENTS 160
#define TITLE_LEN 64
#define VENUE_LEN 32
#define NO_TIME (-1)
#define DAY_START (4 * 60)
#define MAX_ALARMS 24
// Notices and the star queue.
#define SHORT_TITLE_LEN 40
#define SHORT_VENUE_LEN 24
// Alerts: shorter, so three fit in one 256-byte storage value (store.c).
#define ALARM_TITLE_LEN 32
#define ALARM_VENUE_LEN 18

typedef enum {
  DAY_PORT = 0,  // embark, docked, tender, debark
  DAY_SEA = 1,
  DAY_NONE = 2,  // before or after the cruise
} DayKind;

enum {
  EVENT_STARRED = 1 << 0,
  EVENT_FEATURED = 1 << 1,
  EVENT_RESERVATION = 1 << 2,
  EVENT_PERSONAL = 1 << 3,
};

// Where a venue is, worked out by the phone (docs/WATCH_PROTOCOL.md, Packed
// events). The watch only formats it.
enum {
  WHERE_POS_MASK = 3,  // 0 none, 1 Fore, 2 Mid, 3 Aft
  WHERE_ASHORE = 1 << 2,
  WHERE_REL = 1 << 3,  // rel is known (the cabin deck is set)
};

typedef struct {
  uint8_t deck;     // entrance deck to use; 0 = not known
  uint8_t deck_to;  // several entrances and no cabin deck: decks deck..deck_to
  uint8_t bits;     // position and WHERE_ flags
  int8_t rel;       // decks from the cabin: deck - cabin deck (with WHERE_REL)
} Where;

typedef struct {
  char title[TITLE_LEN];
  char venue[VENUE_LEN];
  int32_t start;     // cruise minutes; NO_TIME for untimed entries
  uint16_t minutes;  // duration; 0 if unknown
  uint8_t flags;
  Where where;
} Event;

typedef struct {
  int32_t index;         // watch day, 0 = sail date
  DayKind kind;
  char status[16];       // "DOCKED", "AT SEA", "SAILS MAR 6"
  char location[32];     // "St. Thomas", "At Sea"
  int32_t all_aboard;    // cruise minutes; NO_TIME when there is none
  int32_t arrive;        // cruise minutes, ship time; NO_TIME when there is none
  int32_t depart;        // cruise minutes, ship time; NO_TIME when there is none
  int16_t local_offset;  // local time = ship time + offset (minutes)
} Day;

// What the show to catch tomorrow is (Tomorrow.last_kind).
typedef enum {
  FINAL_NONE = 0,
  FINAL_LAST_CHANCE = 1,  // the last performance of a featured show
  FINAL_ONLY_SHOW = 2,    // a featured show that is on only once
} FinalKind;

// The next watch day, for the evening's tomorrow card (docs/DESIGN_V1_1.md
// §8.1), worked out by the phone since the watch only has today's events.
typedef struct {
  DayKind kind;              // DAY_NONE: tomorrow is outside the cruise
  char status[16];           // "DOCKED", "DEBARK"
  char location[32];
  int32_t arrive;            // cruise minutes, ship time; NO_TIME when none
  int32_t depart;
  int32_t all_aboard;
  int32_t first_start;       // the first timed starred item; NO_TIME when none
  uint8_t starred;           // starred events and personal entries
  uint8_t featured;
  uint8_t last_kind;         // FinalKind
  char first[SHORT_TITLE_LEN];
  char last[SHORT_TITLE_LEN];  // a show to catch (last_kind)
} Tomorrow;

typedef struct {
  char stateroom[12];
  char deck[16];
  char stairs[24];
  char muster[32];
  char clock_note[40];
  char last_sync[24];
} MyInfo;

typedef enum {
  ALARM_ALL_ABOARD = 0,
  ALARM_REMINDER = 1,
} AlarmKind;

// "From" directions on a reminder, decided by the phone (docs/WATCH_PROTOCOL.md,
// Alerts): Alarm.from holds the previous venue's position in bits 0-1 and one
// of these in bits 2-3.
typedef enum {
  FROM_NONE = 0,        // where is relative to the cabin
  FROM_ROUTE = 1,       // where is relative to from_venue
  FROM_SAME_VENUE = 2,
  FROM_SAME_AREA = 3,
} FromKind;

// Something the watch buzzes for on its own, even with the app closed.
typedef struct {
  int32_t at;     // cruise minutes: when to buzz
  int32_t ref;    // cruise minutes: all-aboard time or event start
  int16_t extra;  // all-aboard: local offset; reminder: duration in minutes
  uint8_t kind;   // AlarmKind
  uint8_t from;   // reminder: "From" directions (FromKind << 2 | previous position)
  Where where;    // reminder: where the event is
  char title[ALARM_TITLE_LEN];  // all-aboard: location; reminder: event title
  char venue[ALARM_VENUE_LEN];  // the venue's short name
  char from_venue[ALARM_VENUE_LEN];  // FROM_ROUTE: the previous venue's short name
} Alarm;

static inline FromKind alarm_from_kind(const Alarm *a) { return (FromKind)((a->from >> 2) & 3); }
static inline int alarm_from_pos(const Alarm *a) { return a->from & 3; }

typedef enum {
  NOTICE_MOVED = 0,      // a starred event moved; its star moved with it
  NOTICE_CANCELLED = 1,  // a starred event is gone; its star was dropped
  NOTICE_CHECK = 2,      // several new times match; the star was dropped
  NOTICE_SAVED = 3,      // starred events or alerts from `from` on didn't fit in storage
} NoticeKind;

#define MAX_NOTICES 8

// A starred event a re-sync changed. Shown once, not stored.
typedef struct {
  int32_t from;   // cruise minutes: old start; NO_TIME if untimed
  int32_t to;     // cruise minutes: new start (moved), else same as from
  uint8_t kind;   // NoticeKind
  char title[SHORT_TITLE_LEN];
  char venue[SHORT_VENUE_LEN];      // new venue (moved), else the old one
  char old_venue[SHORT_VENUE_LEN];  // moved to another venue: the old one
} Notice;

// One row of a ship directory page (docs/WATCH_PROTOCOL.md, Ship directory).
// Pages come from the phone one at a time and aren't stored.
#define DIR_LINE1_LEN 40
#define DIR_LINE2_LEN 32

typedef enum {
  DIR_ROW_HEADER = 0,  // small-caps header; the cursor skips it
  DIR_ROW_ITEM = 1,    // name and optional sub-line; opens `ref` when not 0
  DIR_ROW_EVENT = 2,   // an event at the place: title, start and minutes
  DIR_ROW_PLACE = 3,   // a heading: the name; for a place, its area in line2
} DirRowKind;

typedef struct {
  int32_t start;     // events: cruise minutes, NO_TIME for untimed
  uint16_t ref;      // page to open on Select; 0 = none
  uint16_t minutes;  // events: duration, 0 if unknown
  uint8_t kind;      // DirRowKind
  uint8_t flags;     // events: EVENT_ flags
  char line1[DIR_LINE1_LEN];
  char line2[DIR_LINE2_LEN];
} DirRow;

// Slice-wide settings sent with each slice.
typedef struct {
  int32_t sail_days;  // days since 1970-01-01 of the sail date
  bool dark_theme;
  bool show_featured;
  bool is_demo;
  bool from_storage;       // loaded from the watch, not fresh from the phone
  uint8_t reminder_lead;   // minutes before starred events
  uint8_t cruise_starred;  // starred events and personal entries in the whole cruise
  char ship_name[32];
  char sail_port[32];      // "Galveston"; "" when not known
} SliceMeta;

bool data_ready(void);
const Day *data_day(void);
const Tomorrow *data_tomorrow(void);
const MyInfo *data_my_info(void);
const SliceMeta *data_meta(void);
uint16_t data_slice_id(void);
int data_event_count(void);
Event *data_event(int index);
int data_alarm_count(void);
Alarm *data_alarm(int index);

// Replaces the slice (called when a complete slice has arrived from the phone
// or was loaded from storage).
void data_commit(uint16_t slice_id, const SliceMeta *meta, const Day *day, const Tomorrow *tomorrow,
                 const MyInfo *info, int event_count, int alarm_count);

// Adds or removes the reminder for a starred event (kept sorted by time).
void data_set_reminder(const Event *e, bool on);

bool event_is_timed(const Event *e);
bool event_in_progress(const Event *e, int32_t now);
bool event_is_past(const Event *e, int32_t now);
// Over and dropped from lists: past its end or, with no length given,
// FINISHED_GRACE minutes after it starts. Untimed entries last all day.
#define FINISHED_GRACE 30
bool event_is_finished(const Event *e, int32_t now);
int32_t event_end(const Event *e);

int32_t days_from_civil(int y, int m, int d);
// Current time in cruise minutes (needs a slice for the sail date).
int32_t now_cruise(void);
// Watch day (04:00 to 04:00) containing `cruise_min`.
int32_t cruise_day_index(int32_t cruise_min);
