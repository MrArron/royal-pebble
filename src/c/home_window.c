#include "screens.h"
#include "data.h"
#include "onboard.h"
#include "ui.h"
#include "usage.h"

// Home: port day before all-aboard shows the all-aboard countdown with the
// time-ashore bar (on embark day, the terminal arrival card, then the next two
// starred events topped up with the next items, until the arrival time);
// otherwise the next starred
// event (or a featured one), then the next two items. Hold Select on the
// countdown or the arrival card says "I'm on board" (docs/DESIGN.md
// §4.4), and Home shows the sea-day layout for the rest of the day.

static Window *s_window;
static Layer *s_top_bar;
static Layer *s_body;

// The event shown large in the sea-day layout, or -1.
static int find_headline(int32_t now, bool *featured) {
  int count = data_event_count();
  for (int pass = 0; pass < 2; pass++) {
    uint8_t want = pass == 0 ? (EVENT_STARRED | EVENT_PERSONAL) : EVENT_FEATURED;
    if (pass == 1 && !data_meta()->show_featured) {
      break;
    }
    for (int i = 0; i < count; i++) {
      Event *e = data_event(i);
      if ((e->flags & want) && event_is_timed(e) && !event_is_past(e, now)) {
        *featured = pass == 1;
        return i;
      }
    }
  }
  return -1;
}

#if defined(PBL_ROUND)
#define NEXT_ITEMS 1  // the round Home shows one (docs/mockups/round/NOTES.md)
#else
#define NEXT_ITEMS 2
#endif

static bool is_upcoming(const Event *e, int32_t now) { return event_is_timed(e) && e->start >= now; }

// Picks the next NEXT_ITEMS upcoming events after `skip`, in time order. With
// `starred_first`, starred events and personal entries of the day come first
// and other events only fill the rest.
static int pick_next_items(int *out, int32_t now, int skip, bool starred_first) {
  int n = 0;
  int count = data_event_count();
  if (starred_first) {
    for (int i = 0; i < count && n < NEXT_ITEMS; i++) {
      Event *e = data_event(i);
      if (i != skip && is_upcoming(e, now) && (e->flags & (EVENT_STARRED | EVENT_PERSONAL))) {
        out[n++] = i;
      }
    }
  }
  for (int i = 0; i < count && n < NEXT_ITEMS; i++) {
    bool taken = i == skip;
    for (int j = 0; j < n; j++) {
      taken = taken || out[j] == i;
    }
    if (!taken && is_upcoming(data_event(i), now)) {
      // Events are sorted by start, so keep `out` in time order.
      int pos = n++;
      while (pos > 0 && out[pos - 1] > i) {
        out[pos] = out[pos - 1];
        pos--;
      }
      out[pos] = i;
    }
  }
  return n;
}

// Each item: "1:00p Title" (starred ones with a star), then the venue with
// its deck in short form ("Studio B · 4 Mid"), after "Last chance · " when
// tagged, and " · ✓ Reserved" when marked (§7.3). Items that don't fit above
// `bottom` are left out.
static void draw_next_items(GContext *ctx, int y, int width, int bottom, int32_t now, int skip,
                            bool starred_first) {
  GFont bold = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
  GFont small = fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD);
  int items[NEXT_ITEMS];
  int shown = pick_next_items(items, now, skip, starred_first);
  for (int k = 0; k < shown; k++) {
    Event *e = data_event(items[k]);
    char venue_line[VENUE_LEN + 20];
    fmt_venue_where(venue_line, sizeof(venue_line), e->venue, &e->where);
    const char *tag = event_final_tag(e);
    bool reserved = (e->flags & EVENT_STARRED) && (e->flags & EVENT_RESERVATION) &&
                    (e->flags & EVENT_RESERVED);
    int height = 22 + (venue_line[0] || tag || reserved ? 16 : 0);
    if (y + height > bottom) {
      break;
    }
    char time_buf[8];
    fmt_clock(time_buf, sizeof(time_buf), e->start);
    graphics_context_set_text_color(ctx, g_theme->text);
    int time_w = graphics_text_layout_get_content_size(time_buf, bold, GRect(0, 0, width, 22),
                                                       GTextOverflowModeTrailingEllipsis,
                                                       GTextAlignmentLeft).w;
    // Round 2: "1:00p ★ Title" centered as one line.
    int x0 = PAD;
#if defined(PBL_ROUND)
    int lead = time_w + 4 + ((e->flags & EVENT_STARRED) ? 15 : 0);
    x0 = (width - lead -
          graphics_text_layout_get_content_size(e->title, bold, GRect(0, 0, width - 2 * PAD - lead, 22),
                                                GTextOverflowModeTrailingEllipsis,
                                                GTextAlignmentLeft).w) / 2;
#endif
    graphics_draw_text(ctx, time_buf, bold, GRect(x0, y, time_w + 2, 22),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
    int text_x = x0 + time_w + 4;
    if (e->flags & EVENT_STARRED) {
      draw_star(ctx, GPoint(text_x + 6, y + 12), g_theme->sea_accent);
      text_x += 15;
    }
    graphics_draw_text(ctx, e->title, bold, GRect(text_x, y, width - text_x - PAD, 22),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
    // Room is kept for "✓ Reserved"; the venue gets the ellipsis.
    int mark_w = reserved ? reserved_width(false) + 12 : 0;
    int vx = PAD;
#if defined(PBL_ROUND)
    char whole[VENUE_LEN + 40];
    snprintf(whole, sizeof(whole), "%s%s%s", tag ? tag : "", tag && venue_line[0] ? " \xc2\xb7 " : "",
             venue_line);
    vx = (width - mark_w -
          graphics_text_layout_get_content_size(whole, small, GRect(0, 0, width - 2 * PAD - mark_w, 18),
                                                GTextOverflowModeTrailingEllipsis,
                                                GTextAlignmentLeft).w) / 2;
#endif
    int x = vx;
    if (venue_line[0] || tag) {
      x = draw_tagged_line(ctx, tag, g_theme->port_accent, venue_line, g_theme->muted, small,
                           GRect(vx, y + 20, width - 2 * PAD - mark_w, 18));
    }
    if (reserved) {
      if (x > vx) {
        graphics_context_set_text_color(ctx, g_theme->muted);
        graphics_draw_text(ctx, " \xc2\xb7 ", small, GRect(x, y + 20, 12, 18),
                           GTextOverflowModeFill, GTextAlignmentLeft, NULL);
        x += 10;
      }
      draw_reserved(ctx, false, x, y + 20, g_theme->sea_accent);
    }
    y += height + 2;
  }
  if (shown == 0) {
    graphics_context_set_text_color(ctx, g_theme->muted);
    graphics_draw_text(ctx, "Nothing else today", fonts_get_system_font(FONT_KEY_GOTHIC_18),
                       GRect(PAD, y, width - 2 * PAD, 22), GTextOverflowModeTrailingEllipsis,
                       TEXT_ALIGN, NULL);
  }
}

static void draw_line(GContext *ctx, const char *text, GFont font, GColor color, int x, int y,
                      int w, int h);

// "Hold Select: I'm on board" under the countdown and the arrival time (§4.4).
#if defined(PBL_ROUND)
#define ONBOARD_HINT "Hold Select: on board"
#else
#define ONBOARD_HINT "Hold Select: I'm on board"
#endif
static int draw_onboard_hint(GContext *ctx, int y, int width) {
  graphics_context_set_text_color(ctx, g_theme->sea_accent);
  graphics_draw_text(ctx, ONBOARD_HINT, fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD),
                     GRect(PAD, y, width - 2 * PAD, 18), GTextOverflowModeTrailingEllipsis,
                     TEXT_ALIGN, NULL);
  return y + 16;
}

