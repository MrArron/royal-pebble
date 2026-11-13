package io.github.mrarron.royalpebble.settings

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull

/**
 * Typed reads of the cruise data bundle (docs/DATA_FORMAT.md) and of the
 * settings, for the native settings screens. Everything here is a plain
 * function of JSON, so it runs in JVM tests; the rules are those of
 * `src/pkjs/slice.js` and `src/pkjs/config.js` (named in each comment).
 */

const val EXCURSIONS = "Shore excursions"
const val DAY_START = 4 * 60
private val HHMM = Regex("^([01]\\d|2[0-3]):[0-5]\\d$")
private val ISO_DATE = Regex("^\\d{4}-\\d{2}-\\d{2}$")

internal fun JsonElement?.str(): String? = (this as? JsonPrimitive)?.takeIf { it !is JsonNull && it.isString }?.contentOrNull
internal fun JsonElement?.num(): Double? = (this as? JsonPrimitive)?.takeIf { it !is JsonNull && !it.isString }?.doubleOrNull
internal fun JsonElement?.bool(): Boolean? = (this as? JsonPrimitive)?.takeIf { it !is JsonNull && !it.isString }?.booleanOrNull
internal fun JsonElement?.obj(): JsonObject? = this as? JsonObject
internal fun JsonElement?.arr(): JsonArray? = this as? JsonArray

fun isHhmm(text: String?): Boolean = text != null && HHMM.matches(text)
fun isIsoDate(text: String?): Boolean = text != null && ISO_DATE.matches(text)

/** A day from the bundle's itinerary. */
data class ItineraryDay(
    val day: Int,
    val date: String,
    val port: String,
    val code: String?,
    val type: String,
    val arrive: String?,
    val depart: String?,
)

/** An event of the bundle's schedule, read by field name (docs/DATA_FORMAT.md). */
data class Event(
    val title: String,
    val venue: String,
    val category: String,
    val subcategory: String,
    val date: String,
    val time: String?,
    val minutes: Int,
    val featured: Boolean,
    val reservation: Boolean,
    val paid: Boolean,
    val price: Int?,
    val ageMin: Int?,
    val ageMax: Int?,
    val early: Int?,
) {
    /** slice.js starKey: how stars and reserved marks name this event. */
    val key: String get() = "$title|$date|${time ?: ""}|$venue"
    val isExcursion: Boolean get() = category == EXCURSIONS
}

object CruiseData {
    fun itinerary(bundle: JsonObject?): List<ItineraryDay> =
        bundle?.get("itinerary").arr().orEmpty().mapNotNull { e ->
            val o = e.obj() ?: return@mapNotNull null
            ItineraryDay(
                day = o["day"].num()?.toInt() ?: return@mapNotNull null,
                date = o["date"].str() ?: return@mapNotNull null,
                port = o["port"].str() ?: "",
                code = o["code"].str(),
                type = o["type"].str() ?: "",
                arrive = o["arrive"].str(),
                depart = o["depart"].str(),
            )
        }

    fun schedulePublished(bundle: JsonObject?): Boolean =
        (bundle?.get("schedule").obj()?.get("published").bool() ?: true) && events(bundle).isNotEmpty()

    /** Every event, in the bundle's order (date, time, title). */
    fun events(bundle: JsonObject?): List<Event> {
        val sched = bundle?.get("schedule").obj() ?: return emptyList()
        val fields = sched["fields"].arr().orEmpty().mapIndexed { i, n -> (n.str() ?: "") to i }.toMap()
        val cats = sched["cats"].arr().orEmpty()
        val venues = sched["venues"].arr().orEmpty()
        val infos = sched["infos"].arr().orEmpty()
        return sched["events"].arr().orEmpty().mapNotNull { row ->
            val r = row.arr() ?: return@mapNotNull null
            fun at(name: String): JsonElement? = fields[name]?.let { r.getOrNull(it) }
            val title = at("title").str() ?: return@mapNotNull null
            val date = at("date").str() ?: return@mapNotNull null
            val cat = cats.getOrNull(at("cat").num()?.toInt() ?: -1).arr()
            val info = at("info").num()?.toInt()?.let { infos.getOrNull(it) }.arr()
            val age = info?.getOrNull(0).arr()
            Event(
                title = title,
                venue = at("venue").num()?.toInt()?.let { venues.getOrNull(it) }.str() ?: "",
                category = cat?.getOrNull(0).str() ?: "",
                subcategory = cat?.getOrNull(1).str() ?: "",
                date = date,
                time = at("time").str(),
                minutes = at("minutes").num()?.toInt() ?: 0,
                featured = at("featured").num() == 1.0,
                reservation = at("reservation").num() == 1.0,
                paid = at("paid").num() == 1.0,
                price = at("price").num()?.toInt(),
                ageMin = age?.getOrNull(0).num()?.toInt(),
                ageMax = age?.getOrNull(1).num()?.toInt(),
                early = info?.getOrNull(1).num()?.toInt(),
            )
        }
    }

    // ------------------------------------------------------------ filters (slice.js, docs/DESIGN.md §12.4)

    val AGE_FILTERS = listOf("adult", "young", "family")
    val DEFAULT_HIDDEN = listOf("Shop")

