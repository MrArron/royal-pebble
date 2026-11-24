package io.github.mrarron.royalpebble.alerts

import io.github.mrarron.royalpebble.settings.CruiseData
import io.github.mrarron.royalpebble.settings.EXCURSIONS
import kotlinx.serialization.json.JsonObject

/**
 * One product from the downloaded schedule that a price watch can be set on without a link.
 * The schedule pull gives a product's id ([product]) and its adult "from" price ([listedPrice]);
 * the Cruise Planner type id ([prefix]) is only known for shore excursions (`pt_shoreX`).
 */
data class WatchCandidate(
    val prefix: String,
    val product: String,
    val title: String,
    /** The adult "from" price in whole dollars when the schedule was downloaded, or null. */
    val listedPrice: Int?,
    val sessions: Int,
    val firstDate: String,
    val lastDate: String,
    /** Where it is (the excursion's location), or blank. */
    val place: String,
) {
    val code: String get() = "$prefix/$product"
}

object WatchCandidates {
    const val SHORE_PREFIX = "pt_shoreX"

    /** Shore excursions of the schedule, one row per product, by title. Sea-day "Cruising" products are included. */
    fun of(bundle: JsonObject?, alreadyWatched: Set<String> = emptySet()): List<WatchCandidate> =
        CruiseData.events(bundle)
            .filter { it.category == EXCURSIONS && it.pid != null }
            .groupBy { it.pid!! }
            .map { (pid, list) ->
                val first = list.first()
                WatchCandidate(
                    prefix = SHORE_PREFIX, product = pid, title = first.title,
                    listedPrice = list.mapNotNull { it.price }.filter { it > 0 }.minOrNull(),
                    sessions = list.size,
                    firstDate = list.minOf { it.date }, lastDate = list.maxOf { it.date },
                    place = first.venue,
                )
            }
            .filter { it.code !in alreadyWatched }
            .sortedBy { it.title.lowercase() }

    /** Case-insensitive match of every word of [query] in the title or place. */
    fun filter(list: List<WatchCandidate>, query: String): List<WatchCandidate> {
        val words = query.lowercase().split(Regex("\\s+")).filter { it.isNotBlank() }
        if (words.isEmpty()) return list
        return list.filter { c ->
            val hay = (c.title + " " + c.place).lowercase()
            words.all { it in hay }
        }
    }
}