// ---- Time-ashore bar (docs/DESIGN.md §4.2) -------- ---------------------

#define BAR_H 8

// A booked shore excursion with an end, drawn blue on the bar.
static bool is_excursion(const Event *e) {
  return (e->flags & EVENT_BOOKED) && e->booked.kind == BOOKED_EXCURSION && event_is_timed(e) &&
         e->minutes > 0;
}

// In the last warning-period minutes before all-aboard: red on the bar, and
// the warning sign beside the countdown.
static bool in_warning(const Day *day, int32_t t) { return t >= day->all_aboard - day->warn_period; }

// The bar's color at time t: plain, an excursion or the warning window (drawn
// over an excursion), each paler or gray once t is past now.
static GColor bar_color(const Day *day, int32_t t, int32_t now) {
  bool past = t < now;
  if (in_warning(day, t)) {
    return past ? g_theme->warn : g_theme->warn_pale;
  }
  for (int i = 0; i < data_event_count(); i++) {
    Event *e = data_event(i);
    if (is_excursion(e) && e->start <= t && t < event_end(e)) {
      return past ? g_theme->sea_accent : g_theme->sea_pale;
    }
  }
  return past ? g_theme->port_accent : g_theme->divider;
}

// Where the bar starts: the day's arrival, or 04:00 without one.
static int32_t ashore_from(const Day *day) {
  return day->arrive != NO_TIME && day->arrive < day->all_aboard
             ? day->arrive : day->index * MINUTES_PER_DAY + DAY_START;
}

#if defined(PBL_ROUND)
// "Excursion back 11:30a" while a booked excursion is out.
static int draw_excursion_back(GContext *ctx, int y, int w, int32_t now) {
  for (int i = 0; i < data_event_count(); i++) {
    Event *e = data_event(i);
    if (is_excursion(e) && event_end(e) > now) {
      char t[8], buf[28];
      fmt_clock(t, sizeof(t), event_end(e));
      snprintf(buf, sizeof(buf), "Excursion back %s", t);
      draw_line(ctx, buf, fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD), g_theme->sea_accent, PAD, y,
                w, 18);
      return y + 16;
    }
  }
  return y;
}

// Round 2 (docs/mockups/round/NOTES.md): the bar is an arc along the bottom
// edge, radius 121 and 8 px wide, from 140° on the left to 40° on the right
// (screen angles, y down; 230° to 130° clockwise from 12 o'clock), with
// rounded ends, a radial now tick and the two times just above its ends.
#define ARC_R 121
#define ARC_W 8
#define ARC_START 230
#define ARC_SPAN 100

static GRect ring(int r) { return GRect(130 - r, 130 - r, 2 * r, 2 * r); }

// The angle `part` of `whole` along the arc.
static int32_t arc_angle(int32_t part, int32_t whole) {
  return DEG_TO_TRIGANGLE(ARC_START) - DEG_TO_TRIGANGLE(ARC_SPAN) * part / whole;
}

static void arc_cap(GContext *ctx, int32_t angle, GColor color) {
  graphics_context_set_fill_color(ctx, color);
  graphics_fill_circle(ctx, gpoint_from_polar(ring(ARC_R), GOvalScaleModeFitCircle, angle), ARC_W / 2);
}

