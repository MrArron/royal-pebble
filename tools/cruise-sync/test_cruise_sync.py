"""Offline tests for cruise_sync.py (no network).

Run: py tools/cruise-sync/test_cruise_sync.py   (or python3 on Linux/WSL)

Logged-in replies are trimmed copies of the shapes Royal returned in September
2026 (docs/ROYAL_LOGIN_DATA.md), with made-up names, cabins and codes. The
schedule fixture in test/fixtures is public products trimmed from a live
Harmony pull; test/pkjs/royal.test.js checks the phone's producer against the
same expected schedule.
"""

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cruise_sync as cs  # noqa: E402

FIXTURES = Path(__file__).resolve().parents[2] / "test" / "fixtures"

AUTH = {"Access-Token": "t", "account-id": "ACC1", "vds-id": "ACC1"}
SHIP, DATE8 = "HM", "20270306"
EXC_OFFERING = "ZZX1-HM20270306-A"


def order(code, category, title, offering, guests=2, status="BOOKED"):
    return {"payload": {"orderCode": code, "status": status, "orderHistoryDetailItems": [{
        "status": status,
        "productSummary": {"title": title, "productTypeCategory": {"id": category},
                           "baseOptions": [{"selected": {"code": code + "P"}}]},
        "offering": offering,
        "guests": [{"orderStatus": status, "reservationId": "R1"} for _ in range(guests)]}]}}


REPLIES = {
    "/v1/profileBookings/enriched/ACC1": {"payload": {"profileBookings": [
        {"shipCode": "WN", "sailDate": "20280101", "bookingId": "R0", "passengerId": "P0"},
        {"shipCode": SHIP, "sailDate": DATE8, "bookingId": "R1", "passengerId": "P1",
         "stateroomNumber": "1234", "deckNumber": "12", "musterStation": "Z9",
         "passengers": [{"passengerId": "P2", "arrivalTime": "10:00 AM"},
                        {"passengerId": "P1", "arrivalTime": "11:30 AM"}]}]}},
    f"/v3/ships/voyages/{SHIP}{DATE8}/enriched": {"payload": {"sailingInfo": [{
        "departurePortInformation": {"timeZoneName": "America/New_York"},
        "itinerary": {"portInfo": [
            {"day": 1, "portCode": "PCN", "pointsOfInterest": []},
            {"day": 3, "portCode": "NAS", "gangwayDown": "7:00 AM", "gangwayUp": "1630",
             "pointsOfInterest": [{"title": "a"}, {"title": "b", "latitude": 25.0781234, "longitude": -77.3412}]},
            {"day": 4, "portCode": "PCC", "gangwayUp": "see daily planner"}]}}]}},
    f"/calendar/v1/{SHIP}/orderHistory": {"payload": {
        "myOrders": [{"orderCode": "O1"}, {"orderCode": "O2"}, {"orderCode": "O9", "status": "CANCELLED"}],
        "ordersOthersHaveBookedForMe": [{"orderCode": "O3"}]}},
    f"/calendar/v1/{SHIP}/orderHistory/O1": order("O1", "pt_beverage", "Deluxe Beverage Package", {"id": "x"}),
    f"/calendar/v1/{SHIP}/orderHistory/O2": order("O2", "pt_shoreX", "Beach ® Day", {
        "id": EXC_OFFERING, "dateTime": "2027-03-09T09:00:00", "dayOfCruise": 4, "portCode": "PCC"}, guests=3),
    f"/calendar/v1/{SHIP}/orderHistory/O3": order("O3", "pt_arcades", "Arcade Credit", {"id": "y"}, status="CANCELLED"),
    f"/catalog/v2/{SHIP}/categories/pt_shoreX/products/O2P": {"payload": {"durationInMins": 150, "bookingOfferingData": {
        "offerings": [{"id": "other", "dateTime": "2027-03-10T09:00:00", "meetingTime": "2027-03-10T08:30:00"},
                      {"id": EXC_OFFERING, "dateTime": "2027-03-09T09:00:00",
                       "meetingTime": "2027-03-09T08:45:00", "endDateTime": "2027-03-09T11:30:00"}]}}},
}


class Reply:
    def __init__(self, status, body):
        self.status_code, self._body = status, body

    def json(self):
        return self._body


