package io.github.mrarron.royalpebble.store

import io.github.mrarron.royalpebble.royal.Fixtures
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class CruiseStoreTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private fun store(reconciler: StarReconciler = StarReconciler.KEEP) = CruiseStore(File(tmp.root, "cruise"), reconciler)

    private fun bundle(ship: String = "HM", date: String = "2027-03-06", mine: Boolean = false): JsonObject {
        val text = """{"format":"cruise-watch","v":1,"generated":"2026-11-13T17:00:00Z","ship":{"code":"$ship","name":"Harmony of the Seas"},
            "sailDate":"$date","itinerary":[{"day":1},{"day":2}],"schedule":{"events":[["Trivia",0,0,"$date","14:00",45,0,0,0,null,null,"P1"]]}}"""
        val b = Json.parseToJsonElement(text) as JsonObject
        return if (mine) JsonObject(b + ("mine" to Fixtures.json("expected-mine.json"))) else b
    }

    @Test
    fun aSailingWithLoginDataGivesTheBookingAndReservations() {
        val s = store()
        assertNull(s.sailing())
        assertNull(s.booking())
        assertEquals(emptyList<Reservation>(), s.reservations())
        val r = s.saveDownload(bundle(mine = true), "Nov 13, 5:00p")
        assertEquals(SaveResult(sameSailing = false, keptMine = false, starChanges = 0), r)
        assertEquals(Sailing("HM", "Harmony of the Seas", "2027-03-06", "2026-11-13T17:00:00Z", 2, 1, true), s.sailing())
        val b = s.booking()!!
        assertEquals("1234", b.stateroom)
        assertEquals("Z9", b.muster)
        assertEquals("11:30", b.arrival)
        assertEquals("America/New_York", b.embarkTimeZone)
        assertFalse(b.toString().contains("1234"))
        assertEquals(listOf(
            Reservation("Beach Day", "pt_shoreX", 3, "2027-03-09", "09:00", 4, "PCC", "08:45", "11:30", 150),
            Reservation("Deluxe Beverage Package", "pt_beverage", 2, null, null, null, null, null, null, null),
        ), s.reservations())
        assertEquals(JsonObject(emptyMap()), s.status())
    }

    @Test
    fun aPhoneDownloadOfTheSameSailingKeepsTheLoginData() {
        val s = store()
        s.saveDownload(bundle(mine = true), "a")
        val r = s.saveDownload(bundle(), "b")
        assertEquals(SaveResult(sameSailing = true, keptMine = true, starChanges = 0), r)
        assertEquals("1234", s.booking()!!.stateroom)
        assertEquals("""{"at":"b","list":[]}""", s.read(CruiseStore.STAR_CHANGES).toString())
        // Another sailing doesn't take it, and clears the old one's changes and notices.
        s.write(CruiseStore.NOTICES, JsonArray(listOf(JsonPrimitive("old"))))
        assertEquals(SaveResult(sameSailing = false, keptMine = false, starChanges = 0), s.saveDownload(bundle(date = "2027-04-01"), "c"))
        assertNull(s.booking())
        assertEquals(JsonNull, s.read(CruiseStore.STAR_CHANGES))
        assertEquals(JsonArray(emptyList()), s.read(CruiseStore.NOTICES))
    }

    @Test
    fun eachDownloadedSailingIsKeptSeparatelyWithItsOwnStars() {
        val s = store()
        val mar = bundle(date = "2027-03-06")
        val apr = bundle(ship = "XX", date = "2027-04-01")
        s.saveDownload(mar, "a")
        s.applyStarChanges(mapOf("Trivia|2027-03-06|14:00|" to true))
        s.saveDownload(apr, "b")                                   // another sailing becomes the active one
        assertEquals("XX", s.sailing()!!.shipCode)
        assertTrue(s.stars().isEmpty())                            // March's stars went away with March
        assertEquals(listOf("2027-03-06" to false, "2027-04-01" to true), s.sailings().map { it.sailing.sailDate to it.active })
        assertTrue(s.activate("HM", "2027-03-06"))
        assertEquals("HM", s.sailing()!!.shipCode)
        assertEquals(setOf("Trivia|2027-03-06|14:00|"), s.stars().keys)   // and came back with it
        assertEquals(listOf(true, false), s.sailings().map { it.active })
        assertFalse(s.activate("ZZ", "2030-01-01"))
        // Only the active sailing is among the watch's key files.
        assertFalse(s.snapshot().keys.any { it.contains("2027") })
    }

    @Test
    fun aRefreshOfASailingThatIsNotActiveDoesNotSwitchTheApp() {
        val s = store()
        s.saveDownload(bundle(mine = true), "a")
        s.saveDownload(bundle(ship = "XX", date = "2027-04-01"), "b")
        val r = s.saveDownload(bundle(), "c", makeActive = false)          // March, refreshed in the background
        assertTrue(r.sameSailing); assertTrue(r.keptMine)
        assertEquals("XX", s.sailing()!!.shipCode)                          // still April
        assertTrue(s.bundleOf("HM", "2027-03-06")!!["mine"] is JsonObject)   // March kept its booking details
    }

    @Test
    fun removingASailingKeepsTheOthersAndPromotesTheNext() {
        val s = store()
        s.saveDownload(bundle(date = "2027-03-06"), "a")
        s.saveDownload(bundle(ship = "XX", date = "2027-04-01"), "b")
        s.saveDownload(bundle(ship = "YY", date = "2027-02-01"), "c")       // active
        assertTrue(s.remove("XX", "2027-04-01", "2027-01-01"))             // one put away
        assertEquals(2, s.sailings().size)
        assertTrue(s.remove("YY", "2027-02-01", "2027-02-15"))             // the active one: the next from today takes over
        assertEquals("HM", s.sailing()!!.shipCode)
        assertTrue(s.remove("HM", "2027-03-06", "2027-01-01"))
        assertNull(s.sailing())
        assertTrue(s.sailings().isEmpty())
        assertFalse(s.remove("HM", "2027-03-06", "2027-01-01"))
        assertNull(s.read(CruiseStore.STARS))
    }

    @Test
    fun failuresAndMissingBookingDetailsAreRecorded() {
        val s = store()
        s.recordFailure("Royal Caribbean returned error 500.", "Nov 13, 5:00p")
        assertEquals("""{"error":"Royal Caribbean returned error 500.","at":"Nov 13, 5:00p"}""", s.status().toString())
        s.saveDownload(bundle(), "Nov 13, 5:01p", mineError = "Royal Caribbean returned error 404.")
        assertEquals("""{"title":"Booking details not downloaded","error":"Your sailing downloaded, but your booking details didn't: Royal Caribbean returned error 404.","at":"Nov 13, 5:01p"}""",
            s.status().toString())
    }

    @Test
    fun starsTheLatestChangeWinsAndReservedMarksLiveWithThem() {
        val s = store()
        val key = CruiseStore.starKey("Trivia", "2027-03-07", "14:00", "On Air")
        assertEquals("Trivia|2027-03-07|14:00|On Air", key)
        s.applyStarChanges(mapOf(key to true, CruiseStore.RESERVED_PREFIX + key to true), mapOf(key to 1000), nowMs = 5000)
        assertTrue(s.isStarred(key))
        assertEquals(setOf(key), s.reservedMarks())
        assertEquals(mapOf(key to 1000L, "R|$key" to 5000L), s.starTimes())
        // An older change (made before the saved one) loses; a newer one wins.
        s.applyStarChanges(mapOf(key to false), mapOf(key to 900), nowMs = 6000)
        assertTrue(s.isStarred(key))
        s.applyStarChanges(mapOf(key to false), mapOf(key to 2000), nowMs = 6000)
        assertFalse(s.isStarred(key))
        assertEquals(setOf(key), s.reservedMarks())  // the mark stays when the event is unstarred
        // A future time counts as now; over-long keys are ignored.
        s.applyStarChanges(mapOf(key to true, "x".repeat(301) to true), mapOf(key to 99999), nowMs = 7000)
        assertEquals(7000L, s.starTimes()[key])
        assertEquals(2, s.stars().size)
        assertEquals("""{"R|$key":true,"$key":true}""", s.read(CruiseStore.STARS).toString())
    }

    @Test
    fun aReconcilerMovesStarsAndQueuesNotices() {
        val moved = StarReconciler { _, _, stars, _, _, times ->
            StarReconciler.Reconciled(stars.mapKeys { it.key.replace("14:00", "15:00") }, times,
                listOf(JsonPrimitive("moved")), listOf(JsonPrimitive("notice")))
        }
        val s = store(moved)
        s.saveDownload(bundle(), "a")
        s.applyStarChanges(mapOf("Trivia|2027-03-06|14:00|On Air" to true), nowMs = 1)
        assertEquals(1, s.saveDownload(bundle(), "b").starChanges)
        assertEquals(setOf("Trivia|2027-03-06|15:00|On Air"), s.stars().keys)
        assertEquals("""{"at":"b","list":["moved"]}""", s.read(CruiseStore.STAR_CHANGES).toString())
        assertEquals("""["notice"]""", s.read(CruiseStore.NOTICES).toString())
    }

    @Test
    fun settingsAndTheShipList() {
        val s = store()
        assertEquals(JsonObject(emptyMap()), s.settings())
        s.updateSettings(mapOf("theme" to JsonPrimitive("dark"), "reminderLead" to JsonPrimitive(15),
            "personal" to Json.parseToJsonElement("""[{"title":"Dinner","date":"2027-03-07","time":"18:00"}]""")))
        s.updateSettings(mapOf("theme" to null))
        assertEquals("""{"reminderLead":15,"personal":[{"title":"Dinner","date":"2027-03-07","time":"18:00"}]}""", s.settings().toString())
        assertEquals(1, s.personal().size)
        s.saveShips(listOf("HM" to "Harmony of the Seas"), nowMs = 1000)
        assertEquals(listOf("HM" to "Harmony of the Seas"), s.ships(nowMs = 2000))
        assertNull(s.ships(nowMs = 1000 + CruiseStore.SHIPS_MAX_AGE_MS + 1))
    }

    @Test
    fun keysAndFilesLikeLocalStorage() {
        val s = store()
        s.saveDownload(bundle(), "a")
        assertEquals(listOf("bundle", "notices", "starChanges", "starTimes", "status"), s.snapshot().keys.toList())
        assertEquals(bundle(), Json.parseToJsonElement(s.snapshot()["bundle"]!!))
        // Unreadable data reads as nothing, as index.js load() does.
        File(tmp.root, "cruise/settings.json").writeText("{not json")
        assertEquals(JsonObject(emptyMap()), s.settings())
        s.write(CruiseStore.SETTINGS, null)
        assertFalse(File(tmp.root, "cruise/settings.json").exists())
        // A second store on the same folder sees the same data (the app restarting).
        assertEquals(s.sailing(), store().sailing())
        assertFalse(File(tmp.root, "cruise").listFiles()!!.any { it.name.endsWith(".tmp") })
    }
}