void draw_ashore_arc(GContext *ctx, int32_t now) {
  const Day *day = data_day();
  int32_t from = ashore_from(day);
  int32_t span = day->all_aboard - from;
  if (span <= 0) {
    return;
  }
  // One degree at a time, in runs of one color.
  int run = 0;
  GColor color = bar_color(day, from, now);
  arc_cap(ctx, arc_angle(0, 1), color);
  for (int d = 1; d <= ARC_SPAN; d++) {
    GColor next = d < ARC_SPAN ? bar_color(day, from + span * d / ARC_SPAN, now) : GColorClear;
    if (!gcolor_equal(next, color)) {
      graphics_context_set_fill_color(ctx, color);
      graphics_fill_radial(ctx, ring(ARC_R + ARC_W / 2), GOvalScaleModeFitCircle, ARC_W,
                           arc_angle(d, ARC_SPAN), arc_angle(run, ARC_SPAN));
      if (d == ARC_SPAN) {
        arc_cap(ctx, arc_angle(1, 1), color);
      }
      run = d;
      color = next;
    }
  }
  int32_t t = now - from;
  t = t < 0 ? 0 : t > span ? span : t;
  // The now tick: about 2 px wide, radius 114 to 128.
  int32_t a = arc_angle(t, span);
  graphics_context_set_fill_color(ctx, g_theme->text);
  graphics_fill_radial(ctx, ring(128), GOvalScaleModeFitCircle, 14, a - TRIG_MAX_ANGLE / 720,
                       a + TRIG_MAX_ANGLE / 720);

  GFont small = fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD);
  char buf[8];
  graphics_context_set_text_color(ctx, g_theme->muted);
  fmt_clock(buf, sizeof(buf), from);
  graphics_draw_text(ctx, buf, small, GRect(35, 177, 90, 18), GTextOverflowModeFill,
                     GTextAlignmentLeft, NULL);
  fmt_clock(buf, sizeof(buf), day->all_aboard);
  graphics_draw_text(ctx, buf, small, GRect(135, 177, 90, 18), GTextOverflowModeFill,
                     GTextAlignmentRight, NULL);
}
#else
// From the day's arrival (04:00 without one) to all-aboard, with a now tick,
// the two times under it and "Excursion back 11:30a" while one is out.
static int draw_ashore_bar(GContext *ctx, int y, int width, int32_t now) {
  const Day *day = data_day();
  int32_t from = ashore_from(day);
  int32_t span = day->all_aboard - from;
  int w = width - 2 * PAD;
  for (int x = 0; x < w; x++) {
    // Rounded ends.
    int edge = x < w - 1 - x ? x : w - 1 - x;
    int inset = edge == 0 ? 2 : edge == 1 ? 1 : 0;
    graphics_context_set_stroke_color(ctx, bar_color(day, from + span * x / w, now));
    graphics_draw_line(ctx, GPoint(PAD + x, y + inset), GPoint(PAD + x, y + BAR_H - 1 - inset));
  }
  int tick = span > 0 ? (int)((now - from) * w / span) : 0;
  tick = tick < 1 ? 1 : tick > w - 1 ? w - 1 : tick;
  graphics_context_set_fill_color(ctx, g_theme->text);
  graphics_fill_rect(ctx, GRect(PAD + tick - 1, y - 2, 2, 12), 0, GCornerNone);
  y += BAR_H + 1;

  GFont small = fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD);
  char buf[28];
  fmt_clock(buf, sizeof(buf), from);
  draw_line(ctx, buf, small, g_theme->muted, PAD, y, w, 18);
  fmt_clock(buf, sizeof(buf), day->all_aboard);
  graphics_draw_text(ctx, buf, small, GRect(PAD, y, w, 18), GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentRight, NULL);
  y += 15;

  for (int i = 0; i < data_event_count(); i++) {
    Event *e = data_event(i);
    if (is_excursion(e) && event_end(e) > now) {
      char t[8];
      fmt_clock(t, sizeof(t), event_end(e));
      snprintf(buf, sizeof(buf), "Excursion back %s", t);
      draw_line(ctx, buf, small, g_theme->sea_accent, PAD, y, w, 18);
      y += 16;
      break;
    }
  }
  return y + 2;
}
#endif  // PBL_ROUND

// A red triangle with a black "!", about the digits' cap height.
static void draw_warning_sign(GContext *ctx, int x, int y) {
  bool faded = g_theme == theme_faded();
  graphics_context_set_stroke_color(ctx, faded ? g_theme->muted : GColorRed);
  for (int i = 0; i < 28; i++) {
    int half = i * 31 / 56;
    graphics_draw_line(ctx, GPoint(x + 15 - half, y + i), GPoint(x + 15 + half, y + i));
  }
  draw_bang(ctx, GPoint(x + 14, y + 10), 14, faded ? g_theme->bg : GColorBlack);
}

