package io.github.mrarron.royalpebble.alerts

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

/**
 * When a price watch alerts. "Normal" is the watch's [PriceWatch.baseline]: the price when the
 * watch was set (typed in, or the first check's price).
 */
enum class WatchRule(val code: String) {
    /** The default: any price below the price when the watch was set. */
    ANY_DROP("any"),
    /** At least [PriceWatch.percent] % below the price when the watch was set. */
    PERCENT("percent"),
    /** Below the user's own price, [PriceWatch.target]. */
    BELOW("below");

    companion object {
        fun of(code: String?) = entries.firstOrNull { it.code == code } ?: ANY_DROP
    }
}

/**
 * A price watch on a Cruise Planner item not bought yet (drink package, internet, excursion,
 * dining...). The price script checks it as an upstream `watchList` entry; the app decides
 * when it alerts (this class), not the script.
 */
data class PriceWatch(
    val id: String,
    val name: String,
    val prefix: String,
    val product: String,
    /** The booking to check it for; blank checks it on every booking the login sees. */
    val reservationId: String = "",
    val guestAge: String = "adult",
    val rule: WatchRule = WatchRule.ANY_DROP,
    val percent: Double = 0.0,
    val target: Double = 0.0,
    /** The price when the watch was set; null until typed in or found by the first check. */
    val baseline: Double? = null,
    val createdAt: Long = 0,
    val lastPrice: Double? = null,
    val currency: String = "USD",
    /** The script's status for the last check ("priced", "not_available_for_passenger", ...) or "not checked yet". */
    val lastStatus: String = NOT_CHECKED,
    val lastCheckedAt: Long = 0,
) {
    val code: String get() = "$prefix/$product"
    val muteKey: String get() = "watch|$id"

    /** The price at or below which this watch alerts, or null while it waits for a starting price. */
    fun triggerPrice(): Double? = when (rule) {
        WatchRule.ANY_DROP -> baseline
        WatchRule.PERCENT -> baseline?.let { round2(it * (1 - percent / 100.0)) }
        WatchRule.BELOW -> target.takeIf { it > 0 }
    }

    fun isHit(price: Double): Boolean {
        val t = triggerPrice() ?: return false
        return when (rule) {
            WatchRule.PERCENT -> price <= t + 0.004   // "20% or more below"
            else -> price < t - 0.004                  // strictly below
        }
    }

    /**
     * The `price` handed to the script: its own log then says "Book!" exactly when this watch
     * alerts. Before a starting price is known, 0.01 makes it only record the current price.
     */
    fun scriptPrice(): Double = triggerPrice()?.takeIf { it > 0 } ?: 0.01

    fun ruleText(symbol: String = "$"): String = when (rule) {
        WatchRule.ANY_DROP -> baseline?.let { "Any drop below ${NoticeEncoder.money(it, symbol)}" } ?: "Any drop (starting price set by the next check)"
        WatchRule.PERCENT -> {
            val p = trimNumber(percent)
            triggerPrice()?.let { "$p% below ${NoticeEncoder.money(baseline!!, symbol)} (${NoticeEncoder.money(it, symbol)} or less)" }
                ?: "$p% below the starting price (set by the next check)"
        }
        WatchRule.BELOW -> "Below ${NoticeEncoder.money(target, symbol)}"
    }

    companion object {
        const val NOT_CHECKED = "not checked yet"
        fun round2(v: Double) = Math.round(v * 100.0) / 100.0
        fun trimNumber(v: Double) = if (v == Math.floor(v)) v.toLong().toString() else v.toString()
    }
}

/** One app watch row from the price check (`watched` in rcp_runner's summary). */
data class WatchedRow(
    val reservationId: String,
    val code: String,
    val itemName: String,
    val current: Double?,
    val currency: String,
    val status: String,
)

