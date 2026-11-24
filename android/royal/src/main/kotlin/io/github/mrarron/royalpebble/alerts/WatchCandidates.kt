package io.github.mrarron.royalpebble.alerts

import io.github.mrarron.royalpebble.settings.CruiseData
import io.github.mrarron.royalpebble.settings.EXCURSIONS
import io.github.mrarron.royalpebble.royal.CatalogItem
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
    /** Where it was listed ("Shore excursion", "Drinks", "Internet"...). */
    val group: String = "Shore excursion",
    /** Royal's listed price text from the Cruise Planner list (catalog items only), or blank. */
    val priceText: String = "",
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

    /** Items of the Cruise Planner list (drinks, internet, dining, activities, spa), by group then title. */
    fun ofCatalog(items: List<CatalogItem>, alreadyWatched: Set<String> = emptySet()): List<WatchCandidate> =
        items.filter { it.code !in alreadyWatched }
            .map {
                WatchCandidate(
                    prefix = it.prefix, product = it.product, title = it.title, listedPrice = null,
                    sessions = 0, firstDate = "", lastDate = "", place = "", group = it.group, priceText = it.price,
                )
            }
            .sortedWith(compareBy({ it.group }, { it.title.lowercase() }))

    /** The schedule's excursions, then the planner's items; a product in both keeps its schedule row. */
    fun all(bundle: JsonObject?, catalog: List<CatalogItem>, alreadyWatched: Set<String> = emptySet()): List<WatchCandidate> {
        val shore = of(bundle, alreadyWatched)
        val seen = shore.mapTo(HashSet()) { it.code }
        return shore + ofCatalog(catalog, alreadyWatched).filter { it.code !in seen }
    }

    /** Case-insensitive match of every word of [query] in the title or place. */
    fun filter(list: List<WatchCandidate>, query: String): List<WatchCandidate> {
        val words = query.lowercase().split(Regex("\\s+")).filter { it.isNotBlank() }
        if (words.isEmpty()) return list
        return list.filter { c ->
            val hay = (c.title + " " + c.place + " " + c.group).lowercase()
            words.all { it in hay }
        }
    }
}