int draw_countdown(GContext *ctx, int y, int width, int32_t now, bool home) {
  const Day *day = data_day();
  int left = (int)(day->all_aboard - now);

  graphics_context_set_text_color(ctx, g_theme->port_accent);
  graphics_draw_text(ctx, "ALL ABOARD IN", fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                     GRect(PAD, y, width - 2 * PAD, 22), GTextOverflowModeTrailingEllipsis,
                     TEXT_ALIGN, NULL);
  y += 18;

  char count_buf[16];
  snprintf(count_buf, sizeof(count_buf), "%d:%02d", left / 60, left % 60);
  GFont big = fonts_get_system_font(FONT_KEY_BITHAM_42_BOLD);
#if defined(PBL_ROUND)
  // The count and the warning sign centered together.
  bool warn = in_warning(day, now);
  int count_w = graphics_text_layout_get_content_size(count_buf, big, GRect(0, 0, width, 50),
                                                      GTextOverflowModeFill, GTextAlignmentLeft).w;
  int x = (width - count_w - (warn ? 39 : 0)) / 2;
  graphics_context_set_text_color(ctx, g_theme->text);
  graphics_draw_text(ctx, count_buf, big, GRect(x, y, count_w + 2, 50),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  if (warn) {
    draw_warning_sign(ctx, x + count_w + 8, y + 12);
  }
#else
  graphics_context_set_text_color(ctx, g_theme->text);
  graphics_draw_text(ctx, count_buf, big, GRect(PAD, y, width - 2 * PAD, 50),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  if (in_warning(day, now)) {
    int count_w = graphics_text_layout_get_content_size(count_buf, big, GRect(0, 0, width, 50),
                                                        GTextOverflowModeFill,
                                                        GTextAlignmentLeft).w;
    draw_warning_sign(ctx, PAD + count_w + 8, y + 12);
  }
#endif
  y += 50;

  char ship_buf[8], local_buf[8], both[40];
  fmt_clock(ship_buf, sizeof(ship_buf), day->all_aboard);
  fmt_clock(local_buf, sizeof(local_buf), day->all_aboard + day->local_offset);
  snprintf(both, sizeof(both), "%s ship \xc2\xb7 %s local", ship_buf, local_buf);
  graphics_context_set_text_color(ctx, g_theme->muted);
  graphics_draw_text(ctx, both, fonts_get_system_font(FONT_KEY_GOTHIC_18),
                     GRect(PAD, y, width - 2 * PAD, 22), GTextOverflowModeTrailingEllipsis,
                     TEXT_ALIGN, NULL);
#if defined(PBL_ROUND)
  // The arc, its times and the on-board hint are on the edge layer.
  return draw_excursion_back(ctx, y + 22, width - 2 * PAD, now) + 4;
#else
  y = draw_ashore_bar(ctx, y + 26, width, now);
  if (!home) {
    return y;
  }
  draw_divider(ctx, y, width);
  return draw_onboard_hint(ctx, y + 4, width) + 4;
#endif
}

// `route`: Select opens the route to this event, so its brief line ends with
// `Route ›` (§4.1).
static int draw_headline(GContext *ctx, int y, int width, int32_t now, int index, bool featured,
                         bool route) {
  GFont label_font = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
  if (index < 0) {
    graphics_context_set_text_color(ctx, g_theme->muted);
    graphics_draw_text(ctx, "Nothing starred today", fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD),
                       GRect(PAD, y, width - 2 * PAD, 30), GTextOverflowModeTrailingEllipsis,
                       TEXT_ALIGN, NULL);
    return y + 36;
  }

  Event *e = data_event(index);
  char label[40];
  const char *kind = featured ? "FEATURED" : "NEXT";
  if (event_in_progress(e, now)) {
    char end_buf[8];
    fmt_clock(end_buf, sizeof(end_buf), event_end(e));
    snprintf(label, sizeof(label), "NOW \xc2\xb7 UNTIL %s", end_buf);
  } else {
    int wait = (int)(e->start - now);
    if (wait < 60) {
      snprintf(label, sizeof(label), "%s \xc2\xb7 IN %d MIN", kind, wait);
    } else {
      snprintf(label, sizeof(label), "%s \xc2\xb7 IN %d H %d MIN", kind, wait / 60, wait % 60);
    }
  }

  int label_x = PAD;
#if defined(PBL_ROUND)
  // The star and label centered together.
  label_x = (width - (featured ? 0 : 16) -
             graphics_text_layout_get_content_size(label, label_font, GRect(0, 0, width, 22),
                                                   GTextOverflowModeTrailingEllipsis,
                                                   GTextAlignmentLeft).w) / 2;
#endif
  if (!featured) {
    draw_star(ctx, GPoint(label_x + 6, y + 12), g_theme->sea_accent);
    label_x += 16;
  }
  graphics_context_set_text_color(ctx, g_theme->sea_accent);
  graphics_draw_text(ctx, label, label_font, GRect(label_x, y, width - label_x - PAD, 22),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  y += 22;

  GFont title_font = fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD);
  GRect title_box = GRect(PAD, y, width - 2 * PAD, 56);
  GSize title_size = graphics_text_layout_get_content_size(
      e->title, title_font, title_box, GTextOverflowModeTrailingEllipsis, TEXT_ALIGN);
  graphics_context_set_text_color(ctx, g_theme->text);
  graphics_draw_text(ctx, e->title, title_font, title_box, GTextOverflowModeTrailingEllipsis,
                     TEXT_ALIGN, NULL);
  y += title_size.h + 4;

  // "12:00p · On Air" (a long venue wraps to a second line), then the deck in
  // short form: "Deck 4 Aft · ↓2".
  char time_buf[8], detail[48];
  fmt_clock(time_buf, sizeof(time_buf), e->start);
  if (e->venue[0]) {
    snprintf(detail, sizeof(detail), "%s \xc2\xb7 %s", time_buf, e->venue);
  } else {
    snprintf(detail, sizeof(detail), "%s", time_buf);
  }
  GFont detail_font = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
  GRect detail_box = GRect(PAD, y, width - 2 * PAD, 40);
  GSize detail_size = graphics_text_layout_get_content_size(
      detail, detail_font, detail_box, GTextOverflowModeTrailingEllipsis, TEXT_ALIGN);
  graphics_context_set_text_color(ctx, g_theme->muted);
  graphics_draw_text(ctx, detail, detail_font, detail_box, GTextOverflowModeTrailingEllipsis,
                     TEXT_ALIGN, NULL);
  y += detail_size.h + 2;
#if defined(PBL_ROUND)
  // `Route ›` is a bottom hint on the edge layer.
  (void)route;
  int hint_w = 0;
#else
  int hint_w = route ? draw_hint_right(ctx, "Route", width - PAD, y) + 6 : 0;
#endif
  y += draw_where_short(ctx, false, g_theme->muted, PAD, y, width - 2 * PAD - hint_w, &e->where);
  if (event_not_reserved(e->flags)) {
    graphics_context_set_text_color(ctx, g_theme->port_accent);
    graphics_draw_text(ctx, "Not reserved", fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                       GRect(PAD, y, width - 2 * PAD, 22), GTextOverflowModeTrailingEllipsis,
                       TEXT_ALIGN, NULL);
    y += 20;
  }
  const char *tag = event_final_tag(e);
  if (tag) {
    graphics_context_set_text_color(ctx, g_theme->port_accent);
    graphics_draw_text(ctx, tag, fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD),
                       GRect(PAD, y, width - 2 * PAD, 18), GTextOverflowModeTrailingEllipsis,
                       TEXT_ALIGN, NULL);
    y += 16;
  }
  return y + 4;
}

// ---- Days to sail (docs/DESIGN.md §4.5) --------------------------------

// Before the cruise, Home counts the days itself from the sail date, so it
// stays right without the phone until the embark day starts at 04:00.
static bool sail_ahead(void) {
  return data_ready() && data_day()->kind == DAY_NONE && data_day()->index < 0 &&
         cruise_day_index(now_cruise()) < 0;
}

// Calendar days until the sail date: 1 the day before, 0 after midnight on it.
static int days_to_sail(void) {
  int32_t now = now_cruise();
  return now >= 0 ? 0 : (int)((-now + MINUTES_PER_DAY - 1) / MINUTES_PER_DAY);
}

