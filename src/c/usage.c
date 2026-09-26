#include "usage.h"
#include "codec.h"
#include "comm.h"
#include "data.h"

// Persistent keys (store.c uses 1-3, 5, 10-13, 20-27 and 40-79; stars.c
// 30-33; Home's hints 7; the summary 6).
#define KEY_CLOSED 8       // UsageClosed: when the app last closed, for missed alerts
#define KEY_META 89
#define KEY_ENTRIES 90     // 90..102
#define MAX_ENTRIES 200
#define ENTRIES_PER_KEY 16
#define ENTRY_KEYS ((MAX_ENTRIES + ENTRIES_PER_KEY - 1) / ENTRIES_PER_KEY)

#define SEND_DELAY_MS 1500   // after the latest entry, so a burst goes in one message
#define NEXT_DELAY_MS 300    // between messages when more are queued
#define RETRY_MS 5000
#define MAX_TRIES 3
#define MAX_PER_MESSAGE 40   // 640 bytes; the outbox is 768
#define ENTRY_BYTES 16
#define BATTERY_EVERY_S 3600

typedef struct {
  int32_t at;
  uint8_t code;
  uint8_t x;
  int16_t a;
  int32_t b;
  int32_t c;
} UsageEntry;

typedef struct {
  int16_t head;
  int16_t count;
  int32_t dropped;  // entries lost to a full queue, not yet reported
} UsageMeta;

typedef struct {
  int32_t sail_days;
  int32_t closed;   // cruise minutes
} UsageClosed;

_Static_assert(sizeof(UsageEntry) == ENTRY_BYTES, "usage entry size");
_Static_assert(sizeof(UsageEntry) * ENTRIES_PER_KEY <= PERSIST_DATA_MAX_LENGTH, "usage entries too big");

static UsageEntry s_entries[MAX_ENTRIES];
static UsageMeta s_meta;
static uint16_t s_dirty;       // entry keys changed since the last save
static bool s_saving;          // a storage error while saving isn't logged again

static int s_inflight;         // entries in the LOG message being sent
static int32_t s_inflight_dropped;
static int s_tries;
static AppTimer *s_timer;

static time_t s_opened_at;
static time_t s_battery_at;
static uint32_t s_min_free;

static UsageScreen s_screen;
static int32_t s_screen_detail;
static time_t s_screen_since;
static int16_t s_scrolls;

void usage_add(uint8_t code, uint8_t x, int16_t a, int32_t b, int32_t c);

static bool connected(void) { return connection_service_peek_pebble_app_connection(); }

static void note_memory(void) {
  uint32_t free = heap_bytes_free();
  if (s_min_free == 0 || free < s_min_free) {
    s_min_free = free;
  }
}

static void save(void) {
  s_saving = true;
  for (int k = 0; k < ENTRY_KEYS; k++) {
    if (!(s_dirty & (1 << k))) {
      continue;
    }
    int first = k * ENTRIES_PER_KEY;
    int n = MAX_ENTRIES - first < ENTRIES_PER_KEY ? MAX_ENTRIES - first : ENTRIES_PER_KEY;
    int written = persist_write_data(KEY_ENTRIES + k, &s_entries[first], n * sizeof(UsageEntry));
    if (written < 0) {
      APP_LOG(APP_LOG_LEVEL_ERROR, "Saving the usage log failed: %d", written);
      usage_add(USAGE_STORAGE_ERROR, USAGE_STORE_LOG, (int16_t)written, KEY_ENTRIES + k, 0);
    }
  }
  s_dirty = 0;
  int written = persist_write_data(KEY_META, &s_meta, sizeof(s_meta));
  if (written < 0) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "Saving the usage log failed: %d", written);
    usage_add(USAGE_STORAGE_ERROR, USAGE_STORE_LOG, (int16_t)written, KEY_META, 0);
  }
  s_saving = false;
}

