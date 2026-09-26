# Phone ↔ watch protocol

How the phone companion (`src/pkjs/`) sends the watch (`src/c/`) today's slice of
the cruise over AppMessage. This is internal to the app; the cruise data bundle
that the phone stores is described in `DATA_FORMAT.md`.

## Time model

- **Cruise minutes:** every time sent to the watch is minutes since 00:00 ship
  time on the sail date (day 1). An event at 23:30 on day 2 is `1440 + 1410`; one
  that ends after midnight just has a larger end. Nothing wraps at midnight.
- **Watch day:** runs from 04:00 to 04:00 ship time. At 00:30 the watch still
  shows the evening before, including events Royal lists after midnight on the
  next date. Day index `d` covers cruise minutes `[d*1440 + 240, (d+1)*1440 + 240)`.
- **Now:** both sides compute it from the sail date and their own clock:
  `(days(today) - days(sailDate)) * 1440 + minutes since midnight`, with the same
  days-from-civil algorithm, so no time zones or text parsing are involved. The
  watch clock is assumed to be ship time (to confirm onboard).
- **After midnight:** Royal lists anything after midnight under the evening's
  date (live data: a 01:00 curfew dated the embark day, a 02:00 time zone change
  dated the evening before). So an event time before 04:00 is after midnight on
  its listed date. A departure before 04:00 or earlier than that day's arrival is
  after midnight too, and so is an all-aboard override before 04:00.
- **All-aboard** = departure (port-local) − ship offset − buffer (default 30 min,
  60 at tender ports: any day type containing `TENDER`), unless an exact time (ship time) is set per day. None on debark or sea days.
  Itinerary edits from Settings > Days (a skipped or added port, changed times)
  are applied to the day before any of this.
- **Rollover:** at 04:00 the watch sees that the current watch day differs from the
  slice's and asks the phone for a new slice (once per day change).

## Messages

All messages carry `msg_type` and, except watch→phone requests, `slice_id`
(increments per slice, 15 bits). Keys are in `package.json` (`messageKeys`).

### Phone → watch

A slice is `BEGIN`, `INFO`, one or more `EVENTS`, zero or more `ALARMS`, then `END`. The watch stages
everything and switches to the new slice only on `END` with the same `slice_id`.