static const char *const WEEKDAYS[] = {"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"};
static const char *const MONTHS[] = {"Jan", "Feb", "Mar", "Apr", "May", "Jun",
                                     "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};

// "Sat Mar 6 · Galveston", without the weekday when that doesn't fit.
static void fmt_sail_line(char *buf, size_t size, GFont font, int width) {
  // Month and day from days since 1970-01-01 (Howard Hinnant's civil_from_days).
  int32_t z = data_meta()->sail_days + 719468;
  int32_t era = (z >= 0 ? z : z - 146096) / 146097;
  int32_t doe = z - era * 146097;
  int32_t yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  int32_t doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  int32_t mp = (5 * doy + 2) / 153;
  int day = (int)(doy - (153 * mp + 2) / 5 + 1);
  int month = (int)(mp < 10 ? mp + 3 : mp - 9);
  int weekday = (int)((data_meta()->sail_days % 7 + 11) % 7);  // 1970-01-01 was a Thursday

  const char *port = data_meta()->sail_port;
  const char *sep = port[0] ? " \xc2\xb7 " : "";
  snprintf(buf, size, "%s %s %d%s%s", WEEKDAYS[weekday], MONTHS[month - 1], day, sep, port);
  int w = graphics_text_layout_get_content_size(buf, font, GRect(0, 0, 400, 30),
                                                GTextOverflowModeTrailingEllipsis,
                                                GTextAlignmentLeft).w;
  if (w > width) {
    snprintf(buf, size, "%s %d%s%s", MONTHS[month - 1], day, sep, port);
  }
}

static void draw_line(GContext *ctx, const char *text, GFont font, GColor color, int x, int y,
                      int w, int h) {
  graphics_context_set_text_color(ctx, color);
  graphics_draw_text(ctx, text, font, GRect(x, y, w, h), GTextOverflowModeTrailingEllipsis,
                     TEXT_ALIGN, NULL);
}

static void draw_sail_countdown(GContext *ctx, int width) {
  GFont small = fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD);
  GFont medium = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
  int w = width - 2 * PAD;
  int days = days_to_sail();
#if defined(PBL_ROUND)
  // "SAILS IN" is the top bar's label line (apply_style); "days" goes under
  // the count (docs/mockups/round/DaysToSail).
  int y = 0;
#else
  int y = 2;

  draw_line(ctx, days > 1 ? "SAILS IN" : "SAILS", small, g_theme->muted, PAD, y, w, 18);
  y += 16;
#endif
  if (days > 1) {
    char count[8];
    snprintf(count, sizeof(count), "%d", days);
    GFont big = fonts_get_system_font(FONT_KEY_LECO_42_NUMBERS);
#if defined(PBL_ROUND)
    draw_line(ctx, count, big, g_theme->text, PAD, y, w, 50);
    draw_line(ctx, "days", medium, g_theme->text, PAD, y + 44, w, 22);
    y += 66;
#else
    int count_w = graphics_text_layout_get_content_size(count, big, GRect(0, 0, w, 50),
                                                        GTextOverflowModeFill,
                                                        GTextAlignmentLeft).w;
    draw_line(ctx, count, big, g_theme->text, PAD, y, count_w + 2, 50);
    draw_line(ctx, "days", medium, g_theme->text, PAD + count_w + 6, y + 31, w - count_w - 6, 22);
    y += 50;
#endif
  } else {
    draw_line(ctx, days == 1 ? "Tomorrow" : "Today", fonts_get_system_font(FONT_KEY_GOTHIC_28_BOLD),
              g_theme->text, PAD, y - 4, w, 34);
    y += 30;
  }

  char sail[48];
  fmt_sail_line(sail, sizeof(sail), medium, w);
  draw_line(ctx, sail, medium, g_theme->muted, PAD, y, w, 22);
  y += 20;
#if defined(PBL_ROUND)
  bool ship = days > 3;  // no room beside the sync reminder
#else
  bool ship = true;
#endif
  if (ship && data_meta()->ship_name[0]) {
    draw_line(ctx, data_meta()->ship_name, small, g_theme->muted, PAD, y, w, 18);
    y += 16;
  }
  draw_divider(ctx, y + 4, width);
  y += 8;

  // The last 3 days: the sync-before-departure reminder.
  if (days <= 3) {
    draw_line(ctx, "Sync before you leave", medium, g_theme->port_accent, PAD, y, w, 22);
    y += 20;
    draw_line(ctx, "Works offline after a full sync", small, g_theme->muted, PAD, y, w, 18);
    y += 16;
    const char *last_sync = data_my_info()->last_sync;
    if (last_sync[0]) {
      char line[40];
      snprintf(line, sizeof(line), "Last sync %s", last_sync);
      draw_line(ctx, line, small, g_theme->muted, PAD, y, w, 18);
      y += 16;
    }
    y += 2;
  }

  uint8_t starred = data_meta()->cruise_starred;
  if (starred == 0) {
    draw_line(ctx, "Nothing starred yet", small, g_theme->muted, PAD, y, w, 18);
  } else {
    char line[32];
    snprintf(line, sizeof(line), "%d starred so far", starred);
    int x = PAD;
    int line_w = w - 16;
#if defined(PBL_ROUND)
    line_w = graphics_text_layout_get_content_size(line, small, GRect(0, 0, w, 18),
                                                   GTextOverflowModeFill, GTextAlignmentLeft).w + 2;
    x = (width - 16 - line_w) / 2;
#endif
    draw_star(ctx, GPoint(x + 6, y + 9), g_theme->sea_accent);
    draw_line(ctx, line, small, g_theme->text, x + 16, y, line_w, 18);
  }
}

// Is Home showing today's cruise day rather than a message or the days to
// sail?
static bool shows_day(int32_t now) {
  const Day *day = data_day();
  return data_ready() && !sail_ahead() && cruise_day_index(now) <= day->index && day->kind != DAY_NONE;
}

// Embark day's terminal arrival card (docs/DESIGN.md §4.3): until the
// arrival time, or with Royal's text (no time to switch at) until all-aboard;
// never once the user is on board (§4.4).
static bool shows_arrival(int32_t now) {
  const Day *day = data_day();
  if (!shows_day(now) || day->kind != DAY_PORT || onboard_is_set()) {
    return false;
  }
  if (day->terminal != NO_TIME) {
    return now < day->terminal;
  }
  return day->terminal_text[0] && (day->all_aboard == NO_TIME || now < day->all_aboard);
}

// The all-aboard countdown: a port day until all-aboard, or the day's
// departure if that comes first, unless the user is on board (§4.4).
static bool shows_countdown(int32_t now) {
  const Day *day = data_day();
  return shows_day(now) && !shows_arrival(now) && day->kind == DAY_PORT &&
         day->all_aboard != NO_TIME && now < day->all_aboard &&
         (day->depart == NO_TIME || now < day->depart) && !onboard_is_set();
}

// Is Home showing its sea-day layout (the NEXT card) rather than a message,
// the days to sail, the arrival card or the all-aboard countdown?
static bool shows_headline(int32_t now) {
  return shows_day(now) && !shows_arrival(now) && !shows_countdown(now);
}

// Hold Select says "I'm on board": on the arrival card or the countdown.
static bool offers_onboard(int32_t now) { return shows_arrival(now) || shows_countdown(now); }

