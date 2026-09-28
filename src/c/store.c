#include "store.h"
#include "codec.h"
#include "data.h"
#include "usage.h"

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

#define STORE_VERSION 10  // 4: one packed blob, chosen by priority; 5: summary fields; 6: countdown;
                          // 7: tomorrow's to-reserve count; 8: terminal arrival; 9: event details
                          // bytes (age, arrive-early, tags) and the alarm's early byte; 10: My
                          // info's dining room
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
};

// Header: int32 sail_days, uint8 bits (1 dark, 2 featured, 4 demo, 8 hints,
// 16-32 the warning period: 30 minutes times one more than these), uint8
// reminder lead, uint16 slice id, int32 day index, uint8 day kind, int32
// all-aboard, int16 local offset, int32 cutoff, uint8 alert count, uint8 event
// count, uint8 cruise starred count; then for the summary int32 arrive and depart, and
// tomorrow's uint8 kind, int32 arrive, depart, all-aboard and first start,
// uint8 starred, featured, last kind and to-reserve count, then the day's int32
// terminal arrival. Then the texts: the day's status and location, My info's
// seven, the ship name, tomorrow's status, location, first and last, the sail
// port and the terminal arrival text.
#define HEADER_FIXED 59
#define HEADER_TEXTS 16

// The blob is on the heap only while saving or loading (10 KB with a large
// storage cap): it isn't needed in between, and the heap is what voice and deep
// directory pages share. Static, it would also count towards the SDK's 64 KB
// limit on code plus static data.
static int32_t s_cutoff = NO_TIME;
static int s_length;

// Logs a failed allocation like a failed write (docs/WATCH_PROTOCOL.md, code 13).
static uint8_t *blob_alloc(int size) {
  uint8_t *blob = malloc(size);
  if (!blob) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "No memory for the stored slice");
    usage_add(USAGE_STORAGE_ERROR, USAGE_STORE_SCHEDULE, E_OUT_OF_MEMORY, 0, size);
  }
  return blob;
}

int32_t store_cutoff(void) { return s_cutoff; }
int store_saved_bytes(void) { return s_length; }

// 2560 bytes with the old 4 KB cap.
static int budget(void) {
  int max = (int)persist_get_max_size() - STORE_RESERVE;
  max -= max % PERSIST_DATA_MAX_LENGTH;
  return max > STORE_MAX_BUDGET ? STORE_MAX_BUDGET : max < STORE_MIN_BUDGET ? STORE_MIN_BUDGET : max;
}

static int info_size(const MyInfo *info, const Day *day) {
  const SliceMeta *meta = data_meta();
  const Tomorrow *t = data_tomorrow();
  return HEADER_FIXED + HEADER_TEXTS + codec_str_len(day->status, sizeof(day->status) - 1) +
         codec_str_len(day->location, sizeof(day->location) - 1) +
         codec_str_len(info->stateroom, sizeof(info->stateroom) - 1) +
         codec_str_len(info->deck, sizeof(info->deck) - 1) +
         codec_str_len(info->stairs, sizeof(info->stairs) - 1) +
         codec_str_len(info->muster, sizeof(info->muster) - 1) +
         codec_str_len(info->dining, sizeof(info->dining) - 1) +
         codec_str_len(info->clock_note, sizeof(info->clock_note) - 1) +
         codec_str_len(info->last_sync, sizeof(info->last_sync) - 1) +
         codec_str_len(meta->ship_name, sizeof(meta->ship_name) - 1) +
         codec_str_len(t->status, sizeof(t->status) - 1) +
         codec_str_len(t->location, sizeof(t->location) - 1) +
         codec_str_len(t->first, sizeof(t->first) - 1) +
         codec_str_len(t->last, sizeof(t->last) - 1) +
         codec_str_len(meta->sail_port, sizeof(meta->sail_port) - 1) +
         codec_str_len(day->terminal_text, sizeof(day->terminal_text) - 1);
}

