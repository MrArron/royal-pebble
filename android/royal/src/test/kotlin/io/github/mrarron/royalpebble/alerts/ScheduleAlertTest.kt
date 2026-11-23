package io.github.mrarron.royalpebble.alerts

import io.github.mrarron.royalpebble.settings.CruiseData
import io.github.mrarron.royalpebble.settings.DemoBundle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDateTime

class ScheduleAlertTest {
    private fun counts(events: Int, free: Int = events, reserve: Int = 0, published: Boolean = true) =
        ScheduleCounts(published, events, free, reserve)

    @Test
    fun firstAlertWhenTheScheduleAppears() {
        val d = ScheduleAlert.decide(ScheduleCounts.NONE, counts(412, 380, 45), 0, muted = false)
        assertEquals("first", d.reason)
        assertEquals(412, d.baseline)
        assertEquals("up: 412 events, 380 free, 45 to reserve", d.logText)
    }

    @Test
    fun noAlertUntilThereAreEnoughEvents() {
        assertNull(ScheduleAlert.decide(ScheduleCounts.NONE, counts(5), 0, false).reason)
        assertNull(ScheduleAlert.decide(ScheduleCounts.NONE, counts(300, published = false), 0, false).reason)
        assertEquals(0, ScheduleAlert.decide(ScheduleCounts.NONE, counts(5), 0, false).baseline)
        assertEquals("not up yet (300 events, 300 free, 0 to reserve, not published)",
            ScheduleAlert.decide(ScheduleCounts.NONE, counts(300, published = false), 0, false).logText)
    }

    @Test
    fun aScheduleThatWasAlreadyThereOnlySetsTheBaseline() {
        val d = ScheduleAlert.decide(counts(400), counts(410), 0, false)
        assertNull(d.reason)
        assertEquals(410, d.baseline)
    }

    @Test
    fun alertsAgainOnlyWhenItGrowsALot() {
        assertNull(ScheduleAlert.decide(counts(100), counts(110), 100, false).reason)
        assertEquals(100, ScheduleAlert.decide(counts(100), counts(110), 100, false).baseline)
        assertNull("+25% but under 20 events", ScheduleAlert.decide(counts(40), counts(55), 40, false).reason)
        val d = ScheduleAlert.decide(counts(100), counts(125), 100, false)
        assertEquals("grew", d.reason)
        assertEquals(125, d.baseline)
        assertNull("a smaller schedule keeps the baseline", ScheduleAlert.decide(counts(125), counts(90), 125, false).reason)
        assertEquals(125, ScheduleAlert.decide(counts(125), counts(90), 125, false).baseline)
    }

    @Test
    fun mutedSetsTheBaselineWithoutAlerting() {
        val d = ScheduleAlert.decide(ScheduleCounts.NONE, counts(412), 0, muted = true)
        assertNull(d.reason)
        assertEquals(412, d.baseline)
        assertNull(ScheduleAlert.decide(counts(100), counts(200), 100, muted = true).reason)
    }

    @Test
    fun textsSayItIsUpAndWhatIsFree() {
        val name = ScheduleAlert.sailingName("Harmony of the Seas", "2026-12-12")
        assertEquals("Harmony of the Seas Dec 12", name)
        assertEquals("Schedule is up: Harmony of the Seas Dec 12", ScheduleAlert.phoneTitle("first", name))
        assertEquals("More of the schedule is up: Harmony of the Seas Dec 12", ScheduleAlert.phoneTitle("grew", name))
        assertEquals("412 events posted, 380 free, 45 free shows and activities to reserve. Reserve them in the Royal app before they fill up.",
            ScheduleAlert.phoneText("first", counts(412, 380, 45), 0))
        assertTrue(ScheduleAlert.phoneText("grew", counts(412, 380, 45), 300).startsWith("Now 412 events (was 300), "))
        assertEquals("schedule|HM|2026-12-12", ScheduleAlert.muteKey("HM", "2026-12-12"))
    }

    @Test
    fun theWatchNoticeFitsAndPacks() {
        val n = ScheduleAlert.watchNotice("Harmony of the Seas Dec 12", counts(1412, 1380, 145))
        assertEquals(NoticeKind.SCHEDULE, n.kind)
        assertEquals("1412 events, 1380 free", n.first)
        assertEquals("145 to reserve", n.second)
        assertTrue(n.first.length <= 23 && n.second.length <= 23 && n.title.length <= 39)
        assertEquals("Book in the Royal app", ScheduleAlert.watchNotice("x", counts(30)).second)
        val bytes = NoticeEncoder.pack(listOf(n))
        assertEquals(NoticeKind.SCHEDULE, bytes[0].toInt())
    }

    @Test
    fun countsComeFromTheBundleWithoutExcursions() {
        val b = DemoBundle.make(LocalDateTime.of(2027, 3, 8, 12, 0)).bundle
        val c = ScheduleCounts.of(b)
        val all = CruiseData.events(b)
        assertEquals(all.count { !it.isExcursion }, c.events)
        assertTrue(c.free in 1..c.events)
        assertTrue(c.toReserve <= c.free)
        assertEquals(ScheduleCounts.NONE, ScheduleCounts.of(null))
    }
}
