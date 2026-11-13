package io.github.mrarron.royalpebble.royal

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The parsing half of the port, against the expected outputs that the JS and
 * the sync tool are tested on. Outputs are compared as JSON text, so they match
 * JSON.stringify byte for byte (key order, 150 not 150.0, nulls kept).
 */
class RoyalParseTest {
    private val products = Fixtures.json("products-HM-sample.json") as JsonArray
    private val expected = Fixtures.json("expected-schedule.json")

    private fun schedule(pageSize: Int = products.size): JsonObject {
        val acc = RoyalParse.ScheduleAcc()
        products.chunked(pageSize).forEach { page ->
            RoyalParse.addProducts(acc, JsonObject(mapOf("payload" to JsonObject(mapOf("products" to JsonArray(page))))))
        }
        return RoyalParse.finishSchedule(acc)
    }

    @Test
    fun sharedFixtureGivesTheExpectedScheduleInPagesToo() {
        assertEquals(expected.toString(), schedule().toString())
        assertEquals(expected.toString(), schedule(7).toString())
    }

    @Test
    fun summaryLine() {
        assertEquals("51 events (9 shore excursion sessions): 18 with age limits, 23 arrive early, 25 with notes",
            RoyalParse.scheduleSummary(expected))
    }

    @Test
    fun itineraryLikeTheJs() {
        // Expected text from src/pkjs/royal.js parseItinerary on the same reply (node, 2026-11-13).
        val reply = Json.parseToJsonElement("""{"payload":{"sailingInfo":[{"itinerary":{"events":[
            {"day":1,"port":{"portName":"Orlando (Port Canaveral), Fl","portCode":"PCN","portType":"EMBARK","arrivalDateTime":"20261212T000000","departureDateTime":"20261212T160000"}},
            {"day":2,"port":{"portName":"Cruising","portType":"CRUISING","arrivalDateTime":"20261213T000000","departureDateTime":"20261213T235900"}},
            {"day":3,"port":{"portName":"Nassau, Bahamas","portCode":"NAS","portType":"PORT","arrivalDateTime":"20261214T070000","departureDateTime":"20261214T170000"}},
            {"port":{"portName":"Perfect Day at CocoCay\u00ae","portCode":"CCY","portType":"PORT","arrivalDateTime":"2026121","departureDateTime":null}},
            {"day":8,"port":{"portName":"Orlando","portCode":"PCN","portType":"DEBARK","arrivalDateTime":"20261219T063000","departureDateTime":"20261219T000000"}}]}}]}}""")
        assertEquals("""[{"day":1,"date":"2026-12-12","port":"Orlando (Port Canaveral), Fl","code":"PCN","type":"EMBARK","arrive":null,"depart":"16:00"},{"day":2,"date":"2026-12-13","port":"Cruising","type":"CRUISING","arrive":null,"depart":null},{"day":3,"date":"2026-12-14","port":"Nassau, Bahamas","code":"NAS","type":"PORT","arrive":"07:00","depart":"17:00"},{"date":null,"port":"Perfect Day at CocoCay","code":"CCY","type":"PORT","arrive":null,"depart":null},{"day":8,"date":"2026-12-19","port":"Orlando","code":"PCN","type":"DEBARK","arrive":"06:30","depart":null}]""",
            RoyalParse.parseItinerary(reply).toString())
        assertEquals(0, RoyalParse.parseItinerary(Json.parseToJsonElement("{}")).size)
    }

    @Test
    fun shipsAndText() {
        val ships = RoyalParse.parseShips(Json.parseToJsonElement("""{"payload":{"ships":[
            {"brand":"R","shipCode":"HM","name":"HARMONY OF THE SEAS"},{"brand":"C","shipCode":"XX","name":"Celebrity X"},
            {"brand":"R","shipCode":"IC","name":"Icon of the Seas\u00ae"}]}}"""))
        assertEquals(listOf(RoyalParse.Ship("HM", "Harmony of the Seas"), RoyalParse.Ship("IC", "Icon of the Seas")), ships)
        // As the JS: tabs and newlines go with the other non-printing characters.
        assertEquals("Cafe \"Latte\" - tabherenew...", RoyalParse.clean("Caf\u00e9 \u201cLatte\u201d\u00a0\u2014 tab\there\nnew\u2026 \u2122"))
        assertEquals(listOf("2026-12-12", "2027-01-02"), RoyalParse.parseSailDates(
            """{"a":[{"sailDate":"20270102"},{"sailDate" : "20261212"},{"sailDate":"20261212"},{"sailDate":"20250101"}]}""", "2026-01-01"))
    }

