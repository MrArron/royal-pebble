// Packs slice events into byte chunks for AppMessage (docs/WATCH_PROTOCOL.md).
//
// Per event, little-endian:
//   int32 start (cruise minutes, -1 = untimed), uint16 minutes, uint8 flags,
//   4 bytes where (below), uint8 title length, title bytes (UTF-8), uint8 venue
//   length, venue bytes.

var TITLE_MAX = 63;  // bytes; the watch buffers are 64 and 32 with the NUL
var VENUE_MAX = 31;

// UTF-8 bytes of `text`, cut at a character boundary to at most `max` bytes.
function utf8(text, max) {
  var out = [];
  for (var i = 0; i < text.length; i++) {
    var c = text.charCodeAt(i);
    var bytes;
    if (c >= 0xD800 && c <= 0xDBFF && i + 1 < text.length) {
      var cp = 0x10000 + ((c - 0xD800) << 10) + (text.charCodeAt(i + 1) - 0xDC00);
      bytes = [0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)];
      i++;
    } else if (c < 0x80) {
      bytes = [c];
    } else if (c < 0x800) {
      bytes = [0xC0 | (c >> 6), 0x80 | (c & 63)];
    } else {
      bytes = [0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)];
    }
    if (out.length + bytes.length > max) {
      break;
    }
    out.push.apply(out, bytes);
  }
  return out;
}

// `text` cut at a character boundary to at most `max` UTF-8 bytes, for string
// values the watch copies into fixed buffers.
function cutText(text, max) {
  var bytes = 0;
  var i = 0;
  text = text || '';
  while (i < text.length) {
    var c = text.charCodeAt(i);
    var pair = c >= 0xD800 && c <= 0xDBFF && i + 1 < text.length;
    var n = pair ? 4 : c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
    if (bytes + n > max) {
      break;
    }
    bytes += n;
    i += pair ? 2 : 1;
  }
  return text.slice(0, i);
}

var WHERE_ASHORE = 4;
var WHERE_REL = 8;

// Where a venue is (venues.watchWhere): uint8 deck (0 none), uint8 deckTo (a
// range when not 0), uint8 bits (0-1 position: 0 none, 1 Fore, 2 Mid, 3 Aft;
// 4 ashore; 8 rel is known), int8 rel (deck - cabin deck).
function encodeWhere(w) {
  w = w || {};
  var rel = typeof w.rel === 'number' ? Math.max(-127, Math.min(127, w.rel)) : null;
  var bits = ((w.pos | 0) & 3) | (w.ashore ? WHERE_ASHORE : 0) | (rel === null ? 0 : WHERE_REL);
  return [(w.deck | 0) & 255, (w.deckTo | 0) & 255, bits, (rel || 0) & 255];
}

function encodeEvent(e) {
  var title = utf8(e.title || '', TITLE_MAX);
  var venue = utf8(e.venue || '', VENUE_MAX);
  var start = e.start | 0;
  var minutes = Math.max(0, Math.min(0xFFFF, e.minutes | 0));
  return [
    start & 255, (start >> 8) & 255, (start >> 16) & 255, (start >> 24) & 255,
    minutes & 255, (minutes >> 8) & 255,
    e.flags & 255
  ].concat(encodeWhere(e.where), [title.length], title, [venue.length], venue);
}

// Notices and star changes: the watch buffers are 40 and 24 with the NUL.
var SHORT_TITLE_MAX = 39;
var SHORT_VENUE_MAX = 23;
// Alerts are shorter, so three fit in one 256-byte storage value on the watch
// (buffers 32 and 18 with the NUL).
var ALARM_TITLE_MAX = 31;
var ALARM_VENUE_MAX = 17;

function int32(n) {
  n = n | 0;
  return [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255];
}

// Per alarm, little-endian: int32 at, int32 ref, int16 extra, uint8 kind,
// uint8 from (bits 0-1 the previous venue's position, 2-3 the kind of "From"
// directions), 4 bytes where (as events), then title, venue and the previous
// venue's name, each as uint8 length and bytes.
function encodeAlarm(a) {
  var title = utf8(a.title || '', ALARM_TITLE_MAX);
  var venue = utf8(a.venue || '', ALARM_VENUE_MAX);
  var fromVenue = utf8(a.fromVenue || '', ALARM_VENUE_MAX);
  var extra = a.extra | 0;
  var from = ((a.fromPos | 0) & 3) | (((a.from | 0) & 3) << 2);
  return int32(a.at).concat(int32(a.ref), [extra & 255, (extra >> 8) & 255, a.kind & 255, from],
                            encodeWhere(a.where), [title.length], title, [venue.length], venue,
                            [fromVenue.length], fromVenue);
}