class FakeSession:
    def __init__(self, fail=()):
        self.fail, self.calls = fail, []

    def request(self, method, url, params=None, headers=None, data=None, timeout=None):
        path = url.replace(cs.COMMERCE, "").replace(cs.API + "/en/royal/web", "").replace(cs.API, "")
        self.calls.append(path)
        assert headers["Access-Token"] == "t" and method == "GET"
        if path in self.fail or path not in REPLIES:
            return Reply(404, {})
        return Reply(200, REPLIES[path])


class HhmmTest(unittest.TestCase):
    def test_spellings(self):
        for raw, want in (("2027-03-09T07:05:00", "07:05"), ("20270309T173000", "17:30"), ("7:00 AM", "07:00"),
                          ("12:15 pm", "12:15"), ("12:15 AM", "00:15"), ("17:30", "17:30"), ("1730", "17:30"),
                          ("5:30 p.m.", "17:30"), ("", None), (None, None), ("see planner", None), ("2575", None)):
            self.assertEqual(cs.hhmm(raw), want, raw)


class FetchMineTest(unittest.TestCase):
    def setUp(self):
        self.sess = FakeSession()
        self.mine = cs.fetch_mine(self.sess, AUTH, SHIP, DATE8)

    def test_cabin_details(self):
        m = self.mine
        self.assertEqual((m["stateroom"], m["deck"], m["muster"], m["arrival"]), ("1234", "12", "Z9", "11:30"))
        self.assertEqual(m["embarkTimeZone"], "America/New_York")

    def test_ports(self):
        self.assertEqual(self.mine["ports"], [
            {"day": 3, "code": "NAS", "gangwayDown": "07:00", "gangwayUp": "16:30", "lat": 25.0781, "lon": -77.3412},
            {"day": 4, "code": "PCC", "gangwayUp": "see daily planner"}])

    def test_orders(self):
        self.assertEqual(self.mine["orders"], [
            {"title": "Beach Day", "category": "pt_shoreX", "guests": 3, "date": "2027-03-09", "time": "09:00",
             "day": 4, "port": "PCC", "meet": "08:45", "end": "11:30", "minutes": 150},
            {"title": "Deluxe Beverage Package", "category": "pt_beverage", "guests": 2}])

    def test_gentle_requests(self):
        # cancelled order O9 is never fetched; the catalog is asked only for the timed booking
        self.assertNotIn(f"/calendar/v1/{SHIP}/orderHistory/O9", self.sess.calls)
        self.assertEqual(sum("/catalog/" in c for c in self.sess.calls), 1)
        self.assertEqual(len(self.sess.calls), 7)

    def test_parts_fail_softly(self):
        sess = FakeSession(fail={f"/v3/ships/voyages/{SHIP}{DATE8}/enriched",
                                 f"/catalog/v2/{SHIP}/categories/pt_shoreX/products/O2P"})
        mine = cs.fetch_mine(sess, AUTH, SHIP, DATE8)
        self.assertIn("voyageError", mine)
        self.assertNotIn("ports", mine)
        self.assertEqual(mine["orders"][0]["time"], "09:00")
        self.assertNotIn("meet", mine["orders"][0])

    def test_public_meeting_time(self):
        # The public listing has the booked excursion's session: no catalog call.
        sched = schedule([product(productType={"productType": "SHOREX"}, productTitle="Beach Day", productID="X1",
                                  productLocation={}, offering=[
                                      {"offeringDate": "20270309", "offeringTime": "0900", "meetingTime": "0845",
                                       "offeringDurationInMinutes": "150"},
                                      {"offeringDate": "20270309", "offeringTime": "1300", "meetingTime": "1230",
                                       "offeringDurationInMinutes": "150"}])])
        sess = FakeSession()
        mine = cs.fetch_mine(sess, AUTH, SHIP, DATE8, sched)
        self.assertEqual(sum("/catalog/" in c for c in sess.calls), 0)
        self.assertEqual(len(sess.calls), 6)
        self.assertEqual(mine["orders"][0], {"title": "Beach Day", "category": "pt_shoreX", "guests": 3,
                                             "date": "2027-03-09", "time": "09:00", "day": 4, "port": "PCC",
                                             "meet": "08:45", "minutes": 150})

    def test_public_times_no_guessing(self):
        # Listed twice (two venues): left out, so the catalog is asked.
        two = [product(productType={"productType": "SHOREX"}, productTitle="Beach Day", productID="X1",
                       productLocation={"locationTitle": t}, offering=[
                           {"offeringDate": "20270309", "offeringTime": "0900", "meetingTime": "0845",
                            "offeringDurationInMinutes": "150"}]) for t in ("A", "B")]
        self.assertEqual(cs.public_excursion_times(schedule(two)), {})
        self.assertEqual(cs.public_excursion_times(None), {})
        sess = FakeSession()
        mine = cs.fetch_mine(sess, AUTH, SHIP, DATE8, schedule(two))
        self.assertEqual(sum("/catalog/" in c for c in sess.calls), 1)
        self.assertEqual(mine["orders"][0]["end"], "11:30")

    def test_guarantee_and_no_booking(self):
        REPLIES["/v1/profileBookings/enriched/ACC1"]["payload"]["profileBookings"][1]["stateroomNumber"] = "GTY"
        try:
            self.assertIsNone(cs.fetch_mine(FakeSession(), AUTH, SHIP, DATE8)["stateroom"])
        finally:
            REPLIES["/v1/profileBookings/enriched/ACC1"]["payload"]["profileBookings"][1]["stateroomNumber"] = "1234"
        with self.assertRaises(cs.SyncError):
            cs.fetch_mine(FakeSession(), AUTH, SHIP, "20270307")