    /** slice.js hiddenCats: the saved list, or Shop until the owner changes filters. */
    fun hiddenCats(settings: JsonObject): List<String> =
        settings["hiddenCats"].arr()?.mapNotNull { it.str() } ?: DEFAULT_HIDDEN

    fun ageFilters(settings: JsonObject): List<String> =
        settings["ageFilters"].arr()?.mapNotNull { it.str() }?.filter { it in AGE_FILTERS } ?: emptyList()

    fun showFeatured(settings: JsonObject): Boolean = settings["showFeatured"].bool() != false

    /** slice.js isCasino, by the venue's name as the bundle lists it (the JS also looks aliases up in its venue table). */
    fun isCasino(e: Event): Boolean {
        if (Regex("casino", RegexOption.IGNORE_CASE).containsMatchIn(e.venue) || e.subcategory == "Casino") return true
        if (Regex("bingo|raffle", RegexOption.IGNORE_CASE).containsMatchIn(e.title)) return false
        return Regex("\\b(casino|slot (tournament|machine)s?|blackjack|poker|roulette|craps|hold.?em|baccarat)\\b",
            RegexOption.IGNORE_CASE).containsMatchIn(e.title)
    }

    /** slice.js eventCat: the category Filters sees, Casino being its own. */
    fun filterCat(e: Event): Pair<String, String> = if (isCasino(e)) "Casino" to "" else e.category to e.subcategory

    fun isFamily(e: Event): Boolean =
        Regex("^\\s*family\\b|\\ball ages\\b", RegexOption.IGNORE_CASE).containsMatchIn(e.title) ||
            Regex("^adventure ocean theater$", RegexOption.IGNORE_CASE).matches(e.venue)

    /** slice.js ageMask: 1 adult only (18+), 2 teen and kid only (17 and under), 4 family. */
    fun ageMask(e: Event): Int {
        val min = e.ageMin ?: 0
        val max = e.ageMax ?: 0
        return (if (min >= 18) 1 else 0) or (if (max in 1..17) 2 else 0) or (if (isFamily(e)) 4 else 0)
    }

    fun ageFilterMask(settings: JsonObject): Int =
        ageFilters(settings).fold(0) { m, name -> m or (1 shl AGE_FILTERS.indexOf(name)) }

    /** True when the filters keep this event off the watch (stars and booked events are checked by the caller). */
    fun hiddenByFilters(e: Event, settings: JsonObject): Boolean {
        val (c, s) = filterCat(e)
        val hidden = hiddenCats(settings)
        if (c in hidden || "$c / $s" in hidden) return true
        return (ageMask(e) and ageFilterMask(settings)) != 0
    }

    data class CatSummary(val name: String, val count: Int, val subs: List<Pair<String, Int>>)

    /** slice.js categorySummary: categories with counts, shore excursions left out, sorted by name. */
    fun categorySummary(bundle: JsonObject?): List<CatSummary> {
        val byName = sortedMapOf<String, MutableMap<String, Int>>()
        for (e in events(bundle)) {
            val (c, s) = filterCat(e)
            if (c.isEmpty() || c == EXCURSIONS) continue
            val subs = byName.getOrPut(c) { sortedMapOf() }
            subs[s] = (subs[s] ?: 0) + 1
        }
        return byName.map { (name, subs) -> CatSummary(name, subs.values.sum(), subs.toList()) }
    }

    /** slice.js cleanHiddenCats. */
    fun cleanHiddenCats(list: List<String>): List<String> =
        list.filter { it.isNotEmpty() && it.length <= 80 }.distinct().take(200)

    /** The saved or default hidden list as it is stored: always an array once the owner has changed it. */
    fun hiddenJson(list: List<String>): JsonArray = JsonArray(cleanHiddenCats(list).map { JsonPrimitive(it) })

    // ------------------------------------------------------------ times (config.js)

    fun minutesOf(hhmm: String?): Int? {
        if (hhmm.isNullOrEmpty()) return null
        val p = hhmm.split(":")
        return (p.getOrNull(0)?.toIntOrNull() ?: return null) * 60 + (p.getOrNull(1)?.toIntOrNull() ?: return null)
    }

    fun hhmm(minutes: Int): String {
        val m = ((minutes % 1440) + 1440) % 1440
        return "%02d:%02d".format(m / 60, m % 60)
    }

    /** "1:00 PM", with "(next day)" past midnight. */
    fun clock(minutes: Int): String {
        val t = ((minutes % 1440) + 1440) % 1440
        val h = t / 60
        val s = "${if (h % 12 == 0) 12 else h % 12}:${(t % 60).toString().padStart(2, '0')} ${if (h < 12) "AM" else "PM"}"
        return s + (if (minutes >= 1440) " (next day)" else if (minutes < 0) " (day before)" else "")
    }

    /** config.js afterMidnight: a time before 04:00, or before the arrival, is after midnight. */
    fun afterMidnight(m: Int?, arrive: Int?): Int? {
        if (m == null) return null
        return if (m < 240 || (arrive != null && m < arrive)) m + 1440 else m
    }

    /** Sail date as `3 Oct 2026`. */
    fun sailText(iso: String): String {
        val p = iso.split("-")
        val months = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
        if (p.size != 3) return iso
        val m = p[1].toIntOrNull() ?: return iso
        return "${p[2].toIntOrNull() ?: return iso} ${months.getOrNull(m - 1) ?: return iso} ${p[0]}"
    }
}