void usage_init(void) {
  s_opened_at = time(NULL);
  s_battery_at = s_opened_at;
  note_memory();
  if (persist_get_size(KEY_META) != (int)sizeof(UsageMeta)) {
    return;
  }
  persist_read_data(KEY_META, &s_meta, sizeof(s_meta));
  if (s_meta.head < 0 || s_meta.head >= MAX_ENTRIES || s_meta.count < 0 || s_meta.count > MAX_ENTRIES) {
    s_meta = (UsageMeta){0, 0, 0};
    return;
  }
  for (int k = 0; k < ENTRY_KEYS; k++) {
    int first = k * ENTRIES_PER_KEY;
    int n = MAX_ENTRIES - first < ENTRIES_PER_KEY ? MAX_ENTRIES - first : ENTRIES_PER_KEY;
    if (persist_exists(KEY_ENTRIES + k)) {
      persist_read_data(KEY_ENTRIES + k, &s_entries[first], n * sizeof(UsageEntry));
    }
  }
  if (s_meta.count) {
    APP_LOG(APP_LOG_LEVEL_INFO, "%d usage log entries not yet on the phone", s_meta.count);
  }
}

// ---- Sending -------------------------------------------------------------

static void send(void *context);

static void send_later(uint32_t ms) {
  if (s_timer) {
    app_timer_reschedule(s_timer, ms);
  } else {
    s_timer = app_timer_register(ms, send, NULL);
  }
}

static void send(void *context) {
  s_timer = NULL;
  if (s_inflight || s_meta.count == 0 || !connected()) {
    return;
  }
  int n = s_meta.count < MAX_PER_MESSAGE ? s_meta.count : MAX_PER_MESSAGE;
  uint8_t bytes[MAX_PER_MESSAGE * ENTRY_BYTES];
  for (int i = 0; i < n; i++) {
    const UsageEntry *e = &s_entries[(s_meta.head + i) % MAX_ENTRIES];
    uint8_t *p = bytes + i * ENTRY_BYTES;
    codec_write_int32(p, e->at);
    p[4] = e->code;
    p[5] = e->x;
    p[6] = (uint8_t)e->a;
    p[7] = (uint8_t)((uint16_t)e->a >> 8);
    codec_write_int32(p + 8, e->b);
    codec_write_int32(p + 12, e->c);
  }
  if (comm_send_log(bytes, n * ENTRY_BYTES, s_meta.dropped)) {
    s_inflight = n;
    s_inflight_dropped = s_meta.dropped;
  } else {
    usage_send_failed();
  }
}

void usage_sent(void) {
  if (!s_inflight) {
    return;
  }
  s_meta.head = (s_meta.head + s_inflight) % MAX_ENTRIES;
  s_meta.count -= s_inflight;
  s_meta.dropped -= s_inflight_dropped;
  s_inflight = 0;
  s_tries = 0;
  save();
  if (s_meta.count) {
    send_later(NEXT_DELAY_MS);
  }
}

void usage_send_failed(void) {
  s_inflight = 0;
  if (++s_tries <= MAX_TRIES) {
    send_later(RETRY_MS);
  }
}

// ---- Entries -------------------------------------------------------------

void usage_add(uint8_t code, uint8_t x, int16_t a, int32_t b, int32_t c) {
  note_memory();
  if (s_meta.count == MAX_ENTRIES) {
    if (s_inflight) {
      s_meta.dropped++;  // the oldest are on their way; this one is lost
      return;
    }
    s_meta.head = (s_meta.head + 1) % MAX_ENTRIES;
    s_meta.count--;
    s_meta.dropped++;
  }
  int slot = (s_meta.head + s_meta.count) % MAX_ENTRIES;
  s_entries[slot] = (UsageEntry){.at = (int32_t)time(NULL), .code = code, .x = x, .a = a, .b = b, .c = c};
  s_meta.count++;
  s_dirty |= 1 << (slot / ENTRIES_PER_KEY);
  if (connected()) {
    // After failed tries, the next minute's tick tries again.
    if (s_tries <= MAX_TRIES) {
      send_later(SEND_DELAY_MS);
    }
  } else if (!s_saving) {
    save();
  }
}

