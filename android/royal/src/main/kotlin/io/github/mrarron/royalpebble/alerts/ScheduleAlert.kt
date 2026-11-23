package io.github.mrarron.royalpebble.alerts

import io.github.mrarron.royalpebble.settings.CruiseData
import kotlinx.serialization.json.JsonObject
import java.time.LocalDate

/** The schedule's size in a bundle: what the "schedule is up" alert counts. */
data class ScheduleCounts(
    val published: Boolean,
    /** Every event, shore excursions left out. */
    val events: Int,
    /** Events with no price and no "Fee applies" note. */
    val free: Int,
    /** Free events that take a reservation (the shows): the ones that fill up. */
    val toReserve: Int,
) {
    companion object {
        val NONE = ScheduleCounts(false, 0, 0, 0)

        fun of(bundle: JsonObject?): ScheduleCounts {
            val list = CruiseData.events(bundle).filter { !it.isExcursion }
            val free = list.filter { !it.paid && !it.fee && (it.price ?: 0) == 0 }
            return ScheduleCounts(
                published = CruiseData.schedulePublished(bundle),
                events = list.size,
                free = free.size,
                toReserve = free.count { it.reservation },
            )
        }
    }
}

/** What to do after a background schedule refresh. */
data class ScheduleDecision(
    /** "first" (the schedule is up), "grew" (a lot more was added), or null: no alert. */
    val reason: String?,
    /** The event count to remember for this sailing (the next "grew" compares with it). */
    val baseline: Int,
    /** Fixed wording plus counts, safe for the test log. */
    val logText: String,
)

/**
 * The "schedule is up" alert (docs/DESIGN.md §12): Royal posts a sailing's daily schedule about
 * two weeks out, often in parts, and the shows and activities that take a reservation fill up.
 * After each background refresh the app compares the schedule with the one it had:
 *
 * - **first**: the schedule became published with at least [MIN_EVENTS] events, and this sailing
 *   has never alerted. A schedule that was already there before the refresh (downloaded by hand)
 *   only sets the baseline, so it doesn't alert late.
 * - **grew**: after that, the count rose by [GROW_PERCENT]% and at least [GROW_MIN] events over the
 *   count the last alert (or baseline) saw.
 *
 * The baseline is kept per sailing ([sailingKey]), so another sailing starts over.
 */
object ScheduleAlert {
    const val MIN_EVENTS = 20
    const val GROW_PERCENT = 25
    const val GROW_MIN = 20

    fun sailingKey(shipCode: String, sailDate: String) = "$shipCode|$sailDate"

    /** The Mute key for this sailing's schedule alerts. */
    fun muteKey(shipCode: String, sailDate: String) = "schedule|${sailingKey(shipCode, sailDate)}"

    private fun up(s: ScheduleCounts) = s.published && s.events >= MIN_EVENTS

    /** [baseline] is the remembered count for this sailing, 0 when none. */
    fun decide(before: ScheduleCounts, after: ScheduleCounts, baseline: Int, muted: Boolean): ScheduleDecision {
        val counts = "${after.events} events, ${after.free} free, ${after.toReserve} to reserve"
        if (!up(after)) {
            return ScheduleDecision(null, baseline, "not up yet ($counts" + (if (after.published) "" else ", not published") + ")")
        }
        if (baseline == 0) {
            if (up(before)) return ScheduleDecision(null, after.events, "already up before this refresh ($counts), baseline set")
            return if (muted) ScheduleDecision(null, after.events, "up ($counts), muted")
            else ScheduleDecision("first", after.events, "up: $counts")
        }
        val grew = after.events - baseline >= GROW_MIN && after.events * 100 >= baseline * (100 + GROW_PERCENT)
        if (!grew) return ScheduleDecision(null, baseline, "no big change ($counts, alerted at $baseline)")
        return if (muted) ScheduleDecision(null, after.events, "grew from $baseline ($counts), muted")
        else ScheduleDecision("grew", after.events, "grew from $baseline: $counts")
    }

    /** "Harmony of the Seas Dec 12" (or the ship alone without a date). */
    fun sailingName(shipName: String, sailDate: String): String {
        val d = runCatching { LocalDate.parse(sailDate) }.getOrNull()
        val ship = shipName.ifBlank { "Your cruise" }
        return if (d == null) ship else "$ship ${NoticeEncoder.shortDate(d)}"
    }

    fun phoneTitle(reason: String, sailing: String) =
        if (reason == "grew") "More of the schedule is up: $sailing" else "Schedule is up: $sailing"

    fun phoneText(reason: String, after: ScheduleCounts, baseline: Int): String {
        val lead = if (reason == "grew") "Now ${after.events} events (was $baseline)" else "${after.events} events posted"
        return "$lead, ${after.free} free, ${after.toReserve} free shows and activities to reserve. " +
            "Reserve them in the Royal app before they fill up."
    }

    /**
     * The watch's NOTICE (kind [NoticeKind.SCHEDULE], head `SCHEDULE UP`): the sailing,
     * "412 events, 380 free" and "45 to reserve".
     */
    fun watchNotice(sailing: String, after: ScheduleCounts): BookingNotice = BookingNotice(
        NoticeKind.SCHEDULE, sailing, "${after.events} events, ${after.free} free",
        if (after.toReserve > 0) "${after.toReserve} to reserve" else "Book in the Royal app",
    )
}
