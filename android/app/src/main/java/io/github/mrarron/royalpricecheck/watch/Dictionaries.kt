package io.github.mrarron.royalpricecheck.watch

import io.github.mrarron.royalpebble.watch.WireDict
import io.github.mrarron.royalpebble.watch.WireValue
import io.rebble.pebblekit2.common.model.PebbleDictionary
import io.rebble.pebblekit2.common.model.PebbleDictionaryItem

/**
 * WireValue <-> PebbleKit Android 2's dictionary items. The Pebble app encodes
 * these as it encodes PebbleKit JS's values (libpebble3), so the watch gets
 * the same bytes from either.
 */
object Dictionaries {
    fun toPebble(dict: WireDict): PebbleDictionary = LinkedHashMap<UInt, PebbleDictionaryItem>().apply {
        for ((k, v) in dict) {
            put(k.toUInt(), when (v) {
                is WireValue.Text -> PebbleDictionaryItem.Text(v.value)
                is WireValue.Int32 -> PebbleDictionaryItem.Int32(v.value)
                is WireValue.UInt32 -> PebbleDictionaryItem.UInt32(v.value.toUInt())
                is WireValue.Bytes -> PebbleDictionaryItem.Bytes(v.value)
            })
        }
    }

    /** What the watch sent, as the JS sees it: signed and unsigned numbers keep their value. */
    fun fromPebble(data: PebbleDictionary): WireDict = LinkedHashMap<Int, WireValue>().apply {
        for ((k, item) in data) {
            put(k.toInt(), when (item) {
                is PebbleDictionaryItem.Text -> WireValue.Text(item.value)
                is PebbleDictionaryItem.Bytes -> WireValue.Bytes(item.value)
                is PebbleDictionaryItem.Int8 -> WireValue.Int32(item.value.toInt())
                is PebbleDictionaryItem.Int16 -> WireValue.Int32(item.value.toInt())
                is PebbleDictionaryItem.Int32 -> WireValue.Int32(item.value)
                is PebbleDictionaryItem.UInt8 -> WireValue.UInt32(item.value.toLong())
                is PebbleDictionaryItem.UInt16 -> WireValue.UInt32(item.value.toLong())
                is PebbleDictionaryItem.UInt32 -> WireValue.UInt32(item.value.toLong())
            })
        }
    }
}
