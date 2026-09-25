#include "comm.h"
#include "codec.h"
#include "data.h"
#include "stars.h"

// Message types (msg_type key).
enum {
  MSG_BEGIN = 1,
  MSG_INFO = 2,
  MSG_EVENTS = 3,
  MSG_END = 4,
  MSG_ALARMS = 5,
  MSG_NOTICE = 6,
  MSG_STAR_ACK = 7,
  MSG_DIR_PAGE = 8,
  MSG_REQUEST = 10,
  MSG_DEMO_NEXT = 12,
  MSG_STAR_CHANGES = 13,
  MSG_SAVED = 14,
  MSG_DIR_REQUEST = 15,
};

#define INBOX_SIZE 2048
// Room for a full star queue: 8 changes of up to 83 bytes, plus the keys.
#define OUTBOX_SIZE 768

// Type of the message in the outbox, to retry star changes that failed.
static int32_t s_outbox_msg;

static CommSliceHandler s_on_slice;
static CommNoticeHandler s_on_notices;
static CommDirPageHandler s_on_dir_page;
static CommDirFailedHandler s_on_dir_failed;
static Notice s_notices[MAX_NOTICES];

// The slice being received; committed to data.c on MSG_END.
static uint16_t s_pending_id;
static bool s_pending;
static SliceMeta s_meta;
static Day s_day;
static Tomorrow s_tomorrow;
static MyInfo s_info;
static int s_event_count;
static int s_events_received;
static int s_alarm_count;
static int s_alarms_received;

static int32_t tuple_int(const Tuple *t) {
  if (!t) {
    return 0;
  }
  bool is_signed = t->type == TUPLE_INT;
  switch (t->length) {
    case 1: return is_signed ? t->value->int8 : t->value->uint8;
    case 2: return is_signed ? t->value->int16 : t->value->uint16;
    default: return is_signed ? t->value->int32 : (int32_t)t->value->uint32;
  }
}

static int32_t find_int(DictionaryIterator *iter, uint32_t key) {
  return tuple_int(dict_find(iter, key));
}

// Like find_int, with `missing` when the key isn't there.
static int32_t find_int_or(DictionaryIterator *iter, uint32_t key, int32_t missing) {
  Tuple *t = dict_find(iter, key);
  return t ? tuple_int(t) : missing;
}

static void find_str(DictionaryIterator *iter, uint32_t key, char *dst, size_t size) {
  Tuple *t = dict_find(iter, key);
  dst[0] = '\0';
  if (t && t->type == TUPLE_CSTRING) {
    size_t n = t->length < size ? t->length : size;
    strncpy(dst, t->value->cstring, n);
    dst[size - 1] = '\0';
  }
}

// Decodes packed events (docs/WATCH_PROTOCOL.md) into data_event(first...).
static void decode_events(int first, const uint8_t *p, int length) {
  const uint8_t *end = p + length;
  int index = first;
  while (index < MAX_EVENTS && codec_read_event(&p, end, data_event(index))) {
    index++;
  }
  s_events_received = index;
}

// Decodes packed alarms (docs/WATCH_PROTOCOL.md) into data_alarm(first...).
static void decode_alarms(int first, const uint8_t *p, int length) {
  const uint8_t *end = p + length;
  int index = first;
  while (index < MAX_ALARMS && codec_read_alarm(&p, end, data_alarm(index))) {
    index++;
  }
  s_alarms_received = index;
}

// Decodes packed notices (docs/WATCH_PROTOCOL.md); returns how many were whole.
static int decode_notices(const uint8_t *p, int length) {
  const uint8_t *end = p + length;
  int count = 0;
  while (p + 9 <= end && count < MAX_NOTICES) {
    Notice *n = &s_notices[count];
    n->kind = p[0];
    n->from = codec_read_int32(p + 1);
    n->to = codec_read_int32(p + 5);
    p += 9;
    if (!codec_read_str(&p, end, n->title, sizeof(n->title)) ||
        !codec_read_str(&p, end, n->venue, sizeof(n->venue)) ||
        !codec_read_str(&p, end, n->old_venue, sizeof(n->old_venue))) {
      break;
    }
    count++;
  }
  return count;
}