static uint8_t *write_header(uint8_t *p, int alarms, int events) {
  const SliceMeta *meta = data_meta();
  const Day *day = data_day();
  const MyInfo *info = data_my_info();
  const Tomorrow *t = data_tomorrow();
  codec_write_int32(p, meta->sail_days);
  p[4] = (meta->dark_theme ? 1 : 0) | (meta->show_featured ? 2 : 0) | (meta->is_demo ? 4 : 0) |
         (meta->always_hints ? 8 : 0) | ((day->warn_period / 30 - 1) & 3) << 4;
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
  p[25] = meta->cruise_starred;
  codec_write_int32(p + 26, day->arrive);
  codec_write_int32(p + 30, day->depart);
  p[34] = (uint8_t)t->kind;
  codec_write_int32(p + 35, t->arrive);
  codec_write_int32(p + 39, t->depart);
  codec_write_int32(p + 43, t->all_aboard);
  codec_write_int32(p + 47, t->first_start);
  p[51] = t->starred;
  p[52] = t->featured;
  p[53] = t->last_kind;
  p[54] = t->to_reserve;
  codec_write_int32(p + 55, day->terminal);
  p += HEADER_FIXED;
  p = codec_write_str(p, day->status, sizeof(day->status) - 1);
  p = codec_write_str(p, day->location, sizeof(day->location) - 1);
  p = codec_write_str(p, info->stateroom, sizeof(info->stateroom) - 1);
  p = codec_write_str(p, info->deck, sizeof(info->deck) - 1);
  p = codec_write_str(p, info->stairs, sizeof(info->stairs) - 1);
  p = codec_write_str(p, info->muster, sizeof(info->muster) - 1);
  p = codec_write_str(p, info->dining, sizeof(info->dining) - 1);
  p = codec_write_str(p, info->clock_note, sizeof(info->clock_note) - 1);
  p = codec_write_str(p, info->last_sync, sizeof(info->last_sync) - 1);
  p = codec_write_str(p, meta->ship_name, sizeof(meta->ship_name) - 1);
  p = codec_write_str(p, t->status, sizeof(t->status) - 1);
  p = codec_write_str(p, t->location, sizeof(t->location) - 1);
  p = codec_write_str(p, t->first, sizeof(t->first) - 1);
  p = codec_write_str(p, t->last, sizeof(t->last) - 1);
  p = codec_write_str(p, meta->sail_port, sizeof(meta->sail_port) - 1);
  return codec_write_str(p, day->terminal_text, sizeof(day->terminal_text) - 1);
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
  int limit = budget();
  // The blob, then one keep flag per alert and per event.
  uint8_t *blob = data_ready() ? blob_alloc(limit + MAX_ALARMS + MAX_EVENTS) : NULL;
  if (!blob) {
    return;
  }
  int32_t now = now_cruise();
  int alarm_count = data_alarm_count();
  int event_count = data_event_count();
  uint8_t *keep_alarm = blob + limit;
  uint8_t *keep_event = keep_alarm + MAX_ALARMS;
  memset(keep_alarm, 0, MAX_ALARMS + MAX_EVENTS);

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

  uint8_t *p = write_header(blob, alarms, events);
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
  int length = p - blob;
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
    int written = persist_write_data(KEY_BLOB + k, blob + start, n);
    if (written < n) {
      APP_LOG(APP_LOG_LEVEL_ERROR, "Saving slice part %d failed: %d", k, written);
      usage_add(USAGE_STORAGE_ERROR, USAGE_STORE_SCHEDULE, (int16_t)written, KEY_BLOB + k, 0);
    }
  }
  free(blob);
  APP_LOG(APP_LOG_LEVEL_INFO, "Saved %s: %d of %d alerts, %d of %d events, %d of %d bytes, cutoff %d",
          full_day ? "the whole day" : "by priority", alarms, alarm_count, events, event_count,
          length, limit, (int)cutoff);
}

