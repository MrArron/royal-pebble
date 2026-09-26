#include "data.h"

static bool s_ready;
static uint16_t s_slice_id;
static SliceMeta s_meta = {.show_featured = true};
static Day s_day = {.kind = DAY_NONE, .all_aboard = NO_TIME, .arrive = NO_TIME, .depart = NO_TIME};
static Tomorrow s_tomorrow = {.kind = DAY_NONE};
static MyInfo s_info;
// On the heap (data_init): as a static array the events pushed the app past the
// SDK's limit on code plus static data, 64 KB (PebbleProcessInfo.virtual_size is
// 16 bits). It takes the same RAM either way.
static Event *s_events;
static int s_event_count;
static Alarm s_alarms[MAX_ALARMS];
static int s_alarm_count;

void data_init(void) {
  s_events = calloc(MAX_EVENTS, sizeof(Event));
  if (!s_events) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "No room for %d events", MAX_EVENTS);
  }
}

bool data_ready(void) { return s_ready; }
const Day *data_day(void) { return &s_day; }
const Tomorrow *data_tomorrow(void) { return &s_tomorrow; }
const MyInfo *data_my_info(void) { return &s_info; }
const SliceMeta *data_meta(void) { return &s_meta; }
uint16_t data_slice_id(void) { return s_slice_id; }
int data_event_count(void) { return s_event_count; }
Event *data_event(int index) { return &s_events[index]; }
int data_alarm_count(void) { return s_alarm_count; }
Alarm *data_alarm(int index) { return &s_alarms[index]; }

void data_commit(uint16_t slice_id, const SliceMeta *meta, const Day *day, const Tomorrow *tomorrow,
                 const MyInfo *info, int event_count, int alarm_count) {
  s_slice_id = slice_id;
  s_meta = *meta;
  s_day = *day;
  s_tomorrow = *tomorrow;
  s_info = *info;
  s_event_count = event_count < MAX_EVENTS ? event_count : MAX_EVENTS;
  s_alarm_count = alarm_count < MAX_ALARMS ? alarm_count : MAX_ALARMS;
  s_ready = true;
}

static bool same_text(const char *a, const char *b, int n) {
  for (int i = 0; i < n; i++) {
    if (a[i] != b[i]) {
      return false;
    }
    if (!a[i]) {
      return true;
    }
  }
  return true;
}

// Copies `src` into `dst` (`size` bytes with the NUL), cut between UTF-8
// characters like the phone cuts them (no strlen: walks to the NUL).
static void copy_text(char *dst, size_t size, const char *src) {
  size_t n = 0;
  while (n + 1 < size && src[n]) {
    dst[n] = src[n];
    n++;
  }
  if (((uint8_t)src[n] & 0xC0) == 0x80) {
    // Cut inside a character: drop its first bytes too.
    while (n > 0 && ((uint8_t)dst[n - 1] & 0xC0) == 0x80) {
      n--;
    }
    if (n > 0) {
      n--;
    }
  }
  dst[n] = '\0';
}

void data_set_reminder(const Event *e, bool on) {
  if (!event_is_timed(e)) {
    return;
  }
  // Remove any existing reminder for this event (its title as an alert keeps it).
  char title[ALARM_TITLE_LEN];
  copy_text(title, sizeof(title), e->title);
  int out = 0;
  for (int i = 0; i < s_alarm_count; i++) {
    Alarm *a = &s_alarms[i];
    bool match = a->kind == ALARM_REMINDER && a->ref == e->start &&
                 same_text(a->title, title, ALARM_TITLE_LEN);
    if (!match) {
      s_alarms[out++] = *a;
    }
  }
  s_alarm_count = out;
  if (!on || s_alarm_count >= MAX_ALARMS) {
    return;
  }

  // Directions from the cabin until the phone's next plan works out the rest.
  Alarm a = {
    .at = e->start - s_meta.reminder_lead,
    .ref = e->start,
    .extra = (int16_t)e->minutes,
    .kind = ALARM_REMINDER,
    .from = (FROM_NONE << 2) | (event_not_reserved(e->flags) ? ALARM_NOT_RESERVED : 0),
    .where = e->where,
  };
  copy_text(a.title, sizeof(a.title), title);
  copy_text(a.venue, sizeof(a.venue), e->venue);
  int pos = s_alarm_count;
  while (pos > 0 && s_alarms[pos - 1].at > a.at) {
    s_alarms[pos] = s_alarms[pos - 1];
    pos--;
  }
  s_alarms[pos] = a;
  s_alarm_count++;
}

