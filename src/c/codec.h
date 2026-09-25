#pragma once
#include <pebble.h>
#include "data.h"

// The packed byte layouts of docs/WATCH_PROTOCOL.md (little-endian, texts as a
// length byte and UTF-8 bytes). Messages from the phone use them, and so does
// the watch's own storage (store.c), so a short title takes little room.
//
// Readers check bounds and return false when an item runs past `end`; they
// never parse text.

int32_t codec_read_int32(const uint8_t *p);
void codec_write_int32(uint8_t *p, int32_t v);

// Length of `s` up to its NUL, at most `max` (no strlen).
int codec_str_len(const char *s, int max);
// Reads a length-prefixed text at *p into dst (cut to fit `size` with its NUL).
bool codec_read_str(const uint8_t **p, const uint8_t *end, char *dst, size_t size);
// Writes `s` (at most `max` bytes) as a length byte and its bytes.
uint8_t *codec_write_str(uint8_t *p, const char *s, int max);

// Events: int32 start, uint16 minutes, uint8 flags, 4 bytes where, title, venue.
bool codec_read_event(const uint8_t **p, const uint8_t *end, Event *e);
uint8_t *codec_write_event(uint8_t *p, const Event *e);
int codec_event_size(const Event *e);

// Alerts: int32 at, int32 ref, int16 extra, uint8 kind, uint8 from, 4 bytes
// where, title, venue, previous venue.
bool codec_read_alarm(const uint8_t **p, const uint8_t *end, Alarm *a);
uint8_t *codec_write_alarm(uint8_t *p, const Alarm *a);
int codec_alarm_size(const Alarm *a);

// Ship directory rows: uint8 kind, uint16 ref, int32 start, uint16 minutes,
// uint8 flags, line1, line2.
bool codec_read_dir_row(const uint8_t **p, const uint8_t *end, DirRow *r);
// Where a venue is: deck, deck_to, bits, rel.
void codec_read_where(const uint8_t *p, Where *w);
