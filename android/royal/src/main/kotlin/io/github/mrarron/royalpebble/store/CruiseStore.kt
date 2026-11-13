package io.github.mrarron.royalpebble.store

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import io.github.mrarron.royalpebble.royal.parseJson
import java.io.File
import java.io.IOException

/**
 * What the phone keeps about the cruise: the sailing (the cruise data bundle,
 * with the booking's `mine` when downloaded with login), stars and reserved
 * marks, the booked reservations, and the settings. It is what src/pkjs/index.js
 * keeps in localStorage today, under the same keys and in the same JSON, so the
 * reused JS packer (slice.js and friends, Phase 3) can read it unchanged and a
 * phone's saved data could be carried over as it is.
 *
 * One file per key in [dir] (app-private storage), written atomically. Holds a
 * stateroom number and booking details: never log what it reads.
 */
class CruiseStore(
    private val dir: File,
    private val reconciler: StarReconciler = StarReconciler.KEEP,
) {
    companion object {
        // localStorage keys of src/pkjs/index.js.
        const val BUNDLE = "bundle"
        const val SETTINGS = "settings"
        const val STARS = "stars"
        const val STAR_TIMES = "starTimes"
        const val STATUS = "status"
        const val SHIPS = "ships"
        const val STAR_CHANGES = "starChanges"
        const val NOTICES = "notices"
        const val WATCH_SAVED = "watchSaved"

        /** Reserved marks live with the stars under this prefix (slice.js RESERVED_PREFIX). */
        const val RESERVED_PREFIX = "R|"
        const val SHIPS_MAX_AGE_MS = 30L * 24 * 3600 * 1000
        private const val STAR_KEY_MAX = 300
        private val KEY = Regex("[A-Za-z][A-Za-z0-9_]{0,63}")

        /** slice.js starKey: how stars name an event. */
        fun starKey(title: String, date: String, time: String?, venue: String?): String =
            listOf(title, date, time ?: "", venue ?: "").joinToString("|")
    }

    init {
        dir.mkdirs()
    }

    // ------------------------------------------------------------ raw, like localStorage

    private fun file(key: String): File {
        require(KEY.matches(key)) { "bad store key" }
        return File(dir, "$key.json")
    }

    /** The saved value, or null when there is none or it can't be read (as index.js load()). */
    @Synchronized
    fun read(key: String): JsonElement? {
        val f = file(key)
        if (!f.exists()) return null
        return try {
            parseJson(f.readText(Charsets.UTF_8))
        } catch (e: Exception) {
            null
        }
    }

    /** Saves [value] (null removes the key). Written to a temporary file first, so a crash keeps the old value. */
    @Synchronized
    fun write(key: String, value: JsonElement?) {
        val f = file(key)
        if (value == null) {
            f.delete()
            return
        }
        val tmp = File(dir, "$key.json.tmp")
        tmp.writeText(value.toString(), Charsets.UTF_8)
        if (!tmp.renameTo(f)) {
            f.delete()
            if (!tmp.renameTo(f)) throw IOException("could not save $key")
        }
    }

    /** Every saved key and its JSON text: what the JS side would find in localStorage. */
    @Synchronized
    fun snapshot(): Map<String, String> =
        (dir.listFiles() ?: emptyArray()).filter { it.name.endsWith(".json") }.sortedBy { it.name }
            .associate { it.name.removeSuffix(".json") to it.readText(Charsets.UTF_8) }

    private fun readObject(key: String): JsonObject = read(key) as? JsonObject ?: JsonObject(emptyMap())

    // ------------------------------------------------------------ the sailing

    fun bundle(): JsonObject? = read(BUNDLE) as? JsonObject

    /** A short description of the saved sailing, or null when none is saved. */
    fun sailing(): Sailing? {
        val b = bundle() ?: return null
        val ship = b["ship"] as? JsonObject
        return Sailing(
            shipCode = ship.text("code") ?: return null,
            shipName = ship.text("name") ?: "",
            sailDate = b.text("sailDate") ?: return null,
            generated = b.text("generated"),
            days = (b["itinerary"] as? JsonArray)?.size ?: 0,
            events = ((b["schedule"] as? JsonObject)?.get("events") as? JsonArray)?.size ?: 0,
            hasBooking = b["mine"] is JsonObject,
        )
    }

    /**
     * Keeps a downloaded (or pasted) bundle, as index.js useBundle: login data
     * of the same sailing is kept when the new bundle has none, starred events
     * follow the [reconciler], and a new sailing clears the old one's star
     * changes and notices. [at] is the status time as the settings page shows
     * it; [mineError] records why booking details didn't download.
     */
    @Synchronized
    fun saveDownload(bundle: JsonObject, at: String, mineError: String? = null, nowMs: Long = System.currentTimeMillis()): SaveResult {
        val old = bundle()
        val same = sameSailing(old, bundle)
        var saved = bundle
        val keptMine = same && bundle["mine"] !is JsonObject && old?.get("mine") is JsonObject
        if (keptMine) saved = JsonObject(bundle + ("mine" to old!!["mine"]!!))
        val r = reconciler.reconcile(old, saved, stars(), settings(), nowMs, starTimes())
        write(STAR_TIMES, longs(r.times))
        if (r.changes.isNotEmpty()) {
            write(STARS, booleans(r.stars))
            val notices = (read(NOTICES) as? JsonArray).orEmpty() + r.notices
            write(NOTICES, JsonArray(notices.takeLast(8)))
        }
        if (same) {
            write(STAR_CHANGES, JsonObject(mapOf("at" to JsonPrimitive(at), "list" to JsonArray(r.changes))))
        } else {
            write(STAR_CHANGES, JsonNull)
            write(NOTICES, JsonArray(emptyList()))
        }
        write(BUNDLE, saved)
        write(STATUS, if (mineError == null) JsonObject(emptyMap()) else JsonObject(mapOf(
            "title" to JsonPrimitive("Booking details not downloaded"),
            "error" to JsonPrimitive("Your sailing downloaded, but your booking details didn't: $mineError"),
            "at" to JsonPrimitive(at),
        )))
        return SaveResult(sameSailing = same, keptMine = keptMine, starChanges = r.changes.size)
    }

    /** A failed download: shown on the settings page until the next one works. */
    fun recordFailure(error: String, at: String) {
        write(STATUS, JsonObject(mapOf("error" to JsonPrimitive(error), "at" to JsonPrimitive(at))))
    }

    /** {error, at} (and title) of the last failed download, or empty. */
    fun status(): JsonObject = readObject(STATUS)

    // ------------------------------------------------------------ stars and reserved marks

    /** Starred events and reserved marks that are on, by star key. */
    fun stars(): Map<String, Boolean> =
        readObject(STARS).mapNotNull { (k, v) -> if ((v as? JsonPrimitive)?.booleanOrNull == true) k to true else null }.toMap()

    /** When each star last changed (ms), so the latest change wins between the watch and the phone. */
    fun starTimes(): Map<String, Long> =
        readObject(STAR_TIMES).mapNotNull { (k, v) -> (v as? JsonPrimitive)?.longOrNull?.let { k to it } }.toMap()

    /** Star keys of the events marked reserved (docs/DESIGN.md §7.3). */
    fun reservedMarks(): Set<String> =
        stars().keys.filter { it.startsWith(RESERVED_PREFIX) }.map { it.removePrefix(RESERVED_PREFIX) }.toSet()

    fun isStarred(key: String): Boolean = stars()[key] == true

    /**
     * Applies star changes from the watch or a settings screen (slice.js
     * applyStarChanges): the latest change wins. [changeTimes] say when each
     * change was made (ms); a missing, future or unreadable one counts as [nowMs].
     * Returns the stars as saved.
     */
    @Synchronized
    fun applyStarChanges(changes: Map<String, Boolean>, changeTimes: Map<String, Long> = emptyMap(),
                         nowMs: Long = System.currentTimeMillis()): Map<String, Boolean> {
        val stars = LinkedHashMap(stars())
        val times = LinkedHashMap(starTimes())
        for ((k, on) in changes) {
            if (k.length > STAR_KEY_MAX) continue
            val t = changeTimes[k]?.takeIf { it in 1..nowMs } ?: nowMs
            if ((times[k] ?: Long.MIN_VALUE) > t) continue
            times[k] = t
            if (on) stars[k] = true else stars.remove(k)
        }
        write(STARS, booleans(stars))
        write(STAR_TIMES, longs(times))
        return stars
    }

    // ------------------------------------------------------------ reservations (the booking)

    /** The booking's cabin details, or null when the sailing wasn't downloaded with login. */
    fun booking(): Booking? {
        val mine = bundle()?.get("mine") as? JsonObject ?: return null
        return Booking(
            stateroom = mine.text("stateroom"),
            deck = mine.text("deck"),
            muster = mine.text("muster"),
            arrival = mine.text("arrival"),
            embarkTimeZone = mine.text("embarkTimeZone"),
            otherBookings = (mine["otherBookings"] as? JsonPrimitive)?.longOrNull?.toInt() ?: 0,
            unsure = (mine["bookingUnsure"] as? JsonPrimitive)?.booleanOrNull == true,
            ordersError = mine.text("ordersError"),
            voyageError = mine.text("voyageError"),
        )
    }

    /** Purchased add-ons and booked sessions, in the bundle's order (by date and time, then title). */
    fun reservations(): List<Reservation> {
        val orders = (bundle()?.get("mine") as? JsonObject)?.get("orders") as? JsonArray ?: return emptyList()
        return orders.mapNotNull { o ->
            if (o !is JsonObject) return@mapNotNull null
            Reservation(
                title = o.text("title") ?: "",
                category = o.text("category") ?: "",
                guests = o.long("guests")?.toInt() ?: 0,
                date = o.text("date"),
                time = o.text("time"),
                day = o.long("day")?.toInt(),
                port = o.text("port"),
                meet = o.text("meet"),
                end = o.text("end"),
                minutes = o.long("minutes")?.toInt(),
            )
        }
    }

    // ------------------------------------------------------------ settings

    /** The settings as index.js keeps them (me, theme, reminderLead, personal, venues, ...). */
    fun settings(): JsonObject = readObject(SETTINGS)

    fun saveSettings(settings: JsonObject) = write(SETTINGS, settings)

    /** Merges top-level settings over the saved ones (a null value removes a key). */
    @Synchronized
    fun updateSettings(changes: Map<String, JsonElement?>): JsonObject {
        val s = LinkedHashMap(settings())
        changes.forEach { (k, v) -> if (v == null) s.remove(k) else s[k] = v }
        return JsonObject(s).also { saveSettings(it) }
    }

    /** Personal entries (settings.personal) the owner added on the settings page. */
    fun personal(): JsonArray = settings()["personal"] as? JsonArray ?: JsonArray(emptyList())

    // ------------------------------------------------------------ ship list cache

    /** Royal's ship list when saved less than [maxAgeMs] ago, else null. */
    fun ships(nowMs: Long = System.currentTimeMillis(), maxAgeMs: Long = SHIPS_MAX_AGE_MS): List<Pair<String, String>>? {
        val saved = read(SHIPS) as? JsonObject ?: return null
        val at = (saved["at"] as? JsonPrimitive)?.longOrNull ?: return null
        if (nowMs - at > maxAgeMs) return null
        return (saved["list"] as? JsonArray)?.mapNotNull { s ->
            val code = (s as? JsonObject).text("code") ?: return@mapNotNull null
            code to ((s as JsonObject).text("name") ?: code)
        }
    }

    fun saveShips(ships: List<Pair<String, String>>, nowMs: Long = System.currentTimeMillis()) {
        write(SHIPS, JsonObject(mapOf("at" to JsonPrimitive(nowMs), "list" to JsonArray(ships.map { (code, name) ->
            JsonObject(mapOf("code" to JsonPrimitive(code), "name" to JsonPrimitive(name)))
        }))))
    }
}

