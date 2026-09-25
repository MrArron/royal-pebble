#include "store.h"
#include "codec.h"
#include "data.h"

// Storage is values of at most PERSIST_DATA_MAX_LENGTH (256) bytes, and the
// total per app is capped: 4 KB on older firmware, more on newer (the emulator
// reports 1 MB; persist_get_max_size() tells). The slice is saved as one packed
// blob (docs/WATCH_PROTOCOL.md, "Stored on the watch") spread over up to
// STORE_MAX_KEYS values. STORE_RESERVE stays free for the star queue (stars.c)
// and later needs; with a large cap the whole day fits.
//
// Normally the whole day goes in: the day and My info, every alert still to
// come and every event that hasn't finished. Only when that doesn't fit does
// it fall back to priorities, until the blob is full: alerts in the next
// STORE_WINDOW minutes, starred events and personal entries in that window,
// later alerts, then featured and other events in the window, soonest first.
// The first starred event or alert that doesn't fit is then the "cutoff": the
// phone has to be back before then.

#define STORE_VERSION 4  // 4: one packed blob, chosen by priority
#define STORE_MAX_KEYS 40
#define STORE_MAX_BUDGET (STORE_MAX_KEYS * PERSIST_DATA_MAX_LENGTH)
#define STORE_MIN_BUDGET (4 * PERSIST_DATA_MAX_LENGTH)
#define STORE_RESERVE 1536
#define STORE_WINDOW (12 * 60)

enum {
  KEY_VERSION = 1,
  KEY_LENGTH = 2,
  KEY_SHOWN = 5,  // the cutoff last shown to the user
  KEY_BLOB = 40,  // 40..79
  OLD_KEY_EVENTS = 10,  // version 3: events in 10..13
  OLD_EVENT_KEYS = 4,
  // Version 3 kept the header in 2, My info in 3 and alerts in 20..27.
  OLD_KEY_INFO = 3,
  OLD_KEY_ALARMS = 20,
  OLD_ALARM_KEYS = 8,
};

// Header: int32 sail_days, uint8 bits (1 dark, 2 featured, 4 demo), uint8
// reminder lead, uint16 slice id, int32 day index, uint8 day kind, int32
// all-aboard, int16 local offset, int32 cutoff, uint8 alert count, uint8 event
// count; then the day's status and location and My info's six texts.
#define HEADER_FIXED 26

static uint8_t s_blob[STORE_MAX_BUDGET];
static int32_t s_cutoff = NO_TIME;
static int s_length;

int32_t store_cutoff(void) { return s_cutoff; }
int store_saved_bytes(void) { return s_length; }

// 2560 bytes with the old 4 KB cap.
static int budget(void) {
  int max = (int)persist_get_max_size() - STORE_RESERVE;
  max -= max % PERSIST_DATA_MAX_LENGTH;
  return max > STORE_MAX_BUDGET ? STORE_MAX_BUDGET : max < STORE_MIN_BUDGET ? STORE_MIN_BUDGET : max;
}

static int info_size(const MyInfo *info, const Day *day) {
  return HEADER_FIXED + 8 + codec_str_len(day->status, sizeof(day->status) - 1) +
         codec_str_len(day->location, sizeof(day->location) - 1) +
         codec_str_len(info->stateroom, sizeof(info->stateroom) - 1) +
         codec_str_len(info->deck, sizeof(info->deck) - 1) +
         codec_str_len(info->stairs, sizeof(info->stairs) - 1) +
         codec_str_len(info->muster, sizeof(info->muster) - 1) +
         codec_str_len(info->clock_note, sizeof(info->clock_note) - 1) +
         codec_str_len(info->last_sync, sizeof(info->last_sync) - 1);
}

static uint8_t *write_header(uint8_t *p, int alarms, int events) {
  const SliceMeta *meta = data_meta();
  const Day *day = data_day();
  const MyInfo *info = data_my_info();
  codec_write_int32(p, meta->sail_days);
  p[4] = (meta->dark_theme ? 1 : 0) | (meta->show_featured ? 2 : 0) | (meta->is_demo ? 4 : 0);
  p[5] = meta->reminder_lead;
  p[6] = (uint8_t)data_slice_id();
  p[7] = (uint8_t)(data_slice_id() >> 8);
  codec_write_int32(p + 8, day->index);
  p[12] = (uint8_t)day->kind;
  codec_write_int32(p + 13, day->all_aboard);
  p[17] = (uint8_t)day->local_offset;
  p[18] = (uint8_t)(day->local_offset >> 8);
  codec_write_int32(p + 19, s_cutoff);
  p[23] = (uint8_t)alarms;
  p[24] = (uint8_t)events;
  p[25] = 0;  // spare
  p += HEADER_FIXED;
  p = codec_write_str(p, day->status, sizeof(day->status) - 1);
  p = codec_write_str(p, day->location, sizeof(day->location) - 1);
  p = codec_write_str(p, info->stateroom, sizeof(info->stateroom) - 1);
  p = codec_write_str(p, info->deck, sizeof(info->deck) - 1);
  p = codec_write_str(p, info->stairs, sizeof(info->stairs) - 1);
  p = codec_write_str(p, info->muster, sizeof(info->muster) - 1);
  p = codec_write_str(p, info->clock_note, sizeof(info->clock_note) - 1);
  return codec_write_str(p, info->last_sync, sizeof(info->last_sync) - 1);
}

