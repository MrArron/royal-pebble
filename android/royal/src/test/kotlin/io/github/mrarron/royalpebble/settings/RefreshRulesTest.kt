package io.github.mrarron.royalpebble.settings

import java.time.LocalDate
import org.junit.Test
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull

class RefreshRulesTest {
    private val sail = "2026-12-12"
    private val last = "2026-12-19"
    private val h = 3_600_000L

    private fun skip(today: String, login: Boolean = true, lastRun: Long = 0, now: Long = 100 * h, on: Boolean = true, date: String? = sail) =
        RefreshRules.skipReason(on, date, last, LocalDate.parse(today), login, lastRun, now)

    @Test
    fun runsFromThreeWeeksBeforeToTheLastDay() {
        assertEquals("22 days before sailing (the refresh starts 21 days out)", skip("2026-11-20"))
        assertNull(skip("2026-11-21"))
        assertNull(skip("2026-12-15"))
        assertNull(skip("2026-12-19"))
        assertEquals("the cruise is over", skip("2026-12-20"))
    }

    @Test
    fun needsTheSwitchASailingAndALogin() {
        assertEquals("off", skip("2026-12-01", on = false))
        assertEquals("no saved sailing", skip("2026-12-01", date = null))
        assertEquals("no remembered Royal Caribbean login (Download with login and Remember it)", skip("2026-12-01", login = false))
    }

    @Test
    fun atMostEverySixHours() {
        assertEquals("last refresh 300 min ago (at most once every 6 h)", skip("2026-12-01", lastRun = 95 * h))
        assertNull(skip("2026-12-01", lastRun = 94 * h))
        assertNull("a clock set back does not block it", skip("2026-12-01", lastRun = 101 * h))
    }
}