// Per notice (starred event moved or cancelled), little-endian: uint8 kind,
// int32 from, int32 to, then title, venue and old venue, each as uint8 length
// and bytes, cut to 39, 23 and 23 bytes.
function encodeNotice(n) {
  var title = utf8(n.title || '', SHORT_TITLE_MAX);
  var venue = utf8(n.venue || '', SHORT_VENUE_MAX);
  var oldVenue = utf8(n.oldVenue || '', SHORT_VENUE_MAX);
  return [n.kind & 255].concat(int32(n.from), int32(n.to), [title.length], title, [venue.length], venue,
                               [oldVenue.length], oldVenue);
}

function packNotices(notices) {
  var bytes = [];
  notices.forEach(function(n) { bytes = bytes.concat(encodeNotice(n)); });
  return bytes;
}

// Returns [{first: index of first item, bytes: [...]}, ...], each chunk at most
// maxBytes long.
function packItems(items, maxBytes, encode) {
  var chunks = [];
  var current = null;
  items.forEach(function(e, i) {
    var bytes = encode(e);
    if (!current || current.bytes.length + bytes.length > maxBytes) {
      current = {first: i, bytes: []};
      chunks.push(current);
    }
    current.bytes = current.bytes.concat(bytes);
  });
  return chunks;
}

function packEvents(events, maxBytes) {
  return packItems(events, maxBytes, encodeEvent);
}

function packAlarms(alarms, maxBytes) {
  return packItems(alarms, maxBytes, encodeAlarm);
}

// Star changes made on the watch (STAR_CHANGES), little-endian: int32 seq,
// int32 at (seconds since 1970 UTC), int32 sail (days since 1970), int32 start
// (cruise minutes, -1 untimed), int16 day (watch day), uint8 on, then title and
// venue as uint8 length and UTF-8 bytes, cut to 39 and 23 bytes (maybe mid-character).
// Title and venue stay byte arrays, for comparing with the watch's copy.
var STAR_CHANGE_TITLE_MAX = SHORT_TITLE_MAX;
var STAR_CHANGE_VENUE_MAX = SHORT_VENUE_MAX;

function readInt32(b, i) {
  return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) | 0;
}

function decodeStarChanges(bytes) {
  var out = [];
  var i = 0;
  while (i + 20 <= bytes.length) {
    var c = {
      seq: readInt32(bytes, i),
      at: readInt32(bytes, i + 4),
      sail: readInt32(bytes, i + 8),
      start: readInt32(bytes, i + 12),
      day: ((bytes[i + 16] | (bytes[i + 17] << 8)) << 16) >> 16,
      on: bytes[i + 18] !== 0
    };
    i += 19;
    var n = bytes[i++];
    if (i + n + 1 > bytes.length) {
      break;
    }
    c.title = bytes.slice(i, i + n);
    i += n;
    var m = bytes[i++];
    if (i + m > bytes.length) {
      break;
    }
    c.venue = bytes.slice(i, i + m);
    i += m;
    out.push(c);
  }
  return out;
}

// Encodes like the watch does (for tests).
function encodeStarChange(c) {
  var day = c.day | 0;
  var title = utf8(c.title || '', TITLE_MAX).slice(0, STAR_CHANGE_TITLE_MAX);
  var venue = utf8(c.venue || '', VENUE_MAX).slice(0, STAR_CHANGE_VENUE_MAX);
  return int32(c.seq).concat(int32(c.at), int32(c.sail), int32(c.start),
                             [day & 255, (day >> 8) & 255, c.on ? 1 : 0, title.length], title,
                             [venue.length], venue);
}

module.exports = {packEvents: packEvents, packAlarms: packAlarms, packNotices: packNotices,
                  encodeEvent: encodeEvent, encodeAlarm: encodeAlarm, encodeWhere: encodeWhere,
                  encodeNotice: encodeNotice, utf8: utf8, cutText: cutText,
                  decodeStarChanges: decodeStarChanges, encodeStarChange: encodeStarChange,
                  TITLE_MAX: TITLE_MAX, VENUE_MAX: VENUE_MAX,
                  ALARM_TITLE_MAX: ALARM_TITLE_MAX, ALARM_VENUE_MAX: ALARM_VENUE_MAX,
                  STAR_CHANGE_TITLE_MAX: STAR_CHANGE_TITLE_MAX, STAR_CHANGE_VENUE_MAX: STAR_CHANGE_VENUE_MAX};