def product(**extra):
    p = {"productType": {"productType": "NON_REVENUE_SCHEDULABLE"}, "productTitle": "Trivia", "productID": "P1",
         "productLocation": {"locationCode": "ONAIR", "locationTitle": "On Air"},
         "offering": [{"offeringDate": "20261002", "offeringTime": "1400", "offeringDurationInMinutes": "45"}]}
    p.update(extra)
    return p


def schedule(products, page=None):
    acc = cs.new_schedule_acc()
    page = page or len(products)
    for i in range(0, len(products), page):
        cs.add_products(acc, products[i:i + page])
    return cs.finish_schedule(acc)


class ScheduleTest(unittest.TestCase):
    """Keep in step with test/pkjs/royal.test.js."""

    def test_shared_fixture(self):
        products = json.loads((FIXTURES / "products-HM-sample.json").read_text(encoding="utf-8"))
        expected = json.loads((FIXTURES / "expected-schedule.json").read_text(encoding="utf-8"))
        self.assertEqual(schedule(products), expected)
        self.assertEqual(schedule(products, 7), expected)
        self.assertEqual(cs.schedule_summary(expected),
                         "51 events (9 shore excursion sessions): 18 with age limits, 23 arrive early, 25 with notes")

    def test_restriction_age(self):
        self.assertEqual(cs.restriction_age("Minimum 18 years old"), [18, None])
        self.assertEqual(cs.restriction_age("Maximum 17 years old"), [None, 17])
        self.assertEqual(cs.restriction_age("13 to 17 years old"), [13, 17])
        self.assertIsNone(cs.restriction_age("Guests 16 and under must be accompanied by a parent or guardian"))
        self.assertIsNone(cs.restriction_age("Children 12 years old and under must be  supervised by parent"))

    def test_text_age(self):
        for text, want in (("After-Party With Resident DJ (18+)", [18, None]), ("Karaoke: Teens (13-17)", [13, 17]),
                           ("Social100 (Ages 13-17)", [13, 17]), ("Junior Cruisers Curfew (17 & Under)", [None, 17]),
                           ("Hideaway Beach (Adults-Only) — Day Pass", [18, None]),
                           ('Family Movie: "Shrek" (PG)', None), ("Adventure Ocean Theater", None), ("", None)):
            self.assertEqual(cs.text_age(text), want, text)

    def test_age_of(self):
        teen = product(restrictions=[{"restrictionType": "age", "restrictionDisplayText": "Minimum 13 years old"},
                                     {"restrictionType": "age", "restrictionDisplayText": "Maximum 17 years old"}])
        self.assertEqual(cs.age_of(teen, "Teen Open House (13-17)", "Social100 (Ages 13-17)"), [13, 17])
        self.assertEqual(cs.age_of(product(experiences=[{"experienceID": "ages/age18"}]), "Quest", ""), [18, None])
        adult = product(restrictions=[{"restrictionType": "age", "restrictionDisplayText": "Minimum 18 years old"}])
        self.assertEqual(cs.age_of(adult, "Show (21+)", ""), [21, None])
        family = product(experiences=[{"experienceID": "ages/funforall"}], advisements=[
            {"advisementID": "kbyg/general/over21", "advisementTitle": "Guests purchasing alcohol must be of legal age"}])
        self.assertIsNone(cs.age_of(family, "Family Bingo", "Adventure Ocean Theater"))

    def test_early_of(self):
        o = {"offeringTime": "2000"}
        a15 = [{"advisementTitle": "Arrive 15 minutes early"}]
        self.assertEqual(cs.early_of(product(productDuration={"leadTimeInMinutes": 10}, advisements=a15), o), 10)
        self.assertEqual(cs.early_of(product(productDuration={"leadTimeInMinutes": 0}, advisements=a15), o), 15)
        self.assertEqual(cs.early_of(product(productDuration={"leadTimeInMinutes": 200}), o), 120)
        self.assertEqual(cs.early_of(product(advisements=[{"advisementTitle": "Sign up at the venue 15 minutes "
                                                                              "before the activity starts"}]), o), 15)
        self.assertIsNone(cs.early_of(product(advisements=[
            {"advisementTitle": "Doors are open for guests with reservations 45 minutes prior to show time."},
            {"advisementTitle": "Early arrival is recommended"}]), o))
        self.assertIsNone(cs.early_of(product(productDuration={"leadTimeInMinutes": 10}), {"offeringTime": "0000"}))

    def test_early_of_excursion(self):
        p = product(productType={"productType": "SHOREX"}, productDuration={"leadTimeInMinutes": 30})
        self.assertEqual(cs.early_of(p, {"offeringTime": "0900", "meetingTime": "0845"}), 15)
        self.assertEqual(cs.early_of(p, {"offeringTime": "1400", "meetingTime": "0700"}), 240)
        for meet in ("0900", None):
            self.assertIsNone(cs.early_of(p, {"offeringTime": "0900", "meetingTime": meet}))
        self.assertIsNone(cs.early_of(p, {"offeringTime": "0000", "meetingTime": "2345"}))

    def test_notes_of(self):
        notes = cs.notes_of(product(
            productShortDescription="Trivia",
            restrictions=[{"restrictionType": "age", "restrictionID": "age/min",
                           "restrictionDisplayText": "Minimum 18 years old"},
                          {"restrictionType": "age", "restrictionID": "age/13guardian",
                           "restrictionDisplayText": "Children 12 years old and under must be  supervised"}],
            advisements=[{"advisementID": "kbyg/general/IMAGEILLUS", "advisementTitle": "Images are illustrative only"},
                         {"advisementID": "kbyg/general/FEE", "advisementTitle": "This activity has a fee"},
                         {"advisementID": "kbyg/fee-applies", "advisementTitle": "Fee applies"},
                         {"advisementID": "legal", "advisementTitle": "x" * 121},
                         {"advisementID": "kbyg/Children12",
                          "advisementTitle": "Children 12 years old and under must be supervised"},
                         {"advisementID": "kbyg/seapass", "advisementTitle": "Please bring your SeaPass®"}],
            isWaiverRequired=True), "Trivia")
        self.assertEqual(notes, [["age/13guardian", "Children 12 years old and under must be supervised"],
                                 ["kbyg/seapass", "Please bring your SeaPass"],
                                 ["waiver", "Signed waiver required"]])
        disclaimer = [["kbyg/flowrdr/WARNDISCLAIM", "Signed warning disclaimer required"]]
        self.assertEqual(cs.notes_of(product(advisements=[
            {"advisementID": disclaimer[0][0], "advisementTitle": disclaimer[0][1]}], isWaiverRequired=True),
            "Trivia"), disclaimer)

    def test_short_descriptions(self):
        def kept(title, text):
            return len(cs.notes_of(product(productShortDescription=text), title)) == 1
        self.assertTrue(kept("Dance Fitness", "Dance Fitness with your Cruise Director's Staff (Meet by the Car)"))
        self.assertTrue(kept("Effective Fat Burning", "Seminar: Burn Fat Fast"))
        self.assertTrue(kept("World’s Sexiest Man Competition: Adults (18+)", "World's Sexiest Man Competition:Sign Ups"))
        for title, text in (("Celebrity Heads", "Game: Celebrity Heads"),
                            ("Game Show: The Crazy Quest- Adults (18+)", "Adult Game Show: The Quest"),
                            ("Guess the Weight of the Sculpture", "Guess the Weight of the Sculpture Competition"),
                            ("Knockout Basketball Competition", "Basketball Knockout Competition"),
                            ("Pure-Form Pilates", "Pure Form Pilates")):
            self.assertFalse(kept(title, text), text)

    def test_old_shaped_product(self):
        s = schedule([product(productID=None, productLocation={"locationTitle": "On Air"})])
        self.assertEqual((s["venues"], s["venueCodes"], s["notes"], s["infos"]), (["On Air"], [None], [], []))
        self.assertEqual(s["events"][0][10:], [None, None])

    def test_venue_codes_and_excursions(self):
        s = schedule([
            product(productLocation={"locationCode": "VINT", "locationTitle": None}),
            product(productTitle="Bingo", productLocation={"locationCode": None, "locationTitle": ""}),
            product(productTitle="Kayak", productType={"productType": "SHOREX"},
                    productCategory=[{"categoryName": "shorex", "childCategory": [{"items": {"categoryName": "PCC"}}]}],
                    productLocation={"locationCode": "PCC", "locationTitle": "Perfect Day CocoCay"},
                    offering=[{"offeringDate": "20261002", "offeringTime": "0900", "meetingTime": "0845"}])])
        self.assertEqual(s["venues"], ["", "", "Perfect Day CocoCay"])
        self.assertEqual(s["venueCodes"], ["VINT", None, "PCC"])
        self.assertEqual(s["cats"][s["events"][0][2]], ["Shore excursions", ""])
        self.assertEqual(s["events"][0][8:11], [1, None, 0])
        self.assertEqual(s["infos"][0], [None, 15, []])


