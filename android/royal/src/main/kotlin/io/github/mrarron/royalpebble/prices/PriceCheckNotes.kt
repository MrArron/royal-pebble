package io.github.mrarron.royalpebble.prices

/**
 * Plain-language notes for the price check's output. jdeath's script (kept unmodified) prints some
 * things that read like errors but are normal: a guarantee booking has no cabin category yet, an item
 * isn't sold on that ship, Royal's catalog answers 500 for an item it doesn't have. This reads the
 * script's lines and says what they mean, once each. The raw output stays in Prices > Report.
 */
data class PriceNote(val title: String, val detail: String)

object PriceCheckNotes {
    private val ansi = Regex("\u001B\\[[0-9;]*[A-Za-z]")
    private val reservationLine = Regex("^Reservation #(\\w+)")
    private val bookingLine = Regex("^(\\d{2}/\\d{2}/\\d{2}) (.+?) Room (\\S+)")
    private val noCategory = Regex("^No stateroom category code could be resolved")
    private val noPricing = Regex("^(.+?): Server returned no pricing data")
    private val attemptFailed = Regex("^Attempt \\d+/\\d+ failed for (\\S+): Server Error (\\d+)")
    private val couldNotCheck = Regex("^(\\w+) (\\w+): could not check \\(request failed\\)")
    private val notAvailable = Regex("^(\\w+) (\\w+) not available for passenger")
    private val catalogUrl = Regex("/catalog/v2/(\\w+)/categories/(\\w+)/products/(\\w+)")

    private class Booking(val reservation: String, var ship: String = "", var date: String = "", var room: String = "")

    fun from(lines: List<String>): List<PriceNote> {
        val notes = LinkedHashMap<String, PriceNote>()
        var booking: Booking? = null
        val failedUrls = LinkedHashMap<String, Int>() // catalog url -> status
        val unchecked = LinkedHashMap<String, Int>() // "prefix/product" -> guests
        val unavailable = LinkedHashMap<String, Int>()

        fun where(b: Booking?) = if (b == null) "" else
            " (reservation ${b.reservation}${if (b.ship.isNotEmpty()) ", ${b.ship}, ${b.date}" else ""})"

        for (raw in lines) {
            val line = ansi.replace(raw, "").trim()
            if (line.isEmpty()) continue
            reservationLine.find(line)?.let { booking = Booking(it.groupValues[1]); return@let }
            bookingLine.find(line)?.let { m ->
                booking?.apply { date = m.groupValues[1]; ship = m.groupValues[2]; room = m.groupValues[3] }
            }
            if (noCategory.containsMatchIn(line)) {
                val b = booking
                if (b != null && b.room == "GTY") {
                    notes["gty|${b.reservation}"] = PriceNote(
                        "No cabin assigned yet${where(b)}",
                        "This is a guarantee booking, so Royal hasn't picked a cabin category. Cruise fare " +
                            "prices can't be checked until it does; nothing to fix. Your drink, activity and " +
                            "excursion prices are checked as usual.",
                    )
                } else {
                    notes["cat|${b?.reservation}"] = PriceNote(
                        "Cabin category not found${where(b)}",
                        "Royal didn't say which cabin category this booking is. Cruise fare prices need " +
                            "categoryOverride in the config for this reservation.",
                    )
                }
                continue
            }
            noPricing.find(line)?.let { m ->
                val b = booking
                notes["nopricing|${b?.reservation}|${m.groupValues[1]}"] = PriceNote(
                    "${m.groupValues[1]}: no price${where(b)}",
                    "Royal has no price for this item on this booking, usually because it isn't sold on " +
                        "that ship or sailing. Not a problem with the app or your account.",
                )
                return@let
            }
            attemptFailed.find(line)?.let { m ->
                failedUrls[m.groupValues[1]] = m.groupValues[2].toInt()
                return@let
            }
            couldNotCheck.find(line)?.let { m ->
                val k = "${m.groupValues[1]}/${m.groupValues[2]}"
                unchecked[k] = (unchecked[k] ?: 0) + 1
            }
            notAvailable.find(line)?.let { m ->
                val k = "${m.groupValues[1]}/${m.groupValues[2]}"
                unavailable[k] = (unavailable[k] ?: 0) + 1
            }
        }
        for ((url, status) in failedUrls) {
            val m = catalogUrl.find(url)
            val item = m?.let { "${it.groupValues[2]}/${it.groupValues[3]}" }
            val ship = m?.groupValues?.get(1)
            val guests = item?.let { unchecked[it] }
            notes["500|$url"] = PriceNote(
                "Royal's server answered error $status" + if (item != null) " for $item" else "",
                (if (ship != null) "Royal's catalog for ship $ship had a problem with this item. " else "Royal's server had a problem. ") +
                    "That usually means the item isn't sold on that ship, or Royal is having a bad moment. " +
                    "The script tried 3 times" + (if (guests != null && guests > 1) " for each of $guests guests" else "") +
                    " and moved on; the rest of the check is fine. If a watch needs it, set the watch's booking so only that ship is asked.",
            )
        }
        for ((item, n) in unchecked) {
            if (failedUrls.keys.any { it.endsWith("/categories/${item.replace('/', '/products/')}") }) continue
            notes["unchecked|$item"] = PriceNote(
                "Couldn't check $item" + if (n > 1) " ($n guests)" else "",
                "Royal didn't answer for this item; it will be tried again on the next check.",
            )
        }
        for ((item, n) in unavailable) {
            notes["unavail|$item"] = PriceNote(
                "$item isn't available for ${if (n > 1) "$n guests" else "the guest"}",
                "Royal doesn't offer it to this booking right now; that's normal for items that aren't open to book yet.",
            )
        }
        return notes.values.toList()
    }

    fun text(notes: List<PriceNote>): String = notes.joinToString("\n") { "- ${it.title}\n  ${it.detail}" }
}