// TERMINAL ARRIVAL, the time large with "in 2 h 18 min" (or Royal's text),
// then all-aboard and the sailing time.
static int draw_arrival(GContext *ctx, int y, int width, int32_t now) {
  const Day *day = data_day();
  int w = width - 2 * PAD;
  GFont medium = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
  draw_line(ctx, "TERMINAL ARRIVAL", medium, g_theme->port_accent, PAD, y, w, 22);
  y += 18;
  char buf[32];
  if (day->terminal != NO_TIME) {
    fmt_clock(buf, sizeof(buf), day->terminal);
    draw_line(ctx, buf, fonts_get_system_font(FONT_KEY_BITHAM_42_BOLD), g_theme->text, PAD, y, w, 50);
    y += 50;
    char amount[20];
    fmt_duration(amount, sizeof(amount), (int)(day->terminal - now));
    snprintf(buf, sizeof(buf), "in %s", amount);
    draw_line(ctx, buf, fonts_get_system_font(FONT_KEY_GOTHIC_18), g_theme->muted, PAD, y, w, 22);
    y += 22;
  } else {
    draw_line(ctx, day->terminal_text, fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD), g_theme->text,
              PAD, y, w, 30);
    y += 30;
  }
  y = draw_onboard_hint(ctx, y, width) + 4;
  if (day->all_aboard == NO_TIME && day->depart == NO_TIME) {
    return y;
  }
  draw_divider(ctx, y, width);
  y += 4;
  char t[8];
  if (day->all_aboard != NO_TIME) {
    fmt_clock(t, sizeof(t), day->all_aboard);
    snprintf(buf, sizeof(buf), "All aboard %s", t);
    draw_line(ctx, buf, medium, g_theme->text, PAD, y, w, 22);
    y += 20;
  }
  if (day->depart != NO_TIME) {
    fmt_clock(t, sizeof(t), day->depart);
    snprintf(buf, sizeof(buf), "Sails %s", t);
    draw_line(ctx, buf, fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD), g_theme->muted, PAD, y, w, 18);
    y += 16;
  }
  return y + 6;
}

// A venue on board, so the phone can route to it.
static bool routable(const Event *e) { return e->where.deck > 0 && !(e->where.bits & WHERE_ASHORE); }

// The event Select routes to (§4.1): the NEXT card's, when its venue is on
// board; else -1.
static int route_target(int32_t now) {
  bool featured = false;
  int index = shows_headline(now) ? find_headline(now, &featured) : -1;
  return index >= 0 && routable(data_event(index)) ? index : -1;
}

// What the main card shows, for the usage log (docs/WATCH_PROTOCOL.md).
static int32_t home_card(void) {
  int32_t now = now_cruise();
  if (!data_ready()) {
    return 0;
  }
  if (sail_ahead()) {
    return 1;
  }
  if (cruise_day_index(now) > data_day()->index) {
    return 2;
  }
  if (data_day()->kind == DAY_NONE) {
    return 3;
  }
  if (shows_arrival(now)) {
    return 9;
  }
  if (!shows_headline(now)) {
    return 4;
  }
  bool featured = false;
  int index = find_headline(now, &featured);
  if (index < 0) {
    return 8;
  }
  return event_in_progress(data_event(index), now) ? 7 : featured ? 6 : 5;
}

// The card when Home came on top; a "loading" one is replaced once the
// schedule arrives.
static int32_t s_card;

// Big muted message with a smaller line under it.
static void draw_message(GContext *ctx, int width, const char *title, const char *hint) {
  graphics_context_set_text_color(ctx, g_theme->text);
  graphics_draw_text(ctx, title, fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD),
                     GRect(PAD, 10, width - 2 * PAD, 60), GTextOverflowModeWordWrap,
                     TEXT_ALIGN, NULL);
  graphics_context_set_text_color(ctx, g_theme->muted);
  graphics_draw_text(ctx, hint, fonts_get_system_font(FONT_KEY_GOTHIC_18),
                     GRect(PAD, 44, width - 2 * PAD, 100), GTextOverflowModeWordWrap,
                     TEXT_ALIGN, NULL);
}

#if defined(PBL_ROUND)
// What the round edge layer shows, set by the body (drawn just before it).
enum { EDGE_NONE, EDGE_ARC, EDGE_ROUTE };
static uint8_t s_edge_shows;
#endif

static void draw_body(Layer *layer, GContext *ctx) {
  GRect b = layer_get_bounds(layer);
  const Day *day = data_day();
#if defined(PBL_ROUND)
  s_edge_shows = EDGE_NONE;
#endif
  if (!data_ready()) {
    bool connected = connection_service_peek_pebble_app_connection();
    draw_message(ctx, b.size.w, connected ? "Loading..." : "Phone not connected",
                 connected ? "Getting today's schedule from your phone."
                           : "Royal Pebble needs your phone nearby to load the schedule.");
    return;
  }
  if (sail_ahead()) {
    draw_sail_countdown(ctx, b.size.w);
    return;
  }
  if (cruise_day_index(now_cruise()) > day->index) {
    // A new day started while the phone was away; don't show yesterday.
    draw_message(ctx, b.size.w, "Connect your phone",
                 "Today's schedule comes from your phone. Alerts and reminders still work.");
    return;
  }
  if (day->kind == DAY_NONE) {
    draw_message(ctx, b.size.w, "No cruise today", day->status);
    return;
  }

  int32_t now = now_cruise();
  int y = HOME_TOP;
  int skip = -1;
  bool countdown = !shows_headline(now);

  if (shows_arrival(now)) {
    y = draw_arrival(ctx, y, b.size.w, now);
  } else if (countdown) {
    // The bar takes the next items' place; they're one press away in Today
    // (docs/DESIGN.md §4.2).
    y = draw_countdown(ctx, y, b.size.w, now, true);
#if defined(PBL_ROUND)
    s_edge_shows = EDGE_ARC;
#endif
    draw_clash_count(ctx, PAD, y - 4, b.size.w - 2 * PAD, now);
    return;
  } else {
    bool featured = false;
    skip = find_headline(now, &featured);
#if defined(PBL_ROUND)
    bool route = skip >= 0 && routable(data_event(skip));
    s_edge_shows = route ? EDGE_ROUTE : EDGE_NONE;
    y = draw_headline(ctx, y, b.size.w, now, skip, featured, route);
#else
    y = draw_headline(ctx, y, b.size.w, now, skip, featured, skip >= 0 && routable(data_event(skip)));
#endif
  }
  y += draw_clash_count(ctx, PAD, y - 4, b.size.w - 2 * PAD, now);

  draw_divider(ctx, y, b.size.w);
  draw_next_items(ctx, y + 4, b.size.w, b.size.h, now, skip, countdown);
}