| `msg_type` | Name | Other keys |
|---|---|---|
| 1 | BEGIN | `sail_date` (int `YYYYMMDD`), `day_index`, `day_kind` (0 port, 1 sea, 2 none), `day_status`, `day_location`, `all_aboard` (cruise minutes, −1 none), `local_offset` (minutes, local = ship + offset), `arrive`, `depart` (cruise minutes in ship time, −1 none), `ship_name`, `sail_port` (the embark port's short name, empty when unknown), `cruise_starred` (starred events and personal entries in the whole cruise, ≤ 255), `event_count`, `theme` (0 light, 1 dark), `show_featured` (0/1), `is_demo` (0/1), `reminder_lead` (minutes), `alarm_count`, and tomorrow's block (below) |
| 2 | INFO | `info_stateroom`, `info_deck`, `info_stairs`, `info_muster`, `info_clock`, `info_sync` (display strings) |
| 3 | EVENTS | `event_first` (index of the first event in this chunk), `events` (bytes, below) |
| 5 | ALARMS | `alarm_first`, `alarms` (bytes, below) |
| 4 | END | — |
| 6 | NOTICE | `notice_count`, `notices` (bytes, below). No `slice_id`; sent after a slice. |
| 7 | STAR_ACK | `star_ack`: the phone saved every star change up to this `seq`. No `slice_id`. |
| 8 | DIR_PAGE | A ship directory page: `dir_ref`, `dir_title`, `dir_label`, `dir_rel` (only when known), `dir_where` (place pages), `dir_rows`. No `slice_id`; see Ship directory. |

`day_kind` 2 (none) means the date is outside the cruise; `day_status` then reads
e.g. `SAILS MAR 6` or `CRUISE ENDED`. Before the cruise, Home shows the
days-to-sail countdown (`docs/DESIGN_V1_1.md` §8.2): the watch counts the days
from `sail_date` itself, and shows `sail_port`, `ship_name` and
`cruise_starred`. `cruise_starred` counts starred keys that still match the
schedule, whatever the Filters, plus personal entries.

`arrive` and `depart` are the itinerary's port-local times turned into ship time
(minus the day's offset), for the morning summary; a departure after midnight
is a larger number, as for all-aboard. None on sea days, no arrival on the
embark day and no departure on the debark day.

**Tomorrow's block** (the evening's tomorrow card, `docs/DESIGN_V1_1.md` §8.1;
the watch only has today's events, so the phone works it out):

| Key | Value |
|---|---|
| `tmr_kind` | the next watch day's `day_kind`; 2 when it is outside the cruise, and the rest is then empty or −1 |
| `tmr_status`, `tmr_location` | as `day_status` and `day_location` |
| `tmr_arrive`, `tmr_depart`, `tmr_all_aboard` | as for today, cruise minutes, −1 none |
| `tmr_starred` | starred events and personal entries (≤ 255) |
| `tmr_featured` | featured events (≤ 255) |
| `tmr_first`, `tmr_first_start` | the first timed one of them: title (≤ 39 bytes) and start (−1 none) |
| `tmr_last`, `tmr_last_kind` | a show to catch: title (≤ 39 bytes) and 1 last chance, 2 only show, 0 none |
| `tmr_to_reserve` | starred events that need a reservation and aren't marked reserved (≤ 255) |

Counts follow the Filters like the day's events (hidden categories left out
unless starred). **Last chance** is the last performance of a featured show in
the cruise, matched by title (trimmed, any case) across all days; a featured
show on only once is an **only show** (`slice.finalShows`, §8.4). Of tomorrow's,
the earliest last chance is sent, else the earliest only show. Today's events
carry the same as flags 16 and 32 (Packed events).

String values are cut on the phone between UTF-8 characters to fit the watch's
buffers.

### Watch → phone

| `msg_type` | Name | Other keys |
|---|---|---|
| 10 | REQUEST | — (send a fresh slice) |
| 12 | DEMO_NEXT | — (demo data only: next variant) |
| 13 | STAR_CHANGES | `star_count`, `star_changes` (bytes, below): stars changed on the watch and not yet acked |
| 14 | SAVED | `saved_cutoff` (cruise minutes of the first starred event or alert the watch couldn't save, −1 when everything fit), `saved_bytes`, `saved_max` (the watch's storage limit). Sent after every save while the phone is connected; see Stored on the watch. |
| 15 | DIR_REQUEST | `dir_ref`: the ship directory page to send (0 = the decks). |

(11 was an index-based STAR message, replaced by STAR_CHANGES.)

The phone also sends a slice by itself whenever the app starts (`ready`).

## Packed events

`EVENTS.events` is a byte array of events back to back, little-endian:

| Bytes | Field |
|---|---|
| 4 | `start`: int32 cruise minutes, −1 for untimed |
| 2 | `minutes`: uint16 duration, 0 if unknown |
| 1 | `flags`: 1 starred, 2 featured, 4 reservation needed, 8 personal entry, 16 last chance, 32 only show, 64 reserved (only with 4; kept when unstarred, shown only while starred) |
| 4 | `where`: where the venue is (below) |
| 1 | title length `n` (≤ 63) |
| n | title, UTF-8 |
| 1 | venue length `m` (≤ 31) |
| m | venue, UTF-8 |

`where` is worked out on the phone (`venues.whereFinder`: the built-in venue
table for the ship, the owner's edits from Settings > Cruise > Ship venues, and
the cabin deck read from the Me tab's Deck field). The watch has no ship
knowledge and only formats these numbers (`docs/DESIGN_V1_1.md` §2), so other
ships need no watch change.

| Byte | Field |
|---|---|
| 0 | `deck`: the entrance deck to use, the one nearest the cabin (ties go to the lower deck); 0 = not known |
| 1 | `deck_to`: the venue has several entrances and there is no cabin deck, so show `Decks deck-deck_to`; else 0 |
| 2 | bits 0-1 position (0 none, 1 Fore, 2 Mid, 3 Aft); 4 Ashore (no deck); 8 `rel` is known |
| 3 | `rel`: int8, `deck` − cabin deck (negative = down), when bit 8 is set |

A venue that isn't in the table (and has no owner edit), or an event with no
venue, sends all zeros: the watch leaves the deck lines out.

Chunks are at most 1500 bytes (watch inbox is 2048), about 20 events each. Events
are sorted with untimed entries first, then by start and title; at most 160 per
slice (a busy sea day has about 120). Categories hidden in Settings > Filters are
left out (Shop by default), except starred events, which always go. The watch decodes with bounds checks and
never parses text.

## Alerts

The phone sends an alert plan with every slice: all-aboard warnings 60, 30 and 15
minutes before all-aboard, and a reminder `reminder_lead` minutes (5/15/30,
default 15) before each starred event and personal entry. It covers today's and
tomorrow's watch days, so tomorrow's alerts still fire if the phone is away at the
04:00 rollover.

Each of those evenings also gets **to-reserve** alerts (`docs/DESIGN_V1_1.md`
§5): at the Me tab's time (18:00 to 22:00 ship time, default 20:00), one per
starred event of the next watch day that needs a reservation and isn't marked
reserved, at most 5, all in the same minute. The watch shows them on one screen.

Only future alerts are sent, sorted by time, then kind, then `ref`, at most 24.
Settings > Me > **Test alerts** adds a test reminder 2 minutes, a test
all-aboard warning 3 minutes and a test to-reserve alert (two events) 4 minutes
after the tap (anchored to the tap, kept for an hour), to check alerts on the
watch with any data, before the cruise too.

`ALARMS.alarms` is packed like events, little-endian:

| Bytes | Field |
|---|---|
| 4 | `at`: int32 cruise minutes, when to buzz |
| 4 | `ref`: int32 cruise minutes, the all-aboard time or event start (−1 for an untimed event to reserve) |
| 2 | `extra`: int16, local offset (all-aboard), duration (reminder) or how many events there are to reserve in all (to reserve) |
| 1 | `kind`: 0 all-aboard, 1 reminder, 2 to reserve |
| 1 | `from`: "From" directions (reminders; 0 otherwise), below; plus 16 when the event is starred, needs a reservation and isn't marked reserved (the alert shows `Not reserved`) |
| 4 | `where`: as in events (reminders; zeros for all-aboard), but relative to the previous venue when `from` is a route |
| 1 + n | title (location or event title), ≤ 31 bytes |
| 1 + m | venue (its short name), ≤ 17 bytes |
| 1 + k | previous venue's short name (route only, else empty), ≤ 17 bytes |

Texts are cut between UTF-8 characters. They are shorter than in events so alerts
take less of the watch's storage (they were first sized for a 4 kB cap). The venue table gives long venue names a short name for
alerts (`Main Dining Room 5` → `Main Dining 5`); other long names are cut.

**"From" directions** (`docs/DESIGN_V1_1.md` §2 and its decisions) are worked out
on the phone (`venues.venueFinder().route`, `slice.previousStop`). A reminder
starts from the previous starred event or personal entry when that one starts
earlier and ends less than 15 minutes before this one starts, or overlaps it (no
length = 30 minutes); several qualify: the one that started last. It looks back
into the previous watch day, so an event just after 04:00 can start from a
late-night one. `from`:

| Bits | Field |
|---|---|
| 0-1 | the previous venue's position (0 none, 1 Fore, 2 Mid, 3 Aft) |
| 2-3 | 0 none: `where` is relative to the cabin (`↓2 decks from cabin`); 1 route: `where` is relative to the previous venue, whose entrance nearest to this venue's is the reference, and the watch shows `From <previous venue>:` / `↓1 deck · Fore → Mid`; 2 same venue (`Same venue`); 3 same area: same neighborhood, deck and position (`Same area · Deck 5`) |

No directions (0) when either venue is Ashore, isn't in the table or is missing.
A reminder the watch adds itself (starring on the watch) has none until the
phone's next plan.

The watch turns the plan into wakeups: at most 8 per app, at least a minute apart,
so it schedules the next 8 alert minutes (alerts in the same minute share one) and
every launch, including one caused by a wakeup, schedules the next batch. The
wakeup cookie is the alert's `at`. Starring on the watch adds or removes that
event's reminder immediately. A launch by a wakeup shows only the alert screen
(Back returns to the watch face); the alert keeps its own copy because the fresh
plan the phone sends on launch no longer contains an alert that just fired.

## Schedule change notices

A re-sync (Download, or paste-in from the sync tool) can move or cancel starred
events. The phone checks each upcoming star against the new schedule
(`slice.reconcileStars`, rules in `DATA_FORMAT.md`), moves stars that follow a
rescheduled event and drops the rest, and queues a notice per change (at most 8).
It sends them in one NOTICE message after the next slice and forgets them once
delivered; undelivered ones wait for the next slice (e.g. the next app start).

`NOTICE.notices` is packed little-endian:

| Bytes | Field |
|---|---|
| 1 | `kind`: 0 moved (the star moved with it), 1 cancelled (star dropped), 2 check (several new times; star dropped) |
| 4 | `from`: int32 cruise minutes, the old start (−1 untimed) |
| 4 | `to`: int32 cruise minutes, the new start if moved, else `from` |
| 1 + n | title, ≤ 39 bytes |
| 1 + m | venue (the new one if moved), ≤ 23 bytes |
| 1 + k | old venue, only when a moved event changed venue, ≤ 23 bytes |

The watch buzzes (three short pulses) and shows them one at a time on a screen
like the alert screen: `SCHEDULE CHANGE / MOVED` with `Now 9:30p · Studio B` and
`Was 8:00p`. Times are formatted on the watch (12/24h), with the weekday when
not today. Up/Down step through them; Select or Back closes. Notices are not
stored. The same screen shows the watch's own `PHONE NEEDED` notice when some
starred events or alerts didn't fit in its storage (see Stored on the watch);
notices that arrive while one is on screen are added to it. While an alert is on screen they wait, and appear when it closes, so
they never cover an all-aboard warning.

## Star changes

Holding Select on the watch stars or unstars an event right away (flag and
reminder) and queues the change (`src/c/stars.c`) until the phone confirms it
saved it, so a star made with the phone away, on a slice loaded from storage or
while a send fails, isn't lost. Events are identified by content, not by index
in a slice:

- The queue keeps one entry per event (start, title and venue, cut to 39 and 23
  bytes like notices, plus the watch day for untimed entries and the sail date);
  a later change to the same event replaces it.
- **Reserved** (`docs/DESIGN_V1_1.md` §5) goes the same way: a short Select on
  the details of a starred event that needs a reservation toggles flag 64 and
  queues a change with bit 1 of `on` set. Star and Reserved changes of one event
  are separate entries. The phone keeps the mark with the stars under
  `R|` + the star key, so it has its own change time and the latest change wins
  as for stars. At most 8; a ninth event drops
  the oldest. Saved in persistent keys 30-33.
- The watch sends the whole queue after every star change, after every slice it
  receives, and when the phone connects again. A failed send is retried 3 times,
  5 seconds apart.
- Each slice that arrives while changes are queued gets them re-applied before
  it is shown, so the phone's first slice after a reconnect (which doesn't know
  about them yet) doesn't undo them.
- The phone matches each change against the schedule and personal entries the
  way `buildEvents` placed them: same start in cruise minutes (a listed time
  before 04:00 is after midnight on its listed date), or for untimed entries the
  same watch day, and the same title and venue as far as the watch kept them.
  It saves the result in its stars and replies STAR_ACK with the highest `seq`;
  the watch then drops those entries.
- **The latest change wins.** The phone keeps when each star last changed
  (`starTimes`, ms): the watch's changes carry their time (`time(NULL)`, UTC),
  and the settings page reports when each of its changes was made. A change
  older than the one already saved for that star is skipped. When the phone
  skips or can't match a change, it sends a fresh slice after the ack so the
  watch shows the phone's state. The watch's clock is set by the phone, so the
  two agree.
- A star that follows a rescheduled event keeps its change time under the new
  key. On each new bundle the phone drops change times of events no longer
  listed, unless they are personal entries or still starred.

`STAR_CHANGES.star_changes` is packed little-endian:

| Bytes | Field |
|---|---|
| 4 | `seq`: int32, increases with every change on the watch |
| 4 | `at`: int32 seconds since 1970 UTC, when it was made |
| 4 | `sail`: int32 days since 1970 of the sail date the change belongs to |
| 4 | `start`: int32 cruise minutes, −1 for untimed |
| 2 | `day`: int16 watch day of the slice it was made on (matches untimed entries) |
| 1 | `on`: bit 0 the new state (starred, or reserved); bit 1 set when the change is to Reserved rather than the star |
| 1 + n | title, ≤ 39 bytes (may end mid-character) |
| 1 + m | venue, ≤ 23 bytes |

At most 83 bytes each; the watch's outbox is 768 bytes.

## Stored on the watch

The watch saves what it needs without the phone after every slice and star change
(`src/c/store.c`), and loads it at launch. It is one blob in the packed layouts
above, spread over 256-byte values (keys 40 on):

1. Header (55 bytes: sail date, settings bits, reminder lead, slice id, day
   index and kind, all-aboard, local offset, cutoff, alert and event counts,
   the cruise's starred count, then arrive and depart, and tomorrow's kind, arrive, depart, all-aboard,
   first start, starred and featured counts, last kind and to-reserve count),
   then the day's status and location, My info's six texts, the ship name, and
   tomorrow's status, location, first and last, then the sail port. (Storage
   version 7.)
