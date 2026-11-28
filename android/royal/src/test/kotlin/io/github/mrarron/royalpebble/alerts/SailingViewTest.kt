package io.github.mrarron.royalpebble.alerts

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SailingViewTest {
    private val dec1 = BookingRef("1001", "XX", "Test Ship", "20261212")
    private val dec2 = BookingRef("1002", "XX", "Test Ship", "20261212")   // a linked guest's booking, same sailing
    private val mar = BookingRef("2001", "YY", "Other Ship", "20270319")

    private fun watch(id: String, res: String = "", ship: String = "", date: String = "") =
        PriceWatch(id, id, "pt_a", id, reservationId = res, shipCode = ship, sailDate = date)

    @Test
    fun linkedBookingsOfOneSailingAreOneOption() {
        val o = SailingView.options(listOf(mar, dec1, dec2))
        assertEquals(listOf("2026-12-12", "2027-03-19"), o.map { it.sailDate })   // soonest first
        assertEquals(setOf("1001", "1002"), o[0].reservationIds)
        assertTrue(o[0].booked)
        assertEquals("Test Ship · 2026-12-12", o[0].label)
    }

    @Test
    fun aSailingAddedInTripJoinsTheListUnlessABookingCoversIt() {
        val added = BookingRef("", "ZZ", "Third Ship", "2027-05-01")
        val o = SailingView.options(listOf(dec1), added)
        assertEquals(2, o.size)
        assertFalse(o[1].booked)
        assertEquals("Third Ship · 2027-05-01 (added)", o[1].label)
        assertEquals(1, SailingView.options(listOf(dec1), BookingRef("", "xx", "Test Ship", "2026-12-12")).size)
    }

    @Test
    fun watchesFollowTheirSailingNotJustOneBooking() {
        val o = SailingView.options(listOf(dec1, dec2, mar))
        val dec = o[0]
        val fromSchedule = watch("a", ship = "XX", date = "2026-12-12")
        val onLinked = watch("b", res = "1002")
        val march = watch("c", ship = "YY", date = "2027-03-19")
        val marchBooking = watch("d", res = "2001")
        val legacy = watch("e")
        val all = listOf(fromSchedule, onLinked, march, marchBooking, legacy)
        assertEquals(listOf("a", "b", "e"), SailingView.watches(all, dec).map { it.id })
        assertEquals(listOf("c", "d", "e"), SailingView.watches(all, o[1]).map { it.id })
        assertEquals(all, SailingView.watches(all, null))   // all sailings
    }

    @Test
    fun aGoneChoiceFallsBackToAllSailings() {
        val o = SailingView.options(listOf(dec1))
        assertNull(SailingView.selected(o, SailingView.ALL))
        assertNull(SailingView.selected(o, "ZZ|20300101"))
        assertEquals(o[0], SailingView.selected(o, o[0].key))
    }
}