// ---- Button hints (docs/DESIGN.md §4.6) --------------------------------

// Labels beside each button over a faded Home, for about 3 s on the first
// HINT_OPENS opens by the user (every open with the phone's Always show
// setting). Any press dismisses them. Raise HINTS_VERSION when an update adds a
// button to Home, so they show again.
#define KEY_HINTS 7
#define HINTS_VERSION 2  // 1: Select routes to the next event; 2: hold Select, on board
#define HINT_OPENS 3
#define HINT_MS 3000

typedef struct {
  uint8_t version;
  uint8_t opens;  // opens that showed the hints since `version`
} HintState;

static Layer *s_hints;
static AppTimer *s_hint_timer;
static bool s_hints_armed;

static bool hints_shown(void) { return s_hints && !layer_get_hidden(s_hints); }

static void body_update_proc(Layer *layer, GContext *ctx) {
  const Theme *theme = g_theme;
  if (hints_shown()) {
    g_theme = theme_faded();
  }
  draw_body(layer, ctx);
  g_theme = theme;
}

#if defined(PBL_ROUND)
// Round 2: the whole screen under the hints, for what sits along the bottom
// edge outside the body: the time-ashore arc with its times and the on-board
// hint, or `Route ›` (docs/mockups/round/HomePortArc, Main).
static Layer *s_edge;

static void edge_update_proc(Layer *layer, GContext *ctx) {
  const Theme *theme = g_theme;
  if (hints_shown()) {
    g_theme = theme_faded();
  }
  if (s_edge_shows == EDGE_ARC) {
    draw_ashore_arc(ctx, now_cruise());
    draw_onboard_hint(ctx, 202, 260);
  } else if (s_edge_shows == EDGE_ROUTE) {
    draw_hint_right(ctx, "Route", 151, 221);  // centered: "Route ›" is about 42 px wide
  }
  g_theme = theme;
}
#endif

// A label with a pointer toward its button: Back on the left, the others on
// the right. `cy` is the button's height in window coordinates.
static void draw_hint_label(GContext *ctx, const char *text, GColor fill, bool left, int cy,
                            int screen_w) {
  GFont font = fonts_get_system_font(left ? FONT_KEY_GOTHIC_14_BOLD : FONT_KEY_GOTHIC_18_BOLD);
  int h = left ? 18 : 22;
  int tip = 7;
  int text_w = graphics_text_layout_get_content_size(text, font, GRect(0, 0, screen_w, h),
                                                     GTextOverflowModeFill, GTextAlignmentLeft).w;
  int box_w = text_w + 12;
  GRect box = GRect(left ? tip : screen_w - tip - box_w, cy - h / 2, box_w, h);
  graphics_context_set_fill_color(ctx, fill);
  graphics_fill_rect(ctx, box, 0, GCornerNone);
  graphics_context_set_stroke_color(ctx, GColorWhite);
  graphics_draw_rect(ctx, box);
  graphics_context_set_stroke_color(ctx, fill);
  for (int i = 0; i < tip; i++) {
    int x = left ? tip - 1 - i : screen_w - tip + i;
    graphics_draw_line(ctx, GPoint(x, cy - (tip - i)), GPoint(x, cy + (tip - i)));
  }
  // Outlined like the box, so a black pointer shows on the dark theme.
  int base = left ? tip - 1 : screen_w - tip;
  int point = left ? 0 : screen_w - 1;
  graphics_context_set_stroke_color(ctx, GColorWhite);
  graphics_draw_line(ctx, GPoint(base, cy - tip), GPoint(point, cy));
  graphics_draw_line(ctx, GPoint(base, cy + tip), GPoint(point, cy));
  graphics_context_set_text_color(ctx, GColorWhite);
  graphics_draw_text(ctx, text, font, GRect(box.origin.x + 6, box.origin.y + (left ? -2 : -3), text_w + 2, h),
                     GTextOverflowModeFill, GTextAlignmentLeft, NULL);
}

static void hints_update_proc(Layer *layer, GContext *ctx) {
  int w = layer_get_bounds(layer).size.w;
  draw_hint_label(ctx, "My info", GColorBlack, false, HINT_UP_CY, w);
  // Select does nothing without a NEXT card on board, so no label then.
  int32_t now = now_cruise();
  if (route_target(now) >= 0) {
    draw_hint_label(ctx, "Route to next", GColorCobaltBlue, false, HINT_SELECT_CY, w);
  } else if (offers_onboard(now)) {
    draw_hint_label(ctx, "Hold: on board", GColorCobaltBlue, false, HINT_SELECT_CY, w);
  }
  draw_hint_label(ctx, "Today", GColorBlack, false, HINT_DOWN_CY, w);
  draw_hint_label(ctx, "Exit", GColorDarkGray, true, HINT_BACK_CY, w);
}

static void click_config(void *context);

static void hints_hide(void) {
  if (s_hint_timer) {
    app_timer_cancel(s_hint_timer);
    s_hint_timer = NULL;
  }
  if (hints_shown()) {
    layer_set_hidden(s_hints, true);
    layer_mark_dirty(s_body);
    window_set_click_config_provider(s_window, click_config);
  }
}

static void hint_timer_fired(void *data) {
  s_hint_timer = NULL;
  hints_hide();
}

// A press only dismisses the hints, so it can't open something by surprise.
// Back isn't taken: it exits as its label says, and once a window subscribes
// Back the firmware keeps it from exiting after the normal config returns.
static void hint_click(ClickRecognizerRef recognizer, void *context) {
  usage_press(click_recognizer_get_button_id(recognizer), 0, -1);
  hints_hide();
}

static void hints_click_config(void *context) {
  window_single_click_subscribe(BUTTON_ID_UP, hint_click);
  window_single_click_subscribe(BUTTON_ID_SELECT, hint_click);
  window_single_click_subscribe(BUTTON_ID_DOWN, hint_click);
}