/** A watch whose price is at or under its trigger. [key] changes with the price, so a further drop alerts again. */
data class WatchHit(
    val watchId: String,
    val name: String,
    val price: Double,
    val baseline: Double?,
    val trigger: Double,
    val rule: WatchRule,
    val currency: String,
    val reservationId: String,
) {
    val key: String get() = "watch|$watchId|$price"
    val muteKey: String get() = "watch|$watchId"
    /** Whole percent below the starting price, or null. */
    val percentOff: Int? get() = baseline?.takeIf { it > price && it > 0 }?.let { Math.round((it - price) / it * 100).toInt() }
}

data class WatchUpdate(val watches: List<PriceWatch>, val hits: List<WatchHit>, val summary: String)

object PriceWatches {
    private val json = Json { prettyPrint = false }

    /** Fold a check's rows into the watches: last price and status, a starting price when missing. */
    fun apply(watches: List<PriceWatch>, rows: List<WatchedRow>, checkedAt: Long, muted: Set<String> = emptySet()): WatchUpdate {
        var priced = 0
        var started = 0
        val updated = watches.map { w ->
            val mine = rows.filter { it.code == w.code && (w.reservationId.isBlank() || it.reservationId == w.reservationId) }
            if (mine.isEmpty()) return@map w.copy(lastStatus = "not in the last check", lastCheckedAt = checkedAt)
            val best = mine.filter { it.current != null && it.current > 0 }.minByOrNull { it.current!! }
            if (best == null) return@map w.copy(lastStatus = mine.first().status.ifBlank { "no price" }, lastPrice = null, lastCheckedAt = checkedAt)
            priced++
            val price = best.current!!
            val baseline = w.baseline ?: price.also { started++ }
            w.copy(
                name = w.name.ifBlank { best.itemName },
                baseline = baseline,
                lastPrice = price,
                currency = best.currency.ifBlank { w.currency },
                lastStatus = "priced",
                lastCheckedAt = checkedAt,
            )
        }
        val hits = hits(updated, muted)
        val allHits = hits(updated, emptySet())
        val summary = buildString {
            append("${watches.size} ${if (watches.size == 1) "watch" else "watches"}, $priced priced, ${allHits.size} below the trigger")
            if (allHits.size != hits.size) append(" (${allHits.size - hits.size} muted)")
            if (started > 0) append(", starting price set for $started")
        }
        return WatchUpdate(updated, hits, summary)
    }

    /** The watches that alert now, from their stored last prices (muted ones left out). */
    fun hits(watches: List<PriceWatch>, muted: Set<String>): List<WatchHit> = watches.mapNotNull { w ->
        val p = w.lastPrice ?: return@mapNotNull null
        if (w.muteKey in muted || !w.isHit(p)) return@mapNotNull null
        WatchHit(w.id, w.name.ifBlank { w.code }, p, w.baseline, w.triggerPrice()!!, w.rule, w.currency, w.reservationId)
    }

    /** What rcp_runner's `run(..., app_watches_json)` takes. */
    fun scriptJson(watches: List<PriceWatch>): String = JsonArray(watches.map { w ->
        JsonObject(buildMap {
            put("name", JsonPrimitive(w.name.ifBlank { w.code }))
            put("prefix", JsonPrimitive(w.prefix))
            put("product", JsonPrimitive(w.product))
            put("price", JsonPrimitive(w.scriptPrice()))
            put("guestAgeString", JsonPrimitive(w.guestAge))
            if (w.reservationId.isNotBlank()) put("reservation", JsonPrimitive(w.reservationId))
        })
    }).toString()

    fun encode(watches: List<PriceWatch>): String = JsonArray(watches.map { w ->
        JsonObject(buildMap {
            put("id", JsonPrimitive(w.id))
            put("name", JsonPrimitive(w.name))
            put("prefix", JsonPrimitive(w.prefix))
            put("product", JsonPrimitive(w.product))
            put("reservation", JsonPrimitive(w.reservationId))
            put("guestAge", JsonPrimitive(w.guestAge))
            put("rule", JsonPrimitive(w.rule.code))
            put("percent", JsonPrimitive(w.percent))
            put("target", JsonPrimitive(w.target))
            w.baseline?.let { put("baseline", JsonPrimitive(it)) }
            put("createdAt", JsonPrimitive(w.createdAt))
            w.lastPrice?.let { put("lastPrice", JsonPrimitive(it)) }
            put("currency", JsonPrimitive(w.currency))
            put("lastStatus", JsonPrimitive(w.lastStatus))
            put("lastCheckedAt", JsonPrimitive(w.lastCheckedAt))
        })
    }).toString()

