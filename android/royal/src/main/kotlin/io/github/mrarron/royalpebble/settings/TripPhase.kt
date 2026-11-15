package io.github.mrarron.royalpebble.settings

import java.time.LocalDate
import java.time.temporal.ChronoUnit

/**
 * Which tab set the Android app shows: Planning (Trip, Prices, Plan, Settings)
 * or On board (Today, Events, Cabin, Settings). The owner picks Auto, Planning or
 * On board; Auto is On board from the sailing's first itinerary day through
 * its last, by the phone's date, and Planning otherwise (months out, and after
 * the cruise). The demo cruise, shown before a download, always counts as Planning.
 */
object TripPhase {
    enum class Mode(val key: String, val label: String) {
        AUTO("auto", "Auto"), PLANNING("planning", "Planning"), ONBOARD("onboard", "On board");

        companion object {
            fun of(key: String?): Mode = entries.firstOrNull { it.key == key } ?: AUTO
        }
    }

    enum class Phase(val key: String) { PLANNING("planning"), ONBOARD("onboard") }

    /** Auto's answer for [today] (YYYY-MM-DD) and the itinerary's dates. */
    fun auto(itineraryDates: List<String>, today: String, isDemo: Boolean): Phase {
        if (isDemo) return Phase.PLANNING
        val dates = itineraryDates.filter { isIsoDate(it) }.sorted()
        if (dates.isEmpty()) return Phase.PLANNING
        return if (today >= dates.first() && today <= dates.last()) Phase.ONBOARD else Phase.PLANNING
    }

    fun effective(mode: Mode, auto: Phase): Phase = when (mode) {
        Mode.AUTO -> auto
        Mode.PLANNING -> Phase.PLANNING
        Mode.ONBOARD -> Phase.ONBOARD
    }

    /** Days from [today] to [sailDate] (both YYYY-MM-DD), or null when either isn't a date. Negative once sailed. */
    fun daysToGo(sailDate: String, today: String): Long? {
        if (!isIsoDate(sailDate) || !isIsoDate(today)) return null
        return runCatching { ChronoUnit.DAYS.between(LocalDate.parse(today), LocalDate.parse(sailDate)) }.getOrNull()
    }
}
