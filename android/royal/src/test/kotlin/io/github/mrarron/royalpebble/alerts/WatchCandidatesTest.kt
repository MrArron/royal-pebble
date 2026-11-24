package io.github.mrarron.royalpebble.alerts

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WatchCandidatesTest {
    @Test
    fun excursionsBecomeOneRowPerProductWithTheLowestListedPrice() {
        val list = WatchCandidates.of(fixed())
        assertEquals(listOf("Atlantis Day Pass", "Snorkel Reef"), list.map { it.title })
        val snorkel = list.last()
        assertEquals("pt_shoreX/AB1", snorkel.code)
        assertEquals(89, snorkel.listedPrice)
        assertEquals(2, snorkel.sessions)
        assertEquals("Nassau", snorkel.place)
        assertEquals(null, list.first().listedPrice)
    }

    @Test
    fun activitiesAndProductsWithoutAnIdAreLeftOut() {
        assertTrue(WatchCandidates.of(fixed()).none { it.title == "Escape Room" || it.title == "Ship Tour" })
    }

    @Test
    fun watchedItemsAreHiddenAndSearchMatchesWords() {
        val all = WatchCandidates.of(fixed(), setOf("pt_shoreX/AB1"))
        assertEquals(listOf("Atlantis Day Pass"), all.map { it.title })
        val both = WatchCandidates.of(fixed())
        assertEquals(listOf("Snorkel Reef"), WatchCandidates.filter(both, "reef snor").map { it.title })
        assertEquals(2, WatchCandidates.filter(both, "nassau").size)
        assertEquals(2, WatchCandidates.filter(both, " ").size)
    }

    @Test
    fun plannerItemsJoinTheExcursionsAndASharedProductKeepsItsScheduleRow() {
        val catalog = listOf(
            io.github.mrarron.royalpebble.royal.CatalogItem("pt_packages", "YOUC", "Party Package", "Drinks", "${'$'}96.99 per day"),
            io.github.mrarron.royalpebble.royal.CatalogItem("pt_internet", "N1", "Internet", "Internet", ""),
            io.github.mrarron.royalpebble.royal.CatalogItem("pt_shoreX", "AB1", "Snorkel Reef (planner)", "Activities", ""),
        )
        val all = WatchCandidates.all(fixed(), catalog)
        assertEquals(listOf("Atlantis Day Pass", "Snorkel Reef", "Party Package", "Internet"), all.map { it.title })
        assertEquals("Snorkel Reef", all.first { it.code == "pt_shoreX/AB1" }.title)  // schedule row wins
        val party = all.first { it.group == "Drinks" }
        assertEquals("pt_packages/YOUC", party.code)
        assertEquals("${'$'}96.99 per day", party.priceText)
        assertEquals(0, party.sessions)
        assertEquals(listOf("Party Package"), WatchCandidates.filter(all, "drinks").map { it.title })
        assertEquals(listOf("Internet"), WatchCandidates.all(fixed(), catalog, setOf("pt_packages/YOUC", "pt_shoreX/AB1"))
            .filter { it.sessions == 0 }.map { it.title })
    }

    private fun fixed() = Json.parseToJsonElement(
        """{"schedule":{"published":true,
          "fields":["title","venue","cat","date","time","minutes","featured","reservation","paid","price","info","pid"],
          "cats":[["Shore excursions",""],["Activities",""]],
          "venues":["Nassau","Cruising","Royal Escape Room"],
          "events":[
            ["Snorkel Reef",0,0,"2026-12-14","09:00",120,0,1,1,89.0,null,"AB1"],
            ["Snorkel Reef",0,0,"2026-12-14","13:00",120,0,1,1,95.0,null,"AB1"],
            ["Atlantis Day Pass",0,0,"2026-12-14","08:00",0,0,1,1,null,null,"CD2"],
            ["Escape Room",2,1,"2026-12-15","19:00",60,0,1,1,40.0,null,"YO9Y"],
            ["Ship Tour",1,0,"2026-12-15","10:00",60,0,1,1,30.0,null,null]
          ]}}""",
    ).jsonObject
}