/** True when both bundles are for the same ship and sail date (bundle.js sameSailing). */
fun sameSailing(a: JsonObject?, b: JsonObject?): Boolean {
    if (a == null || b == null) return false
    val sa = a.text("sailDate") ?: return false
    val ca = (a["ship"] as? JsonObject).text("code")
    val cb = (b["ship"] as? JsonObject).text("code")
    return a["ship"] is JsonObject && b["ship"] is JsonObject && sa == b.text("sailDate") && ca == cb
}

data class Sailing(
    val shipCode: String,
    val shipName: String,
    val sailDate: String,
    val generated: String?,
    val days: Int,
    val events: Int,
    val hasBooking: Boolean,
)

data class Booking(
    val stateroom: String?,
    val deck: String?,
    val muster: String?,
    val arrival: String?,
    val embarkTimeZone: String?,
    val otherBookings: Int,
    val unsure: Boolean,
    val ordersError: String?,
    val voyageError: String?,
) {
    // Cabin details: keep them out of logs.
    override fun toString(): String = "Booking(<private>)"
}

data class Reservation(
    val title: String,
    val category: String,
    val guests: Int,
    val date: String?,
    val time: String?,
    val day: Int?,
    val port: String?,
    val meet: String?,
    val end: String?,
    val minutes: Int?,
)

