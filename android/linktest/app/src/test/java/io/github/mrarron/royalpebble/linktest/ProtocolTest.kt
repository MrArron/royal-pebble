package io.github.mrarron.royalpebble.linktest

import io.rebble.pebblekit2.common.model.PebbleDictionaryItem
import org.junit.Assert.assertEquals
import org.junit.Test

class ProtocolTest {
    // From src/pkjs/pack.js: packNotices([{kind: 0, from: 2640, to: 2730,
    //   title: "Android app link test", venue: "Royal Pebble app", oldVenue: ""}])
    private val jsBytes = "00500a0000aa0a000015416e64726f696420617070206c696e6b2074657374" +
        "10526f79616c20506562626c652061707000"

    @Test
    fun testNoticeMatchesThePhoneCompanionsPacking() {
        val notice = Protocol.testNotice()
        val bytes = (notice[Protocol.KEY_NOTICES] as PebbleDictionaryItem.Bytes).value
        assertEquals(jsBytes, bytes.joinToString("") { "%02x".format(it) })
        assertEquals(Protocol.MSG_NOTICE, Protocol.intValue(notice[Protocol.KEY_MSG_TYPE]))
        assertEquals(1, Protocol.intValue(notice[Protocol.KEY_NOTICE_COUNT]))
    }
}
