# What a Royal Caribbean login can see

Findings from running `tools/cruise-sync/explore_account.py` against the owner's
account in September 2026 (one upcoming Harmony sailing, three
purchases: a beverage package, an arcade credit and a shore excursion). The
explorer calls each endpoint below once and writes a values-free shape report.
Re-run it before relying on anything marked *unverified*, and again on board or
after online check-in, when more fields fill in.

The phone companion never logs in (`docs/PROJECT_BRIEF.md`, To verify early), so
everything here reaches the app only through `cruise_sync.py --login` and the
paste-in backup (`docs/DATA_FORMAT.md`, `mine`). What the sync tool already
copies into the bundle is marked **In the bundle**; the rest is for a future
session to weigh.

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
  `muster`. My info fields are typed by hand today; a future session can prefill
  them (typed values should still win).
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
  and the meaning. `gangwayUp` may be when the gangway is raised, i.e. close to
  departure, which would give a real all-aboard time instead of departure minus
  a buffer. Compare with the Daily Planner on board before using it for
  countdowns.
- `portInfo[].pointsOfInterest[]` sometimes has `latitude`/`longitude` (3 of
  16 points). **In the bundle** as `lat`/`lon` of the first point with
  coordinates: approximate, but good enough for the Phase 3 sunrise/sunset
  formula in place of the built-in port table.
- `portInfo[].bazaarDayType` (`ANCHOR` / `DESTINATION`) might mark tender ports
  (Phase 3, tender-day warning). Not copied; check against a known tender port
  first.
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

## Ideas for the app (not scheduled)

Nothing here is in the brief's phases yet; ask the owner before building.

1. **Booked excursions (and other timed orders) as events.** Show `mine.orders`
   with a `time` on Today and in the day lists like a reserved, starred event,
   with the usual reminder, at `meet` when present (else `time`). Place: the
   port name from the itinerary for day `day`.
2. **Excursion-aware all-aboard.** On a port day with a booked excursion, show
   its end time next to the all-aboard countdown.
3. **Prefill My info** (deck, muster station) from `mine` when the owner hasn't
   typed them.
4. **Gangway times** as a suggested all-aboard (after checking on board what
   `gangwayUp` means) and for the Phase 3 time-ashore bar.
5. **Port coordinates** from `mine.ports` for sun reminders, falling back to the
   built-in table.
6. **Embark day:** terminal arrival appointment (`mine.arrival`) on the embark
   day's Home.
