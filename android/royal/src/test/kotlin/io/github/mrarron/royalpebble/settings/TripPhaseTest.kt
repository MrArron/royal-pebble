package io.github.mrarron.royalpebble.settings

import io.github.mrarron.royalpebble.settings.TripPhase.Mode
import io.github.mrarron.royalpebble.settings.TripPhase.Phase
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TripPhaseTest {
    private val days = listOf("2026-12-12", "2026-12-13", "2026-12-19")

    @Test
    fun autoIsOnBoardFromTheFirstDayThroughTheLast() {
        assertEquals(Phase.PLANNING, TripPhase.auto(days, "2026-12-11", false))
        assertEquals(Phase.ONBOARD, TripPhase.auto(days, "2026-12-12", false))
        assertEquals(Phase.ONBOARD, TripPhase.auto(days, "2026-12-19", false))
        assertEquals(Phase.PLANNING, TripPhase.auto(days, "2026-12-20", false))
    }

    @Test
    fun demoAndNoItineraryArePlanning() {
        assertEquals(Phase.PLANNING, TripPhase.auto(days, "2026-12-13", true))
        assertEquals(Phase.PLANNING, TripPhase.auto(emptyList(), "2026-12-13", false))
        assertEquals(Phase.PLANNING, TripPhase.auto(listOf("soon"), "2026-12-13", false))
    }

    @Test
    fun theOwnersPickWins() {
        assertEquals(Phase.ONBOARD, TripPhase.effective(Mode.ONBOARD, Phase.PLANNING))
        assertEquals(Phase.PLANNING, TripPhase.effective(Mode.PLANNING, Phase.ONBOARD))
        assertEquals(Phase.ONBOARD, TripPhase.effective(Mode.AUTO, Phase.ONBOARD))
        assertEquals(Mode.AUTO, Mode.of(null))
        assertEquals(Mode.ONBOARD, Mode.of("onboard"))
    }

    @Test
    fun daysToGo() {
        assertEquals(27L, TripPhase.daysToGo("2026-12-12", "2026-11-15"))
        assertEquals(-1L, TripPhase.daysToGo("2026-12-12", "2026-12-13"))
        assertNull(TripPhase.daysToGo("", "2026-12-13"))
    }
}
