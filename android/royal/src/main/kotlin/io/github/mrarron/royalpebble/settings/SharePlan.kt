package io.github.mrarron.royalpebble.settings

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.util.Base64

/**
 * Share my plan (docs/DESIGN.md §12.2): the message one phone copies for a
 * travel companion and the comparison and merge the other phone runs on import.
 * A port of `src/pkjs/share.js`; the format is "Shared plan" in
 * docs/DATA_FORMAT.md, so a plan made by the Pebble app's settings page imports
 * here and the other way round.
 */
object SharePlan {
    const val VERSION = 1
    private const val START = "RPPLAN"
    private const val END = ":END"
    private const val RES = "R|"
    val DAY_FIELDS = listOf("allAboard", "shift", "buffer", "warn", "offset", "edit")

    /** The owner's own state, as a plan is built from it. [stars] holds only the ones that are on. */
    class Mine(
        val ship: String,
        val sailDate: String,
        val stars: Map<String, Boolean>,
        val personal: List<SettingsRules.Personal>,
        val days: JsonObject,
        val venues: JsonObject,
        val cabin: Map<String, String>,
    )

    private fun starList(stars: Map<String, Boolean>): List<String> {
        val on = stars.filterValues { it }.keys
        return on.filter { !it.startsWith(RES) || it.removePrefix(RES) in on }.sorted()
    }

    /** The plan; cabin details go in only with [withCabin], and only the ones that are set. */
    fun build(mine: Mine, withCabin: Boolean): JsonObject {
        val plan = LinkedHashMap<String, JsonElement>()
        plan["v"] = JsonPrimitive(VERSION)
        plan["ship"] = JsonPrimitive(mine.ship)
        plan["sail"] = JsonPrimitive(mine.sailDate)
        plan["stars"] = JsonArray(starList(mine.stars).map { JsonPrimitive(it) })
        if (mine.personal.isNotEmpty()) plan["personal"] = SettingsRules.personalJson(mine.personal)
        val days = LinkedHashMap<String, JsonElement>()
        for (date in mine.days.keys.sorted()) {
            val set = mine.days[date] as? JsonObject ?: continue
            val d = LinkedHashMap<String, JsonElement>()
            for (f in DAY_FIELDS) set[f]?.takeIf { it !is JsonNull && it.str() != "" }?.let { d[f] = it }
            if (d.isNotEmpty()) days[date] = JsonObject(d)
        }
        if (days.isNotEmpty()) plan["days"] = JsonObject(days)
        if (mine.venues.isNotEmpty()) plan["venues"] = mine.venues
        if (withCabin) {
            val cabin = LinkedHashMap<String, JsonElement>()
            for (f in SettingsRules.ME_FIELDS) mine.cabin[f]?.trim()?.takeIf { it.isNotEmpty() }?.let { cabin[f] = JsonPrimitive(it) }
            if (cabin.isNotEmpty()) plan["cabin"] = JsonObject(cabin)
        }
        return JsonObject(plan)
    }

    data class Counts(val stars: Int, val personal: Int, val daySettings: Int, val itinerary: Int, val venues: Int, val cabin: Int)

    fun counts(plan: JsonObject): Counts {
        val days = plan["days"] as? JsonObject ?: JsonObject(emptyMap())
        fun has(d: JsonElement?, f: String) = (d as? JsonObject)?.containsKey(f) == true
        return Counts(
            stars = (plan["stars"] as? JsonArray).orEmpty().count { it.str()?.startsWith(RES) != true },
            personal = (plan["personal"] as? JsonArray)?.size ?: 0,
            daySettings = days.keys.count { d -> DAY_FIELDS.any { f -> f != "edit" && has(days[d], f) } },
            itinerary = days.keys.count { d -> has(days[d], "edit") },
            venues = (plan["venues"] as? JsonObject)?.size ?: 0,
            cabin = (plan["cabin"] as? JsonObject)?.size ?: 0,
        )
    }