2. Alerts, then events, each as packed above, in time order.

The blob's budget follows `persist_get_max_size()`: the limit minus 1.5 kB kept
free (for the star queue and later needs), at most 10 kB. With the old 4 kB cap
that is 2.5 kB. The Pebble Time 2 (the owner's watch and the emulator) reports
1 MB, so a whole day fits: a real sync saved 2.6 kB. The cutoff warning below is
a safety net for watches with less.
Normally it saves **the whole day**: every alert still to come and every event
that hasn't finished. Only when that is over the budget does it fall back to
priorities, taking until the budget is full, in this order:

1. alerts in the next 12 hours;
2. starred events and personal entries in the next 12 hours (untimed ones too);
3. later alerts;
4. featured events in the next 12 hours, soonest first;
5. other events in the next 12 hours, soonest first.

Finished events aren't saved. With priorities, the first starred event (step 2)
or alert that doesn't fit is the **cutoff**: without the phone the watch is missing things
from then on. The watch shows a one-time `PHONE NEEDED` notice ("Open Royal
Pebble near your phone before 3:40p"), again only if the cutoff moves earlier or
the one shown has passed (the last one shown is kept in key 5). It also sends
SAVED, and the phone's settings page shows the cutoff while it is ahead, plus
how much storage the saved schedule uses.

The storage has a version (4 since the blob, 5 with the summary fields); a
different version is ignored and the watch waits for the phone. With the phone
away the app still shows the countdown and next events, and alerts keep firing.
After the 04:00 rollover without a new slice, Home says to connect the phone
instead of showing yesterday. Stars made on a stored slice are queued like any
other (see Star changes) and reach the phone once it is back.

## Morning summary

The summary card (`src/c/summary_window.c`, `docs/DESIGN_V1_1.md` §8.1) is
drawn from the stored slice, so it works without the phone. It replaces Home on
the first user open (`APP_LAUNCH_USER` or quick launch, not an alert wakeup or
an install) of each watch day once the slice is today's; from 20:00 that first
open shows tomorrow's card instead (none on the last evening). A launch with
yesterday's slice shows it when today's arrives, if Home is still on top.
Persistent key 6 holds the last card shown by itself: the sail date's days and
`watch day * 2`, plus 1 for tomorrow's card. My info's top row reopens it any
time (`Tomorrow's summary` from 20:00).

Today's counts come from the day's events on the watch, so stars made on the
watch count. On a slice loaded from storage, finished events aren't there, so
the count covers the rest of the day.

## Ship directory

The directory at the bottom of My info (`docs/DESIGN_V1_1.md` §3) is built on
the phone (`src/pkjs/directory.js`) from the venue table, the owner's venue
edits and the cabin deck, one page at a time: the watch sends DIR_REQUEST when
a directory screen opens and the phone answers with DIR_PAGE. Pages are
reference data the phone always has, so the watch keeps only the pages of the
screens that are open and stores nothing. With the phone away (not connected,
the request fails, or no answer within 8 seconds) the screen says `Connect your
phone`, and Select asks again.

`dir_ref` is the phone's name for a page; the watch only echoes it back and
ignores a DIR_PAGE whose ref isn't the one it is waiting for. Currently: 0 the
decks, 1 the areas, 100 + deck, 200 + area (the seven neighborhoods in Harmony
order, then `Other places`, then Ashore), 1000 + place (its index in the
directory's list, sorted by name; a ref that no longer matches gets a `Not
found` page).

- `dir_title`: the top bar's left side (`Ship`, `Deck 5`, `Area`, `Place`).
- `dir_label`: the top bar's right side (`by deck`, `by area`), replacing the
  day's status. `dir_rel` (int, decks from the cabin, deck pages only) replaces
  it with a drawn `↓1 deck` or `your deck`.
- `dir_where`: a place page's where, 4 bytes as in Packed events.

`dir_rows` is rows back to back, little-endian, in one message (at most 40 rows
and 1500 bytes; when a page has more, the phone ends it with `N more`):

| Bytes | Field |
|---|---|
| 1 | `kind`: 0 header (small caps; the cursor skips it), 1 item, 2 event, 3 heading |
| 2 | `ref`: uint16, the page Select opens (items; 0 = none, drawn muted) |
| 4 | `start`: int32 cruise minutes (events), −1 otherwise |
| 2 | `minutes`: uint16 duration (events) |
| 1 | `flags`: events, as in Packed events (the watch draws the star) |
| 1 + n | line 1, ≤ 39 bytes: the name, title or header text |
| 1 + m | line 2, ≤ 31 bytes: an item's sub-line, or a place heading's area |

The watch formats event times (`2:00p - 3:00p`, `Now · until 3:00p`, `All
day`) so they follow its 12/24h setting. A place page lists what's on there for
the rest of the watch day as the watch's lists show it: events and personal
entries at the venue (its aliases included) that haven't finished, with hidden
categories left out unless starred.

## Demo data

Until real cruise data is saved in settings, the phone builds a demo bundle
around the current time (`src/pkjs/demo.js`) and sends it like real data. Hold Up
on the watch's Home for the next demo variant (port/sea × light/dark). The dark
port day is an alert test: a starred event 17 minutes out and all-aboard 18
minutes out, so a reminder buzzes about 2 minutes after switching and an
all-aboard warning a minute later. A starred show at Royal Theater ends 7
minutes before that event, so the reminder shows "From" directions. The demo's variant and start time are kept for
12 hours so alert launches don't move it.