static void handle_begin(DictionaryIterator *iter, uint16_t slice_id) {
  s_pending = true;
  s_pending_id = slice_id;
  s_events_received = 0;
  s_alarms_received = 0;

  int32_t sail = find_int(iter, MESSAGE_KEY_sail_date);  // YYYYMMDD
  s_meta.sail_days = days_from_civil(sail / 10000, (sail / 100) % 100, sail % 100);
  s_meta.dark_theme = find_int(iter, MESSAGE_KEY_theme) != 0;
  s_meta.show_featured = find_int(iter, MESSAGE_KEY_show_featured) != 0;
  s_meta.is_demo = find_int(iter, MESSAGE_KEY_is_demo) != 0;
  s_meta.from_storage = false;
  s_meta.reminder_lead = (uint8_t)find_int(iter, MESSAGE_KEY_reminder_lead);

  s_day.index = find_int(iter, MESSAGE_KEY_day_index);
  s_day.kind = (DayKind)find_int(iter, MESSAGE_KEY_day_kind);
  s_day.all_aboard = find_int(iter, MESSAGE_KEY_all_aboard);
  s_day.local_offset = (int16_t)find_int(iter, MESSAGE_KEY_local_offset);
  s_day.arrive = find_int_or(iter, MESSAGE_KEY_arrive, NO_TIME);
  s_day.depart = find_int_or(iter, MESSAGE_KEY_depart, NO_TIME);
  find_str(iter, MESSAGE_KEY_day_status, s_day.status, sizeof(s_day.status));
  find_str(iter, MESSAGE_KEY_day_location, s_day.location, sizeof(s_day.location));
  find_str(iter, MESSAGE_KEY_ship_name, s_meta.ship_name, sizeof(s_meta.ship_name));
  find_str(iter, MESSAGE_KEY_sail_port, s_meta.sail_port, sizeof(s_meta.sail_port));
  s_meta.cruise_starred = (uint8_t)find_int(iter, MESSAGE_KEY_cruise_starred);

  // Tomorrow's card (an older phone sends none: DAY_NONE).
  s_tomorrow.kind = (DayKind)find_int_or(iter, MESSAGE_KEY_tmr_kind, DAY_NONE);
  find_str(iter, MESSAGE_KEY_tmr_status, s_tomorrow.status, sizeof(s_tomorrow.status));
  find_str(iter, MESSAGE_KEY_tmr_location, s_tomorrow.location, sizeof(s_tomorrow.location));
  s_tomorrow.arrive = find_int_or(iter, MESSAGE_KEY_tmr_arrive, NO_TIME);
  s_tomorrow.depart = find_int_or(iter, MESSAGE_KEY_tmr_depart, NO_TIME);
  s_tomorrow.all_aboard = find_int_or(iter, MESSAGE_KEY_tmr_all_aboard, NO_TIME);
  s_tomorrow.starred = (uint8_t)find_int(iter, MESSAGE_KEY_tmr_starred);
  s_tomorrow.featured = (uint8_t)find_int(iter, MESSAGE_KEY_tmr_featured);
  find_str(iter, MESSAGE_KEY_tmr_first, s_tomorrow.first, sizeof(s_tomorrow.first));
  s_tomorrow.first_start = find_int_or(iter, MESSAGE_KEY_tmr_first_start, NO_TIME);
  find_str(iter, MESSAGE_KEY_tmr_last, s_tomorrow.last, sizeof(s_tomorrow.last));
  s_tomorrow.last_kind = (uint8_t)find_int(iter, MESSAGE_KEY_tmr_last_kind);

  s_event_count = find_int(iter, MESSAGE_KEY_event_count);
  s_alarm_count = find_int(iter, MESSAGE_KEY_alarm_count);
}

static void handle_info(DictionaryIterator *iter) {
  find_str(iter, MESSAGE_KEY_info_stateroom, s_info.stateroom, sizeof(s_info.stateroom));
  find_str(iter, MESSAGE_KEY_info_deck, s_info.deck, sizeof(s_info.deck));
  find_str(iter, MESSAGE_KEY_info_stairs, s_info.stairs, sizeof(s_info.stairs));
  find_str(iter, MESSAGE_KEY_info_muster, s_info.muster, sizeof(s_info.muster));
  find_str(iter, MESSAGE_KEY_info_clock, s_info.clock_note, sizeof(s_info.clock_note));
  find_str(iter, MESSAGE_KEY_info_sync, s_info.last_sync, sizeof(s_info.last_sync));
}