    /** The message: a readable first line, how to import it, then the code. [title] is e.g. `Harmony · sails 3 Oct 2026`. */
    fun encode(plan: JsonObject, title: String): String {
        val n = counts(plan).stars
        val code = Base64.getEncoder().encodeToString(plan.toString().toByteArray(Charsets.UTF_8))
        return "Royal Pebble plan · $title · $n ${if (n == 1) "star" else "stars"}\n" +
            "To import it, open Royal Pebble's settings, tap Import plan under Share my plan and paste this whole message.\n" +
            "$START$VERSION:$code$END"
    }

    sealed class Decoded {
        data class Ok(val plan: JsonObject) : Decoded()
        data class Error(val message: String) : Decoded()
    }

    /** Finds the code in a pasted message (chat apps may wrap it or add spaces). */
    fun decode(text: String): Decoded {
        val at = text.indexOf(START)
        if (at == -1) return Decoded.Error("No Royal Pebble plan found. Paste the whole message.")
        val rest = text.substring(at + START.length)
        val m = Regex("^(\\d+):([A-Za-z0-9+/=\\s]*)").find(rest) ?: return Decoded.Error("The plan is damaged. Ask for it again.")
        if ((m.groupValues[1].toLongOrNull() ?: Long.MAX_VALUE) > VERSION) {
            return Decoded.Error("This plan comes from a newer Royal Pebble. Update the app, then paste it again.")
        }
        if (!rest.startsWith(END, m.value.length)) return Decoded.Error("The plan is cut short. Copy the whole message and paste it again.")
        val plan = try {
            val json = String(Base64.getMimeDecoder().decode(m.groupValues[2].replace(Regex("\\s+"), "")), Charsets.UTF_8)
            Json.parseToJsonElement(json) as? JsonObject
        } catch (e: Exception) {
            null
        }
        if (plan == null || plan["ship"].str() == null || plan["sail"].str() == null || plan["stars"] !is JsonArray) {
            return Decoded.Error("The plan is damaged. Ask for it again.")
        }
        val out = LinkedHashMap(plan)
        out["stars"] = JsonArray((plan["stars"] as JsonArray).filter { it.str()?.let { s -> s.length <= 300 } == true })
        if (plan["personal"] !is JsonArray) out["personal"] = JsonArray(emptyList())
        for (k in listOf("days", "venues", "cabin")) if (plan[k] !is JsonObject) out[k] = JsonObject(emptyMap())
        return Decoded.Ok(JsonObject(out))
    }

    // ------------------------------------------------------------ import

    /** One difference between the receiver's plan and theirs. [takeTheirs] is what Accept all does. */
    sealed class Item {
        abstract val takeTheirs: Boolean

        data class Star(val key: String, val reserved: Boolean, val theirsOnly: Boolean, override val takeTheirs: Boolean) : Item()
        data class Personal(val entry: JsonObject, override val takeTheirs: Boolean = true) : Item()
        data class Day(val date: String, val field: String, val theirs: JsonElement, val mine: JsonElement?,
                       override val takeTheirs: Boolean = true) : Item()
        data class Cabin(val field: String, val theirs: String, val mine: String, override val takeTheirs: Boolean = true) : Item()
    }

    class Diff(val items: List<Item>, val venueFixesSkipped: Int)

    private fun starSortKey(k: String): String {
        val e = if (k.startsWith(RES)) k.removePrefix(RES) else k
        val p = e.split("|")
        return (p.getOrNull(1) ?: "") + "|" + (p.getOrNull(2) ?: "") + "|" + e
    }