void data_update_reminder(const Event *e) {
  if (!event_is_timed(e)) {
    return;
  }
  char title[ALARM_TITLE_LEN];
  copy_text(title, sizeof(title), e->title);
  for (int i = 0; i < s_alarm_count; i++) {
    Alarm *a = &s_alarms[i];
    if (a->kind == ALARM_REMINDER && a->ref == e->start && same_text(a->title, title, ALARM_TITLE_LEN)) {
      a->from = (a->from & ~ALARM_NOT_RESERVED) | (event_not_reserved(e->flags) ? ALARM_NOT_RESERVED : 0);
    }
  }
}

bool event_is_timed(const Event *e) { return e->start != NO_TIME; }

int32_t event_end(const Event *e) { return e->start + e->minutes; }

bool event_in_progress(const Event *e, int32_t now) {
  return event_is_timed(e) && e->minutes > 0 && e->start <= now && now < event_end(e);
}

bool event_is_past(const Event *e, int32_t now) {
  if (!event_is_timed(e)) {
    return false;
  }
  return e->minutes > 0 ? event_end(e) <= now : e->start < now;
}

bool event_is_finished(const Event *e, int32_t now) {
  if (!event_is_timed(e)) {
    return false;
  }
  return (e->minutes > 0 ? event_end(e) : e->start + FINISHED_GRACE) <= now;
}

bool event_can_clash(const Event *e) {
  return (e->flags & (EVENT_STARRED | EVENT_PERSONAL)) && event_is_timed(e);
}

static int32_t clash_end(const Event *e) {
  return e->start + (e->minutes > 0 ? e->minutes : FINISHED_GRACE);
}

static bool overlap(const Event *a, const Event *b) {
  return a->start < clash_end(b) && b->start < clash_end(a);
}

static bool clash_candidate(const Event *e, int32_t now) {
  return event_can_clash(e) && !event_is_finished(e, now);
}

int data_clashes_with(int index, int32_t now, int *first) {
  if (first) {
    *first = -1;
  }
  const Event *e = &s_events[index];
  if (!clash_candidate(e, now)) {
    return 0;
  }
  int n = 0;
  for (int i = 0; i < s_event_count; i++) {
    const Event *o = &s_events[i];
    if (i != index && clash_candidate(o, now) && overlap(e, o)) {
      // Events are sorted by start, so the first found is the earliest.
      if (n++ == 0 && first) {
        *first = i;
      }
    }
  }
  return n;
}

int data_clash_count(int32_t now) {
  int n = 0;
  for (int i = 0; i < s_event_count; i++) {
    if (!clash_candidate(&s_events[i], now)) {
      continue;
    }
    for (int j = i + 1; j < s_event_count; j++) {
      n += clash_candidate(&s_events[j], now) && overlap(&s_events[i], &s_events[j]);
    }
  }
  return n;
}

// Days since 1970-01-01 (Howard Hinnant's algorithm; the phone uses the same).
int32_t days_from_civil(int y, int m, int d) {
  y -= m <= 2;
  int32_t era = (y >= 0 ? y : y - 399) / 400;
  int32_t yoe = y - era * 400;
  int32_t doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  int32_t doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097 + doe - 719468;
}

int32_t now_cruise(void) {
  time_t now = time(NULL);
  struct tm *t = localtime(&now);
  int32_t today = days_from_civil(t->tm_year + 1900, t->tm_mon + 1, t->tm_mday);
  return (today - s_meta.sail_days) * MINUTES_PER_DAY + t->tm_hour * 60 + t->tm_min;
}

int32_t cruise_day_index(int32_t cruise_min) {
  int32_t shifted = cruise_min - DAY_START;
  // Floor division: times before the sail date are negative.
  return shifted >= 0 ? shifted / MINUTES_PER_DAY
                      : -((-shifted + MINUTES_PER_DAY - 1) / MINUTES_PER_DAY);
}