    @Test
    fun ageRestrictionWordings() {
        assertEquals(RoyalParse.Age(18, null), RoyalParse.restrictionAge("Minimum 18 years old"))
        assertEquals(RoyalParse.Age(null, 17), RoyalParse.restrictionAge("Maximum 17 years old"))
        assertEquals(RoyalParse.Age(13, 17), RoyalParse.restrictionAge("13 to 17 years old"))
        assertNull(RoyalParse.restrictionAge("Guests 16 and under must be accompanied by a parent or guardian"))
        assertNull(RoyalParse.restrictionAge("Children 12 years old and under must be  supervised by parent"))
    }

    @Test
    fun agePatternsInTitlesAndVenues() {
        assertEquals(RoyalParse.Age(18, null), RoyalParse.textAge("After-Party With Resident DJ (18+)"))
        assertEquals(RoyalParse.Age(13, 17), RoyalParse.textAge("Karaoke: Teens (13-17)"))
        assertEquals(RoyalParse.Age(13, 17), RoyalParse.textAge("Social100 (Ages 13-17)"))
        assertEquals(RoyalParse.Age(null, 17), RoyalParse.textAge("Junior Cruisers Curfew (17 & Under)"))
        assertEquals(RoyalParse.Age(18, null), RoyalParse.textAge("Hideaway Beach (Adults-Only) \u2014 Day Pass"))
        assertNull(RoyalParse.textAge("Family Movie: \"Shrek\" (PG)"))
        assertNull(RoyalParse.textAge("Adventure Ocean Theater"))
        assertNull(RoyalParse.textAge(""))
    }

    @Test
    fun timeSpellingsLikeTheSyncTool() {
        listOf("2027-03-09T07:05:00" to "07:05", "20270309T173000" to "17:30", "7:00 AM" to "07:00", "12:15 pm" to "12:15",
            "12:15 AM" to "00:15", "17:30" to "17:30", "1730" to "17:30", "5:30 p.m." to "17:30", "" to null, null to null,
            "see planner" to null, "2575" to null, "153000" to "15:30", "073000" to "07:30", "157500" to null,
            "1530000" to null).forEach { (text, want) ->
            assertEquals(text, want, RoyalParse.hhmm(text))
        }
        assertEquals("ACC1", RoyalParse.accountOf(Fixtures.TOKEN))
        assertNull(RoyalParse.accountOf("nope"))
        assertNull(RoyalParse.accountOf(null))
    }

    @Test
    fun publicExcursionTimesLeaveOutRepeatedSessions() {
        val acc = RoyalParse.ScheduleAcc()
        RoyalParse.addProducts(acc, Json.parseToJsonElement("""{"payload":{"products":[
            {"productType":{"productType":"SHOREX"},"productTitle":"Beach Day","productLocation":{},"offering":[
              {"offeringDate":"20270309","offeringTime":"0900","meetingTime":"0845","offeringDurationInMinutes":"150"}]},
            {"productType":{"productType":"SHOREX"},"productTitle":"Snorkel","productLocation":{"locationTitle":"A"},"offering":[
              {"offeringDate":"20270309","offeringTime":"1000"}]},
            {"productType":{"productType":"SHOREX"},"productTitle":"Snorkel","productLocation":{"locationTitle":"B"},"offering":[
              {"offeringDate":"20270309","offeringTime":"1000"}]}]}}"""))
        val times = RoyalParse.publicExcursionTimes(RoyalParse.finishSchedule(acc))
        assertEquals(mapOf(listOf("beach day", "2027-03-09", "09:00") to
            JsonObject(mapOf("meet" to JsonPrimitive("08:45"), "minutes" to JsonPrimitive(150)))), times)
    }

    @Test
    fun encodingLikeEncodeUriComponent() {
        // encodeURIComponent('a#b&c%d+e=f?g/h i:é!*()~\'')
        assertEquals("a%23b%26c%25d%2Be%3Df%3Fg%2Fh%20i%3A%C3%A9!*()~'", encodeUriComponent("a#b&c%d+e=f?g/h i:\u00e9!*()~'"))
    }
}
