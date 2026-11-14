package io.github.mrarron.royalpebble.watch

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * The Android app's test log (Settings > Watch > Share test log), one text in
 * the usage log's style (src/pkjs/log.js): a header saying which build and
 * switches served the watch, the app's own lines (switches, server starts and
 * stops, alerts it sent), then the usage log index.js keeps in the app's cruise
 * store (the `usageLog` key, which PebbleKit JS's copy never sees). Holds cabin
 * and booking details: never commit one.
 */
object TestLog {
    /** One usage log entry, [ms, day, minute, kind, detail], as log.js renderEntry draws it. */
    fun renderEntry(e: JsonArray, zone: TimeZone = TimeZone.getDefault()): String {
        val ms = (e[0] as JsonPrimitive).longOrNull ?: 0L
        val day = (e[1] as? JsonPrimitive)?.intOrNull
        val min = (e[2] as? JsonPrimitive)?.intOrNull
        val dayText = if (day == null) "--" else "D" + (if (day >= 0) day + 1 else day)
        val ship = if (min == null) "--:--" else "%02d:%02d".format(Locale.ROOT, (min / 60) % 24, min % 60)
        return "${stamp(ms, zone)}  $dayText $ship  ${(e[3] as JsonPrimitive).content}  ${(e[4] as JsonPrimitive).content}"
    }

    /** The usage log's lines (the `usageLog` key's JSON text), oldest first; empty when it can't be read. */
    fun usageLines(json: String?, zone: TimeZone = TimeZone.getDefault()): List<String> {
        if (json.isNullOrBlank()) return emptyList()
        return runCatching {
            Json.parseToJsonElement(json).jsonObject["entries"]?.jsonArray?.map { renderEntry(it.jsonArray, zone) }
        }.getOrNull() ?: emptyList()
    }

    /** "2026-09-26 14:03:12" in [zone], the usage log's stamp. */
    fun stamp(ms: Long, zone: TimeZone = TimeZone.getDefault()): String =
        SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.ROOT).apply { timeZone = zone }.format(Date(ms))

    /** The app's own line: "2026-09-26 14:03:12  --:--  kind  detail" (no cruise day: it isn't index.js's). */
    fun appLine(ms: Long, kind: String, detail: String, zone: TimeZone = TimeZone.getDefault()): String =
        "${stamp(ms, zone)}  app  $kind  ${detail.replace(Regex("\\s+"), " ").trim()}"

    /**
     * The whole text. [header] lines go first, then "App lines" ([appLines]),
     * the usage log ([usageJson]) and, when given, the watch message log
     * ([wire], one line per message).
     */
    fun text(header: List<String>, appLines: List<String>, usageJson: String?, wire: String?,
             zone: TimeZone = TimeZone.getDefault()): String {
        val usage = usageLines(usageJson, zone)
        val out = StringBuilder()
        header.forEach { out.append(it).append('\n') }
        val off = zone.getOffset(System.currentTimeMillis()) / 60000
        out.append("Times on the phone clock, now UTC").append(if (off < 0) "-" else "+").append(Math.abs(off) / 60)
        if (Math.abs(off) % 60 != 0) out.append(":%02d".format(Locale.ROOT, Math.abs(off) % 60))
        out.append("\n\n== App lines (").append(appLines.size).append(")\n")
        appLines.forEach { out.append(it).append('\n') }
        out.append("\n== Usage log in the app (").append(usage.size).append(" entries; PebbleKit JS keeps its own)\n")
        usage.forEach { out.append(it).append('\n') }
        if (wire != null) {
            out.append("\n== Watch messages (> to the watch, < from it; ms since 1970)\n").append(wire)
            if (!wire.endsWith("\n")) out.append('\n')
        }
        return out.toString()
    }

    /** What index.js gets as __host.info (host.js), JSON text. */
    fun hostInfo(version: String, commit: String, serves: Boolean, wireLog: Boolean): String =
        JsonObject(mapOf(
            "version" to JsonPrimitive(version),
            "commit" to JsonPrimitive(commit),
            "serves" to JsonPrimitive(serves),
            "wireLog" to JsonPrimitive(wireLog),
        )).toString()
}
