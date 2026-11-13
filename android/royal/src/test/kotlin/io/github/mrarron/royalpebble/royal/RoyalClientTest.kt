package io.github.mrarron.royalpebble.royal

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.IOException
import java.time.Instant

/** The requests, against the made-up login fixture that royal.test.js and test_cruise_sync.py use. */
class RoyalClientTest {
    private val sleeps = mutableListOf<Long>()
    private fun client(fake: FakeRoyal) = RoyalClient(fake, sleep = { sleeps += it }, now = { Instant.parse("2026-11-13T17:00:00.123Z") })
    private val auth = RoyalAuth("t", "ACC1")
    private val expectedMine = Fixtures.json("expected-mine.json")
    private val ship = RoyalParse.Ship("HM", "Harmony of the Seas")

    private fun error(block: () -> Unit): String {
        try {
            block()
        } catch (e: RoyalException) {
            return e.message!!
        }
        fail("no RoyalException")
        error("unreachable")
    }

    @Test
    fun theSharedFixtureGivesTheExpectedMineGently() {
        val fake = FakeRoyal()
        val mine = client(fake).fetchMine(auth, "HM", "20270306", null)
        assertEquals(expectedMine.toString(), mine.toString())
        val paths = fake.calls.map { it.path }
        assertFalse("/calendar/v1/HM/orderHistory/O9" in paths)  // cancelled: never fetched
        val catalog = fake.calls.filter { "/catalog/" in it.path }
        assertEquals(1, catalog.size)
        assertTrue(catalog[0].query, Regex("(^|&)startDate=2027-03-06(&|$)").containsMatchIn(catalog[0].query))
        assertEquals(7, fake.calls.size)
        fake.calls.forEach {
            assertEquals("GET", it.method)
            assertEquals("t", it.headers["Access-Token"])
            assertEquals("ACC1", it.headers["account-id"])
            assertEquals("ACC1", it.headers["vds-id"])
            // cruise_sync.get_json's headers on every call.
            assertEquals(RoyalClient.APPKEY, it.headers["AppKey"])
            assertEquals("application/json", it.headers["Accept"])
            assertEquals(RoyalClient.USER_AGENT, it.headers["User-Agent"])
        }
        assertEquals("brand=R&includeCheckin=true", fake.calls[0].query)
        assertEquals("booking found: 2 purchases (1 timed), 2 port days", RoyalParse.mineSummary(mine))
        assertEquals(emptyList<Long>(), sleeps)
    }

    @Test
    fun partsFailSoftly() {
        var mine = client(FakeRoyal(fail = setOf("/v3/ships/voyages/HM20270306/enriched",
            "/catalog/v2/HM/categories/pt_shoreX/products/O2P"))).fetchMine(auth, "HM", "20270306", null)
        assertEquals("Royal Caribbean returned error 404.", (mine["voyageError"] as JsonPrimitive).content)
        assertNull(mine["ports"])
        val first = (mine["orders"] as JsonArray)[0] as JsonObject
        assertEquals("09:00", (first["time"] as JsonPrimitive).content)
        assertNull(first["meet"])
        mine = client(FakeRoyal(fail = setOf("/calendar/v1/HM/orderHistory"))).fetchMine(auth, "HM", "20270306", null)
        assertEquals(JsonArray(emptyList()), mine["orders"])
        assertEquals("booking found: 0 purchases (0 timed), 2 port days, purchases skipped", RoyalParse.mineSummary(mine))
    }

    @Test
    fun publicMeetingTimesSaveTheCatalogCall() {
        val acc = RoyalParse.ScheduleAcc()
        RoyalParse.addProducts(acc, Json.parseToJsonElement("""{"payload":{"products":[{"productType":{"productType":"SHOREX"},
            "productTitle":"Beach Day","productID":"X1","productLocation":{},"offering":[
            {"offeringDate":"20270309","offeringTime":"0900","meetingTime":"0845","offeringDurationInMinutes":"150"},
            {"offeringDate":"20270309","offeringTime":"1300","meetingTime":"1230","offeringDurationInMinutes":"150"}]}]}}"""))
        val fake = FakeRoyal()
        val mine = client(fake).fetchMine(auth, "HM", "20270306", RoyalParse.finishSchedule(acc))
        assertEquals(6, fake.calls.size)
        assertEquals("""{"title":"Beach Day","category":"pt_shoreX","guests":3,"date":"2027-03-09","time":"09:00","day":4,"port":"PCC","meet":"08:45","minutes":150}""",
            (mine["orders"] as JsonArray)[0].toString())
    }

