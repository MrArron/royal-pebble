package io.github.mrarron.royalpricecheck.watch

import io.github.mrarron.royalpebble.watch.AppMessageCodec
import io.github.mrarron.royalpebble.watch.WireValue
import io.rebble.pebblekit2.common.model.PebbleDictionaryItem
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Test

class DictionariesTest {
    private val keys = WatchLink.keys

    @Test
    fun keysAreTheSdksNumbers() {
        // docs/WATCH_PROTOCOL.md: msg_type 10000, notice_count 10026, notices 10027.
        assertEquals(10000, keys.id("msg_type"))
        assertEquals(10026, keys.id("notice_count"))
        assertEquals(10027, keys.id("notices"))
    }

    @Test
    fun aJsMessageBecomesThePebbleKitItemsPebbleKitJsWouldSend() {
        val msg = Json.parseToJsonElement(
            """{"msg_type":1,"slice_id":5,"day_status":"SEA DAY","all_aboard":-1,"events":[1,255,0],"sail_date":20270307}"""
        ).jsonObject
        val d = Dictionaries.toPebble(AppMessageCodec.toWire(msg, keys))
        assertEquals(PebbleDictionaryItem.Int32(1), d[10000u])
        assertEquals(PebbleDictionaryItem.Int32(5), d[10001u])
        assertEquals(PebbleDictionaryItem.Text("SEA DAY"), d[keys.id("day_status")!!.toUInt()])
        assertEquals(PebbleDictionaryItem.Int32(-1), d[keys.id("all_aboard")!!.toUInt()])
        assertEquals("01ff00", (d[keys.id("events")!!.toUInt()] as PebbleDictionaryItem.Bytes).value
            .joinToString("") { "%02x".format(it) })
        assertEquals(PebbleDictionaryItem.Int32(20270307), d[keys.id("sail_date")!!.toUInt()])
    }

    @Test
    fun watchMessagesKeepTheirValues() {
        val data = mapOf(
            10000u to PebbleDictionaryItem.Int32(14),
            keys.id("saved_cutoff")!!.toUInt() to PebbleDictionaryItem.Int32(-1),
            keys.id("voice_seq")!!.toUInt() to PebbleDictionaryItem.UInt8(200u),
            keys.id("voice_text")!!.toUInt() to PebbleDictionaryItem.Text("how do I get to the theater"),
            keys.id("log_entries")!!.toUInt() to PebbleDictionaryItem.Bytes(byteArrayOf(0, -1, 16)),
        )
        val js = AppMessageCodec.toJs(Dictionaries.fromPebble(data), keys)
        assertEquals(
            """{"msg_type":14,"saved_cutoff":-1,"voice_seq":200,"voice_text":"how do I get to the theater","log_entries":[0,255,16]}""",
            js.toString(),
        )
    }

    @Test
    fun aNoticeIsLaidOutLikeTheLinkTests() {
        val bytes = byteArrayOf(1, 2, 3)
        val wire = linkedMapOf(10000 to WireValue.Int32(6), 10026 to WireValue.Int32(1), 10027 to WireValue.Bytes(bytes))
        val d = Dictionaries.toPebble(wire)
        assertEquals(listOf(10000u, 10026u, 10027u), d.keys.toList())
    }
}