static void handle_dir_page(DictionaryIterator *iter) {
  if (!s_on_dir_page) {
    return;
  }
  DirPageMsg page = {.ref = find_int(iter, MESSAGE_KEY_dir_ref)};
  find_str(iter, MESSAGE_KEY_dir_title, page.title, sizeof(page.title));
  find_str(iter, MESSAGE_KEY_dir_label, page.label, sizeof(page.label));
  Tuple *rel = dict_find(iter, MESSAGE_KEY_dir_rel);
  page.has_rel = rel != NULL;
  page.rel = (int8_t)tuple_int(rel);
  Tuple *where = dict_find(iter, MESSAGE_KEY_dir_where);
  if (where && where->type == TUPLE_BYTE_ARRAY && where->length >= 4) {
    page.has_where = true;
    codec_read_where(where->value->data, &page.where);
  }
  Tuple *rows = dict_find(iter, MESSAGE_KEY_dir_rows);
  if (rows && rows->type == TUPLE_BYTE_ARRAY) {
    page.rows = rows->value->data;
    page.rows_length = rows->length;
  }
  s_on_dir_page(&page);
}

static void inbox_received(DictionaryIterator *iter, void *context) {
  Tuple *type = dict_find(iter, MESSAGE_KEY_msg_type);
  if (!type) {
    return;
  }
  uint16_t slice_id = (uint16_t)find_int(iter, MESSAGE_KEY_slice_id);
  int32_t msg = tuple_int(type);

  if (msg == MSG_BEGIN) {
    handle_begin(iter, slice_id);
    return;
  }
  if (msg == MSG_STAR_ACK) {
    stars_ack(find_int(iter, MESSAGE_KEY_star_ack));
    return;
  }
  if (msg == MSG_DIR_PAGE) {
    handle_dir_page(iter);
    return;
  }
  if (msg == MSG_NOTICE) {
    Tuple *bytes = dict_find(iter, MESSAGE_KEY_notices);
    if (bytes && bytes->type == TUPLE_BYTE_ARRAY) {
      int count = decode_notices(bytes->value->data, bytes->length);
      APP_LOG(APP_LOG_LEVEL_INFO, "%d of %d schedule change notices", count,
              (int)find_int(iter, MESSAGE_KEY_notice_count));
      if (count > 0 && s_on_notices) {
        s_on_notices(s_notices, count);
      }
    }
    return;
  }
  if (!s_pending || slice_id != s_pending_id) {
    return;
  }
  switch (msg) {
    case MSG_INFO:
      handle_info(iter);
      break;
    case MSG_EVENTS: {
      Tuple *bytes = dict_find(iter, MESSAGE_KEY_events);
      if (bytes && bytes->type == TUPLE_BYTE_ARRAY) {
        decode_events(find_int(iter, MESSAGE_KEY_event_first), bytes->value->data, bytes->length);
      }
      break;
    }
    case MSG_ALARMS: {
      Tuple *bytes = dict_find(iter, MESSAGE_KEY_alarms);
      if (bytes && bytes->type == TUPLE_BYTE_ARRAY) {
        decode_alarms(find_int(iter, MESSAGE_KEY_alarm_first), bytes->value->data, bytes->length);
      }
      break;
    }
    case MSG_END: {
      int count = s_event_count < s_events_received ? s_event_count : s_events_received;
      int alarms = s_alarm_count < s_alarms_received ? s_alarm_count : s_alarms_received;
      if (count != s_event_count || alarms != s_alarm_count) {
        APP_LOG(APP_LOG_LEVEL_WARNING, "Slice %d: expected %d events, %d alerts; got %d, %d",
                slice_id, s_event_count, s_alarm_count, s_events_received, s_alarms_received);
      }
      data_commit(slice_id, &s_meta, &s_day, &s_tomorrow, &s_info, count, alarms);
      s_pending = false;
      if (s_on_slice) {
        s_on_slice();
      }
      break;
    }
  }
}

static void inbox_dropped(AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_WARNING, "Inbox dropped: %d", (int)reason);
}

static void outbox_failed(DictionaryIterator *iter, AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_WARNING, "Message %d not delivered: %d", (int)s_outbox_msg, (int)reason);
  if (s_outbox_msg == MSG_STAR_CHANGES) {
    stars_send_failed();
  } else if (s_outbox_msg == MSG_DIR_REQUEST && s_on_dir_failed) {
    s_on_dir_failed();
  }
}

static void send_simple(int32_t msg) {
  DictionaryIterator *iter;
  if (app_message_outbox_begin(&iter) != APP_MSG_OK) {
    APP_LOG(APP_LOG_LEVEL_WARNING, "Outbox busy, message %d not sent", (int)msg);
    return;
  }
  dict_write_int32(iter, MESSAGE_KEY_msg_type, msg);
  s_outbox_msg = msg;
  app_message_outbox_send();
}

void comm_set_dir_handlers(CommDirPageHandler on_page, CommDirFailedHandler on_failed) {
  s_on_dir_page = on_page;
  s_on_dir_failed = on_failed;
}

