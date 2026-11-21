package io.github.mrarron.royalpebble.alerts

import java.time.LocalDateTime
import java.time.LocalTime

/**
 * When alerts from background checks may reach the phone and the watch: from [fromMinute] to
 * [untilMinute] local time (default 8:00 AM to 9:00 PM). Alerts found outside it are held until
 * the window opens. The choices are limited ([FROM_CHOICES], [UNTIL_CHOICES]) so an alert can
 * never arrive overnight.
 */
data class QuietHours(val fromMinute: Int = DEFAULT_FROM, val untilMinute: Int = DEFAULT_UNTIL) {
    fun allowed(t: LocalTime): Boolean {
        val m = t.hour * 60 + t.minute
        return m in fromMinute until untilMinute
    }

    /** [now] when alerts may go out now, else the next opening of the window. */
    fun nextAllowed(now: LocalDateTime): LocalDateTime {
        if (allowed(now.toLocalTime())) return now
        val open = now.toLocalDate().atTime(fromMinute / 60, fromMinute % 60)
        return if (open.isAfter(now)) open else open.plusDays(1)
    }

    /** "8:00 AM to 9:00 PM". */
    fun text(): String = "${clock(fromMinute)} to ${clock(untilMinute)}"

    companion object {
        const val DEFAULT_FROM = 8 * 60
        const val DEFAULT_UNTIL = 21 * 60
        val FROM_CHOICES = listOf(7 * 60, 8 * 60, 9 * 60, 10 * 60)
        val UNTIL_CHOICES = listOf(20 * 60, 21 * 60, 22 * 60)

        /** A stored pair, clamped to the allowed choices (anything else falls back to the default). */
        fun of(fromMinute: Int, untilMinute: Int) = QuietHours(
            if (fromMinute in FROM_CHOICES) fromMinute else DEFAULT_FROM,
            if (untilMinute in UNTIL_CHOICES) untilMinute else DEFAULT_UNTIL,
        )

        fun clock(minute: Int): String {
            val h = minute / 60
            val h12 = if (h % 12 == 0) 12 else h % 12
            return "$h12:${(minute % 60).toString().padStart(2, '0')} ${if (h < 12) "AM" else "PM"}"
        }
    }
}
