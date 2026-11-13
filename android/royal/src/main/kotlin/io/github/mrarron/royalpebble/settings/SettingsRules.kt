package io.github.mrarron.royalpebble.settings

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * What the settings page lets the owner change, and the checks `src/pkjs/slice.js`
 * applies to what comes back (cleanDaySettings, cleanPersonal, reserveAlertAt).
 * The native screens save through these, so the JSON in the cruise store is
 * exactly what the reused JS packer expects.
 */
object SettingsRules {
    val WARN_PERIODS = listOf(30, 60, 90, 120)
    val BUFFERS = listOf(30, 45, 60)
    val REMINDER_LEADS = listOf(5, 15, 30)
    val UNITS = listOf("m", "ft", "steps")
    val RESERVE_ALERT_TIMES = listOf(18 * 60, 19 * 60, 20 * 60, 21 * 60, 22 * 60)
    const val RESERVE_ALERT_DEFAULT = 20 * 60
    const val MAX_SHIFT = 120
    const val MAX_PERSONAL = 100
    val DAY_TYPES = listOf("EMBARK", "DOCKED", "TENDER", "CRUISING", "DEBARK")

    /** Fields of `settings.me` shared on the Me tab and in a shared plan (share.js CABIN_FIELDS). */
    val ME_FIELDS = listOf("stateroom", "deck", "stairs", "muster", "dining")

    fun reserveAlertAt(settings: JsonObject): Int {
        val v = settings["reserveAlertAt"].num()?.toInt()
        return if (v in RESERVE_ALERT_TIMES) v!! else RESERVE_ALERT_DEFAULT
    }

    fun reminderLead(settings: JsonObject): Int {
        val v = settings["reminderLead"].num()?.toInt()
        return if (v in REMINDER_LEADS) v!! else 15
    }

    fun units(settings: JsonObject): String = settings["units"].str()?.takeIf { it in UNITS } ?: "m"

    fun theme(settings: JsonObject): String = if (settings["theme"].str() == "dark") "dark" else "light"

    fun alwaysHints(settings: JsonObject): Boolean = settings["alwaysHints"].bool() == true

    // ------------------------------------------------------------ days (slice.js cleanDaySettings)

    /** The cleaned per-day settings, or null when nothing valid is left. */
    fun cleanDaySettings(d: JsonElement?): JsonObject? {
        val o = d as? JsonObject ?: return null
        val out = LinkedHashMap<String, JsonElement>()
        o["offset"].num()?.let { v ->
            if (v % 30.0 == 0.0 && v >= -720 && v <= 720 && v != 0.0) out["offset"] = JsonPrimitive(v.toInt())
        }
        o["buffer"].num()?.toInt()?.let { if (it in BUFFERS) out["buffer"] = JsonPrimitive(it) }
        o["allAboard"].str()?.let { if (isHhmm(it)) out["allAboard"] = JsonPrimitive(it) }
        o["shift"].num()?.let { v ->
            if (v % 5.0 == 0.0 && abs(v) <= MAX_SHIFT && v != 0.0) out["shift"] = JsonPrimitive(v.toInt())
        }
        o["warn"].num()?.toInt()?.let { if (it in WARN_PERIODS) out["warn"] = JsonPrimitive(it) }
        (o["edit"] as? JsonObject)?.let { e ->
            val edit = LinkedHashMap<String, JsonElement>()
            e["type"].str()?.let { if (Regex("^[A-Z_]{1,20}$").matches(it)) edit["type"] = JsonPrimitive(it) }
            e["port"].str()?.let { edit["port"] = JsonPrimitive(it.take(60)) }
            for (k in listOf("arrive", "depart")) {
                val v = e[k]
                if (v is JsonNull) edit[k] = JsonNull else v.str()?.let { if (isHhmm(it)) edit[k] = JsonPrimitive(it) }
            }
            if (edit.isNotEmpty()) out["edit"] = JsonObject(edit)
        }
        return if (out.isEmpty()) null else JsonObject(out)
    }

    fun cleanDays(days: Map<String, JsonElement?>): JsonObject {
        val out = LinkedHashMap<String, JsonElement>()
        days.toSortedMap().forEach { (date, v) -> if (isIsoDate(date)) cleanDaySettings(v)?.let { out[date] = it } }
        return JsonObject(out)
    }

    // ------------------------------------------------------------ personal entries (slice.js cleanPersonal)

    data class Personal(val title: String, val venue: String, val date: String, val time: String?, val minutes: Int) {
        fun toJson(): JsonObject = JsonObject(linkedMapOf(
            "title" to JsonPrimitive(title),
            "venue" to JsonPrimitive(venue),
            "date" to JsonPrimitive(date),
            "time" to (time?.let { JsonPrimitive(it) } ?: JsonNull),
            "minutes" to JsonPrimitive(minutes),
        ))

        val id: String get() = listOf(title, date, time ?: "", venue, minutes).joinToString("|")
    }

    fun personal(settings: JsonObject): List<Personal> = cleanPersonal(settings["personal"] as? JsonArray ?: JsonArray(emptyList()))

    fun cleanPersonal(list: JsonArray): List<Personal> {
        val out = ArrayList<Personal>()
        for (p in list) {
            val o = p as? JsonObject ?: continue
            val title = o["title"].str()?.trim()?.takeIf { it.isNotEmpty() } ?: continue
            val date = o["date"].str()?.takeIf { isIsoDate(it) } ?: continue
            if (out.size >= MAX_PERSONAL) break
            out += Personal(
                title = title.take(63),
                venue = o["venue"].str()?.trim()?.take(31) ?: "",
                date = date,
                time = o["time"].str()?.takeIf { isHhmm(it) },
                minutes = o["minutes"].num()?.let { if (it > 0 && it <= 1440) it.roundToInt() else 0 } ?: 0,
            )
        }
        return out
    }