static void earlier(int32_t *cutoff, int32_t t) {
  if (*cutoff == NO_TIME || t < *cutoff) {
    *cutoff = t;
  }
}

// Priority passes: which alerts (a) or events (e) each one takes.
enum { PASS_SOON_ALERTS, PASS_STARRED, PASS_LATER_ALERTS, PASS_FEATURED, PASS_OTHER, PASS_COUNT };

static bool starred(const Event *e) { return (e->flags & (EVENT_STARRED | EVENT_PERSONAL)) != 0; }

// Whether event e is worth storing at all: not over, and in the window
// (untimed ones only when starred or personal).
static bool event_wanted(const Event *e, int32_t now) {
  if (!event_is_timed(e)) {
    return starred(e);
  }
  return !event_is_finished(e, now) && e->start < now + STORE_WINDOW;
}

void store_save(void) {
  if (!data_ready()) {
    return;
  }
  int32_t now = now_cruise();
  int limit = budget();
  int alarm_count = data_alarm_count();
  int event_count = data_event_count();
  static bool keep_alarm[MAX_ALARMS];
  static bool keep_event[MAX_EVENTS];
  memset(keep_alarm, 0, sizeof(keep_alarm));
  memset(keep_event, 0, sizeof(keep_event));

  // The header is written last (it holds the counts and cutoff), but its size
  // is known now; a cutoff is always four bytes.
  int used = info_size(data_my_info(), data_day());
  int32_t cutoff = NO_TIME;
  int alarms = 0, events = 0;

  // The whole day, if it fits.
  int whole = used;
  for (int i = 0; i < alarm_count; i++) {
    if (data_alarm(i)->at > now) {
      whole += codec_alarm_size(data_alarm(i));
    }
  }
  for (int i = 0; i < event_count; i++) {
    if (!event_is_finished(data_event(i), now)) {
      whole += codec_event_size(data_event(i));
    }
  }
  bool full_day = whole <= limit;
  if (full_day) {
    for (int i = 0; i < alarm_count; i++) {
      keep_alarm[i] = data_alarm(i)->at > now;
      alarms += keep_alarm[i];
    }
    for (int i = 0; i < event_count; i++) {
      keep_event[i] = !event_is_finished(data_event(i), now);
      events += keep_event[i];
    }
    used = whole;
  }

  for (int pass = 0; pass < PASS_COUNT && !full_day; pass++) {
    if (pass == PASS_SOON_ALERTS || pass == PASS_LATER_ALERTS) {
      for (int i = 0; i < alarm_count; i++) {
        Alarm *a = data_alarm(i);
        bool soon = a->at < now + STORE_WINDOW;
        if (a->at <= now || soon != (pass == PASS_SOON_ALERTS)) {
          continue;
        }
        int size = codec_alarm_size(a);
        if (used + size <= limit) {
          keep_alarm[i] = true;
          used += size;
          alarms++;
        } else {
          earlier(&cutoff, a->at);
        }
      }
      continue;
    }
    for (int i = 0; i < event_count; i++) {
      Event *e = data_event(i);
      if (!event_wanted(e, now)) {
        continue;
      }
      bool want = pass == PASS_STARRED ? starred(e)
                : pass == PASS_FEATURED ? !starred(e) && (e->flags & EVENT_FEATURED)
                : !starred(e) && !(e->flags & EVENT_FEATURED);
      if (!want) {
        continue;
      }
      int size = codec_event_size(e);
      if (used + size <= limit) {
        keep_event[i] = true;
        used += size;
        events++;
      } else if (pass == PASS_STARRED && event_is_timed(e)) {
        earlier(&cutoff, e->start);
      }
    }
  }
  s_cutoff = cutoff;

  uint8_t *p = write_header(s_blob, alarms, events);
  for (int i = 0; i < alarm_count; i++) {
    if (keep_alarm[i]) {
      p = codec_write_alarm(p, data_alarm(i));
    }
  }
  for (int i = 0; i < event_count; i++) {
    if (keep_event[i]) {
      p = codec_write_event(p, data_event(i));
    }
  }
  int length = p - s_blob;
  s_length = length;

  persist_write_int(KEY_VERSION, STORE_VERSION);
  persist_write_int(KEY_LENGTH, length);
  for (int k = 0; k < STORE_MAX_KEYS; k++) {
    int start = k * PERSIST_DATA_MAX_LENGTH;
    if (start >= length) {
      if (persist_exists(KEY_BLOB + k)) {
        persist_delete(KEY_BLOB + k);
      }
      continue;
    }
    int n = length - start < PERSIST_DATA_MAX_LENGTH ? length - start : PERSIST_DATA_MAX_LENGTH;
    int written = persist_write_data(KEY_BLOB + k, s_blob + start, n);
    if (written < n) {
      APP_LOG(APP_LOG_LEVEL_ERROR, "Saving slice part %d failed: %d", k, written);
    }
  }
  // Version 3 values that the blob doesn't reuse.
  if (persist_exists(OLD_KEY_INFO)) {
    persist_delete(OLD_KEY_INFO);
    for (int k = 0; k < OLD_EVENT_KEYS; k++) {
      persist_delete(OLD_KEY_EVENTS + k);
    }
    for (int k = 0; k < OLD_ALARM_KEYS; k++) {
      persist_delete(OLD_KEY_ALARMS + k);
    }
  }
  APP_LOG(APP_LOG_LEVEL_INFO, "Saved %s: %d of %d alerts, %d of %d events, %d of %d bytes, cutoff %d",
          full_day ? "the whole day" : "by priority", alarms, alarm_count, events, event_count,
          length, limit, (int)cutoff);
}