    @Test
    fun noBookingForTheSailingListsTheAccountsSailings() {
        val fake = FakeRoyal()
        val err = error { client(fake).fetchMine(auth, "HM", "20270307", null) }
        assertTrue(err, err.startsWith(RoyalClient.ERR_NO_BOOKING))
        assertTrue(err, err.endsWith(" Your account has: WN 2028-01-01, HM 2027-03-06."))
        assertEquals(1, fake.calls.size)
    }

    // A family member's booking linked to the account, listed before the guest's own (made-up guests and cabins).
    private fun withLinked(profile: String?, tweak: (MutableList<Any?>) -> Unit = {}): FakeRoyal {
        val bookings = Fixtures.login["replies"]!!.let { (it as JsonObject)["/v1/profileBookings/enriched/ACC1"] }.toString()
        @Suppress("UNCHECKED_CAST")
        val tree = toKotlin(Json.parseToJsonElement(bookings)) as MutableMap<String, Any?>
        @Suppress("UNCHECKED_CAST")
        val list = (tree["payload"] as MutableMap<String, Any?>)["profileBookings"] as MutableList<Any?>
        @Suppress("UNCHECKED_CAST")
        val ownGuest = ((list[1] as MutableMap<String, Any?>)["passengers"] as MutableList<Any?>)[1] as MutableMap<String, Any?>
        ownGuest["firstName"] = "Alex"
        ownGuest["lastName"] = "Sample"
        ownGuest["birthdate"] = "1980-05-01"
        list.add(1, toKotlin(Json.parseToJsonElement("""{"shipCode":"HM","sailDate":"20270306","bookingId":"R7","passengerId":"P7",
            "stateroomNumber":"4321","deckNumber":"4","musterStation":"A1","passengers":[
            {"passengerId":"P7","firstName":"Alex","lastName":"Sample","birthdate":"2010-02-02"},
            {"passengerId":"P8","firstName":"Sam","lastName":"Sample"}]}""")))
        tweak(list)
        val replies = mutableMapOf("/v1/profileBookings/enriched/ACC1" to toJson(tree).toString())
        if (profile != null) replies["/v3/guestAccounts/ACC1"] = """{"payload":$profile}"""
        return FakeRoyal(replies = replies)
    }

    @Test
    fun aLinkedBookingOnTheSameSailingIsSetAsideForYourOwn() {
        val fake = withLinked("""{"personalInformation":{"firstName":"ALEX","lastName":"sample","birthdate":"19800501"}}""")
        val mine = client(fake).fetchMine(auth, "HM", "20270306", null)
        assertEquals("1234", (mine["stateroom"] as JsonPrimitive).content)
        assertEquals("Z9", (mine["muster"] as JsonPrimitive).content)
        assertEquals(JsonPrimitive(1), mine["otherBookings"])
        assertNull(mine["bookingUnsure"])
        val history = fake.calls.first { it.path == "/calendar/v1/HM/orderHistory" }
        assertTrue(history.query, Regex("(^|&)reservationId=R1(&|$)").containsMatchIn(history.query))
        assertEquals(8, fake.calls.size)
        assertEquals("booking found: 2 purchases (1 timed), 2 port days, 1 linked booking on this sailing set aside",
            RoyalParse.mineSummary(mine))
        // The Crown & Anchor number wins over the name.
        @Suppress("UNCHECKED_CAST")
        val loyal = withLinked("""{"personalInformation":{"firstName":"Alex","lastName":"Sample"},"loyaltyInformation":{"crownAndAnchorId":"555"}}""") { list ->
            (((list[2] as MutableMap<String, Any?>)["passengers"] as MutableList<Any?>)[1] as MutableMap<String, Any?>)["loyaltyNumber"] = "555"
            (((list[1] as MutableMap<String, Any?>)["passengers"] as MutableList<Any?>)[0] as MutableMap<String, Any?>)["loyaltyNumber"] = "777"
        }
        assertEquals("1234", (client(loyal).fetchMine(auth, "HM", "20270306", null)["stateroom"] as JsonPrimitive).content)
    }

    @Test
    fun bookingsThatCantBeToldApartKeepTheFirstMarkedUnsure() {
        var mine = client(withLinked(null)).fetchMine(auth, "HM", "20270306", null)  // no profile reply
        assertEquals("4321", (mine["stateroom"] as JsonPrimitive).content)
        assertEquals(JsonPrimitive(true), mine["bookingUnsure"])
        assertTrue(RoyalParse.mineSummary(mine).endsWith("set aside (not sure which is yours)"))
        mine = client(withLinked("""{"personalInformation":{"firstName":"Pat","lastName":"Other"}}""")).fetchMine(auth, "HM", "20270306", null)
        assertEquals("4321", (mine["stateroom"] as JsonPrimitive).content)
        assertEquals(JsonPrimitive(true), mine["bookingUnsure"])
    }

