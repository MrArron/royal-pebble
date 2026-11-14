package io.github.mrarron.royalpebble.alerts

import java.time.LocalDate
import java.time.format.DateTimeFormatter

/** What the price script found, reduced to what alerts need (the app maps its run result to this). */
data class AlertBooking(
    val reservationId: String,
    val shipName: String,
    val sailDate: String,      // yyyyMMdd
    val checkinLabel: String,  // the script's label: "Opens ...", "Open now", "Open (window ...)", "Checked in", "Boarding ...", "TBD"
    val finalPaymentDate: String, // yyyyMMdd
    val balanceDue: Boolean?,
)

data class AlertDrop(
    val reservationId: String,
    val itemName: String,
    val guestName: String,
    val paid: Double,
    val current: Double,
    val currency: String,
    val alert: Boolean,
)

data class AlertInput(val bookings: List<AlertBooking>, val drops: List<AlertDrop>)

/** Keys of the alerts already delivered to the watch, kept between runs. */
interface AlertState {
    fun sentKeys(): Set<String>
    fun saveSentKeys(keys: Set<String>)
}

class MemoryAlertState(private var keys: Set<String> = emptySet()) : AlertState {
    override fun sentKeys() = keys
    override fun saveSentKeys(keys: Set<String>) { this.keys = keys }
}

/** A notice and the key that says it has been sent. */
data class Candidate(val key: String, val notice: BookingNotice)

data class AlertReport(val found: Int, val sent: Int, val pending: Int, val detail: String)

/**
 * Works out which booking alerts are new since the last delivery and sends them to the watch.
 *
 * A key is remembered only once the watch has acknowledged it, so alerts that couldn't be sent
 * (watch away, Royal Pebble closed) stay pending for the next check. Price alerts are forgotten
 * when they stop being alerts (a later drop to the same price alerts again); check-in and payment
 * alerts are kept while their booking is still listed, so a glitchy label can't repeat them.
 */
class WatchAlerts(
    private val sender: WatchSender,
    private val state: AlertState,
    private val packer: NoticePacker = NoticeEncoder,
    private val today: () -> LocalDate = { LocalDate.now() },
) {
    fun process(input: AlertInput): AlertReport {
        val candidates = detect(input, today())
        val sent = state.sentKeys()
        val current = candidates.mapTo(HashSet()) { it.key }
        val listed = input.bookings.mapTo(HashSet()) { it.reservationId }
        val keep = sent.filterTo(HashSet()) { k ->
            val parts = k.split('|')
            if (parts[0] == "price") k in current else parts.getOrNull(1) in listed
        }
        val fresh = candidates.filter { it.key !in keep }
        if (fresh.isEmpty()) {
            if (keep != sent) state.saveSentKeys(keep)
            return AlertReport(candidates.size, 0, 0, "nothing new")
        }
        val batch = fresh.take(WatchProtocol.MAX_NOTICES)
        val result = sender.sendNotices(batch.size, packer.pack(batch.map { it.notice }))
        val after = if (result.delivered) keep + batch.map { it.key } else keep
        state.saveSentKeys(after)
        val sentCount = if (result.delivered) batch.size else 0
        return AlertReport(candidates.size, sentCount, fresh.size - sentCount, result.detail)
    }

    companion object {
        private val BASIC = DateTimeFormatter.BASIC_ISO_DATE
        private val REMIND_DAYS = listOf(7, 3, 1, 0)

        private fun date(s: String): LocalDate? = runCatching { LocalDate.parse(s, BASIC) }.getOrNull()

        private fun symbol(currency: String) = when (currency.uppercase()) {
            "GBP" -> "£"
            "EUR" -> "€"
            else -> "$"
        }

        private fun sailing(b: AlertBooking): String {
            val d = date(b.sailDate)
            val ship = b.shipName.ifBlank { "Your cruise" }
            return if (d == null) ship else "$ship ${NoticeEncoder.shortDate(d)}"
        }

        fun detect(input: AlertInput, today: LocalDate): List<Candidate> {
            val out = ArrayList<Candidate>()
            for (d in input.drops.filter { it.alert }) {
                out.add(Candidate(
                    "price|${d.reservationId}|${d.itemName}|${d.guestName}|${d.current}",
                    NoticeEncoder.priceDrop(d.itemName, d.paid, d.current, symbol(d.currency)),
                ))
            }
            for (b in input.bookings) {
                val label = b.checkinLabel.trim()
                val lower = label.lowercase()
                if (lower == "open now" || lower.startsWith("open (")) {
                    out.add(Candidate("open|${b.reservationId}", NoticeEncoder.checkinOpen(sailing(b), 1, 0)))
                } else if (lower == "checked in" || lower.startsWith("boarding")) {
                    val window = if (lower.startsWith("boarding")) label.substring(8).trim() else null
                    out.add(Candidate("done|${b.reservationId}", NoticeEncoder.checkinDone(sailing(b), window)))
                }
                val due = date(b.finalPaymentDate)
                if (b.balanceDue == true && due != null) {
                    val days = java.time.temporal.ChronoUnit.DAYS.between(today, due)
                    val step = if (days < 0) -1 else REMIND_DAYS.lastOrNull { days <= it }
                    if (step != null) {
                        out.add(Candidate("pay|${b.reservationId}|${b.finalPaymentDate}|$step",
                            NoticeEncoder.payment(sailing(b), due, null, today)))
                    }
                }
            }
            return out
        }
    }
}
