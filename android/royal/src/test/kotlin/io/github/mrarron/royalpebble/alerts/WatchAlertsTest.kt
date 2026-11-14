package io.github.mrarron.royalpebble.alerts

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

private class FakeSender(var delivered: Boolean = true) : WatchSender {
    val sends = ArrayList<Pair<Int, ByteArray>>()
    override fun sendNotices(count: Int, packed: ByteArray): SendResult {
        sends.add(count to packed)
        return SendResult(delivered, if (delivered) "watch ACKed" else "no watch connected")
    }
}

class WatchAlertsTest {
    private val today = LocalDate.of(2026, 12, 1)

    private fun booking(
        label: String = "TBD", pay: String = "20270101", due: Boolean? = false, id: String = "R1",
    ) = AlertBooking(id, "Harmony of the Seas", "20261212", label, pay, due)

    private fun drop(item: String = "The Key", current: Double = 89.0, alert: Boolean = true, id: String = "R1") =
        AlertDrop(id, item, "Pat", 109.0, current, "USD", alert)

    private fun alerts(sender: FakeSender, state: AlertState = MemoryAlertState()) =
        WatchAlerts(sender, state, NoticeEncoder) { today }

    @Test
    fun nothingToSendDoesNotTouchTheWatch() {
        val s = FakeSender()
        val r = alerts(s).process(AlertInput(listOf(booking()), listOf(drop(alert = false))))
        assertEquals(0, s.sends.size)
        assertEquals(0, r.sent)
    }

    @Test
    fun aNewPriceDropIsSentOnceAsOneNotice() {
        val s = FakeSender()
        val state = MemoryAlertState()
        val a = alerts(s, state)
        val input = AlertInput(listOf(booking()), listOf(drop()))
        val r = a.process(input)
        assertEquals(1, r.sent)
        assertEquals(1, s.sends.size)
        assertEquals(1, s.sends[0].first)
        assertEquals(NoticeEncoder.pack(listOf(NoticeEncoder.priceDrop("The Key", 109.0, 89.0))).toList(), s.sends[0].second.toList())
        // The next check finds the same drop: nothing more is sent.
        assertEquals(0, a.process(input).sent)
        assertEquals(1, s.sends.size)
    }

    @Test
    fun aFurtherDropOnTheSameItemAlertsAgain() {
        val s = FakeSender()
        val a = alerts(s)
        a.process(AlertInput(listOf(booking()), listOf(drop(current = 89.0))))
        a.process(AlertInput(listOf(booking()), listOf(drop(current = 79.0))))
        assertEquals(2, s.sends.size)
    }

    @Test
    fun aDropThatWentAwayAndCameBackAlertsAgain() {
        val s = FakeSender()
        val a = alerts(s)
        a.process(AlertInput(listOf(booking()), listOf(drop())))
        a.process(AlertInput(listOf(booking()), listOf(drop(alert = false))))
        a.process(AlertInput(listOf(booking()), listOf(drop())))
        assertEquals(2, s.sends.size)
    }

    @Test
    fun anUndeliveredAlertWaitsForTheNextCheck() {
        val s = FakeSender(delivered = false)
        val state = MemoryAlertState()
        val a = alerts(s, state)
        val input = AlertInput(listOf(booking()), listOf(drop()))
        val r = a.process(input)
        assertEquals(0, r.sent)
        assertEquals(1, r.pending)
        assertTrue(state.sentKeys().isEmpty())
        s.delivered = true
        assertEquals(1, a.process(input).sent)
        assertEquals(2, s.sends.size)
    }

    @Test
    fun checkinOpenThenCheckedInEachSendOnce() {
        val s = FakeSender()
        val a = alerts(s)
        a.process(AlertInput(listOf(booking("Opens Dec 10 8:00 AM")), emptyList()))
        assertEquals(0, s.sends.size)
        a.process(AlertInput(listOf(booking("Open now")), emptyList()))
        a.process(AlertInput(listOf(booking("Open (window 11:30)")), emptyList()))
        assertEquals(1, s.sends.size)
        assertEquals(NoticeKind.CHECKIN_OPEN, s.sends[0].second[0].toInt())
        // A failed lookup reads as "TBD" and must not repeat the alert when it opens again.
        a.process(AlertInput(listOf(booking("TBD")), emptyList()))
        a.process(AlertInput(listOf(booking("Open now")), emptyList()))
        assertEquals(1, s.sends.size)
        a.process(AlertInput(listOf(booking("Boarding 11:30 AM - 12:00 PM")), emptyList()))
        a.process(AlertInput(listOf(booking("Checked in")), emptyList()))
        assertEquals(2, s.sends.size)
        assertEquals(NoticeKind.CHECKIN_DONE, s.sends[1].second[0].toInt())
        val done = NoticeEncoder.pack(listOf(NoticeEncoder.checkinDone("Harmony of the Seas Dec 12", "11:30 AM - 12:00 PM")))
        assertEquals(done.toList(), s.sends[1].second.toList())
    }

    @Test
    fun paymentRemindersComeAtSevenThreeOneAndZeroDaysThenOverdue() {
        val s = FakeSender()
        var now = LocalDate.of(2026, 12, 1)
        val a = WatchAlerts(s, MemoryAlertState(), NoticeEncoder) { now }
        val input = AlertInput(listOf(booking(pay = "20261210", due = true)), emptyList())
        fun at(d: LocalDate) { now = d; a.process(input) }
        at(LocalDate.of(2026, 12, 1)) // 9 days: too early
        assertEquals(0, s.sends.size)
        at(LocalDate.of(2026, 12, 3)) // 7 days
        at(LocalDate.of(2026, 12, 4)) // 6 days: same step
        assertEquals(1, s.sends.size)
        at(LocalDate.of(2026, 12, 7)) // 3
        at(LocalDate.of(2026, 12, 9)) // 1
        at(LocalDate.of(2026, 12, 10)) // 0
        at(LocalDate.of(2026, 12, 11)) // overdue
        at(LocalDate.of(2026, 12, 20)) // still overdue: once
        assertEquals(5, s.sends.size)
        assertEquals(NoticeKind.PAYMENT, s.sends[4].second[0].toInt())
    }

    @Test
    fun noPaymentReminderWithoutABalanceOrOnceTheBalanceIsPaid() {
        val s = FakeSender()
        val a = alerts(s)
        a.process(AlertInput(listOf(booking(pay = "20261203", due = false), booking(pay = "20261203", due = null, id = "R2")), emptyList()))
        assertEquals(0, s.sends.size)
    }

    @Test
    fun atMostEightNoticesPerMessageTheRestWait() {
        val s = FakeSender()
        val a = alerts(s)
        val drops = (1..10).map { drop(item = "Item $it", current = 50.0 + it) }
        val input = AlertInput(listOf(booking()), drops)
        assertEquals(8, a.process(input).sent)
        val second = a.process(input)
        assertEquals(2, second.sent)
        assertEquals(listOf(8, 2), s.sends.map { it.first })
        assertEquals(0, a.process(input).sent)
    }

    @Test
    fun forgetsKeysOfBookingsThatAreGone() {
        val state = MemoryAlertState()
        val a = alerts(FakeSender(), state)
        a.process(AlertInput(listOf(booking("Open now")), emptyList()))
        assertEquals(setOf("open|R1"), state.sentKeys())
        a.process(AlertInput(listOf(booking("TBD", id = "R2")), emptyList()))
        assertTrue(state.sentKeys().isEmpty())
    }
}
