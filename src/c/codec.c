#include "codec.h"

int32_t codec_read_int32(const uint8_t *p) {
  return (int32_t)((uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) |
                   ((uint32_t)p[3] << 24));
}

void codec_write_int32(uint8_t *p, int32_t v) {
  p[0] = (uint8_t)v;
  p[1] = (uint8_t)(v >> 8);
  p[2] = (uint8_t)(v >> 16);
  p[3] = (uint8_t)(v >> 24);
}

int codec_str_len(const char *s, int max) {
  int n = 0;
  while (n < max && s[n]) {
    n++;
  }
  return n;
}

// Copies `len` bytes as a string, truncated to fit `size` with its NUL.
static void copy_bytes_str(char *dst, size_t size, const uint8_t *src, int len) {
  int n = len < (int)size - 1 ? len : (int)size - 1;
  memcpy(dst, src, n);
  dst[n] = '\0';
}

bool codec_read_str(const uint8_t **p, const uint8_t *end, char *dst, size_t size) {
  if (*p >= end) {
    return false;
  }
  int len = **p;
  (*p)++;
  if (*p + len > end) {
    return false;
  }
  copy_bytes_str(dst, size, *p, len);
  *p += len;
  return true;
}

uint8_t *codec_write_str(uint8_t *p, const char *s, int max) {
  int n = codec_str_len(s, max);
  *p++ = (uint8_t)n;
  memcpy(p, s, n);
  return p + n;
}

// Four bytes: deck, deck_to, bits, rel.
void codec_read_where(const uint8_t *p, Where *w) {
  w->deck = p[0];
  w->deck_to = p[1];
  w->bits = p[2];
  w->rel = (int8_t)p[3];
}

static void write_where(uint8_t *p, const Where *w) {
  p[0] = w->deck;
  p[1] = w->deck_to;
  p[2] = w->bits;
  p[3] = (uint8_t)w->rel;
}

#define EVENT_FIXED 11
#define DIR_ROW_FIXED 10
#define ALARM_FIXED 16

bool codec_read_event(const uint8_t **p, const uint8_t *end, Event *e) {
  const uint8_t *q = *p;
  if (q + EVENT_FIXED > end) {
    return false;
  }
  e->start = codec_read_int32(q);
  e->minutes = (uint16_t)(q[4] | (q[5] << 8));
  e->flags = q[6];
  codec_read_where(q + 7, &e->where);
  q += EVENT_FIXED;
  if (!codec_read_str(&q, end, e->title, sizeof(e->title)) ||
      !codec_read_str(&q, end, e->venue, sizeof(e->venue))) {
    return false;
  }
  *p = q;
  return true;
}

uint8_t *codec_write_event(uint8_t *p, const Event *e) {
  codec_write_int32(p, e->start);
  p[4] = (uint8_t)e->minutes;
  p[5] = (uint8_t)(e->minutes >> 8);
  p[6] = e->flags;
  write_where(p + 7, &e->where);
  p = codec_write_str(p + EVENT_FIXED, e->title, TITLE_LEN - 1);
  return codec_write_str(p, e->venue, VENUE_LEN - 1);
}

int codec_event_size(const Event *e) {
  return EVENT_FIXED + 2 + codec_str_len(e->title, TITLE_LEN - 1) +
         codec_str_len(e->venue, VENUE_LEN - 1);
}

bool codec_read_alarm(const uint8_t **p, const uint8_t *end, Alarm *a) {
  const uint8_t *q = *p;
  if (q + ALARM_FIXED > end) {
    return false;
  }
  a->at = codec_read_int32(q);
  a->ref = codec_read_int32(q + 4);
  a->extra = (int16_t)(q[8] | (q[9] << 8));
  a->kind = q[10];
  a->from = q[11];
  codec_read_where(q + 12, &a->where);
  q += ALARM_FIXED;
  if (!codec_read_str(&q, end, a->title, sizeof(a->title)) ||
      !codec_read_str(&q, end, a->venue, sizeof(a->venue)) ||
      !codec_read_str(&q, end, a->from_venue, sizeof(a->from_venue))) {
    return false;
  }
  *p = q;
  return true;
}

uint8_t *codec_write_alarm(uint8_t *p, const Alarm *a) {
  codec_write_int32(p, a->at);
  codec_write_int32(p + 4, a->ref);
  p[8] = (uint8_t)a->extra;
  p[9] = (uint8_t)(a->extra >> 8);
  p[10] = a->kind;
  p[11] = a->from;
  write_where(p + 12, &a->where);
  p = codec_write_str(p + ALARM_FIXED, a->title, ALARM_TITLE_LEN - 1);
  p = codec_write_str(p, a->venue, ALARM_VENUE_LEN - 1);
  return codec_write_str(p, a->from_venue, ALARM_VENUE_LEN - 1);
}

int codec_alarm_size(const Alarm *a) {
  return ALARM_FIXED + 3 + codec_str_len(a->title, ALARM_TITLE_LEN - 1) +
         codec_str_len(a->venue, ALARM_VENUE_LEN - 1) +
         codec_str_len(a->from_venue, ALARM_VENUE_LEN - 1);
}

bool codec_read_dir_row(const uint8_t **p, const uint8_t *end, DirRow *r) {
  const uint8_t *q = *p;
  if (q + DIR_ROW_FIXED > end) {
    return false;
  }
  r->kind = q[0];
  r->ref = (uint16_t)(q[1] | (q[2] << 8));
  r->start = codec_read_int32(q + 3);
  r->minutes = (uint16_t)(q[7] | (q[8] << 8));
  r->flags = q[9];
  q += DIR_ROW_FIXED;
  if (!codec_read_str(&q, end, r->line1, sizeof(r->line1)) ||
      !codec_read_str(&q, end, r->line2, sizeof(r->line2))) {
    return false;
  }
  *p = q;
  return true;
}
