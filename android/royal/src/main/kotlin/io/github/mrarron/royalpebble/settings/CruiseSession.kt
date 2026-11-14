package io.github.mrarron.royalpebble.settings

import io.github.mrarron.royalpebble.store.CruiseStore
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.time.LocalDateTime

/**
 * What the native settings screens read and write: the saved cruise, or the demo
 * (see [DemoBundle]) while no real cruise data is saved. Every save goes through
 * [SettingsRules] and into the [CruiseStore] under the keys and JSON of
 * `src/pkjs/index.js`, so the watch side reads it as it reads the settings
 * page's results. In demo mode the owner's settings are still saved, but the demo
 * sailing and its stars stay in memory.
 *
 * Not thread-safe by itself; the view model calls it from one place at a time.
 */
class CruiseSession(
    val store: CruiseStore,
    private val now: () -> LocalDateTime = { LocalDateTime.now() },
) {
    private var demo: DemoBundle.Demo? = null
    private val demoStars = LinkedHashMap<String, Boolean>()

    private fun demoData(): DemoBundle.Demo = demo ?: DemoBundle.make(now()).also { demo = it; demoStars.putAll(it.stars) }

    val isDemo: Boolean get() = store.bundle() == null

    /** The saved sailing's bundle, or the demo's. */
    fun bundle(): JsonObject = store.bundle() ?: demoData().bundle

    /** The saved settings; in demo mode they are laid over the demo's. */
    fun settings(): JsonObject {
        val saved = store.settings()
        return if (isDemo) JsonObject(demoData().settings + saved) else saved
    }

    fun stars(): Map<String, Boolean> = if (isDemo) { demoData(); demoStars.filterValues { it } } else store.stars()

    fun events(): List<Event> = CruiseData.events(bundle())
    fun itinerary(): List<ItineraryDay> = CruiseData.itinerary(bundle())

    // ------------------------------------------------------------ stars and reserved marks

    fun setStar(key: String, on: Boolean) = setStars(mapOf(key to on))

    /** Stars and reserved marks (`R|` keys); the latest change wins, as between the watch and the phone. */
    fun setStars(changes: Map<String, Boolean>) {
        if (isDemo) {
            demoData()
            changes.forEach { (k, on) -> if (on) demoStars[k] = true else demoStars.remove(k) }
        } else {
            store.applyStarChanges(changes)
        }
    }

    fun isStarred(key: String): Boolean = stars()[key] == true
    fun isReserved(key: String): Boolean = stars()[CruiseStore.RESERVED_PREFIX + key] == true

    /** A booked session's Pick: it stars the session and marks it reserved (docs/DESIGN.md §12.5). */
    fun pick(key: String, on: Boolean) = setStars(mapOf(key to on, CruiseStore.RESERVED_PREFIX + key to on))

    // ------------------------------------------------------------ settings

    private fun save(changes: Map<String, JsonElement?>) { store.updateSettings(changes) }

    fun saveFilters(hiddenCats: List<String>, ageFilters: List<String>, showFeatured: Boolean) = save(mapOf(
        "hiddenCats" to CruiseData.hiddenJson(hiddenCats),
        "ageFilters" to JsonArray(CruiseData.AGE_FILTERS.filter { it in ageFilters }.map { JsonPrimitive(it) }),
        "showFeatured" to JsonPrimitive(showFeatured),
    ))

    /** One day's settings replaced (null clears it). */
    fun saveDay(date: String, day: JsonObject?) {
        val days = LinkedHashMap((settings()["days"] as? JsonObject) ?: emptyMap())
        val cleaned = SettingsRules.cleanDaySettings(day)
        if (cleaned == null) days.remove(date) else days[date] = cleaned
        save(mapOf("days" to JsonObject(days)))
    }

    fun savePersonal(list: List<SettingsRules.Personal>) = save(mapOf("personal" to SettingsRules.personalJson(list)))

    fun addPersonal(entry: SettingsRules.Personal): Boolean {
        val cleaned = SettingsRules.cleanPersonal(JsonArray(listOf(entry.toJson()))).firstOrNull() ?: return false
        val list = SettingsRules.personal(settings())
        if (list.size >= SettingsRules.MAX_PERSONAL) return false
        savePersonal(list + cleaned)
        return true
    }

    fun removePersonal(id: String) = savePersonal(SettingsRules.personal(settings()).filter { it.id != id })

    /** My info: only the fields given are changed; an empty one is removed. */
    fun saveMe(fields: Map<String, String>) {
        val me = LinkedHashMap((settings()["me"] as? JsonObject) ?: emptyMap())
        fields.forEach { (k, v) -> val t = v.trim().take(80); if (t.isEmpty()) me.remove(k) else me[k] = JsonPrimitive(t) }
        save(mapOf("me" to JsonObject(me)))
    }

    fun me(): Map<String, String> =
        (settings()["me"] as? JsonObject)?.mapNotNull { (k, v) -> v.str()?.let { k to it } }?.toMap() ?: emptyMap()

    fun saveBasics(theme: String, reminderLead: Int, reserveAlertAt: Int, units: String, alwaysHints: Boolean) = save(mapOf(
        "theme" to JsonPrimitive(if (theme == "dark") "dark" else "light"),
        "reminderLead" to JsonPrimitive(if (reminderLead in SettingsRules.REMINDER_LEADS) reminderLead else 15),
        "reserveAlertAt" to JsonPrimitive(if (reserveAlertAt in SettingsRules.RESERVE_ALERT_TIMES) reserveAlertAt else SettingsRules.RESERVE_ALERT_DEFAULT),
        "units" to JsonPrimitive(if (units in SettingsRules.UNITS) units else "m"),
        "alwaysHints" to JsonPrimitive(alwaysHints),
    ))

    // ------------------------------------------------------------ the booking (for Me's "Use booking")

    fun booking() = store.booking()

    // ------------------------------------------------------------ share my plan

    fun shipCode(): String = (bundle()["ship"] as? JsonObject)?.get("code").str() ?: ""
    fun shipName(): String = (bundle()["ship"] as? JsonObject)?.get("name").str() ?: "Your ship"
    fun sailDate(): String = bundle()["sailDate"].str() ?: ""

    fun myPlan(): SharePlan.Mine {
        val s = settings()
        return SharePlan.Mine(
            ship = shipCode(), sailDate = sailDate(), stars = stars(), personal = SettingsRules.personal(s),
            days = s["days"] as? JsonObject ?: JsonObject(emptyMap()),
            venues = (s["venues"] as? JsonObject)?.get(shipCode()) as? JsonObject ?: JsonObject(emptyMap()),
            cabin = me(),
        )
    }

    /** The message to share, with or without the cabin details. */
    fun sharePlanText(withCabin: Boolean): String {
        val plan = SharePlan.build(myPlan(), withCabin)
        return SharePlan.encode(plan, shipName() + " \u00b7 sails " + CruiseData.sailText(sailDate()))
    }

    sealed class PlanRead {
        data class Error(val message: String) : PlanRead()
        data class Ready(val plan: JsonObject, val diff: SharePlan.Diff) : PlanRead()
    }

    /** Reads a pasted plan: refuses another sailing, else lists the differences. */
    fun readPlan(text: String): PlanRead {
        if (text.isBlank()) return PlanRead.Error("")
        val plan = when (val d = SharePlan.decode(text)) {
            is SharePlan.Decoded.Error -> return PlanRead.Error(d.message)
            is SharePlan.Decoded.Ok -> d.plan
        }
        if (plan["ship"].str() != shipCode() || plan["sail"].str() != sailDate()) {
            return PlanRead.Error("This plan is for ${plan["ship"].str()} sailing ${CruiseData.sailText(plan["sail"].str() ?: "")}. " +
                "Yours is ${shipName()} sailing ${CruiseData.sailText(sailDate())}. A plan only imports onto the same sailing.")
        }
        return PlanRead.Ready(plan, SharePlan.diff(SharePlan.build(myPlan(), true), plan))
    }

    data class Applied(val stars: Int, val unstarred: Int, val personal: Int, val days: Int, val cabin: Int)

    /** Applies the chosen changes. Never removes anything of the owner's except a star they chose to drop. */
    fun applyPlan(items: List<SharePlan.Item>, take: Map<Int, Boolean> = emptyMap()): Applied {
        val ch = SharePlan.changes(items, take)
        setStars(ch.stars)
        var personalAdded = 0
        if (ch.personal.isNotEmpty()) {
            val current = SettingsRules.personal(settings())
            val seen = current.map { it.id }.toMutableSet()
            val added = SettingsRules.cleanPersonal(JsonArray(ch.personal)).filter { seen.add(it.id) }
            personalAdded = added.size
            if (added.isNotEmpty()) savePersonal((current + added).take(SettingsRules.MAX_PERSONAL))
        }
        var dayFields = 0
        val dates = itinerary().map { it.date }.toSet()
        for ((date, fields) in ch.days) {
            if (date !in dates) continue
            val cur = LinkedHashMap(((settings()["days"] as? JsonObject)?.get(date) as? JsonObject) ?: emptyMap())
            fields.forEach { (f, v) -> cur[f] = v; dayFields++ }
            saveDay(date, JsonObject(cur))
        }
        if (ch.cabin.isNotEmpty()) saveMe(ch.cabin)
        return Applied(ch.stars.count { it.value }, ch.stars.count { !it.value }, personalAdded, dayFields, ch.cabin.size)
    }
}
