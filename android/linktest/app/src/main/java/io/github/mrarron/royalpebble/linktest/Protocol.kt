package io.github.mrarron.royalpebble.linktest

import io.rebble.pebblekit2.common.model.PebbleDictionary
import io.rebble.pebblekit2.common.model.PebbleDictionaryItem
import java.io.ByteArrayOutputStream
import java.util.UUID

// The parts of docs/WATCH_PROTOCOL.md this test needs.
object Protocol {
    val APP_UUID: UUID = UUID.fromString("c2b564f0-f418-4968-b545-08825e3fef19")

    // AppMessage keys are 10000 + the key's index in package.json "messageKeys"
    // (build/js/message_keys.json). A real app should read them from that file.
    const val KEY_MSG_TYPE = 10000u
    const val KEY_NOTICE_COUNT = 10026u
    const val KEY_NOTICES = 10027u

    const val MSG_NOTICE = 6

    private val NAMES = mapOf(
        1 to "BEGIN", 2 to "INFO", 3 to "EVENTS", 4 to "END", 5 to "ALARMS", 6 to "NOTICE",
        7 to "STAR_ACK", 8 to "DIR_PAGE", 10 to "REQUEST", 12 to "DEMO_NEXT", 13 to "STAR_CHANGES",
        14 to "SAVED", 15 to "DIR_REQUEST", 16 to "ROUTE_REQUEST", 17 to "ROUTE_PAGE", 18 to "LOG",
        19 to "VOICE", 20 to "VOICE_CARD",
    )

    fun name(msgType: Int?): String = msgType?.let { NAMES[it] ?: "type $it" } ?: "no msg_type"

    fun intValue(item: PebbleDictionaryItem?): Int? = when (item) {
        is PebbleDictionaryItem.Int8 -> item.value.toInt()
        is PebbleDictionaryItem.UInt8 -> item.value.toInt()
        is PebbleDictionaryItem.Int16 -> item.value.toInt()
        is PebbleDictionaryItem.UInt16 -> item.value.toInt()
        is PebbleDictionaryItem.Int32 -> item.value
        is PebbleDictionaryItem.UInt32 -> item.value.toInt()
        else -> null
    }

    // One "moved" schedule change notice, packed like pack.encodeNotice: uint8 kind,
    // int32 from, int32 to (cruise minutes, little-endian), then title, venue and
    // old venue as uint8 length + UTF-8, cut to 39, 23 and 23 bytes.
    fun testNotice(): PebbleDictionary {
        val from = 1440 + 20 * 60 // day 2, 8:00 pm
        val to = 1440 + 21 * 60 + 30 // day 2, 9:30 pm
        val out = ByteArrayOutputStream()
        out.write(0) // kind 0: moved
        writeInt32(out, from)
        writeInt32(out, to)
        writeText(out, "Android app link test", 39)
        writeText(out, "Royal Pebble app", 23)
        writeText(out, "", 23)
        return mapOf(
            KEY_MSG_TYPE to PebbleDictionaryItem.Int32(MSG_NOTICE),
            KEY_NOTICE_COUNT to PebbleDictionaryItem.Int32(1),
            KEY_NOTICES to PebbleDictionaryItem.Bytes(out.toByteArray()),
        )
    }

    private fun writeInt32(out: ByteArrayOutputStream, v: Int) {
        for (shift in intArrayOf(0, 8, 16, 24)) out.write((v shr shift) and 0xFF)
    }

    // ASCII only here, so cutting by bytes can't split a character.
    private fun writeText(out: ByteArrayOutputStream, text: String, max: Int) {
        val bytes = text.toByteArray(Charsets.UTF_8).take(max).toByteArray()
        out.write(bytes.size)
        out.write(bytes)
    }
}
