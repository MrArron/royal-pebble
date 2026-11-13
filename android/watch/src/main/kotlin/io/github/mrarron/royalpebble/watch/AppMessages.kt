package io.github.mrarron.royalpebble.watch

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.longOrNull

/**
 * One AppMessage value as it goes over the air. The app turns these into
 * PebbleKit Android 2's PebbleDictionaryItem (Text, Bytes, Int32, UInt32),
 * which the Pebble app encodes exactly as it encodes PebbleKit JS's
 * values (libpebble3: a string gets its trailing NUL, numbers are int32).
 */
sealed interface WireValue {
    data class Text(val value: String) : WireValue
    data class Int32(val value: Int) : WireValue
    data class UInt32(val value: Long) : WireValue
    class Bytes(val value: ByteArray) : WireValue {
        override fun equals(other: Any?) = other is Bytes && other.value.contentEquals(value)
        override fun hashCode() = value.contentHashCode()
        override fun toString() = "Bytes(${value.size})"
    }
}

/** An AppMessage: key id -> value, in the order the JS wrote the keys. */
typealias WireDict = Map<Int, WireValue>

/**
 * AppMessage keys: 10000 + the key's index in package.json "messageKeys"
 * (docs/WATCH_PROTOCOL.md, Android companion app), as the SDK numbers them.
 */
class MessageKeys(val names: List<String>) {
    private val ids = names.withIndex().associate { (i, n) -> n to FIRST + i }

    fun id(name: String): Int? = ids[name]
    fun name(id: Int): String? = names.getOrNull(id - FIRST)

    companion object {
        const val FIRST = 10000

        /** The keys from package.json's text. */
        fun fromPackageJson(text: String): MessageKeys {
            val pebble = Json.parseToJsonElement(text).jsonObject["pebble"]!!.jsonObject
            return MessageKeys(pebble["messageKeys"]!!.jsonArray.map { it.jsonPrimitive.content })
        }
    }
}

/**
 * Converts between the JS's message objects and AppMessages exactly as the
 * Pebble app does for PebbleKit JS (libpebble3 PKJSApp: toAppMessageData and
 * toJSData), so a message index.js sends from QuickJS reaches the watch as the
 * same bytes as when PebbleKit JS sends it.
 */
object AppMessageCodec {
    /**
     * A message object as JSON (what index.js passed to sendAppMessage) to an
     * AppMessage. As the Pebble app: unknown key names are dropped unless they
     * are numbers, arrays become bytes, strings text, whole numbers int32 (or
     * uint32 past int32), other numbers are cut to int32, and null is dropped.
     * The Pebble app would pass a boolean through as is; PebbleKit Android 2
     * has no boolean, so it goes as int32 1 or 0 (index.js sends none).
     */
    fun toWire(msg: JsonObject, keys: MessageKeys): WireDict {
        val out = LinkedHashMap<Int, WireValue>()
        for ((name, value) in msg) {
            val id = keys.id(name) ?: name.toIntOrNull() ?: continue
            out[id] = when (value) {
                is JsonArray -> WireValue.Bytes(ByteArray(value.size) { i -> value[i].jsonPrimitive.long.toInt().toByte() })
                is JsonObject -> throw IllegalArgumentException("$name: an object can't be sent")
                JsonNull -> continue
                is JsonPrimitive -> when {
                    value.isString -> WireValue.Text(value.content)
                    value.intOrNull != null -> WireValue.Int32(value.long.toInt())
                    value.longOrNull != null -> WireValue.UInt32(value.long and 0xFFFFFFFFL)
                    value.booleanOrNull != null -> WireValue.Int32(if (value.booleanOrNull!!) 1 else 0)
                    value.doubleOrNull != null -> WireValue.Int32(value.doubleOrNull!!.toInt())
                    else -> continue
                }
            }
        }
        return out
    }

    /**
     * An AppMessage from the watch to the payload PebbleKit JS's handler gets:
     * key names where known (else the number), text, numbers, and bytes as an
     * array of 0..255.
     */
    fun toJs(dict: WireDict, keys: MessageKeys): JsonObject = JsonObject(LinkedHashMap<String, kotlinx.serialization.json.JsonElement>().apply {
        for ((id, v) in dict) {
            put(keys.name(id) ?: id.toString(), when (v) {
                is WireValue.Text -> JsonPrimitive(v.value)
                is WireValue.Int32 -> JsonPrimitive(v.value)
                is WireValue.UInt32 -> JsonPrimitive(v.value)
                is WireValue.Bytes -> JsonArray(v.value.map { JsonPrimitive(it.toInt() and 0xFF) })
            })
        }
    })

    /**
     * One line per message for the wire log and the byte-for-byte checks:
     * `10000=i:1 10021=s:"Nassau" 10022=b:0a1f..`, keys in the order sent.
     * Holds cruise text (titles, venues, a cabin number): never commit one.
     */
    fun describe(dict: WireDict): String = dict.entries.joinToString(" ") { (id, v) ->
        "$id=" + when (v) {
            is WireValue.Text -> "s:" + JsonPrimitive(v.value).toString()
            is WireValue.Int32 -> "i:${v.value}"
            is WireValue.UInt32 -> "u:${v.value}"
            is WireValue.Bytes -> "b:" + v.value.joinToString("") { "%02x".format(it) }
        }
    }
}
