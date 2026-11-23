package io.github.mrarron.royalpebble.settings

import java.time.LocalDate
import java.time.temporal.ChronoUnit

/** When the app's background schedule refresh runs (the app's ScheduleRefresh); plain rules, so they run in JVM tests. */
object RefreshRules {
    /** Royal publishes the schedule about two weeks before sailing; start a week early to catch it the day it's posted. */
    const val DAYS_BEFORE = 21L
    /** At most one refresh this often, however often the price checks run. */
    const val MIN_GAP_HOURS = 6L

    /** Why the refresh shouldn't run now, or null when it should. Fixed wording plus counts, safe to log. */
    fun skipReason(
        enabled: Boolean, sailDate: String?, lastDay: String?, today: LocalDate, hasLogin: Boolean,
        lastRunMs: Long, nowMs: Long,
    ): String? {
        if (!enabled) return "off"
        val sail = sailDate?.let { runCatching { LocalDate.parse(it) }.getOrNull() } ?: return "no saved sailing"
        val end = lastDay?.let { runCatching { LocalDate.parse(it) }.getOrNull() } ?: sail
        val before = ChronoUnit.DAYS.between(today, sail)
        if (before > DAYS_BEFORE) return "$before days before sailing (the refresh starts $DAYS_BEFORE days out)"
        if (today.isAfter(end)) return "the cruise is over"
        if (!hasLogin) return "no remembered Royal Caribbean login (Download with login and Remember it)"
        val since = nowMs - lastRunMs
        if (lastRunMs > 0 && since in 0 until MIN_GAP_HOURS * 3_600_000L) {
            return "last refresh ${since / 60_000} min ago (at most once every $MIN_GAP_HOURS h)"
        }
        return null
    }

}
