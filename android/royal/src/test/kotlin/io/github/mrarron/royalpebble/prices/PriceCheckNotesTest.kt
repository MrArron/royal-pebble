package io.github.mrarron.royalpebble.prices

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PriceCheckNotesTest {
    private val url = "https://aws-prd.api.rccl.com/en/royal/web/commerce-api/catalog/v2/EX/categories/pt_packages/products/Y7OD"
    private val report = """
        Reservation #1111111
        12/12/26 Harmony of the Seas Room GTY (In this cabin: A, B)
        No stateroom category code could be resolved from API payload.
        Please set categoryOverride in your config YAML for this reservation.
        Reservation #2222222
        12/12/26 Harmony of the Seas Room 1234 (In this cabin: C)
        Reservation #3333333
        03/19/27 Explorer of the Seas Room GTY (In this cabin: A, B)
        No stateroom category code could be resolved from API payload.
        Please set categoryOverride in your config YAML for this reservation.
        ESC[33m	Kayak, Hike and Snorkel at Cas Cay: Server returned no pricing data (currency mismatch or unavailable for reservation).ESC[0m
        Attempt 1/3 failed for $url: Server Error 500. Retrying in 2s...
        Attempt 2/3 failed for $url: Server Error 500. Retrying in 4s...
        All 3 retry attempts exhausted for $url.
        pt_packages Y7OD: could not check (request failed)
        Kayak, Hike and Snorkel at Cas Cay: Server returned no pricing data (currency mismatch or unavailable for reservation).
        Attempt 1/3 failed for $url: Server Error 500. Retrying in 2s...
        pt_packages Y7OD: could not check (request failed)
    """.trimIndent().replace("ESC", "\u001B").lines()

    @Test
    fun guaranteeBookingsGetOneFriendlyNoteEach() {
        val notes = PriceCheckNotes.from(report).filter { it.title.startsWith("No cabin assigned") }
        assertEquals(2, notes.size)
        assertTrue(notes[0].title.contains("1111111") && notes[0].title.contains("Harmony of the Seas"))
        assertTrue(notes[1].title.contains("3333333") && notes[1].title.contains("Explorer"))
        assertTrue(notes.none { it.detail.contains("categoryOverride") })
    }

    @Test
    fun repeatedServerErrorsAndNoPriceItemsCollapse() {
        val notes = PriceCheckNotes.from(report)
        assertEquals(1, notes.count { it.title.startsWith("Royal's server answered error 500 for pt_packages/Y7OD") })
        assertEquals(1, notes.count { it.title.startsWith("Kayak, Hike and Snorkel at Cas Cay: no price") })
        assertTrue(notes.first { it.title.startsWith("Royal's server") }.detail.contains("2 guests"))
        assertTrue(notes.none { it.title.startsWith("Couldn't check") })
        assertEquals(4, notes.size)
    }

    @Test
    fun aRealGapStillTellsYouWhatToDo() {
        val notes = PriceCheckNotes.from(listOf("Reservation #1", "01/02/27 Some Ship Room 1234 (x)", "No stateroom category code could be resolved from API payload."))
        assertTrue(notes.single().detail.contains("categoryOverride"))
    }

    @Test
    fun aCleanReportHasNoNotes() {
        assertTrue(PriceCheckNotes.from(listOf("Reservation #1", "01/02/27 Some Ship Room 1234 (x)", "Cruise Fare - Total 100")).isEmpty())
    }
}