    /**
     * Every difference between [mine] (as from [build] with cabin details) and
     * [theirs], in review order. Only stars go both ways: an event only the
     * receiver starred can be unstarred. Venue fixes are counted but left out:
     * venues are edited on the Pebble app's settings page.
     */
    fun diff(mine: JsonObject, theirs: JsonObject): Diff {
        val items = ArrayList<Item>()
        val myStars = (mine["stars"] as? JsonArray).orEmpty().mapNotNull { it.str() }.toSet()
        val theirList = (theirs["stars"] as? JsonArray).orEmpty().mapNotNull { it.str() }
        val theirStars = theirList.toSet()
        val keys = (myStars + theirList.filter { it !in myStars }).sortedWith(
            compareBy<String> { starSortKey(it) }.thenBy { it })
        for (k in keys) {
            if (k in myStars && k in theirStars) continue
            items += Item.Star(k, k.startsWith(RES), theirsOnly = k !in myStars, takeTheirs = k !in myStars)
        }
        val seen = (mine["personal"] as? JsonArray).orEmpty().mapNotNull { personalId(it) }.toMutableSet()
        for (p in (theirs["personal"] as? JsonArray).orEmpty()) {
            val o = p as? JsonObject ?: continue
            val id = personalId(o) ?: continue
            if (seen.add(id)) items += Item.Personal(o)
        }
        val theirDays = theirs["days"] as? JsonObject ?: JsonObject(emptyMap())
        val myDays = mine["days"] as? JsonObject ?: JsonObject(emptyMap())
        for (date in theirDays.keys.sorted()) {
            val t = theirDays[date] as? JsonObject ?: JsonObject(emptyMap())
            val m = myDays[date] as? JsonObject
            for (f in DAY_FIELDS) if (t.containsKey(f) && t[f] != m?.get(f)) items += Item.Day(date, f, t[f]!!, m?.get(f))
        }
        val venueFixes = (theirs["venues"] as? JsonObject).orEmpty().count { (n, v) -> v != (mine["venues"] as? JsonObject)?.get(n) }
        val tc = theirs["cabin"] as? JsonObject ?: JsonObject(emptyMap())
        val mc = mine["cabin"] as? JsonObject ?: JsonObject(emptyMap())
        for (f in SettingsRules.ME_FIELDS) {
            val t = tc[f].str()?.trim().orEmpty()
            val m = mc[f].str()?.trim().orEmpty()
            if (t.isNotEmpty() && t != m) items += Item.Cabin(f, t, m)
        }
        return Diff(items, venueFixes)
    }

    private fun personalId(e: JsonElement): String? {
        val o = e as? JsonObject ?: return null
        val title = o["title"].str() ?: return null
        return listOf(title, o["date"].str() ?: "", o["time"].str() ?: "", o["venue"].str() ?: "",
            (o["minutes"].num()?.toInt() ?: 0).toString()).joinToString("|")
    }

    class Changes(
        val stars: Map<String, Boolean>,
        val personal: List<JsonObject>,
        val days: Map<String, Map<String, JsonElement>>,
        val cabin: Map<String, String>,
    )

    /** The changes to make: [take] says per item (by index) whether to take theirs; a missing one is the item's default. */
    fun changes(items: List<Item>, take: Map<Int, Boolean> = emptyMap()): Changes {
        val stars = LinkedHashMap<String, Boolean>()
        val personal = ArrayList<JsonObject>()
        val days = LinkedHashMap<String, MutableMap<String, JsonElement>>()
        val cabin = LinkedHashMap<String, String>()
        items.forEachIndexed { i, it ->
            if (!(take[i] ?: it.takeTheirs)) return@forEachIndexed
            when (it) {
                is Item.Star -> stars[it.key] = it.theirsOnly
                is Item.Personal -> personal += it.entry
                is Item.Day -> days.getOrPut(it.date) { LinkedHashMap() }[it.field] = it.theirs
                is Item.Cabin -> cabin[it.field] = it.theirs
            }
        }
        return Changes(stars, personal, days, cabin)
    }

    /** A short line for a review row. */
    fun describe(item: Item): String = when (item) {
        is Item.Star -> (if (item.reserved) "Reserved mark: " else "Star: ") + item.key.removePrefix(RES).split("|").let { p ->
            p[0] + (p.getOrNull(1)?.let { " · $it" } ?: "") + (p.getOrNull(2)?.takeIf { it.isNotEmpty() }?.let { " $it" } ?: "")
        }
        is Item.Personal -> "Entry: " + (item.entry["title"].str() ?: "") + " · " + (item.entry["date"].str() ?: "")
        is Item.Day -> "${item.date}: ${item.field} = ${item.theirs}" + (item.mine?.let { " (yours: $it)" } ?: "")
        is Item.Cabin -> "${item.field}: ${item.theirs}" + (if (item.mine.isNotEmpty()) " (yours: ${item.mine})" else "")
    }
}
