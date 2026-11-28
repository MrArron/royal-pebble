package io.github.mrarron.royalpebble.alerts

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDateTime
import java.time.LocalTime

class PriceWatchTest {
    private fun watch(rule: WatchRule = WatchRule.ANY_DROP, baseline: Double? = 80.0, percent: Double = 0.0, target: Double = 0.0, res: String = "") =
        PriceWatch("w1", "Surf", "pt_internet", "7", reservationId = res, rule = rule, baseline = baseline, percent = percent, target = target)

    private fun row(price: Double?, code: String = "pt_internet/7", res: String = "R1", status: String = "priced") =
        WatchedRow(res, code, "Surf + Stream", price, "USD", status)

    @Test
    fun defaultRuleAlertsOnAnyDropBelowTheStartingPrice() {
        val w = watch()
        assertEquals(80.0, w.triggerPrice()!!, 0.0)
        assertFalse(w.isHit(80.0))
        assertTrue(w.isHit(79.99))
        assertFalse(w.isHit(85.0))
    }

    @Test
    fun percentRuleAlertsAtThatManyPercentBelow() {
        val w = watch(WatchRule.PERCENT, percent = 20.0)
        assertEquals(64.0, w.triggerPrice()!!, 0.0)
        assertTrue(w.isHit(64.0))
        assertFalse(w.isHit(64.5))
    }

    @Test
    fun belowRuleUsesTheUsersPriceWithoutAStartingPrice() {
        val w = watch(WatchRule.BELOW, baseline = null, target = 70.0)
        assertEquals(70.0, w.triggerPrice()!!, 0.0)
        assertTrue(w.isHit(69.0))
        assertFalse(w.isHit(70.0))
    }

    @Test
    fun withoutAStartingPriceTheScriptOnlyRecordsThePrice() {
        val w = watch(baseline = null)
        assertNull(w.triggerPrice())
        assertEquals(0.01, w.scriptPrice(), 0.0)
        assertFalse(w.isHit(1.0))
        assertEquals(80.0, watch().scriptPrice(), 0.0)
    }

    @Test
    fun theFirstCheckSetsTheStartingPriceAndDoesNotAlert() {
        val u = PriceWatches.apply(listOf(watch(baseline = null)), listOf(row(30.0)), 1000)
        val w = u.watches.single()
        assertEquals(30.0, w.baseline!!, 0.0)
        assertEquals(30.0, w.lastPrice!!, 0.0)
        assertEquals("priced", w.lastStatus)
        assertTrue(u.hits.isEmpty())
        assertEquals("1 watch, 1 priced, 0 below the trigger, starting price set for 1", u.summary)
    }

    @Test
    fun aLaterDropAlertsWithAKeyThatFollowsThePrice() {
        val start = PriceWatches.apply(listOf(watch(baseline = null)), listOf(row(30.0)), 1000).watches
        val u = PriceWatches.apply(start, listOf(row(25.0), row(26.0, res = "R2")), 2000)
        val h = u.hits.single()
        assertEquals(25.0, h.price, 0.0)
        assertEquals("watch|w1|25.0", h.key)
        assertEquals(17, h.percentOff)
        assertEquals(30.0, u.watches.single().baseline!!, 0.0) // the starting price stays
    }

    @Test
    fun aWatchOnOneBookingIgnoresOtherBookings() {
        val u = PriceWatches.apply(listOf(watch(res = "R2")), listOf(row(10.0, res = "R1")), 1)
        assertTrue(u.hits.isEmpty())
        assertEquals("not in the last check", u.watches.single().lastStatus)
    }

    @Test
    fun unpricedRowsKeepTheScriptsStatus() {
        val u = PriceWatches.apply(listOf(watch()), listOf(row(null, status = "not_available_for_passenger")), 1)
        assertEquals("not_available_for_passenger", u.watches.single().lastStatus)
        assertNull(u.watches.single().lastPrice)
    }

    @Test
    fun aMutedWatchDoesNotAlertButIsCounted() {
        val u = PriceWatches.apply(listOf(watch()), listOf(row(50.0)), 1, muted = setOf("watch|w1"))
        assertTrue(u.hits.isEmpty())
        assertEquals("1 watch, 1 priced, 1 below the trigger (1 muted)", u.summary)
    }

    @Test
    fun watchesSurviveEncodeAndDecode() {
        val w = watch(WatchRule.PERCENT, percent = 12.5, res = "R9").copy(lastPrice = 70.0, createdAt = 5, lastCheckedAt = 6)
        assertEquals(listOf(w), PriceWatches.decode(PriceWatches.encode(listOf(w))))
        assertTrue(PriceWatches.decode("not json").isEmpty())
    }

    @Test
    fun scriptJsonHasWhatRcpRunnerReads() {
        assertEquals(
            """[{"name":"Surf","prefix":"pt_internet","product":"7","price":80.0,"guestAgeString":"adult","reservation":"R1"}]""",
            PriceWatches.scriptJson(listOf(watch(res = "R1"))),
        )
    }