    fun personalJson(list: List<Personal>): JsonArray = JsonArray(list.take(MAX_PERSONAL).map { it.toJson() })

    // ------------------------------------------------------------ the Days tab (config.js effective / allAboardOf)

    /** A day as the Days tab shows it: Royal's day, the owner's edits on top, and the resulting all-aboard. */
    data class DayView(
        val royal: ItineraryDay,
        val set: JsonObject,
        val type: String,
        val port: String,
        val arrive: String?,
        val depart: String?,
        /** All-aboard in ship time, minutes from the day's midnight (past 1440 = after midnight), or null. */
        val allAboard: Int?,
        /** Departure in local time (port clock). */
        val departMinutes: Int?,
        val royalGangway: Boolean,
        val exact: Boolean,
        val tender: Boolean,
        val warn: Int,
        val edited: Boolean,
    )

    fun defaultBuffer(type: String?): Int = if (type != null && type.contains("TENDER")) 60 else 30

    /** Royal's gangway-up time for the day, as `mine.ports[].gangwayUp`, in minutes (config.js d.royal). */
    fun royalGangway(bundle: JsonObject?, day: ItineraryDay): Int? {
        val ports = (bundle?.get("mine") as? JsonObject)?.get("ports") as? JsonArray ?: return null
        for (p in ports) {
            val o = p as? JsonObject ?: continue
            if (o["day"].num()?.toInt() == day.day) {
                val up = o["gangwayUp"].str()?.takeIf { isHhmm(it) } ?: continue
                return CruiseData.afterMidnight(CruiseData.minutesOf(up), CruiseData.minutesOf(day.arrive))
            }
        }
        return null
    }

    fun dayView(bundle: JsonObject?, day: ItineraryDay, settings: JsonObject): DayView {
        val set = ((settings["days"] as? JsonObject)?.get(day.date) as? JsonObject) ?: JsonObject(emptyMap())
        val edit = set["edit"] as? JsonObject ?: JsonObject(emptyMap())
        fun field(k: String, royal: String?): String? = if (edit.containsKey(k)) edit[k].str() else royal
        val type = field("type", day.type) ?: day.type
        val port = field("port", day.port) ?: day.port
        val arrive = field("arrive", day.arrive)
        val depart = field("depart", day.depart)
        val departMin = CruiseData.afterMidnight(CruiseData.minutesOf(depart), CruiseData.minutesOf(arrive))
        val royal = royalGangway(bundle, day)
        val offset = set["offset"].num()?.toInt() ?: 0
        val allAboardSet = set["allAboard"].str()
        val allAboard: Int? = when {
            type == "DEBARK" || type == "CRUISING" -> null
            allAboardSet != null -> CruiseData.afterMidnight(CruiseData.minutesOf(allAboardSet), null)
            royal != null -> royal - offset + (set["shift"].num()?.toInt() ?: 0)
            else -> departMin?.let { it - offset - (set["buffer"].num()?.toInt() ?: defaultBuffer(type)) }
        }
        val warn = set["warn"].num()?.toInt()?.takeIf { it in WARN_PERIODS } ?: defaultBuffer(type)
        return DayView(day, set, type, port, arrive, depart, allAboard, departMin,
            royalGangway = royal != null && allAboardSet == null, exact = allAboardSet != null,
            tender = type.contains("TENDER"), warn = warn, edited = set.isNotEmpty())
    }

    /** Settings with one day's settings replaced (a null or empty one clears it), cleaned. */
    fun withDay(settings: JsonObject, date: String, day: JsonObject?): JsonObject {
        val days = LinkedHashMap((settings["days"] as? JsonObject) ?: emptyMap())
        val cleaned = cleanDaySettings(day)
        if (cleaned == null) days.remove(date) else days[date] = cleaned
        return JsonObject(settings + ("days" to JsonObject(days)))
    }

    /**
     * One day's settings with [field] set to [value] (null removes it) and any
     * edit that matches Royal's own day pruned (config.js prune), so "Edited"
     * means something changed.
     */
    fun setDayField(current: JsonObject?, royal: ItineraryDay, field: String, value: JsonElement?): JsonObject? {
        val m = LinkedHashMap(current ?: emptyMap())
        if (value == null || value is JsonNull) m.remove(field) else m[field] = value
        val edit = m["edit"] as? JsonObject
        if (edit != null) {
            val e = LinkedHashMap(edit)
            fun same(k: String, r: String?) { if (e.containsKey(k) && e[k].str() == r) e.remove(k) }
            same("type", royal.type)
            same("port", royal.port)
            same("arrive", royal.arrive)
            same("depart", royal.depart)
            if (e.isEmpty()) m.remove("edit") else m["edit"] = JsonObject(e)
        }
        return cleanDaySettings(JsonObject(m))
    }

    /** `Same as ship`, `+1 hour`, `−1:30 h`. */
    fun offsetText(o: Int): String {
        if (o == 0) return "Same as ship"
        val a = abs(o)
        val t = if (a % 60 != 0) "${a / 60}:${(a % 60).toString().padStart(2, '0')} h" else if (a == 60) "1 hour" else "${a / 60} hours"
        return (if (o > 0) "+" else "−") + t
    }
}