data class SaveResult(val sameSailing: Boolean, val keptMine: Boolean, val starChanges: Int)

/**
 * What a re-download does to stars of events Royal moved or cancelled
 * (slice.js reconcileStars + pruneStarTimes + buildNotices). That logic stays
 * in the JS and runs through the embedded JS engine once Phase 3 wires it in;
 * until then [KEEP] leaves stars as they are, which is what the JS does for a
 * new sailing.
 */
fun interface StarReconciler {
    fun reconcile(old: JsonObject?, new: JsonObject, stars: Map<String, Boolean>, settings: JsonObject, nowMs: Long,
                  times: Map<String, Long>): Reconciled

    data class Reconciled(
        val stars: Map<String, Boolean>,
        val times: Map<String, Long>,
        /** The settings page's change list (slice.js `changes`), as JSON. */
        val changes: List<JsonElement>,
        /** Watch notices for those changes (slice.js buildNotices). */
        val notices: List<JsonElement>,
    )

    companion object {
        val KEEP = StarReconciler { _, _, stars, _, _, times -> Reconciled(stars, times, emptyList(), emptyList()) }
    }
}

private fun JsonObject?.text(key: String): String? =
    (this?.get(key) as? JsonPrimitive)?.takeIf { it !is JsonNull && it.isString }?.contentOrNull

private fun JsonObject.long(key: String): Long? =
    (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull && !it.isString }?.let { it.longOrNull ?: it.content.toDoubleOrNull()?.toLong() }

private fun booleans(m: Map<String, Boolean>) = JsonObject(m.mapValues { JsonPrimitive(it.value) })
private fun longs(m: Map<String, Long>) = JsonObject(m.mapValues { JsonPrimitive(it.value) })
