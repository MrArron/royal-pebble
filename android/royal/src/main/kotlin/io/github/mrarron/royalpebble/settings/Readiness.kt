package io.github.mrarron.royalpebble.settings

import io.github.mrarron.royalpebble.royal.parseJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject

/** The Cruise screen's backup paste and its Ready to sail checks (`bundle.js`, `config.js readyChecks`). */
object Readiness {
    const val MAX_EVENTS = 160  // what the watch keeps per day (slice.js MAX_EVENTS)

    /** bundle.js validate: null when the bundle is usable, else a short reason. */
    fun validate(bundle: JsonObject?): String? {
        if (bundle == null || bundle["format"].str() != "cruise-watch") return "Not a cruise data bundle"
        val v = bundle["v"].num()
        if (v != 1.0) return "Unsupported bundle version ${v?.toInt() ?: "undefined"}"
        if (!isIsoDate(bundle["sailDate"].str())) return "Missing sail date"
        if ((bundle["itinerary"] as? JsonArray).orEmpty().isEmpty()) return "Missing itinerary"
        val sched = bundle["schedule"] as? JsonObject
        if (sched == null || sched["events"] !is JsonArray || sched["fields"] !is JsonArray) return "Missing schedule"
        val fields = (sched["fields"] as JsonArray).mapNotNull { it.str() }
        for (n in listOf("title", "venue", "cat", "date", "time", "minutes", "featured", "reservation")) {
            if (n !in fields) return "Schedule is missing \"$n\""
        }
        return null
    }

    /** Parses pasted bundle text: the bundle, or the reason it can't be used. */
    fun parse(text: String): Pair<JsonObject?, String?> {
        val b = try { parseJson(text.trim()) as? JsonObject } catch (e: Exception) { null }
            ?: return null to "That text is not valid cruise data"
        return validate(b).let { if (it == null) b to null else null to it }
    }

    data class Check(val ok: Boolean, val title: String, val text: String)

    /** Events one cruise day sends the watch before the trim: what no filter hides, plus starred, personal and booked. */
    fun dayLoad(bundle: JsonObject, settings: JsonObject, stars: Map<String, Boolean>): Map<String, Int> {
        val events = CruiseData.events(bundle)
        val personal = SettingsRules.personal(settings)
        val booked = ((bundle["mine"] as? JsonObject)?.get("orders") as? JsonArray).orEmpty().mapNotNull { (it as? JsonObject)?.get("date").str() }
        return CruiseData.itinerary(bundle).associate { day ->
            var n = 0
            for (e in events) {
                if (e.date != day.date) continue
                val starred = stars[e.key] == true
                if (starred) n++
                else if (!e.paid && !CruiseData.hiddenByFilters(e, settings)) n++
            }
            n += personal.count { it.date == day.date }
            n += booked.count { it == day.date }
            day.date to n
        }
    }

    fun checks(bundle: JsonObject, settings: JsonObject, stars: Map<String, Boolean>, stateroom: String?): List<Check> {
        val days = CruiseData.itinerary(bundle)
        val events = CruiseData.events(bundle)
        val published = CruiseData.schedulePublished(bundle)
        val dated = events.map { it.date }.toSet()
        val saved = days.count { it.type == "DEBARK" || it.date in dated }
        val list = ArrayList<Check>()
        list += if (published && saved >= days.size) Check(true, "Every day downloaded", "${days.size} of ${days.size} days, schedule published")
        else Check(false, if (published) "Some days have no events yet" else "Schedule not published yet",
            if (published) "Royal lists events for $saved of ${days.size} days so far."
            else "Royal usually publishes it about two weeks before sailing.")
        list += if (!stateroom.isNullOrBlank()) Check(true, "Stateroom set", stateroom.trim())
        else Check(false, "Stateroom not set", "The watch needs it for directions from your cabin. Set it on the Me screen.")
        val busiest = dayLoad(bundle, settings, stars).maxByOrNull { it.value }
        list += if (busiest != null && busiest.value > MAX_EVENTS) Check(false, "Too many events on ${busiest.key}",
            "${busiest.value} events; the watch keeps $MAX_EVENTS and drops the earliest. Hide categories on the Filters screen.")
        else Check(true, "Fits on the watch", if (busiest != null) "Busiest day ${busiest.value} of $MAX_EVENTS events" else "No events yet")
        return list
    }
}