static bool load(uint8_t *blob, int length) {
  for (int start = 0, k = 0; start < length; start += PERSIST_DATA_MAX_LENGTH, k++) {
    int n = length - start < PERSIST_DATA_MAX_LENGTH ? length - start : PERSIST_DATA_MAX_LENGTH;
    if (persist_read_data(KEY_BLOB + k, blob + start, n) != n) {
      return false;
    }
  }

  const uint8_t *p = blob;
  const uint8_t *end = blob + length;
  SliceHead h;
  h.meta = (SliceMeta){
    .sail_days = codec_read_int32(p),
    .dark_theme = (p[4] & 1) != 0,
    .show_featured = (p[4] & 2) != 0,
    .is_demo = (p[4] & 4) != 0,
    .always_hints = (p[4] & 8) != 0,
    .from_storage = true,
    .reminder_lead = p[5],
    .cruise_starred = p[25],
  };
  uint16_t slice_id = (uint16_t)(p[6] | (p[7] << 8));
  h.day = (Day){
    .index = codec_read_int32(p + 8),
    .kind = (DayKind)p[12],
    .all_aboard = codec_read_int32(p + 13),
    .local_offset = (int16_t)(p[17] | (p[18] << 8)),
    .arrive = codec_read_int32(p + 26),
    .depart = codec_read_int32(p + 30),
    .terminal = codec_read_int32(p + 55),
    .warn_period = (uint8_t)(30 * (((p[4] >> 4) & 3) + 1)),
  };
  h.tomorrow = (Tomorrow){
    .kind = (DayKind)p[34],
    .arrive = codec_read_int32(p + 35),
    .depart = codec_read_int32(p + 39),
    .all_aboard = codec_read_int32(p + 43),
    .first_start = codec_read_int32(p + 47),
    .starred = p[51],
    .featured = p[52],
    .last_kind = p[53],
    .to_reserve = p[54],
  };
  s_cutoff = codec_read_int32(p + 19);
  int alarms = p[23] < MAX_ALARMS ? p[23] : MAX_ALARMS;
  int events = p[24] < MAX_EVENTS ? p[24] : MAX_EVENTS;
  p += HEADER_FIXED;
  if (!codec_read_str(&p, end, h.day.status, sizeof(h.day.status)) ||
      !codec_read_str(&p, end, h.day.location, sizeof(h.day.location)) ||
      !codec_read_str(&p, end, h.info.stateroom, sizeof(h.info.stateroom)) ||
      !codec_read_str(&p, end, h.info.deck, sizeof(h.info.deck)) ||
      !codec_read_str(&p, end, h.info.stairs, sizeof(h.info.stairs)) ||
      !codec_read_str(&p, end, h.info.muster, sizeof(h.info.muster)) ||
      !codec_read_str(&p, end, h.info.dining, sizeof(h.info.dining)) ||
      !codec_read_str(&p, end, h.info.clock_note, sizeof(h.info.clock_note)) ||
      !codec_read_str(&p, end, h.info.last_sync, sizeof(h.info.last_sync)) ||
      !codec_read_str(&p, end, h.meta.ship_name, sizeof(h.meta.ship_name)) ||
      !codec_read_str(&p, end, h.tomorrow.status, sizeof(h.tomorrow.status)) ||
      !codec_read_str(&p, end, h.tomorrow.location, sizeof(h.tomorrow.location)) ||
      !codec_read_str(&p, end, h.tomorrow.first, sizeof(h.tomorrow.first)) ||
      !codec_read_str(&p, end, h.tomorrow.last, sizeof(h.tomorrow.last)) ||
      !codec_read_str(&p, end, h.meta.sail_port, sizeof(h.meta.sail_port)) ||
      !codec_read_str(&p, end, h.day.terminal_text, sizeof(h.day.terminal_text))) {
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
  data_commit(slice_id, &h, e, a);
  APP_LOG(APP_LOG_LEVEL_INFO, "Loaded stored slice: %d events, %d alerts, %d bytes (storage max %d)",
          e, a, length, (int)persist_get_max_size());
  return true;
}

bool store_load(void) {
  if (!persist_exists(KEY_VERSION) || persist_read_int(KEY_VERSION) != STORE_VERSION) {
    return false;
  }
  int length = persist_read_int(KEY_LENGTH);
  if (length < HEADER_FIXED || length > STORE_MAX_BUDGET) {
    return false;
  }
  uint8_t *blob = blob_alloc(length);
  bool loaded = blob && load(blob, length);
  free(blob);
  return loaded;
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
