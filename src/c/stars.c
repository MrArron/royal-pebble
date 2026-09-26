#include "stars.h"
#include "comm.h"

// Persistent keys (store.c uses 1-3, 10-13 and 20-27).
#define KEY_STARS_META 30
#define KEY_STARS 31  // 31..33
#define CHANGES_PER_KEY 3
#define STAR_KEYS ((MAX_STAR_CHANGES + CHANGES_PER_KEY - 1) / CHANGES_PER_KEY)

// A failed send is retried a few times; the next slice sends again anyway.
#define RETRY_MS 5000
#define MAX_RETRIES 3

typedef struct {
  int32_t next_seq;
  int16_t count;
} StarsMeta;

_Static_assert(sizeof(StarChange) * CHANGES_PER_KEY <= PERSIST_DATA_MAX_LENGTH, "star changes too big");

static StarChange s_changes[MAX_STAR_CHANGES];
static StarsMeta s_meta = {.next_seq = 1};
static AppTimer *s_retry_timer;
static int s_retries;

static void save(void) {
  persist_write_data(KEY_STARS_META, &s_meta, sizeof(s_meta));
  for (int k = 0; k < STAR_KEYS; k++) {
    int first = k * CHANGES_PER_KEY;
    int n = s_meta.count - first;
    if (n <= 0) {
      persist_delete(KEY_STARS + k);
      continue;
    }
    n = n < CHANGES_PER_KEY ? n : CHANGES_PER_KEY;
    int written = persist_write_data(KEY_STARS + k, &s_changes[first], n * sizeof(StarChange));
    if (written < 0) {
      APP_LOG(APP_LOG_LEVEL_ERROR, "Saving star changes failed: %d", written);
    }
  }
}

void stars_init(void) {
  if (persist_get_size(KEY_STARS_META) != (int)sizeof(StarsMeta)) {
    return;
  }
  persist_read_data(KEY_STARS_META, &s_meta, sizeof(s_meta));
  if (s_meta.count < 0 || s_meta.count > MAX_STAR_CHANGES) {
    s_meta.count = 0;
  }
  for (int k = 0; k * CHANGES_PER_KEY < s_meta.count; k++) {
    int first = k * CHANGES_PER_KEY;
    int n = s_meta.count - first < CHANGES_PER_KEY ? s_meta.count - first : CHANGES_PER_KEY;
    persist_read_data(KEY_STARS + k, &s_changes[first], n * sizeof(StarChange));
  }
  if (s_meta.count) {
    APP_LOG(APP_LOG_LEVEL_INFO, "%d star changes not yet on the phone", s_meta.count);
  }
}

// Compares at most n bytes, stopping at the first NUL (no strlen/strcmp).
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

// Whether queued change c is about event e. Titles and venues are compared as
// far as the change keeps them (cut to fit, like notices).
static bool change_matches(const StarChange *c, const Event *e, int32_t day) {
  if (c->start != e->start || (c->start == NO_TIME && c->day != day)) {
    return false;
  }
  return same_text(c->title, e->title, SHORT_TITLE_LEN - 1) &&
         same_text(c->venue, e->venue, SHORT_VENUE_LEN - 1);
}

// Same event and the same kind of change (star or Reserved).
static bool same_event(const StarChange *a, const StarChange *b) {
  return a->sail_days == b->sail_days && a->start == b->start &&
         (a->on & STAR_CHANGE_RESERVED) == (b->on & STAR_CHANGE_RESERVED) &&
         (a->start != NO_TIME || a->day == b->day) &&
         same_text(a->title, b->title, SHORT_TITLE_LEN) &&
         same_text(a->venue, b->venue, SHORT_VENUE_LEN);
}

void stars_record(const Event *e, bool reserved, bool on) {
  StarChange c = {
    .seq = s_meta.next_seq++,
    .at = (int32_t)time(NULL),
    .sail_days = data_meta()->sail_days,
    .start = e->start,
    .day = (int16_t)data_day()->index,
    .on = (on ? STAR_CHANGE_ON : 0) | (reserved ? STAR_CHANGE_RESERVED : 0),
  };
  strncpy(c.title, e->title, sizeof(c.title) - 1);
  strncpy(c.venue, e->venue, sizeof(c.venue) - 1);

  // Replace an earlier change for the same event; otherwise append, dropping
  // the oldest when full (8 different events changed with the phone away).
  int i = 0;
  while (i < s_meta.count && !same_event(&s_changes[i], &c)) {
    i++;
  }
  if (i == s_meta.count) {
    if (s_meta.count == MAX_STAR_CHANGES) {
      APP_LOG(APP_LOG_LEVEL_WARNING, "Star queue full, dropping the oldest change");
      for (int j = 1; j < s_meta.count; j++) {
        s_changes[j - 1] = s_changes[j];
      }
      s_meta.count--;
    }
    i = s_meta.count++;
  }
  s_changes[i] = c;
  s_retries = 0;
  save();
}

void stars_apply(void) {
  const SliceMeta *meta = data_meta();
  int32_t day = data_day()->index;
  int count = data_event_count();
  for (int i = 0; i < s_meta.count; i++) {
    const StarChange *c = &s_changes[i];
    if (c->sail_days != meta->sail_days) {
      continue;
    }
    for (int j = 0; j < count; j++) {
      Event *e = data_event(j);
      if (!change_matches(c, e, day)) {
        continue;
      }
      bool on = (c->on & STAR_CHANGE_ON) != 0;
      if (c->on & STAR_CHANGE_RESERVED) {
        if (((e->flags & EVENT_RESERVED) != 0) != on) {
          e->flags ^= EVENT_RESERVED;
          data_update_reminder(e);
        }
        continue;
      }
      bool was = (e->flags & EVENT_STARRED) != 0;
      if (was == on) {
        continue;
      }
      e->flags ^= EVENT_STARRED;
      if (!(e->flags & EVENT_PERSONAL)) {
        data_set_reminder(e, on);
      }
    }
  }
}

static void retry(void *context) {
  s_retry_timer = NULL;
  stars_send();
}

void stars_send_failed(void) {
  if (!s_retry_timer && s_retries < MAX_RETRIES) {
    s_retries++;
    s_retry_timer = app_timer_register(RETRY_MS, retry, NULL);
  }
}

void stars_send(void) {
  if (s_meta.count == 0) {
    return;
  }
  if (!comm_send_star_changes(s_changes, s_meta.count)) {
    stars_send_failed();
  }
}

void stars_ack(int32_t seq) {
  int out = 0;
  for (int i = 0; i < s_meta.count; i++) {
    if (s_changes[i].seq > seq) {
      s_changes[out++] = s_changes[i];
    }
  }
  s_retries = 0;
  if (out != s_meta.count) {
    APP_LOG(APP_LOG_LEVEL_INFO, "Phone saved %d star changes, %d left", s_meta.count - out, out);
    s_meta.count = out;
    save();
  }
}
