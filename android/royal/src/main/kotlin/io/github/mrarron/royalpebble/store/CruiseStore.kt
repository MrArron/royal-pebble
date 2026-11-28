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

    /** A short description of the active sailing (the one the app and the watch follow), or null when none is saved. */
    fun sailing(): Sailing? = describe(bundle())

    private fun describe(b: JsonObject?): Sailing? {
        b ?: return null
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
     * follow the [reconciler], and a sailing's star changes and notices belong
     * to that sailing. [at] is the status time as the settings page shows
     * it; [mineError] records why booking details didn't download.
     *
     * Each sailing is kept on its own (ship and sail date). A download of another
     * sailing becomes the active one (the one the app screens and the watch follow)
     * when [makeActive] is true, and the sailing that was active is put away with its
     * stars; a background refresh passes false so it never switches the app.
     */
    @Synchronized
    fun saveDownload(bundle: JsonObject, at: String, mineError: String? = null, nowMs: Long = System.currentTimeMillis(),
                     makeActive: Boolean = true): SaveResult {
        val act = activeState()
        val slot = slotName(bundle)
        val activeSlot = act?.let { slotName(it.bundle) }
        val toActive = slot == null || act == null || slot == activeSlot || makeActive
        val old: SailingState? = if (slot == null || slot == activeSlot) act else readSlot(slot)
        val same = old != null && sameSailing(old.bundle, bundle)
        var saved = bundle
        val keptMine = same && bundle["mine"] !is JsonObject && old!!.bundle["mine"] is JsonObject
        if (keptMine) saved = JsonObject(bundle + ("mine" to old!!.bundle["mine"]!!))
        val oldStars = old?.stars.orEmpty()
        val r = reconciler.reconcile(old?.bundle, saved, oldStars, settings(), nowMs, old?.times.orEmpty())
        val stars = if (r.changes.isNotEmpty()) r.stars else oldStars
        var notices: List<JsonElement> = old?.notices ?: emptyList()
        if (r.changes.isNotEmpty()) notices = (notices + r.notices).takeLast(8)
        val next = SailingState(
            saved, stars, r.times,
            if (same) JsonObject(mapOf("at" to JsonPrimitive(at), "list" to JsonArray(r.changes))) else JsonNull,
            if (same) JsonArray(notices) else JsonArray(emptyList()),
        )
        if (toActive) {
            // The sailing that was active is put away; a stored copy of this one is now the live one.
            if (act != null && activeSlot != null && slot != activeSlot) writeSlot(activeSlot, act)
            if (slot != null && slot != activeSlot) deleteSlot(slot)
            writeActive(next)
            write(STATUS, if (mineError == null) JsonObject(emptyMap()) else JsonObject(mapOf(
                "title" to JsonPrimitive("Booking details not downloaded"),
                "error" to JsonPrimitive("Your sailing downloaded, but your booking details didn't: $mineError"),
                "at" to JsonPrimitive(at),
            )))
        } else {
            writeSlot(slot!!, next)
        }
        return SaveResult(sameSailing = same, keptMine = keptMine, starChanges = r.changes.size)
    }

    // ------------------------------------------------------------ several sailings

    /** One saved sailing and whether it is the active one. */
    data class StoredSailing(val sailing: Sailing, val active: Boolean)

    /** Every saved sailing (the active one and the ones put away), soonest first. */
    @Synchronized
    fun sailings(): List<StoredSailing> {
        val list = ArrayList<StoredSailing>()
        describe(bundle())?.let { list += StoredSailing(it, true) }
        archived().forEach { list += StoredSailing(it, false) }
        return list.sortedBy { it.sailing.sailDate }
    }

    /** The saved bundle of a sailing, active or put away; null when it isn't saved. */
    @Synchronized
    fun bundleOf(shipCode: String, sailDate: String): JsonObject? {
        val slot = slotName(shipCode, sailDate)
        val act = bundle()
        if (act != null && slotName(act) == slot) return act
        return readSlot(slot)?.bundle
    }

    /**
     * Makes a saved sailing the active one: the app screens and the watch follow it. The sailing that was
     * active is put away with its stars and notices. False when [shipCode] and [sailDate] aren't saved.
     */
    @Synchronized
    fun activate(shipCode: String, sailDate: String): Boolean {
        val slot = slotName(shipCode, sailDate)
        val act = activeState()
        if (act != null && slotName(act.bundle) == slot) return true
        val s = readSlot(slot) ?: return false
        if (act != null) slotName(act.bundle)?.let { writeSlot(it, act) }
        deleteSlot(slot)
        writeActive(s)
        return true
    }

    /**
     * Removes a saved sailing with its stars (price watches are kept). When it was the active one, the soonest
     * sailing from [today] (`YYYY-MM-DD`) on takes its place, else the latest. False when it isn't saved.
     */
    @Synchronized
    fun remove(shipCode: String, sailDate: String, today: String): Boolean {
        val slot = slotName(shipCode, sailDate)
        val act = activeState()
        if (act != null && slotName(act.bundle) == slot) {
            writeActive(null)
            val rest = archived().sortedBy { it.sailDate }
            val next = rest.firstOrNull { it.sailDate >= today } ?: rest.lastOrNull()
            next?.let { activate(it.shipCode, it.sailDate) }
            return true
        }
        if (readSlot(slot) == null) return false
        deleteSlot(slot)
        return true
    }

    private class SailingState(
        val bundle: JsonObject, val stars: Map<String, Boolean>, val times: Map<String, Long>,
        val changes: JsonElement, val notices: JsonArray,
    )

    private fun activeState(): SailingState? {
        val b = bundle() ?: return null
        return SailingState(b, stars(), starTimes(), read(STAR_CHANGES) ?: JsonNull, read(NOTICES) as? JsonArray ?: JsonArray(emptyList()))
    }

    /** Writes the active sailing's files (null: none active). The bundle goes last, as a download always did. */
    private fun writeActive(s: SailingState?) {
        write(STAR_TIMES, s?.let { longs(it.times) })
        write(STARS, s?.takeIf { it.stars.isNotEmpty() }?.let { booleans(it.stars) })
        write(STAR_CHANGES, s?.changes)
        write(NOTICES, s?.notices)
        write(BUNDLE, s?.bundle)
    }

    // Sailings put away: sailings/<SHIP>_<YYYYMMDD>.json beside the key files, where the watch's JS doesn't look.
    private fun slotFile(slot: String) = File(File(dir, "sailings"), "$slot.json")

    private fun readSlot(slot: String): SailingState? {
        val f = slotFile(slot)
        if (!f.exists()) return null
        return try {
            val o = parseJson(f.readText(Charsets.UTF_8)) as? JsonObject ?: return null
            SailingState(
                o["bundle"] as? JsonObject ?: return null,
                (o["stars"] as? JsonObject).orEmpty().mapNotNull { (k, v) -> if ((v as? JsonPrimitive)?.booleanOrNull == true) k to true else null }.toMap(),
                (o["starTimes"] as? JsonObject).orEmpty().mapNotNull { (k, v) -> (v as? JsonPrimitive)?.longOrNull?.let { k to it } }.toMap(),
                o["starChanges"] ?: JsonNull,
                o["notices"] as? JsonArray ?: JsonArray(emptyList()),
            )
        } catch (e: Exception) {
            null
        }
    }

    private fun writeSlot(slot: String, s: SailingState) {
        val f = slotFile(slot)
        f.parentFile!!.mkdirs()
        val text = JsonObject(mapOf(
            "bundle" to s.bundle, "stars" to booleans(s.stars), "starTimes" to longs(s.times),
            "starChanges" to s.changes, "notices" to s.notices,
        )).toString()
        val tmp = File(f.parentFile, "$slot.json.tmp")
        tmp.writeText(text, Charsets.UTF_8)
        if (!tmp.renameTo(f)) {
            f.delete()
            if (!tmp.renameTo(f)) throw IOException("could not save a sailing")
        }
    }

    private fun deleteSlot(slot: String) { slotFile(slot).delete() }

    private fun archived(): List<Sailing> =
        (File(dir, "sailings").listFiles() ?: emptyArray()).filter { it.name.endsWith(".json") }
            .mapNotNull { describe(readSlot(it.name.removeSuffix(".json"))?.bundle) }

    private fun slotName(b: JsonObject): String? {
        val code = (b["ship"] as? JsonObject).text("code") ?: return null
        return slotName(code, b.text("sailDate") ?: return null)
    }

    private fun slotName(shipCode: String, sailDate: String): String =
        shipCode.uppercase().filter { it.isLetterOrDigit() } + "_" + sailDate.filter { it.isDigit() }

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
 * in the JS: the app passes android/watch's JsStarReconciler, which runs it in
 * QuickJS. [KEEP] leaves stars as they are (tests, and the fallback when the JS fails).
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
