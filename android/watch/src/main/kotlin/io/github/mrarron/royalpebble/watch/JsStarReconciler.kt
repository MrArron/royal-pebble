package io.github.mrarron.royalpebble.watch

import io.github.mrarron.royalpebble.store.StarReconciler
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull

/**
 * Stars follow events Royal moved or cancelled on a re-download, as index.js
 * useBundle does: runs slice.js reconcileStars, pruneStarTimes and
 * buildNotices from src/pkjs in a fresh JS engine (QuickJS in the app), so the
 * app and PebbleKit JS share one copy of the logic. A download is rare, so
 * each call makes its own engine on the caller's thread and closes it.
 *
 * If the JS fails, stars are left as they are (StarReconciler.KEEP) and
 * [lastError] says why, for the app's log.
 */
class JsStarReconciler(
    private val engine: () -> JsRuntime,
    private val sources: JsBundle.Sources = JsBundle.Resources(),
) : StarReconciler {
    @Volatile
    var lastError: String? = null
        private set

    override fun reconcile(
        old: JsonObject?, new: JsonObject, stars: Map<String, Boolean>, settings: JsonObject, nowMs: Long,
        times: Map<String, Long>,
    ): StarReconciler.Reconciled {
        lastError = null
        return try {
            val out = run(old, new, stars, settings, nowMs, times)
            StarReconciler.Reconciled(
                stars = (out["stars"] as JsonObject).mapNotNull { (k, v) -> (v as? JsonPrimitive)?.booleanOrNull?.let { k to it } }.toMap(),
                times = (out["times"] as JsonObject).mapNotNull { (k, v) -> (v as? JsonPrimitive)?.longOrNull?.let { k to it } }.toMap(),
                changes = (out["changes"] as JsonArray).toList(),
                notices = (out["notices"] as JsonArray).toList(),
            )
        } catch (e: Exception) {
            lastError = "${e::class.java.simpleName}: ${e.message}"
            StarReconciler.KEEP.reconcile(old, new, stars, settings, nowMs, times)
        }
    }

    private fun run(
        old: JsonObject?, new: JsonObject, stars: Map<String, Boolean>, settings: JsonObject, nowMs: Long,
        times: Map<String, Long>,
    ): JsonObject {
        val args = JsonObject(mapOf(
            "old" to (old ?: kotlinx.serialization.json.JsonNull),
            "new" to new,
            "stars" to JsonObject(stars.mapValues { JsonPrimitive(it.value) }),
            "settings" to settings,
            "now" to JsonPrimitive(nowMs),
            "times" to JsonObject(times.mapValues { JsonPrimitive(it.value) }),
        ))
        engine().use { js ->
            js.evaluate(JsBundle.build(sources, "slice.js", exportAs = "__slice"), "slice-bundle.js")
            val result = js.evaluate(CALL.replace("ARGS", args.toString()), "reconcile.js")
            return Json.parseToJsonElement(result as String).jsonObject
        }
    }

    private companion object {
        // index.js useBundle, without the storage: the caller (CruiseStore.saveDownload) saves.
        const val CALL = """(function(a){
var s=__slice;
var r=s.reconcileStars(a.old,a.new,a.stars,a.settings,new Date(a.now),a.times);
return JSON.stringify({stars:r.stars,times:s.pruneStarTimes(r.times,a.new,a.settings,r.stars),
changes:r.changes,notices:r.changes.length?s.buildNotices(a.new.sailDate,r.changes):[]});
})(ARGS)"""
    }
}

/** 'moved 1, cancelled 1, check 0' for a log line: counts only, no titles. */
fun starChangeCounts(changes: List<JsonElement>): String {
    val kinds = changes.map { ((it as? JsonObject)?.get("kind") as? JsonPrimitive)?.content }
    return listOf("moved", "cancelled", "check").joinToString(", ") { k -> "$k ${kinds.count { it == k }}" }
}
