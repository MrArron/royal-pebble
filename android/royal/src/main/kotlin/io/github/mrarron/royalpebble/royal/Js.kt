package io.github.mrarron.royalpebble.royal

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.math.floor

// Small helpers that read Royal's JSON the way src/pkjs/royal.js does, so the
// port keeps its JavaScript semantics: a missing key is `undefined` (Kotlin
// null), `x || {}` falls back on any falsy value, String(x) spells numbers
// without a trailing ".0". Keep them boring; the parity tests lean on them.

/**
 * JSON.parse: like Json.parseToJsonElement, but an unquoted word on its own
 * ("<html>", which kotlinx reads as a literal) is not valid data.
 */
fun parseJson(text: String): JsonElement {
    val e = kotlinx.serialization.json.Json.parseToJsonElement(text)
    if (e is JsonPrimitive && e !is JsonNull && !e.isString && e.content != "true" && e.content != "false" &&
        !Regex("-?(0|[1-9]\\d*)(\\.\\d+)?([eE][+-]?\\d+)?").matches(e.content)) {
        throw IllegalArgumentException("not JSON")
    }
    return e
}

internal operator fun JsonElement?.get(key: String): JsonElement? = (this as? JsonObject)?.get(key)

/** JS `x || {}` then `.key`: an object, or empty. */
internal fun JsonElement?.objOrEmpty(): JsonObject = this as? JsonObject ?: EMPTY_OBJECT

/** JS `x || []`: an array, or empty (a non-array value would throw in JS; here it reads as empty). */
internal fun JsonElement?.arrOrEmpty(): JsonArray = this as? JsonArray ?: EMPTY_ARRAY

/** JS `Array.isArray(x) ? x[0] : x`. */
internal fun JsonElement?.firstIfArray(): JsonElement? = if (this is JsonArray) this.getOrNull(0) else this

internal val EMPTY_OBJECT = JsonObject(emptyMap())
internal val EMPTY_ARRAY = JsonArray(emptyList())

internal fun JsonElement?.isNumber(): Boolean =
    this is JsonPrimitive && this !is JsonNull && !isString && content != "true" && content != "false"

internal fun JsonElement?.isBoolean(): Boolean =
    this is JsonPrimitive && this !is JsonNull && !isString && (content == "true" || content == "false")

/** The number, when it is a JSON number (JS `typeof x === 'number'`). */
internal fun JsonElement?.number(): Double? = if (isNumber()) (this as JsonPrimitive).content.toDoubleOrNull() else null

/** The text, when it is a JSON string. */
internal fun JsonElement?.string(): String? = if (this is JsonPrimitive && this !is JsonNull && isString) content else null

/** JS truthiness. */
internal fun JsonElement?.truthy(): Boolean = when {
    this == null || this is JsonNull -> false
    this is JsonPrimitive && isString -> content.isNotEmpty()
    this is JsonPrimitive && isBoolean() -> content == "true"
    this is JsonPrimitive -> content.toDoubleOrNull().let { it != null && it != 0.0 && !it.isNaN() }
    else -> true
}

/** JS `String(x)`. */
internal fun JsonElement?.jsString(): String = when {
    this == null -> "undefined"
    this is JsonNull -> "null"
    this is JsonPrimitive && isNumber() -> content.toDoubleOrNull()?.let { jsNumberText(it) } ?: content
    this is JsonPrimitive -> content
    this is JsonArray -> joinToString(",") { if (it is JsonNull) "" else it.jsString() }
    else -> "[object Object]"
}

/** JS `typeof v === 'number' && v % 1 === 0`. */
internal fun JsonElement?.isCount(): Boolean = number()?.let { !it.isInfinite() && it % 1.0 == 0.0 } ?: false

internal fun jsNumberText(d: Double): String =
    if (!d.isInfinite() && !d.isNaN() && d % 1.0 == 0.0 && kotlin.math.abs(d) < 1e21) d.toLong().toString()
    else d.toString()

/** A JSON number the way JSON.stringify writes it: 150, not 150.0. */
internal fun jsNumber(d: Double): JsonPrimitive =
    if (d % 1.0 == 0.0 && kotlin.math.abs(d) < 9e15) JsonPrimitive(d.toLong()) else JsonPrimitive(d)

/** JS `Math.round` (halves round up, also for negative numbers). */
internal fun jsRound(d: Double): Double = floor(d + 0.5)

/** JS `parseInt(String(x), 10)`: leading digits after optional spaces and sign, or null (NaN). */
internal fun jsParseInt(x: JsonElement?): Long? {
    val m = Regex("^\\s*([+-]?\\d+)").find(x.jsString()) ?: return null
    return m.groupValues[1].toBigInteger().let {
        if (it.bitLength() < 63) it.toLong() else null
    }
}

/** JS `encodeURIComponent`. */
internal fun encodeUriComponent(s: String): String {
    val out = StringBuilder()
    for (b in s.toByteArray(Charsets.UTF_8)) {
        val c = b.toInt() and 0xff
        val ch = c.toChar()
        if (c < 0x80 && (ch.isLetterOrDigit() || ch in "-_.!~*'()")) {
            out.append(ch)
        } else {
            out.append('%').append("0123456789ABCDEF"[c shr 4]).append("0123456789ABCDEF"[c and 15])
        }
    }
    return out.toString()
}

/** A mutable JSON object that, like JSON.stringify, leaves out keys whose value is `undefined`. */
internal class ObjBuilder {
    val map = LinkedHashMap<String, JsonElement>()

    /** Copies a raw value through; a missing one (Kotlin null) leaves the key out. */
    fun raw(key: String, value: JsonElement?) {
        if (value != null) map[key] = value else map.remove(key)
    }

    fun str(key: String, value: String?) {
        map[key] = if (value == null) JsonNull else JsonPrimitive(value)
    }

    fun num(key: String, value: Number?) {
        map[key] = when (value) {
            null -> JsonNull
            is Double -> jsNumber(value)
            else -> JsonPrimitive(value)
        }
    }

    fun bool(key: String, value: Boolean) {
        map[key] = JsonPrimitive(value)
    }

    fun build(): JsonObject = JsonObject(LinkedHashMap(map))
}

internal fun obj(block: ObjBuilder.() -> Unit): JsonObject = ObjBuilder().apply(block).build()

internal fun jsonArrayOf(vararg values: Any?): JsonArray = JsonArray(values.map { toJson(it) })

internal fun toJson(v: Any?): JsonElement = when (v) {
    null -> JsonNull
    is JsonElement -> v
    is String -> JsonPrimitive(v)
    is Boolean -> JsonPrimitive(v)
    is Double -> jsNumber(v)
    is Number -> JsonPrimitive(v)
    is List<*> -> JsonArray(v.map { toJson(it) })
    is Map<*, *> -> JsonObject(v.entries.associate { (k, x) -> k.toString() to toJson(x) })
    else -> error("not JSON: $v")
}