class DumpProductsTest(unittest.TestCase):
    def test_report(self):
        text = cs.products_report([
            product(),
            product(productTitle="Bingo", productID="P2", productLocation={"locationCode": "ONAIR", "locationTitle": "Studio"}),
            product(productTitle="Bingo", productID="P3", productLocation={"locationCode": "VINT", "locationTitle": None}),
            product(productTitle="Massage", productType={"productType": "SPA"}, productID="S1")])
        self.assertIn("  NON_REVENUE_SCHEDULABLE: 3\n  SPA: 1\n", text)
        self.assertIn(" *ONAIR: On Air x2; Studio x1\n", text)
        self.assertIn("  VINT: (blank) x1\n", text)
        self.assertIn(" *Bingo: P2, P3\n", text)
        self.assertNotIn("Massage:", text)  # not a schedule type
        self.assertIn("  offeringTime: 4\n", text)
        self.assertNotIn("Compared", text)

    def test_compare(self):
        old = [product(), product(productTitle="Bingo", productID="P2"), product(productTitle="Gone", productID="P4")]
        new = [product(), product(productTitle="Bingo", productID="P9"), product(productTitle="New", productID="P5")]
        self.assertEqual(cs.compare_ids(old, new), [
            "Titles in both pulls: 2; same productID: 1; changed: 1; only in the earlier pull: 1; only in this pull: 1",
            "  changed  Bingo: P2 -> P9", "  gone     Gone", "  new      New"])

    def test_dump_compares_with_newest_earlier(self):
        import datetime as dt
        import tempfile
        ship = {"shipCode": "HM", "name": "Harmony of the Seas"}
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            cs.dump_products(d, ship, DATE8, [product(productID="P0")], dt.datetime(2026, 9, 26, 9, 0))
            cs.dump_products(d, ship, DATE8, [product()], dt.datetime(2026, 9, 27, 9, 0))
            raw, report = cs.dump_products(d, ship, DATE8, [product()], dt.datetime(2026, 9, 30, 9, 5))
            self.assertEqual(raw.name, f"royal-pebble-products-HM-{DATE8}-pulled-20260930-0905.json")
            self.assertEqual(json.loads(raw.read_text(encoding="utf-8"))["products"], [product()])
            text = report.read_text(encoding="utf-8")
            self.assertTrue(text.startswith(f"Harmony of the Seas (HM), sailing {DATE8}, pulled 2026-09-30 09:05\n"))
            self.assertIn("Compared with the earlier pull (2026-09-27 09:00):\nTitles in both pulls: 1; same productID: 1;",
                          text)


if __name__ == "__main__":
    unittest.main()
