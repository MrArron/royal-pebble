# Cruise Watch — Design

Mockups: **https://claude.ai/artifact/Sj434CSwUr27FP6z4V4Voz** (private to the owner).
Pages: "Combined direction" = the chosen watch design (light and dark rows);
"Phone settings" = the settings page; "First concepts" = rejected explorations
(A Deck Log, B Horizon, C Timeline) kept for reference.

v1.1 changes (venue table and editor, venue lines on the watch, ship directory,
centered ship time in the top bar, Mark reserved) are in `docs/DESIGN_V1_1.md`.

## Watch (Pebble Time 2)

Assumed screen 200×228, 64-color palette (every color below is in it). The mockups
are drawn at 2× (400×456); halve their pixel sizes. Mockup fonts are web stand-ins;
on the watch use the closest system fonts (bold condensed Gothic for text, a bold
numeric font such as Leco or Bitham for the countdown).

Chosen design = A's home screen and today list + B's top bar and My info card.

### Top bar (every screen)

Colored band, white text: small caps line `TUE MAR 9 · DOCKED`, large location
line (`St. Thomas`, `At Sea`, `Today`, `My Info`), ship time on the right with a
small `SHIP TIME` label. Band color by context, same in both themes:

| Context | Band | Small-caps label |
|---|---|---|
| Port day | `#005555` | `#AAFFFF` |
| Sea day / Today list | `#000055` | `#AAFFFF` |
| My info | `#555555` | `#FFFFFF` |

### Theme tokens

| Token | Light | Dark |
|---|---|---|
| background | `#FFFFFF` | `#000000` |
| text | `#000000` | `#FFFFFF` |
| muted text | `#555555` | `#AAAAAA` |
| divider | `#AAAAAA` | `#555555` |
| port accent (countdown label) | `#AA5500` | `#FFAA00` |
| sea accent ("NEXT" label, star) | `#0055AA` | `#00AAFF` |
| list cursor background / text | `#0055AA` / `#FFFFFF` | `#00AAFF` / `#000000` |
| NOW label | `#005555` | `#55FFAA` |

### Screens

- **Home, port day:** `ALL ABOARD IN` (port accent) → huge `2:13` → `1:00p ship ·
  2:00p local` (muted) → divider → next two items (`5:30p  Dinner · Main Dining`):
  upcoming starred events and personal entries first, topped up with the next
  events, shown in time order.
- **Home, sea day:** star + `NEXT · IN 20 MIN` (sea accent) → event title large
  (wraps to two lines) → `12:00p · On Air` (muted) → `Deck 4 Aft · ↓2` (muted)
  with `Route ›` (sea accent) at its right end → divider → next two items.
  Select opens the route to that event (`DESIGN_V1_1.md` §9.5); the hint shows
  only when the venue is on board. Up = My info, Down = Today, Hold Up = next
  demo variant (demo data only). The first 3 opens label the buttons for
  about 3 s (`DESIGN_V1_1.md` §9.5).
- **Today list:** rows of time column + title/venue. Same-start-time events are
  grouped: time only on the first row, dividers only between groups. In-progress
  event shows `NOW` and `ends 11:45`. Starred rows show ★. The cursor highlight is
  independent of starring.
- **My info:** labeled rows: Stateroom (large) with deck and nearest stairs, Muster
  station, Ship clock note, Last sync.
- **Schedule change** (after a re-sync moved or cancelled starred events): the
  alert screen's layout with a gray band, `SCHEDULE CHANGE` / `MOVED` (or
  `CANCELLED`, `CHECK TIMES`), the title, then `Now 9:30p · Studio B` (bold) and
  `Was 8:00p` (muted), and `1 of 3 · Down for next` at the bottom.
- **Event details** (Select on an event): top bar `Event` in the day's band
  color → title large (wraps) → venue (muted) → `1:00p - 2:00p · 1 h` (bold;
  `Any time today` if untimed) → `Reservation needed` (port accent) → divider →
  ★ `Starred` (sea accent) or `Hold Select to star` (muted). Hold Select toggles.
- **Place page** (Ship directory, top bar `Place`; `DESIGN_V1_1.md` §9.1): name
  large → `Deck 5 · Fore` → area (muted) → `Closest restroom · 30 m aft` (muted)
  and `Hold Select for its route` (sea accent) → divider → `FROM YOUR CABIN`
  (muted) → `↓1 deck · 160 m fore` (bold) → `Select for route ›` (sea accent) →
  divider → `LATER TODAY` and the events there. Select opens the route to the
  place, Hold Select the route to its closest restroom; each hint shows only
  when its route exists. An elevator bank's page has the STOPS AT deck chips and
  no restroom line.
- **Route** (top bar `Route`; `DESIGN_V1_1.md` §9.2): destination large → the
  start (`FROM YOUR CABIN`, muted) → divider → one line per step with a drawn
  sea-accent glyph (dot walk, double arrow cross the ship, elevator box, stairs,
  ring arrive) → divider → `↓1 deck · 100 m in all` (muted). The restroom route
  says `Restroom` / `CLOSEST TO ROYAL THEATER` and ends with its `Deck 5 · Fore`
  and `Same deck as Royal Theater`. Opened from Home, it ends with the event
  (`12:00p Name That Tune Trivia`, muted) instead of the summary. `Finding
  route…` while loading; `Connect your phone` / `Select tries again` with the
  phone away. Long routes scroll.

## Phone settings page

Material 3 Expressive look, hand-built CSS (no component library; must work
offline). Font Roboto Flex with a system-font fallback (it can't be fetched
offline, so bundle it or accept the fallback). Teal color scheme to match the
watch's port band:

| Role | Color |
|---|---|
| primary / on-primary | `#006A6A` / `#FFFFFF` |
| primary container / on | `#9CF1F0` / `#002020` |
| secondary container / on | `#CCE8E7` / `#051F1F` |
| tertiary container / on (personal entries) | `#D3E4FF` / `#001C38` |
| warning container / on (edited, pending) | `#FFDDB5` / `#2A1700` |
| surface / container low / container / container high | `#F4FBFA` / `#EFF5F4` / `#E9EFEE` / `#E3E9E9` |
| on-surface / on-surface variant / outline | `#161D1D` / `#3F4948` / `#6F7979` |

Shapes: cards 28px radius, pills for buttons, 12px text fields, connected segmented
buttons. Bottom navigation with five destinations; **Save** as a pill button top
right on every screen.

Screens: **Cruise** (ship/date pickers, Download, sync status incl. "schedule not
published yet", a "Changed since your last sync" card for starred events a
re-sync moved or cancelled (also shown in Events > Starred), collapsible paste-in backup with a short pointer to
`tools/cruise-sync`), **Days** (per-day cards; expanded day has local-vs-ship
offset stepper, all-aboard buffer 30/45/60 (60 by default at tender ports) or an
exact time, resulting times in
both clocks, and "Change itinerary" for skipped/added ports and changed times),
**Filters** (featured-events switch, category switches expanding to subcategory
chips, Shop off by default), **Events** (search, day chips, My entries card with
Add, star buttons), **Me** (stateroom, deck, stairs, walking distance units,
muster station, theme, reminder lead time, Always show button hints switch).