    @Test
    fun signInSendsThePasswordOnceEncodedWithTheSyncToolsHeaders() {
        val tricky = "a#b&c%d+e=f?g/h i:\u00e9"
        val fake = FakeRoyal()
        val got = client(fake).login("me@example.com", tricky)
        assertEquals("ACC1", got.accountId)
        assertEquals(mapOf("Access-Token" to Fixtures.TOKEN, "account-id" to "ACC1", "vds-id" to "ACC1"), got.headers())
        assertEquals(1, fake.calls.size)
        val c = fake.calls[0]
        assertEquals("POST", c.method)
        assertEquals(RoyalClient.LOGIN_URL, c.path)
        assertEquals(mapOf("Content-Type" to "application/x-www-form-urlencoded", "Authorization" to RoyalClient.LOGIN_CLIENT,
            "User-Agent" to RoyalClient.USER_AGENT), c.headers)
        assertEquals("grant_type=password&username=me%40example.com&password=a%23b%26c%25d%2Be%3Df%3Fg%2Fh%20i%3A%C3%A9" +
            "&scope=openid+profile+email+vdsid", c.body)
        // Nothing prints the password or the token.
        assertFalse(HttpRequest("POST", RoyalClient.LOGIN_URL, emptyMap(), c.body).toString().contains("password"))
        assertFalse(got.toString().contains(Fixtures.TOKEN))
    }

    @Test
    fun signInRefusalsReadPlainlyAndAreNeverRetried() {
        listOf((400 to """{"error":"invalid_grant"}""") to RoyalClient.ERR_LOGIN_REJECTED,
            (401 to "{}") to RoyalClient.ERR_LOGIN_REJECTED,
            (403 to "{}") to RoyalClient.ERR_LOGIN_REFUSED,
            (500 to "{}") to "Sign-in failed (error 500).",
            (200 to """{"access_token":"garbled"}""") to RoyalClient.ERR_LOGIN_TOKEN,
            (200 to "<html>") to RoyalClient.ERR_INVALID).forEach { (reply, want) ->
            val fake = FakeRoyal(login = reply)
            assertEquals(want, error { client(fake).login("me@example.com", "pw") })
            assertEquals(1, fake.calls.size)
        }
        val down = FakeRoyal(script = mapOf(1 to IOException("down")))
        assertEquals(RoyalClient.ERR_UNREACHABLE, error { client(down).login("me@example.com", "pw") })
        assertEquals(emptyList<Long>(), sleeps)
    }

    @Test
    fun getsRetryNetworkTroubleAndServerErrorsLikeTheSyncToolButNot4xx() {
        var fake = FakeRoyal(script = mapOf(1 to 503, 2 to Timeout()))
        val mine = client(fake).fetchMine(auth, "HM", "20270306", null)
        assertEquals(expectedMine.toString(), mine.toString())
        assertEquals(3, fake.calls.count { it.path.startsWith("/v1/profileBookings") })
        assertEquals(listOf(2000L, 4000L), sleeps)
        sleeps.clear()
        fake = FakeRoyal(script = mapOf(1 to 503, 2 to 502, 3 to Timeout()))
        assertEquals(RoyalClient.ERR_TIMEOUT, error { client(fake).fetchShips() })
        assertEquals(3, fake.calls.size)
        assertEquals(listOf(2000L, 4000L), sleeps)
        sleeps.clear()
        fake = FakeRoyal(script = mapOf(1 to 403))
        assertEquals(RoyalClient.ERR_REFUSED, error { client(fake).fetchShips() })
        assertEquals(1, fake.calls.size)
        fake = FakeRoyal(script = mapOf(1 to 404))
        assertEquals("Royal Caribbean returned error 404.", error { client(fake).fetchShips() })
        assertEquals(1, fake.calls.size)
        assertEquals(emptyList<Long>(), sleeps)
    }