    @Test
    fun productLinksAreFoundInSharedText() {
        val l = ProductLink.parse("Look at this https://www.royalcaribbean.com/account/cruise-planner/category/pt_beverage/product/3001?bookingId=1234567&shipCode=HM&sailDate=20261212")!!
        assertEquals(ProductLink("pt_beverage", "3001", "1234567"), l)
        assertEquals(ProductLink("pt_internet", "IN01", ""), ProductLink.parse("/category/pt_internet/product/IN01"))
        assertNull(ProductLink.parse("https://www.royalcaribbean.com/cruise-ships"))
    }

    @Test
    fun watchNoticesFitTheWatchLines() {
        val n = NoticeEncoder.watchHit(WatchHit("w1", "Surf + Stream", 25.0, 30.0, 30.0, WatchRule.ANY_DROP, "USD", ""))
        assertEquals(NoticeKind.PRICE, n.kind)
        assertEquals("Now $25.00 (-17%)", n.first)
        assertEquals("Was $30.00 when set", n.second)
        val b = NoticeEncoder.watchHit(WatchHit("w1", "Deluxe", 1180.0, 1300.0, 1200.0, WatchRule.BELOW, "USD", ""))
        assertEquals("Now $1,180 (-9%)", b.first)
        assertEquals("Below your $1,200", b.second)
        assertTrue(n.first.length <= 23 && n.second.length <= 23)
    }

    @Test
    fun mutesAreKeptOnceAndCanBeUndone() {
        var m = AlertMutes.mute(emptyList(), "watch|w1", "Surf", 1)
        m = AlertMutes.mute(m, "watch|w1", "Surf", 2)
        assertEquals(1, m.size)
        assertEquals(m, AlertMutes.decode(AlertMutes.encode(m)))
        assertTrue(AlertMutes.unmute(m, "watch|w1").isEmpty())
    }

    @Test
    fun aWatchOnlyCountsRowsOfItsOwnSailing() {
        val w = watch().copy(shipCode = "HM", sailDate = "2026-12-12")
        val dec = row(80.0).copy(shipCode = "HM", sailDate = "20261212")
        val mar = row(28.0, res = "R2").copy(shipCode = "EX", sailDate = "20270319")
        val u = PriceWatches.apply(listOf(w), listOf(mar, dec), 1000)
        assertEquals(80.0, u.watches.single().lastPrice!!, 0.0)   // the cheaper March row is ignored
        assertTrue(u.hits.isEmpty())
        val only = PriceWatches.apply(listOf(w), listOf(mar), 1000).watches.single()
        assertEquals("not in the last check", only.lastStatus)
        // Rows without a sailing (older results) and watches without one still match.
        assertEquals(30.0, PriceWatches.apply(listOf(w), listOf(row(30.0)), 1).watches.single().lastPrice!!, 0.0)
        assertEquals(28.0, PriceWatches.apply(listOf(watch()), listOf(mar), 1).watches.single().lastPrice!!, 0.0)
    }

    @Test
    fun sailingSurvivesStorageAndReachesTheScript() {
        val w = watch().copy(shipCode = "HM", sailDate = "2026-12-12")
        assertEquals(w, PriceWatches.decode(PriceWatches.encode(listOf(w))).single())
        val sent = PriceWatches.scriptJson(listOf(w))
        assertTrue(sent.contains("\"ship\":\"HM\"") && sent.contains("\"sailDate\":\"20261212\""))
        // A watch tied to one booking sends just that booking.
        assertFalse(PriceWatches.scriptJson(listOf(w.copy(reservationId = "R1"))).contains("sailDate"))
    }
}

class QuietHoursTest {
    private val q = QuietHours()

    @Test
    fun defaultWindowIsEightToNine() {
        assertFalse(q.allowed(LocalTime.of(7, 59)))
        assertTrue(q.allowed(LocalTime.of(8, 0)))
        assertTrue(q.allowed(LocalTime.of(20, 59)))
        assertFalse(q.allowed(LocalTime.of(21, 0)))
        assertFalse(q.allowed(LocalTime.MIDNIGHT))
        assertEquals("8:00 AM to 9:00 PM", q.text())
    }

    @Test
    fun heldAlertsGoOutWhenTheWindowOpens() {
        val late = LocalDateTime.of(2026, 12, 1, 23, 30)
        assertEquals(LocalDateTime.of(2026, 12, 2, 8, 0), q.nextAllowed(late))
        val early = LocalDateTime.of(2026, 12, 2, 3, 0)
        assertEquals(LocalDateTime.of(2026, 12, 2, 8, 0), q.nextAllowed(early))
        val day = LocalDateTime.of(2026, 12, 2, 12, 0)
        assertEquals(day, q.nextAllowed(day))
    }

    @Test
    fun storedValuesOutsideTheChoicesFallBackSoNothingArrivesOvernight() {
        assertEquals(QuietHours(), QuietHours.of(0, 24 * 60))
        assertEquals(QuietHours(9 * 60, 22 * 60), QuietHours.of(9 * 60, 22 * 60))
    }
}
