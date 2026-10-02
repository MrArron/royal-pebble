# What a Royal Caribbean login can see

Findings from running `tools/cruise-sync/explore_account.py` against the owner's
account in September 2026 (one upcoming Harmony sailing, three
purchases: a beverage package, an arcade credit and a shore excursion). The
explorer calls each endpoint below once and writes a values-free shape report.
Re-run it before relying on anything marked *unverified*, and again on board or
after online check-in, when more fields fill in.

Everything here reaches the app through `cruise_sync.py --login` and the
paste-in backup, or through the settings page's Advanced download, where the
phone companion signs in once and makes the same calls (`royal.fetchMine`, from
1.4.7; `docs/DATA_FORMAT.md`, `mine`). What the sync tool already
copies into the bundle is marked **In the bundle**; the rest is not used.

All endpoints are on `aws-prd.api.rccl.com` with headers `AppKey`,
`Access-Token` and `account-id` / `vds-id` (the token's `sub`). Commerce paths
start with `/en/royal/web/commerce-api`. Endpoint knowledge comes from
jdeath/CheckRoyalCaribbeanPrice (MIT).

## Endpoints and what they hold

| # | Endpoint | Worked | Useful contents |
|---|---|---|---|
| 1 | `/en/royal/web/v3/guestAccounts/{accountId}` | yes | Name, birth date, contact details, loyalty tiers. Nothing the app needs. |
| 2 | `/en/royal/web/v1/guestAccounts/loyalty/info` | yes | Crown & Anchor tier and points, co-brand card points. Not needed. |
| 3 | `/en/royal/web/v1/guestAccounts/loyalty/history/summary?loyaltyNumber=` | yes | Total nights and trips. Not needed. |
| 4 | `/v1/profileBookings/enriched/{accountId}?brand=R&includeCheckin=true` | yes | Every booking: ship, sail date, stateroom, **deck**, **muster station**, passengers (with a terminal **arrival time** after check-in), paid in full, booking status. |
| 5 | `/en/royal/web/v3/ships/voyages/{ship}{YYYYMMDD}/enriched` | yes | Sailing details: per-port **gangway down/up times**, port **points of interest with coordinates**, embark port **time zone** and terminal (address, coordinates), check-in window, health questionnaire window. |
| 6 | `commerce-api/cart/v1/obc/reservations/{reservationId}` | yes | Onboard credit amount and currency. |
| 7 | `commerce-api/catalog/v2/promotions/list` | no reply | Timed out once; not needed. |
| 8 | `commerce-api/calendar/v1/{ship}/orderHistory` | yes | Orders (mine and ones others booked for me) with totals and status. |
| 9 | `commerce-api/calendar/v1/{ship}/orderHistory/{orderCode}` | yes | Each order's items: title, category, the **booked session** (date, time, cruise day, port), guests and prices. |
| 10 | `commerce-api/catalog/v2/{ship}/categories/{category}/products/{product}` | yes | The product page: description, what to wear/bring, age limits, duration, and every offering with **meeting time** and **end time**. |

## Findings

### Booked excursions carry their time (answers the brief's open question)

- Order items have `offering.dateTime` (`YYYY-MM-DDTHH:MM:SS`, apparently
  ship/port-local like the schedule), `offering.dayOfCruise` (1 = embark day),
  `portCode` and `portLocation`. Seen on a shore excursion
  (`productTypeCategory.id` `pt_shoreX`, `salesUnit` `PER_SEAT`,
  `variantType` `TimeBasedVariant`). **In the bundle** as `date`, `time`, `day`
  and `port` on the order.
- Packages and credits (`pt_beverage` `PER_DAY`, `pt_arcades` `PER_PACKAGE`)
  have every offering field `null`. **In the bundle** without a time.
- In the order, `meetingTime`, `endDateTime` and `meetingLocation` were `null`.
  The product's catalog page lists offerings with `meetingTime` and
  `endDateTime` filled in, and `durationInMins`. The sync tool fetches that page
  only for timed orders and matches the booked offering by `id` (form
  `CODE-HMYYYYMMDD-A`) or `dateTime`. **In the bundle** as `meet`, `end` and
  `minutes`. *Unverified:* whether the catalog page's offering for the booked
  session is always the one returned; `meetingLocation` was `null` everywhere.
- *Unverified:* dining, shows, spa and other timed bookings. Probably the same
  `offering` fields; other categories should appear as `pt_dining` and similar.
  Book one and re-run the explorer to check.
- **To check (owner, 2026-09-28): the main dining room assignment.** Royal
  assigns every stateroom a dining room (on the SeaPass and in the Royal app).
  Once the owner's Dec 12 sailing has its schedule (about two weeks before),
  re-run the explorer and look for it in the booking (`profileBookings`) and
  the voyage data. If it's there, add it to `mine` in both producers
  (`docs/DATA_FORMAT.md`) and let the Advanced download fill Me's Main dining
  room like muster (`From booking`). Until then it's typed in (1.4.8). On the
  freeze checklist in `docs/PLAN.md`.
- An order's `guests` can include people from **other staterooms and
  bookings** (a group booking listed a third guest with a different cabin and
  reservation id). The bundle's `guests` counts them all.
- Cancelled guests have `orderStatus: CANCELLED`; the sync tool drops those and
  cancelled orders and items.
- Prices come with a lot of `-999.99` placeholders (`discount`, `bonus`,
  `onboardCredit`, `refund`). Use `totalPrice.value` or the guest's
  `priceDetails.total` if prices are ever needed.

### Cabin details for My info

- The booking has `deckNumber` and `musterStation` (seen on one of two
  bookings, presumably once a cabin is assigned). **In the bundle** as `deck` and
  `muster`. The Me tab fills them from the booking when empty (1.3.3); a hand
  edit still wins.
- `passengers[].arrivalTime` (terminal arrival appointment) is empty until
  online check-in. **In the bundle** as `arrival` when set. *Unverified format*;
  the sync tool converts common time spellings to `HH:MM` and otherwise keeps
  Royal's text.
- `hasFlight`, `onlineCheckinStatus` (empty before check-in),
  `passengersInStateroom` (cabin mates' names and ages) are also there. Not
  copied: the app has no use for them and they are personal.

### Port days (all-aboard, time ashore, sun reminders)

- `itinerary.portInfo[]` has `gangwayDown` and `gangwayUp` on port days (4 of 8
  days on a 7-night sailing; not on sea, embark or debark days). **In the
  bundle** under `ports` by cruise day. *Unverified:* the format (not a plain
  `HH:MM` or ISO time; the sync tool keeps Royal's text when it can't read it)
  and the meaning. A readable `gangwayUp` is the day's all-aboard by default
  (Phase 3 item 23), shifted in 5-minute steps on the Days tab. Still to check
  against the Daily Planner on board that it's when you must be back.
- `portInfo[].pointsOfInterest[]` sometimes has `latitude`/`longitude` (3 of
  16 points). **In the bundle** as `lat`/`lon` of the first point with
  coordinates: approximate, but good enough for the sunrise/sunset formula
  (sun reminders, now a future concept in the brief) in place of the built-in
  port table.
- `portInfo[].bazaarDayType` (`ANCHOR` / `DESTINATION`) might mark tender ports.
  Not copied: the app treats a day as a tender day when the itinerary's day type
  contains `TENDER`. Check against a known tender port first.
- `departurePortInformation.timeZoneName` gives the embark port's time zone.
  **In the bundle** as `embarkTimeZone`. Might help the ship-time default; port
  time zones per day are not listed.
- `departurePortInformation.terminals[]` has the terminal's address and
  coordinates. Not copied; a candidate for the Later "back to the ship" pin.

### Other data

- Onboard credit amount (endpoint 6): a starting balance for the Later
  spending log. Not copied.
- The catalog page also has `whatToWear`, `whatToBring`, `importantNote`,
  `highlights`, age `restrictions` and `activityLevel`. A future excursion
  details screen could show a short "bring" line; not copied (long text).
- `smartShipCapabilities`, check-in and health questionnaire windows: not
  needed at sea.

## How the app uses it

Built in Phase 3 (`docs/PROJECT_BRIEF.md`, items 22-24; screens in
`docs/DESIGN.md`): booked excursions and other timed orders on Today with
reminders (§7.7), the excursion's end on the port-day bar (§4.2), the Me tab
prefilled from the booking (§12.6), gangway times as the default all-aboard
(§12.3), and the terminal arrival card on embark day (§4.3). Port coordinates
are kept for sun reminders, a future concept in the brief.
