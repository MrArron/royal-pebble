package io.github.mrarron.royalpebble.settings

import io.github.mrarron.royalpebble.royal.FakeRoyal
import io.github.mrarron.royalpebble.royal.RoyalClient
import io.github.mrarron.royalpebble.royal.RoyalParse
import io.github.mrarron.royalpebble.store.CruiseStore
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId

class SettingsTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private fun store() = CruiseStore(File(tmp.root, "cruise"))
    private fun session(s: CruiseStore = store()) = CruiseSession(s) { LocalDateTime.of(2027, 3, 8, 12, 0) }
    private fun json(text: String) = Json.parseToJsonElement(text)
    private val ship = RoyalParse.Ship("HM", "Harmony of the Seas")

    private fun service(fake: FakeRoyal, s: CruiseStore) = DownloadService(
        RoyalClient(fake, sleep = {}, now = { Instant.parse("2026-11-13T17:00:00Z") }), s,
        ZoneId.of("UTC"), { Instant.parse("2026-11-13T17:24:00Z").toEpochMilli() })

    // ------------------------------------------------------------ download

    @Test
    fun aLoginDownloadSavesTheSailingAndTheBooking() {
        val s = store()
        val out = service(FakeRoyal(), s).download(ship, "2027-03-06", DownloadService.Login("me@example.com", "pw"))
        out as DownloadOutcome.Done
        assertTrue(out.withLogin)
        assertNull(out.mineError)
        assertTrue(out.bookingSummary!!.startsWith("booking found:"))
        assertTrue(s.sailing()!!.hasBooking)
        assertEquals("1234", s.booking()!!.stateroom)
        assertEquals("Harmony of the Seas", s.sailing()!!.shipName)
        assertEquals(JsonObject(emptyMap()), s.status())
        // Nothing the owner typed is kept anywhere in the store.
        assertFalse(s.snapshot().values.any { it.contains("me@example.com") || it.contains("\"pw\"") })
    }

    @Test
    fun aPlainDownloadKeepsTheEarlierBooking() {
        val s = store()
        service(FakeRoyal(), s).download(ship, "2027-03-06", DownloadService.Login("me@example.com", "pw"))
        val out = service(FakeRoyal(), s).download(ship, "2027-03-06") as DownloadOutcome.Done
        assertFalse(out.withLogin)
        assertTrue(out.saved.keptMine)
        assertTrue(s.sailing()!!.hasBooking)
    }

    @Test
    fun aRefusedSignInSavesNothingAndIsRecorded() {
        val s = store()
        val fake = FakeRoyal(login = 401 to "{}")
        val out = service(fake, s).download(ship, "2027-03-06", DownloadService.Login("me@example.com", "bad"))
        assertEquals(DownloadOutcome.Failed(RoyalClient.ERR_LOGIN_REJECTED), out)
        assertNull(s.bundle())
        assertEquals("Nov 13, 5:24p", (s.status()["at"] as JsonPrimitive).content)
        assertEquals(RoyalClient.ERR_LOGIN_REJECTED, (s.status()["error"] as JsonPrimitive).content)
        assertEquals(1, fake.calls.size)  // only the sign-in
    }

    @Test
    fun aBookingThatFailsStillSavesTheSailing() {
        val s = store()
        val fake = FakeRoyal(fail = setOf("/v1/profileBookings/enriched/ACC1"))
        val out = service(fake, s).download(ship, "2027-03-06", DownloadService.Login("me@example.com", "pw")) as DownloadOutcome.Done
        assertNotNull(out.mineError)
        assertNotNull(s.sailing())
        assertFalse(s.sailing()!!.hasBooking)
        assertEquals("Booking details not downloaded", (s.status()["title"] as JsonPrimitive).content)
    }

    @Test
    fun theLoginNeverShowsInItsText() {
        assertFalse(DownloadService.Login("me@example.com", "hunter2").toString().contains("hunter2"))
        assertFalse(DownloadService.Login("me@example.com", "hunter2").toString().contains("example"))
    }

    @Test
    fun theStampReadsLikeTheSettingsPage() {
        assertEquals("Nov 13, 5:24p", formatStamp(Instant.parse("2026-11-13T17:24:00Z").toEpochMilli(), ZoneId.of("UTC")))
        assertEquals("Mar 2, 12:05a", formatStamp(Instant.parse("2027-03-02T00:05:00Z").toEpochMilli(), ZoneId.of("UTC")))
    }

    // ------------------------------------------------------------ demo mode and stars

    @Test
    fun demoModeShowsADemoCruiseAndKeepsItsStarsInMemory() {
        val s = store()
        val ses = session(s)
        assertTrue(ses.isDemo)
        assertEquals("HM", ses.shipCode())
        assertTrue(ses.events().size > 10)
        assertTrue(ses.itinerary().size == 4)
        val hiro = ses.events().first { it.title == "HiRO" }
        assertTrue(ses.isStarred(hiro.key))
        ses.setStar(hiro.key, false)
        assertFalse(ses.isStarred(hiro.key))
        assertNull(s.read(CruiseStore.STARS))  // nothing written
        assertNull(s.bundle())
    }

    @Test
    fun settingsSavedInDemoModeAreKept() {
        val s = store()
        session(s).saveFilters(listOf("Shop", "Activities / Fitness"), listOf("adult"), false)
        val saved = s.settings()
        assertEquals("[\"Shop\",\"Activities / Fitness\"]", saved["hiddenCats"].toString())
        assertEquals("[\"adult\"]", saved["ageFilters"].toString())
        assertEquals(false, CruiseData.showFeatured(saved))
        // The demo's own settings (its dinner entry) still show beneath.
        assertTrue(SettingsRules.personal(session(s).settings()).any { it.title == "Dinner" })
    }

    @Test
    fun realStarsGoToTheStoreWithTheLatestChangeWinning() {
        val s = store()
        service(FakeRoyal(), s).download(ship, "2027-03-06")
        val ses = session(s)
        assertFalse(ses.isDemo)
        val e = ses.events().first()
        ses.pick(e.key, true)
        assertTrue(s.isStarred(e.key))
        assertTrue(ses.isReserved(e.key))
        assertTrue(s.reservedMarks().contains(e.key))
        ses.pick(e.key, false)
        assertFalse(s.isStarred(e.key))
    }

    // ------------------------------------------------------------ filters (slice.js rules)

    private fun ev(title: String, venue: String = "", cat: String = "Activities", sub: String = "", min: Int? = null, max: Int? = null) =
        Event(title, venue, cat, sub, "2027-03-08", "10:00", 30, false, false, false, null, min, max, null)

    @Test
    fun shopIsHiddenUntilFiltersAreChanged() {
        val shop = ev("Watch Sale", cat = "Shop", sub = "Retail")
        assertTrue(CruiseData.hiddenByFilters(shop, JsonObject(emptyMap())))
        val shown = JsonObject(mapOf("hiddenCats" to JsonArray(emptyList())))
        assertFalse(CruiseData.hiddenByFilters(shop, shown))
        val sub = JsonObject(mapOf("hiddenCats" to JsonArray(listOf(JsonPrimitive("Shop / Retail")))))
        assertTrue(CruiseData.hiddenByFilters(shop, sub))
    }

    @Test
    fun casinoIsItsOwnCategory() {
        assertEquals("Casino" to "", CruiseData.filterCat(ev("Slot Tournament", cat = "Activities")))
        assertEquals("Casino" to "", CruiseData.filterCat(ev("Pull Tab Prizes", venue = "Casino Royale")))
        assertEquals("Activities" to "", CruiseData.filterCat(ev("Bingo Blast", cat = "Activities")))
        assertEquals("Activities" to "", CruiseData.filterCat(ev("Poker Bingo", cat = "Activities")))
    }

    @Test
    fun agesHideAdultTeenAndFamilyEvents() {
        val off = JsonObject(mapOf("hiddenCats" to JsonArray(emptyList())))
        fun with(vararg f: String) = JsonObject(off + ("ageFilters" to JsonArray(f.map { JsonPrimitive(it) })))
        assertTrue(CruiseData.hiddenByFilters(ev("Adult Comedy", min = 18), with("adult")))
        assertFalse(CruiseData.hiddenByFilters(ev("Adult Comedy", min = 18), with("young")))
        assertTrue(CruiseData.hiddenByFilters(ev("Teen Night", min = 13, max = 17), with("young")))
        assertTrue(CruiseData.hiddenByFilters(ev("Family Trivia"), with("family")))
        assertTrue(CruiseData.hiddenByFilters(ev("Movie", venue = "Adventure Ocean Theater"), with("family")))
        assertFalse(CruiseData.hiddenByFilters(ev("Trivia With Family Fun Crew"), with("family")))
        assertFalse(CruiseData.hiddenByFilters(ev("Trivia"), with("adult", "young", "family")))
    }

    @Test
    fun categoriesAreCountedWithoutExcursions() {
        val b = DemoBundle.make(LocalDateTime.of(2027, 3, 8, 12, 0)).bundle
        val names = CruiseData.categorySummary(b).map { it.name }
        assertEquals(names.sorted(), names)
        assertTrue("Shop" in names)
        assertFalse(EXCURSIONS in names)
    }

    // ------------------------------------------------------------ days

    @Test
    fun allAboardFollowsRoyalsGangwayThenTheBuffer() {
        val b = json("""{"itinerary":[{"day":3,"date":"2027-03-08","port":"Nassau","type":"DOCKED","arrive":"07:30","depart":"17:30"}],
            "mine":{"ports":[{"day":3,"gangwayUp":"17:00"}]}}""") as JsonObject
        val day = CruiseData.itinerary(b)[0]
        val none = JsonObject(emptyMap())
        var v = SettingsRules.dayView(b, day, none)
        assertEquals(17 * 60, v.allAboard)
        assertTrue(v.royalGangway)
        assertEquals(30, v.warn)
        val shifted = SettingsRules.withDay(none, day.date, json("""{"shift":-15,"offset":60}""") as JsonObject)
        v = SettingsRules.dayView(b, day, shifted)
        assertEquals(17 * 60 - 60 - 15, v.allAboard)
        val exact = SettingsRules.withDay(none, day.date, json("""{"allAboard":"16:10"}""") as JsonObject)
        assertEquals(16 * 60 + 10, SettingsRules.dayView(b, day, exact).allAboard)
        // Without Royal's gangway time: departure minus the buffer; tenders get 60.
        val plain = JsonObject(b - "mine")
        assertEquals(17 * 60, SettingsRules.dayView(plain, day, none).allAboard)
        val tender = JsonObject(plain + ("itinerary" to json("""[{"day":3,"date":"2027-03-08","port":"X","type":"TENDER","arrive":"07:30","depart":"17:30"}]""")))
        assertEquals(16 * 60 + 30, SettingsRules.dayView(tender, CruiseData.itinerary(tender)[0], none).allAboard)
    }

    @Test
    fun daySettingsAreCleanedLikeThePage() {
        assertNull(SettingsRules.cleanDaySettings(json("""{"offset":45,"buffer":50,"allAboard":"25:00","shift":7,"warn":45}""")))
        val c = SettingsRules.cleanDaySettings(json("""{"offset":-60,"buffer":45,"shift":-5,"warn":90,"edit":{"type":"CRUISING","port":"x","arrive":null,"depart":"bad"}}"""))!!
        assertEquals("""{"offset":-60,"buffer":45,"shift":-5,"warn":90,"edit":{"type":"CRUISING","port":"x","arrive":null}}""", c.toString())
    }

    @Test
    fun anEditThatMatchesRoyalIsPruned() {
        val day = ItineraryDay(3, "2027-03-08", "Nassau", "NAS", "DOCKED", "07:30", "17:30")
        var set = SettingsRules.setDayField(null, day, "edit", json("""{"type":"CRUISING","port":"Nassau"}"""))
        assertEquals("""{"edit":{"type":"CRUISING"}}""", set.toString())
        set = SettingsRules.setDayField(set, day, "edit", json("""{"type":"DOCKED"}"""))
        assertNull(set)
    }

    // ------------------------------------------------------------ personal entries and me

    @Test
    fun personalEntriesAreAddedAndRemoved() {
        val s = store()
        val ses = session(s)
        assertTrue(ses.addPersonal(SettingsRules.Personal("  Spa  ", "Vitality", "2027-03-08", "15:00", 60)))
        assertFalse(ses.addPersonal(SettingsRules.Personal("   ", "", "2027-03-08", null, 0)))
        assertFalse(ses.addPersonal(SettingsRules.Personal("Bad date", "", "March 8", null, 0)))
        val spa = SettingsRules.personal(s.settings()).first { it.title == "Spa" }
        assertEquals("Vitality", spa.venue)
        session(s).removePersonal(spa.id)
        assertTrue(SettingsRules.personal(s.settings()).none { it.title == "Spa" })
    }

    @Test
    fun myInfoAndBasicsSave() {
        val s = store()
        val ses = session(s)
        ses.saveMe(mapOf("stateroom" to " 1234 ", "muster" to "B4", "dining" to ""))
        ses.saveBasics("dark", 30, 21 * 60, "ft", true)
        val saved = s.settings()
        assertEquals("1234", ses.me()["stateroom"])
        assertEquals("dark", SettingsRules.theme(saved))
        assertEquals(30, SettingsRules.reminderLead(saved))
        assertEquals(21 * 60, SettingsRules.reserveAlertAt(saved))
        assertEquals("ft", SettingsRules.units(saved))
        assertTrue(SettingsRules.alwaysHints(saved))
        ses.saveBasics("nope", 7, 5, "x", false)
        assertEquals(15, SettingsRules.reminderLead(s.settings()))
        assertEquals(SettingsRules.RESERVE_ALERT_DEFAULT, SettingsRules.reserveAlertAt(s.settings()))
    }

    // ------------------------------------------------------------ share my plan

    private fun withPlan(s: CruiseStore, block: (CruiseSession) -> Unit) {
        service(FakeRoyal(), s).download(ship, "2027-03-06")
        block(session(s))
    }

    @Test
    fun aPlanRoundTripsBetweenPhones() {
        val mine = store()
        var text = ""
        withPlan(mine) { a ->
            val e = a.events().first()
            a.setStar(e.key, true)
            a.setStar(CruiseStore.RESERVED_PREFIX + e.key, true)
            a.addPersonal(SettingsRules.Personal("Dinner", "Chops", "2027-03-06", "19:30", 90))
            a.saveMe(mapOf("stateroom" to "1234", "deck" to "Deck 9"))
            text = a.sharePlanText(withCabin = false)
        }
        assertTrue(text.startsWith("Royal Pebble plan · Harmony of the Seas · sails 6 Mar 2027 · 1 star\n"))
        assertTrue(text.contains("RPPLAN1:") && text.trimEnd().endsWith(":END"))
        assertFalse(text.contains("1234"))
        val other = CruiseStore(File(tmp.root, "other"))
        withPlan(other) { b ->
            // Chat apps wrap the code.
            val wrapped = text.replace("RPPLAN1:", "RPPLAN1:\n  ").let { it.substring(0, it.length - 20) + "\n" + it.substring(it.length - 20) }
            val read = b.readPlan(wrapped) as CruiseSession.PlanRead.Ready
            assertEquals(3, read.diff.items.size)  // star, reserved mark, entry
            val done = b.applyPlan(read.diff.items)
            assertEquals(CruiseSession.Applied(stars = 2, unstarred = 0, personal = 1, days = 0, cabin = 0), done)
            assertTrue(b.isStarred(b.events().first().key))
            assertEquals("Dinner", SettingsRules.personal(other.settings())[0].title)
            // The same plan again has nothing left.
            assertEquals(0, (b.readPlan(text) as CruiseSession.PlanRead.Ready).diff.items.size)
        }
    }

    @Test
    fun aPlanForAnotherSailingIsRefusedAndBadTextExplained() {
        withPlan(store()) { a ->
            val other = SharePlan.encode(json("""{"v":1,"ship":"HM","sail":"2027-04-01","stars":[]}""") as JsonObject, "x")
            val err = a.readPlan(other) as CruiseSession.PlanRead.Error
            assertTrue(err.message.contains("only imports onto the same sailing"))
            assertEquals("No Royal Pebble plan found. Paste the whole message.", (a.readPlan("hello") as CruiseSession.PlanRead.Error).message)
            assertEquals("The plan is cut short. Copy the whole message and paste it again.",
                (a.readPlan("RPPLAN1:abcd") as CruiseSession.PlanRead.Error).message)
            assertEquals("This plan comes from a newer Royal Pebble. Update the app, then paste it again.",
                (a.readPlan("RPPLAN9:abcd:END") as CruiseSession.PlanRead.Error).message)
            assertEquals("The plan is damaged. Ask for it again.", (a.readPlan("RPPLAN1:abcd:END") as CruiseSession.PlanRead.Error).message)
        }
    }

    @Test
    fun cabinDetailsOnlyTravelWhenAsked() {
        withPlan(store()) { a ->
            a.saveMe(mapOf("stateroom" to "1234", "stairs" to "Fwd"))
            val without = a.sharePlanText(false)
            val with = a.sharePlanText(true)
            val plan = (SharePlan.decode(with) as SharePlan.Decoded.Ok).plan
            assertEquals("""{"stateroom":"1234","stairs":"Fwd"}""", plan["cabin"].toString())
            assertNull((SharePlan.decode(without) as SharePlan.Decoded.Ok).plan["cabin"].takeIf { (it as JsonObject).isNotEmpty() })
        }
    }

    @Test
    fun acceptingAPlanNeverRemovesAnything() {
        val s = store()
        withPlan(s) { a ->
            val mine = a.events().first()
            a.setStar(mine.key, true)
            val plan = SharePlan.encode(json("""{"v":1,"ship":"HM","sail":"2027-03-06","stars":[],
                "days":{"2027-03-06":{"warn":60}},"cabin":{"muster":"C3"}}""") as JsonObject, "x")
            val read = a.readPlan(plan) as CruiseSession.PlanRead.Ready
            // Their plan lacks my star: listed (to unstar) but not taken by default.
            val star = read.diff.items.filterIsInstance<SharePlan.Item.Star>().single()
            assertFalse(star.takeTheirs)
            val done = a.applyPlan(read.diff.items)
            assertEquals(CruiseSession.Applied(0, 0, 0, 1, 1), done)
            assertTrue(a.isStarred(mine.key))
            assertEquals(60, SettingsRules.dayView(a.bundle(), a.itinerary().first { it.date == "2027-03-06" }, s.settings()).warn)
            assertEquals("C3", a.me()["muster"])
            // Review each lets them drop the star.
            val dropped = a.applyPlan(read.diff.items, mapOf(read.diff.items.indexOf(star) to true))
            assertEquals(1, dropped.unstarred)
            assertFalse(a.isStarred(mine.key))
        }
    }
}