// Shows the hints once per armed open, when Home is on top with its data and
// they're due. The watch counts the opens itself.
static void hints_maybe_show(void) {
  if (!s_hints_armed || !s_hints || !data_ready() || !home_window_is_top()) {
    return;
  }
  s_hints_armed = false;
  HintState state = {0, 0};
  if (persist_get_size(KEY_HINTS) == (int)sizeof(state)) {
    persist_read_data(KEY_HINTS, &state, sizeof(state));
  }
  if (state.version != HINTS_VERSION) {
    state.version = HINTS_VERSION;
    state.opens = 0;
  }
  if (state.opens >= HINT_OPENS && !data_meta()->always_hints) {
    return;
  }
  if (state.opens < 255) {
    state.opens++;
  }
  persist_write_data(KEY_HINTS, &state, sizeof(state));
  layer_set_hidden(s_hints, false);
  layer_mark_dirty(s_body);
  window_set_click_config_provider(s_window, hints_click_config);
  s_hint_timer = app_timer_register(HINT_MS, hint_timer_fired, NULL);
}

void home_window_arm_hints(void) {
  s_hints_armed = true;
  hints_maybe_show();
}

static void apply_style(void) {
  const Day *day = data_day();
  window_set_background_color(s_window, g_theme->bg);
  // The countdown names the ship and date itself, so the bar just says Home.
  bool counting = sail_ahead();
#if defined(PBL_ROUND)
  // Round 2: the label line reads "SAILS IN" over the count.
  const char *home = days_to_sail() > 1 ? "Sails in" : "Sails";
#else
  const char *home = "Home";
#endif
  top_bar_set(s_top_bar, day->kind == DAY_PORT ? BAND_PORT : BAND_SEA, BAND_LABEL,
              counting ? home
              : data_ready() ? day->location
                             : (connection_service_peek_pebble_app_connection() ? "Loading..." : "No phone"));
  top_bar_set_right(s_top_bar, counting || !data_ready() ? ""
                               : onboard_is_set() && shows_day(now_cruise()) ? "ON BOARD"
                                                                             : day->status,
                    false, 0);
}

static void up_click(ClickRecognizerRef recognizer, void *context) {
  usage_press(BUTTON_ID_UP, 0, -1);
  info_window_push();
}

static void down_click(ClickRecognizerRef recognizer, void *context) {
  usage_press(BUTTON_ID_DOWN, 0, -1);
  today_window_push();
}

static void up_long_click(ClickRecognizerRef recognizer, void *context) {
  usage_press(BUTTON_ID_UP, USAGE_LONG | (data_meta()->is_demo ? 0 : USAGE_NOTHING), -1);
  demo_next();
}

static void select_click(ClickRecognizerRef recognizer, void *context) {
  int index = route_target(now_cruise());
  usage_press(BUTTON_ID_SELECT, index >= 0 ? 0 : USAGE_NOTHING, -1);
  if (index >= 0) {
    route_window_push_event(data_event(index));
  }
}

static void select_long_click(ClickRecognizerRef recognizer, void *context) {
  bool offered = offers_onboard(now_cruise());
  usage_press(BUTTON_ID_SELECT, USAGE_LONG, -1);
  // Ask by voice (§11), where "I'm on board" is one of the commands (owner,
  // 2026-09-28). With the phone away there's no voice, so the "On board?"
  // screen takes Hold Select while it's offered.
  if (offered && !connection_service_peek_pebble_app_connection()) {
    onboard_window_push();
  } else {
    ask_window_push();
  }
}

static void click_config(void *context) {
  window_single_click_subscribe(BUTTON_ID_UP, up_click);
  window_single_click_subscribe(BUTTON_ID_DOWN, down_click);
  window_single_click_subscribe(BUTTON_ID_SELECT, select_click);
  window_long_click_subscribe(BUTTON_ID_UP, 700, up_long_click, NULL);
  window_long_click_subscribe(BUTTON_ID_SELECT, 700, select_long_click, NULL);
}

static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect b = layer_get_bounds(root);
  s_top_bar = top_bar_create(TOP_BAR_FRAME(b), BAND_SEA, BAND_LABEL, "");
  layer_add_child(root, s_top_bar);
  s_body = layer_create(HOME_FRAME(b));
  layer_set_update_proc(s_body, body_update_proc);
  layer_add_child(root, s_body);
#if defined(PBL_ROUND)
  s_edge = layer_create(b);
  layer_set_update_proc(s_edge, edge_update_proc);
  layer_add_child(root, s_edge);
  s_hints = layer_create(GRect(HINTS_INSET_X, 0, b.size.w - 2 * HINTS_INSET_X, b.size.h));
#else
  s_hints = layer_create(b);
#endif
  layer_set_update_proc(s_hints, hints_update_proc);
  layer_set_hidden(s_hints, true);
  layer_add_child(root, s_hints);
  apply_style();
}

static void window_appear(Window *window) {
  s_card = home_card();
  usage_screen(SCREEN_HOME, s_card);
  hints_maybe_show();
}
static void window_disappear(Window *window) { hints_hide(); }

static void window_unload(Window *window) {
  hints_hide();
  layer_destroy(s_hints);
  s_hints = NULL;
#if defined(PBL_ROUND)
  layer_destroy(s_edge);
#endif
  layer_destroy(s_body);
  top_bar_destroy(s_top_bar);
  s_body = NULL;
  s_top_bar = NULL;
}

void home_window_refresh(void) {
  if (s_top_bar) {
    apply_style();
    layer_mark_dirty(s_body);
    if (hints_shown()) {
      layer_mark_dirty(s_hints);
    }
    hints_maybe_show();
    if (s_card == 0 && home_window_is_top()) {
      s_card = home_card();
      usage_screen_detail(SCREEN_HOME, s_card);
    }
  }
}

void home_window_push(void) {
  s_window = window_create();
  window_set_click_config_provider(s_window, click_config);
  window_set_window_handlers(s_window, (WindowHandlers){
    .load = window_load,
    .appear = window_appear,
    .disappear = window_disappear,
    .unload = window_unload,
  });
  window_stack_push(s_window, true);
}

void home_window_destroy(void) { window_destroy(s_window); }

bool home_window_is_top(void) { return s_window && window_stack_get_top_window() == s_window; }