bool store_load(void) {
  if (!persist_exists(KEY_VERSION) || persist_read_int(KEY_VERSION) != STORE_VERSION) {
    return false;
  }
  int length = persist_read_int(KEY_LENGTH);
  if (length < HEADER_FIXED || length > STORE_MAX_BUDGET) {
    return false;
  }
  for (int start = 0, k = 0; start < length; start += PERSIST_DATA_MAX_LENGTH, k++) {
    int n = length - start < PERSIST_DATA_MAX_LENGTH ? length - start : PERSIST_DATA_MAX_LENGTH;
    if (persist_read_data(KEY_BLOB + k, s_blob + start, n) != n) {
      return false;
    }
  }

  const uint8_t *p = s_blob;
  const uint8_t *end = s_blob + length;
  SliceMeta meta = {
    .sail_days = codec_read_int32(p),
    .dark_theme = (p[4] & 1) != 0,
    .show_featured = (p[4] & 2) != 0,
    .is_demo = (p[4] & 4) != 0,
    .from_storage = true,
    .reminder_lead = p[5],
  };
  uint16_t slice_id = (uint16_t)(p[6] | (p[7] << 8));
  Day day = {
    .index = codec_read_int32(p + 8),
    .kind = (DayKind)p[12],
    .all_aboard = codec_read_int32(p + 13),
    .local_offset = (int16_t)(p[17] | (p[18] << 8)),
  };
  s_cutoff = codec_read_int32(p + 19);
  int alarms = p[23] < MAX_ALARMS ? p[23] : MAX_ALARMS;
  int events = p[24] < MAX_EVENTS ? p[24] : MAX_EVENTS;
  p += HEADER_FIXED;
  MyInfo info;
  if (!codec_read_str(&p, end, day.status, sizeof(day.status)) ||
      !codec_read_str(&p, end, day.location, sizeof(day.location)) ||
      !codec_read_str(&p, end, info.stateroom, sizeof(info.stateroom)) ||
      !codec_read_str(&p, end, info.deck, sizeof(info.deck)) ||
      !codec_read_str(&p, end, info.stairs, sizeof(info.stairs)) ||
      !codec_read_str(&p, end, info.muster, sizeof(info.muster)) ||
      !codec_read_str(&p, end, info.clock_note, sizeof(info.clock_note)) ||
      !codec_read_str(&p, end, info.last_sync, sizeof(info.last_sync))) {
    return false;
  }
  int a = 0;
  while (a < alarms && codec_read_alarm(&p, end, data_alarm(a))) {
    a++;
  }
  int e = 0;
  while (e < events && codec_read_event(&p, end, data_event(e))) {
    e++;
  }
  data_commit(slice_id, &meta, &day, &info, e, a);
  APP_LOG(APP_LOG_LEVEL_INFO, "Loaded stored slice: %d events, %d alerts, %d bytes (storage max %d)",
          e, a, length, (int)persist_get_max_size());
  return true;
}

bool store_should_warn(void) {
  if (s_cutoff == NO_TIME || s_cutoff <= now_cruise()) {
    return false;
  }
  int32_t shown = persist_exists(KEY_SHOWN) ? persist_read_int(KEY_SHOWN) : NO_TIME;
  // Once per cutoff; again only if it moves earlier or the last one has passed.
  if (shown != NO_TIME && shown > now_cruise() && s_cutoff >= shown) {
    return false;
  }
  persist_write_int(KEY_SHOWN, s_cutoff);
  return true;
}