class ReadinessTest {
    private val ship = RoyalParse.Ship("HM", "Harmony of the Seas")
    @get:Rule
    val tmp = TemporaryFolder()

    @Test
    fun pastedBundlesAreChecked() {
        assertEquals("That text is not valid cruise data", Readiness.parse("hello").second)
        assertEquals("Not a cruise data bundle", Readiness.parse("{}").second)
        assertEquals("Unsupported bundle version 2", Readiness.parse("""{"format":"cruise-watch","v":2}""").second)
        assertEquals("Missing sail date", Readiness.parse("""{"format":"cruise-watch","v":1}""").second)
        val demo = DemoBundle.make(LocalDateTime.of(2027, 3, 8, 12, 0)).bundle
        // The demo has no `paid`/`pid` fields; the required ones are enough.
        assertNull(Readiness.parse(demo.toString()).second)
        assertEquals("Schedule is missing \"time\"",
            Readiness.parse(demo.toString().replace("\"time\",", "")).second)
    }

    @Test
    fun readyChecksTellWhatIsLeft() {
        val demo = DemoBundle.make(LocalDateTime.of(2027, 3, 8, 12, 0))
        val none = JsonObject(emptyMap())
        val checks = Readiness.checks(demo.bundle, none, demo.stars, null)
        assertEquals(listOf(false, false, true), checks.map { it.ok })  // demo: debark day has no events; no stateroom given
        assertTrue(checks[2].text.startsWith("Busiest day "))
        val room = Readiness.checks(demo.bundle, none, demo.stars, "1234")
        assertTrue(room[1].ok)
    }

    @Test
    fun aDownloadedSailingCountsItsDays() {
        val s = CruiseStore(File(tmp.root, "c"))
        DownloadService(RoyalClient(FakeRoyal(), sleep = {}), s).download(ship, "2027-03-06")
        val b = s.bundle()!!
        val checks = Readiness.checks(b, s.settings(), s.stars(), s.booking()?.stateroom)
        assertEquals(3, checks.size)
        assertFalse(checks[1].ok)  // a plain download has no stateroom
        assertTrue(Readiness.dayLoad(b, s.settings(), s.stars()).isNotEmpty())
    }
}