bool comm_request_dir(int32_t ref) {
  DictionaryIterator *iter;
  if (app_message_outbox_begin(&iter) != APP_MSG_OK) {
    return false;
  }
  dict_write_int32(iter, MESSAGE_KEY_msg_type, MSG_DIR_REQUEST);
  dict_write_int32(iter, MESSAGE_KEY_dir_ref, ref);
  s_outbox_msg = MSG_DIR_REQUEST;
  return app_message_outbox_send() == APP_MSG_OK;
}

void comm_request_slice(void) {
  APP_LOG(APP_LOG_LEVEL_INFO, "Requesting a new slice");
  send_simple(MSG_REQUEST);
}
void comm_demo_next(void) { send_simple(MSG_DEMO_NEXT); }

// The saved cutoff waiting to go to the phone; the outbox may be busy with star
// changes, so it's retried a few times.
#define SAVED_RETRY_MS 1500
#define SAVED_RETRIES 5
static int32_t s_saved_cutoff;
static int32_t s_saved_bytes;
static int s_saved_tries;
static AppTimer *s_saved_timer;

static void send_saved(void *context) {
  s_saved_timer = NULL;
  DictionaryIterator *iter;
  if (app_message_outbox_begin(&iter) == APP_MSG_OK) {
    dict_write_int32(iter, MESSAGE_KEY_msg_type, MSG_SAVED);
    dict_write_int32(iter, MESSAGE_KEY_saved_cutoff, s_saved_cutoff);
    dict_write_int32(iter, MESSAGE_KEY_saved_bytes, s_saved_bytes);
    dict_write_int32(iter, MESSAGE_KEY_saved_max, (int32_t)persist_get_max_size());
    s_outbox_msg = MSG_SAVED;
    if (app_message_outbox_send() == APP_MSG_OK) {
      return;
    }
  }
  if (++s_saved_tries < SAVED_RETRIES) {
    s_saved_timer = app_timer_register(SAVED_RETRY_MS, send_saved, NULL);
  }
}

void comm_send_saved(int32_t cutoff, int bytes) {
  s_saved_cutoff = cutoff;
  s_saved_bytes = bytes;
  s_saved_tries = 0;
  if (s_saved_timer) {
    app_timer_cancel(s_saved_timer);
  }
  send_saved(NULL);
}

bool comm_send_star_changes(const StarChange *changes, int count) {
  uint8_t bytes[MAX_STAR_CHANGES * STAR_CHANGE_MAX_BYTES];
  uint8_t *p = bytes;
  for (int i = 0; i < count && i < MAX_STAR_CHANGES; i++) {
    const StarChange *c = &changes[i];
    codec_write_int32(p, c->seq);
    codec_write_int32(p + 4, c->at);
    codec_write_int32(p + 8, c->sail_days);
    codec_write_int32(p + 12, c->start);
    p[16] = (uint8_t)c->day;
    p[17] = (uint8_t)(c->day >> 8);
    p[18] = c->on;
    p = codec_write_str(p + 19, c->title, SHORT_TITLE_LEN - 1);
    p = codec_write_str(p, c->venue, SHORT_VENUE_LEN - 1);
  }
  DictionaryIterator *iter;
  if (app_message_outbox_begin(&iter) != APP_MSG_OK) {
    APP_LOG(APP_LOG_LEVEL_WARNING, "Outbox busy, star changes not sent");
    return false;
  }
  dict_write_int32(iter, MESSAGE_KEY_msg_type, MSG_STAR_CHANGES);
  dict_write_int32(iter, MESSAGE_KEY_star_count, count);
  dict_write_data(iter, MESSAGE_KEY_star_changes, bytes, p - bytes);
  s_outbox_msg = MSG_STAR_CHANGES;
  if (app_message_outbox_send() != APP_MSG_OK) {
    return false;
  }
  APP_LOG(APP_LOG_LEVEL_INFO, "Sent %d star changes (%d bytes)", count, (int)(p - bytes));
  return true;
}

void comm_init(CommSliceHandler on_slice, CommNoticeHandler on_notices) {
  s_on_slice = on_slice;
  s_on_notices = on_notices;
  app_message_register_inbox_received(inbox_received);
  app_message_register_inbox_dropped(inbox_dropped);
  app_message_register_outbox_failed(outbox_failed);
  uint32_t inbox = app_message_inbox_size_maximum();
  if (inbox < INBOX_SIZE) {
    APP_LOG(APP_LOG_LEVEL_WARNING, "Inbox limited to %d bytes", (int)inbox);
  }
  app_message_open(inbox < INBOX_SIZE ? inbox : INBOX_SIZE, OUTBOX_SIZE);
}

void comm_deinit(void) { app_message_deregister_callbacks(); }
