package io.github.mrarron.royalpebble.alerts

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate

class NoticeEncoderTest {
    private fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }
    private fun pack(vararg n: BookingNotice) = hex(NoticeEncoder.pack(n.toList()))

    @Test
    fun moneyMatchesPackJs() {
        assertEquals("$89.50", NoticeEncoder.money(89.5))
        assertEquals("$20.00", NoticeEncoder.money(20.0))
        assertEquals("$100", NoticeEncoder.money(99.999))
        assertEquals("$1,235", NoticeEncoder.money(1234.56))
        assertEquals("$12,355", NoticeEncoder.money(12355.0))
        assertEquals("$0.30", NoticeEncoder.money(0.1 + 0.2))
        assertEquals("-$5.00", NoticeEncoder.money(-5.0))
        assertEquals("$90", NoticeEncoder.money(89.5, "$", true))
        assertEquals("£45.00", NoticeEncoder.money(45.0, "£"))
    }

    @Test
    fun noticeTextMatchesPackJs() {
        val drop = NoticeEncoder.priceDrop("The Key", 109.0, 89.0)
        assertEquals(BookingNotice(4, "The Key", "Save $20.00", "Was $109 now $89"), drop)
        assertEquals("Was $25.00 now $19.99", NoticeEncoder.priceDrop("Wi-Fi", 25.0, 19.99).second)
        val cabin = NoticeEncoder.priceDrop("Balcony cabin", 12355.4, 11235.4)
        assertEquals("Was $12,355 now $11,235", cabin.second)
        assertEquals("Save $1,120", cabin.first)

        val open = NoticeEncoder.checkinOpen("Harmony of the Seas", 3, 1)
        assertEquals(listOf("2 of 3 guests to go", "Check in on Royal app"), listOf(open.first, open.second))
        val one = NoticeEncoder.checkinOpen("Harmony of the Seas", 1, 0, LocalDate.of(2026, 12, 9))
        assertEquals(listOf("Not checked in yet", "Closes Dec 9"), listOf(one.first, one.second))

        val done = NoticeEncoder.checkinDone("Harmony of the Seas", "11:30 AM - 12:00 PM")
        assertEquals(listOf("All guests checked in", "Boarding 11:30a-12:00p"), listOf(done.first, done.second))
        assertEquals("", NoticeEncoder.checkinDone("X").second)

        val due = LocalDate.of(2026, 9, 13)
        fun pay(today: LocalDate, balance: Double? = 1234.56) = NoticeEncoder.payment("S", due, balance, today)
        assertEquals("$1,235 due Sep 13", pay(LocalDate.of(2026, 9, 8)).first)
        assertEquals("In 5 days", pay(LocalDate.of(2026, 9, 8)).second)
        assertEquals("Due tomorrow", pay(LocalDate.of(2026, 9, 12)).second)
        assertEquals("Due today", pay(due).second)
        assertEquals("Overdue", pay(LocalDate.of(2026, 9, 14)).second)
        assertEquals("Balance due Sep 13", pay(due, null).first)
    }

    // Bytes taken from pack.js (packNotices of the same notices) on 2026-11-13.
    @Test
    fun bytesMatchPackJs() {
        assertEquals(
            "04ffffffffffffffff07546865204b65790b53617665202432302e3030105761732024313039206e6f7720243839",
            pack(NoticeEncoder.priceDrop("The Key", 109.0, 89.0)),
        )
        assertEquals(
            "04ffffffffffffffff0d42616c636f6e7920636162696e0c5361766520c2a3312c3132301757617320c2a331322c333535206e6f7720c2a331312c32",
            pack(NoticeEncoder.priceDrop("Balcony cabin", 12355.4, 11235.4, "£")),
        )
        assertEquals(
            "05ffffffffffffffff134861726d6f6e79206f662074686520536561731332206f6620332067756573747320746f20676f15436865636b20696e206f6e20526f79616c20617070",
            pack(NoticeEncoder.checkinOpen("Harmony of the Seas", 3, 1)),
        )
        assertEquals(
            "06ffffffffffffffff134861726d6f6e79206f6620746865205365617315416c6c2067756573747320636865636b656420696e16426f617264696e672031313a3330612d31323a303070",
            pack(NoticeEncoder.checkinDone("Harmony of the Seas", "11:30 AM - 12:00 PM")),
        )
        assertEquals(
            "07ffffffffffffffff134861726d6f6e79206f662074686520536561731124312c323335206475652053657020313309496e20352064617973",
            pack(NoticeEncoder.payment("Harmony of the Seas", LocalDate.of(2026, 9, 13), 1234.56, LocalDate.of(2026, 9, 8))),
        )
        // Long text is cut at a character boundary, as utf8() does in pack.js.
        assertEquals(
            "04ffffffffffffffff27436166c3a920e298952057692d4669207061636b61676520666f72207468652077686f6c6520760a536176652024352e303115576173202432352e3030206e6f77202431392e3939",
            pack(NoticeEncoder.priceDrop("Café ☕ Wi-Fi package for the whole voyage extra long", 25.0, 19.99)),
        )
    }

    @Test
    fun twoNoticesArePackedBackToBack() {
        val a = NoticeEncoder.priceDrop("The Key", 109.0, 89.0)
        val b = NoticeEncoder.checkinDone("X")
        assertEquals(pack(a) + pack(b), pack(a, b))
    }
}
