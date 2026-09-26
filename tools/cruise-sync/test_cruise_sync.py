"""Offline tests for the logged-in part of cruise_sync.py (no network).

Run: py tools/cruise-sync/test_cruise_sync.py   (or python3 on Linux/WSL)

Replies are trimmed copies of the shapes Royal returned in September 2026
(docs/ROYAL_LOGIN_DATA.md), with made-up names, cabins and codes.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cruise_sync as cs  # noqa: E402

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

    def test_guarantee_and_no_booking(self):
        REPLIES["/v1/profileBookings/enriched/ACC1"]["payload"]["profileBookings"][1]["stateroomNumber"] = "GTY"
        try:
            self.assertIsNone(cs.fetch_mine(FakeSession(), AUTH, SHIP, DATE8)["stateroom"])
        finally:
            REPLIES["/v1/profileBookings/enriched/ACC1"]["payload"]["profileBookings"][1]["stateroomNumber"] = "1234"
        with self.assertRaises(cs.SyncError):
            cs.fetch_mine(FakeSession(), AUTH, SHIP, "20270307")


if __name__ == "__main__":
    unittest.main()
