package io.github.mrarron.royalpebble.alerts

/** A booking as the sailing picker sees it (from a price check's bookings). [sailDate] is `YYYYMMDD` or `YYYY-MM-DD`. */
data class BookingRef(val reservationId: String, val shipCode: String, val shipName: String, val sailDate: String)

/**
 * One sailing in the picker: every booking of a ship and sail date (a linked guest's booking is part of it),
 * or a sailing the user added by downloading it in Trip, which may have no booking yet.
 */
data class SailingOption(
    val key: String,
    val shipCode: String,
    val shipName: String,
    /** `YYYY-MM-DD`. */
    val sailDate: String,
    val reservationIds: Set<String>,
    val booked: Boolean,
) {
    val label: String get() = "${shipName.ifBlank { shipCode }} · $sailDate" + if (booked) "" else " (added)"

    fun owns(reservationId: String) = reservationId in reservationIds

    /**
     * Whether a price watch belongs to this sailing: its booking is one of ours, or it was set from this
     * sailing. A watch not yet tied to anything (set before sailings were recorded) shows under every sailing.
     */
    fun owns(w: PriceWatch): Boolean = when {
        w.reservationId.isNotBlank() -> w.reservationId in reservationIds
        w.shipCode.isBlank() || w.sailDate.isBlank() -> true
        else -> SailingView.key(w.shipCode, w.sailDate) == key
    }
}

/**
 * The sailing selector: which sailings the app knows, and what belongs to the selected one. It only limits
 * what the screens show; background checks, schedule refresh and alerts always cover every booking and watch.
 */
object SailingView {
    /** Empty selection: all sailings. */
    const val ALL = ""

    fun key(shipCode: String, sailDate: String) = "${shipCode.trim().uppercase()}|${sailDate.replace("-", "")}"

    private fun dashed(d: String): String {
        val s = d.replace("-", "")
        return if (s.length == 8) "${s.substring(0, 4)}-${s.substring(4, 6)}-${s.substring(6)}" else d
    }

    /**
     * The picker's list, soonest first: sailings with a booking in the last check, plus [added] (the sailing
     * downloaded in Trip) when no booking covers it.
     */
    fun options(bookings: List<BookingRef>, added: BookingRef? = null): List<SailingOption> {
        fun code(b: BookingRef) = b.shipCode.ifBlank { b.shipName }
        val booked = bookings.filter { it.sailDate.isNotBlank() && code(it).isNotBlank() }
            .groupBy { key(code(it), it.sailDate) }
            .map { (k, list) ->
                val f = list.first()
                SailingOption(k, f.shipCode, f.shipName, dashed(f.sailDate), list.mapTo(HashSet()) { it.reservationId }, true)
            }
        val extra = added?.takeIf { it.sailDate.isNotBlank() && code(it).isNotBlank() }?.let {
            val k = key(code(it), it.sailDate)
            if (booked.any { o -> o.key == k }) null
            else SailingOption(k, it.shipCode, it.shipName, dashed(it.sailDate), emptySet(), false)
        }
        return (booked + listOfNotNull(extra)).sortedBy { it.sailDate }
    }

    /** The selected option, or null for all sailings (or a stored choice that is gone). */
    fun selected(options: List<SailingOption>, selectedKey: String): SailingOption? =
        if (selectedKey == ALL) null else options.firstOrNull { it.key == selectedKey }

    fun watches(all: List<PriceWatch>, sailing: SailingOption?): List<PriceWatch> =
        if (sailing == null) all else all.filter { sailing.owns(it) }
}
