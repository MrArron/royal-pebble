package io.github.mrarron.royalpebble.alerts

import java.io.ByteArrayOutputStream
import java.time.LocalDate

/** NOTICE `kind` values for booking notices (docs/WATCH_PROTOCOL.md, Booking notices). */
object NoticeKind {
    const val PRICE = 4
    const val CHECKIN_OPEN = 5
    const val CHECKIN_DONE = 6
    const val PAYMENT = 7
}

/** One booking notice as the watch shows it: a title and two lines of text made on the phone. */
data class BookingNotice(val kind: Int, val title: String, val first: String, val second: String)

/** Turns detected alerts into the packed NOTICE bytes of docs/WATCH_PROTOCOL.md. */
interface NoticePacker {
    fun pack(notices: List<BookingNotice>): ByteArray
}

/**
 * Plain Kotlin port of the booking-notice encoders in `src/pkjs/pack.js` (`priceDropNotice` and
 * friends, `encodeNotice`), so alerts work without a JavaScript engine. `NoticeEncoderTest`
 * compares its bytes with what pack.js produced. A QuickJS packer can replace it behind
 * [NoticePacker].
 */
object NoticeEncoder : NoticePacker {
    private const val TITLE_MAX = 39
    private const val LINE_MAX = 23
    private val MONTHS = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

    /** "$89.50", or whole dollars from $100 (or when [whole]) so two prices fit a line: "$1,235". */
    fun money(amount: Double, symbol: String = "$", whole: Boolean = false): String {
        val cents = Math.floor(Math.abs(amount) * 100 + 0.5).toLong()
        val dollars = whole || cents >= 10000
        val n = if (dollars) Math.floor(cents / 100.0 + 0.5).toLong() else cents / 100
        val grouped = n.toString().reversed().chunked(3).joinToString(",").reversed()
        val tail = if (dollars) "" else "." + (cents % 100).toString().padStart(2, '0')
        return (if (amount < 0) "-" else "") + symbol + grouped + tail
    }

    /** "Sep 13". */
    fun shortDate(d: LocalDate): String = "${MONTHS[d.monthValue - 1]} ${d.dayOfMonth}"

    /** "11:30a-12:00p" from Royal's "11:30 AM - 12:00 PM". */
    fun compactWindow(text: String): String =
        text.replace(Regex("\\s*([AaPp])\\.?[Mm]\\.?")) { it.groupValues[1].lowercase() }
            .replace(Regex("\\s*-\\s*"), "-").trim()

    fun priceDrop(item: String, paid: Double, now: Double, symbol: String = "$"): BookingNotice {
        // Both prices in one format: whole dollars when either is $100 or more.
        val whole = maxOf(Math.abs(paid), Math.abs(now)) >= 99.995
        return BookingNotice(
            NoticeKind.PRICE, item, "Save " + money(paid - now, symbol),
            "Was " + money(paid, symbol, whole) + " now " + money(now, symbol, whole),
        )
    }

    fun checkinOpen(sailing: String, guests: Int, done: Int, closes: LocalDate? = null): BookingNotice {
        val first = if (guests > 1) "${guests - done} of $guests guests to go" else "Not checked in yet"
        return BookingNotice(
            NoticeKind.CHECKIN_OPEN, sailing, first,
            if (closes != null) "Closes " + shortDate(closes) else "Check in on Royal app",
        )
    }

    fun checkinDone(sailing: String, boarding: String? = null): BookingNotice = BookingNotice(
        NoticeKind.CHECKIN_DONE, sailing, "All guests checked in",
        if (boarding.isNullOrBlank()) "" else "Boarding " + compactWindow(boarding),
    )

    /**
     * Final payment coming up. [balance] is null when the amount isn't known (the price script only
     * reports whether a balance is due), which gives "Balance due Dec 20" instead of "$1,235 due Dec 20".
     */
    fun payment(sailing: String, due: LocalDate, balance: Double?, today: LocalDate, symbol: String = "$"): BookingNotice {
        val days = java.time.temporal.ChronoUnit.DAYS.between(today, due)
        val second = when {
            days < 0 -> "Overdue"
            days == 0L -> "Due today"
            days == 1L -> "Due tomorrow"
            else -> "In $days days"
        }
        val first = if (balance == null) "Balance due " + shortDate(due) else money(balance, symbol) + " due " + shortDate(due)
        return BookingNotice(NoticeKind.PAYMENT, sailing, first, second)
    }

    /** `text` as UTF-8 cut at a character boundary to at most [max] bytes. */
    fun utf8(text: String, max: Int): ByteArray {
        val out = ByteArrayOutputStream()
        var i = 0
        while (i < text.length) {
            val cp = text.codePointAt(i)
            val bytes = String(Character.toChars(cp)).toByteArray(Charsets.UTF_8)
            if (out.size() + bytes.size > max) break
            out.write(bytes)
            i += Character.charCount(cp)
        }
        return out.toByteArray()
    }

    /** One notice, little-endian: kind, int32 from, int32 to (both -1), title, line 1, line 2 (uint8 length + bytes). */
    fun encode(n: BookingNotice): ByteArray {
        val out = ByteArrayOutputStream()
        out.write(n.kind and 255)
        repeat(8) { out.write(255) } // from and to: int32 -1 twice
        for ((text, max) in listOf(n.title.ifEmpty { "Your cruise" } to TITLE_MAX, n.first to LINE_MAX, n.second to LINE_MAX)) {
            val b = utf8(text, max)
            out.write(b.size)
            out.write(b)
        }
        return out.toByteArray()
    }

    override fun pack(notices: List<BookingNotice>): ByteArray {
        val out = ByteArrayOutputStream()
        notices.forEach { out.write(encode(it)) }
        return out.toByteArray()
    }
}