    @Test
    fun downloadPagesThroughTheScheduleGently() {
        val page = { n: Int ->
            """{"payload":{"products":[${(0 until n).joinToString(",") {
                """{"productType":{"productType":"NON_REVENUE_SCHEDULABLE"},"productTitle":"Trivia $it","productLocation":{"locationTitle":"On Air"},
                   "offering":[{"offeringDate":"20270307","offeringTime":"1400"}]}"""
            }}]}}"""
        }
        val itinerary = """{"payload":{"sailingInfo":[{"itinerary":{"events":[{"day":1,"port":{"portName":"Port Canaveral",
            "portCode":"PCN","portType":"EMBARK","arrivalDateTime":"20270306T000000","departureDateTime":"20270306T163000"}}]}}]}}"""
        val fake = FakeRoyal(script = mapOf(1 to itinerary, 2 to page(200), 3 to page(3)))
        val bundle = client(fake).download(ship, "2027-03-06")
        assertEquals(listOf("/v3/ships/HM/sailDate/20270306", "/v3/products", "/v3/products"), fake.calls.map { it.path })
        assertEquals(listOf("", "sailingID=HM20270306&limit=200&offset=0", "sailingID=HM20270306&limit=200&offset=200"),
            fake.calls.map { it.query })
        assertEquals(listOf("format", "v", "generated", "ship", "sailDate", "itinerary", "schedule"), bundle.keys.toList())
        assertEquals("""{"format":"cruise-watch","v":1,"generated":"2026-11-13T17:00:00Z","ship":{"code":"HM","name":"Harmony of the Seas"},"sailDate":"2027-03-06"}""",
            JsonObject(bundle.filterKeys { it !in setOf("itinerary", "schedule") }).toString())
        // Titles repeat across pages ("Trivia 0".."Trivia 199", then "Trivia 0".."Trivia 2"): the repeats are one event.
        assertEquals(200, ((bundle["schedule"] as JsonObject)["events"] as JsonArray).size)

        val empty = FakeRoyal(script = mapOf(1 to """{"payload":{}}"""))
        assertEquals("Royal Caribbean has no itinerary for Harmony of the Seas on that date.", error { client(empty).download(ship, "2027-03-06") })
        assertEquals(1, empty.calls.size)
    }

    @Test
    fun downloadWithLoginSignsInFirstThenTheSailingThenMine() {
        var fake = FakeRoyal()
        val got = client(fake).downloadWithLogin(ship, "2027-03-06", "me@example.com", "pw")
        assertNull(got.mineError)
        assertTrue(fake.calls[0].path.endsWith("oauth2/access_token"))
        assertEquals("/v3/ships/HM/sailDate/20270306", fake.calls[1].path)
        assertEquals(1, ((got.bundle["schedule"] as JsonObject)["events"] as JsonArray).size)
        // The public listing had the excursion's meeting time and length: no catalog call.
        assertEquals(0, fake.calls.count { "catalog" in it.path })
        val mine = got.bundle["mine"] as JsonObject
        assertEquals("08:45", (((mine["orders"] as JsonArray)[0] as JsonObject)["meet"] as JsonPrimitive).content)
        assertEquals(expectedMine["stateroom"], mine["stateroom"])
        assertEquals("mine", got.bundle.keys.last())

        // A refused sign-in downloads nothing.
        fake = FakeRoyal(login = 401 to "{}")
        error { client(fake).downloadWithLogin(ship, "2027-03-06", "me@example.com", "bad") }
        assertEquals(1, fake.calls.size)

        // No booking: the sailing still downloads, without mine.
        fake = FakeRoyal(fail = setOf("/v1/profileBookings/enriched/ACC1"))
        val partial = client(fake).downloadWithLogin(ship, "2027-03-06", "me@example.com", "pw")
        assertEquals("Royal Caribbean returned error 404.", partial.mineError)
        assertNull(partial.bundle["mine"])
    }

    @Test
    fun shipsAndSailDates() {
        val fake = FakeRoyal(script = mapOf(
            1 to """{"payload":{"ships":[{"brand":"R","shipCode":"WN","name":"WONDER OF THE SEAS"},{"brand":"R","shipCode":"HM","name":"Harmony of the Seas"}]}}""",
            2 to """{"payload":{"voyages":[{"sailDate":"20270306"},{"sailDate":"20261212"},{"sailDate":"20250102"}]}}"""))
        val c = client(fake)
        assertEquals(listOf("HM", "WN"), c.fetchShips().map { it.code })
        assertEquals(listOf("2026-12-12", "2027-03-06"), c.fetchSailDates("HM", "2026-01-01"))
        assertEquals(listOf("/v2/ships", "/v3/ships/HM/voyages"), fake.calls.map { it.path })
    }
}

private fun toKotlin(e: kotlinx.serialization.json.JsonElement): Any? = when (e) {
    is JsonObject -> e.mapValuesTo(LinkedHashMap()) { toKotlin(it.value) }
    is JsonArray -> e.mapTo(ArrayList()) { toKotlin(it) }
    else -> e
}