int16_t usage_battery(void) {
  BatteryChargeState b = battery_state_service_peek();
  return (int16_t)(b.charge_percent | (b.is_charging ? 256 : 0) | (b.is_plugged ? 512 : 0));
}

void usage_opened(AppLaunchReason reason, bool from_storage) {
  usage_add(USAGE_OPEN, (uint8_t)reason, usage_battery(), (int32_t)heap_bytes_free(),
            (connected() ? 1 : 0) | (from_storage ? 2 : 0));
}

static void end_view(void) {
  if (s_screen != SCREEN_NONE) {
    usage_add(USAGE_SCREEN, s_screen, s_scrolls, (int32_t)(time(NULL) - s_screen_since), s_screen_detail);
  }
}

void usage_screen(UsageScreen screen, int32_t detail) {
  end_view();
  s_screen = screen;
  s_screen_detail = detail;
  s_screen_since = time(NULL);
  s_scrolls = 0;
}

void usage_screen_detail(UsageScreen screen, int32_t detail) {
  if (s_screen == screen) {
    s_screen_detail = detail;
  }
}

void usage_scroll(void) {
  if (s_scrolls < INT16_MAX) {
    s_scrolls++;
  }
}

void usage_press(ButtonId button, uint8_t flags, int32_t row) {
  if ((flags & USAGE_NOTHING) || connected()) {
    usage_add(USAGE_BUTTON, s_screen, (int16_t)(button | flags), row, s_screen_detail);
  }
}

void usage_move(int old_row, int new_row) {
  if (new_row != old_row) {
    usage_scroll();
    usage_press(new_row < old_row ? BUTTON_ID_UP : BUTTON_ID_DOWN, 0, new_row);
  }
}

void usage_tick(void) {
  note_memory();
  time_t now = time(NULL);
  if (now - s_battery_at >= BATTERY_EVERY_S) {
    s_battery_at = now;
    usage_add(USAGE_BATTERY, 0, usage_battery(), 0, 0);
  }
  // Sending kept failing: one more try a minute.
  if (s_tries > MAX_TRIES && s_meta.count && !s_timer) {
    s_tries = MAX_TRIES;
    send(NULL);
  }
}

void usage_connection(bool is_connected) {
  if (is_connected) {
    s_tries = 0;
  }
  usage_add(USAGE_PHONE, is_connected ? 1 : 0, 0, 0, 0);
}

void usage_check_missed(int32_t launch_at) {
  UsageClosed closed;
  if (!data_ready() || persist_get_size(KEY_CLOSED) != (int)sizeof(closed)) {
    return;
  }
  persist_read_data(KEY_CLOSED, &closed, sizeof(closed));
  if (closed.sail_days != data_meta()->sail_days) {
    return;
  }
  int32_t now = now_cruise();
  int missed = 0;
  int32_t first = NO_TIME, last = NO_TIME;
  for (int i = 0; i < data_alarm_count(); i++) {
    int32_t at = data_alarm(i)->at;
    // Alerts are sorted; several in the same minute count once.
    if (at <= closed.closed || at > now || at == launch_at || at == last) {
      continue;
    }
    if (missed == 0) {
      first = at;
    }
    last = at;
    missed++;
  }
  if (missed) {
    usage_add(USAGE_ALERTS_MISSED, (uint8_t)(missed < 255 ? missed : 255), 0, first, last);
  }
}

void usage_deinit(void) {
  end_view();
  s_screen = SCREEN_NONE;
  note_memory();
  usage_add(USAGE_CLOSE, 0, usage_battery(), (int32_t)(time(NULL) - s_opened_at), (int32_t)s_min_free);
  if (s_timer) {
    app_timer_cancel(s_timer);
    s_timer = NULL;
  }
  save();
  if (data_ready()) {
    UsageClosed closed = {.sail_days = data_meta()->sail_days, .closed = now_cruise()};
    persist_write_data(KEY_CLOSED, &closed, sizeof(closed));
  }
}