    fun decode(text: String?): List<PriceWatch> {
        if (text.isNullOrBlank()) return emptyList()
        return runCatching {
            json.parseToJsonElement(text).jsonArray.mapNotNull { e ->
                val o = e.jsonObject
                fun s(k: String) = (o[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
                fun d(k: String) = (o[k] as? JsonPrimitive)?.doubleOrNull
                val id = s("id") ?: return@mapNotNull null
                PriceWatch(
                    id = id,
                    name = s("name") ?: "",
                    prefix = s("prefix") ?: return@mapNotNull null,
                    product = s("product") ?: return@mapNotNull null,
                    reservationId = s("reservation") ?: "",
                    guestAge = s("guestAge") ?: "adult",
                    rule = WatchRule.of(s("rule")),
                    percent = d("percent") ?: 0.0,
                    target = d("target") ?: 0.0,
                    baseline = d("baseline"),
                    createdAt = (o["createdAt"] as? JsonPrimitive)?.longOrNull ?: 0,
                    lastPrice = d("lastPrice"),
                    currency = s("currency") ?: "USD",
                    lastStatus = s("lastStatus") ?: PriceWatch.NOT_CHECKED,
                    lastCheckedAt = (o["lastCheckedAt"] as? JsonPrimitive)?.longOrNull ?: 0,
                )
            }
        }.getOrDefault(emptyList())
    }
}

/** A Cruise Planner product link: `.../cruise-planner/category/<prefix>/product/<product>?bookingId=...`. */
data class ProductLink(val prefix: String, val product: String, val bookingId: String) {
    companion object {
        private val PATH = Regex("""/category/([A-Za-z0-9_.\-]+)/product/([A-Za-z0-9_.\-]+)""")
        private val BOOKING = Regex("""[?&]bookingId=([A-Za-z0-9]+)""")

        /** Finds the link anywhere in [text] (a shared message can wrap it in other words). */
        fun parse(text: String?): ProductLink? {
            if (text.isNullOrBlank()) return null
            val m = PATH.find(text) ?: return null
            return ProductLink(m.groupValues[1], m.groupValues[2], BOOKING.find(text)?.groupValues?.get(1) ?: "")
        }
    }
}

/** Muted alerts: a booked item's price alert (`price|res|item|guest`) or a watch (`watch|id`), with a label to show. */
data class Muted(val key: String, val label: String, val at: Long)

object AlertMutes {
    /** The key that mutes one booked item's price alerts, whatever the price. */
    fun dropKey(reservationId: String, item: String, guest: String) = "price|$reservationId|$item|$guest"

    fun encode(list: List<Muted>): String = JsonArray(list.map {
        JsonObject(mapOf("key" to JsonPrimitive(it.key), "label" to JsonPrimitive(it.label), "at" to JsonPrimitive(it.at)))
    }).toString()

    fun decode(text: String?): List<Muted> {
        if (text.isNullOrBlank()) return emptyList()
        return runCatching {
            Json.parseToJsonElement(text).jsonArray.mapNotNull { e ->
                val o = e.jsonObject
                val key = o["key"]?.jsonPrimitive?.content ?: return@mapNotNull null
                Muted(key, o["label"]?.jsonPrimitive?.content ?: key, o["at"]?.jsonPrimitive?.longOrNull ?: 0)
            }
        }.getOrDefault(emptyList())
    }

    fun mute(list: List<Muted>, key: String, label: String, at: Long) =
        if (list.any { it.key == key }) list else list + Muted(key, label, at)

    fun unmute(list: List<Muted>, key: String) = list.filterNot { it.key == key }
}
