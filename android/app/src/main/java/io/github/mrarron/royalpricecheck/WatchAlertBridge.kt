package io.github.mrarron.royalpricecheck

import android.content.Context
import io.github.mrarron.royalpebble.alerts.AlertBooking
import io.github.mrarron.royalpebble.alerts.AlertDrop
import io.github.mrarron.royalpebble.alerts.AlertInput
import io.github.mrarron.royalpebble.alerts.AlertState
import io.github.mrarron.royalpebble.alerts.AlertReport
import io.github.mrarron.royalpebble.alerts.WatchAlerts
import io.github.mrarron.royalpebble.alerts.SendResult
import io.github.mrarron.royalpebble.alerts.WatchSender
import io.github.mrarron.royalpricecheck.watch.WatchLink
import kotlinx.coroutines.runBlocking

/** Glue between a price-check result and the plain-Kotlin watch alerts in `:royal`. */
object WatchAlertBridge {
    /** The watch sender; tests or other builds can replace it. */
    @Volatile
    var senderFactory: ((Context) -> WatchSender)? = { c -> WatchLinkSender(c) }

    fun toInput(r: RunResult) = AlertInput(
        bookings = r.bookings.map {
            AlertBooking(it.reservationId, it.shipName, it.sailDate, it.checkinLabel, it.finalPaymentDate, it.balanceDue)
        },
        drops = r.drops.map {
            AlertDrop(it.reservationId, it.itemName, it.guestName, it.paid, it.current, it.currency, it.alert)
        },
    )

    /** After a check: send what is new to the watch. Never throws; returns a log line or null when off. */
    fun afterCheck(c: Context, result: RunResult): String? {
        if (!Prefs.watchAlerts(c) || !result.ok) return null
        val sender = senderFactory?.invoke(c) ?: return "Watch alerts: no watch link in this build"
        return runCatching {
            val r: AlertReport = WatchAlerts(sender, PrefsAlertState(c)).process(toInput(result))
            "Watch alerts: ${r.detail} (sent ${r.sent}, waiting ${r.pending})"
        }.getOrElse { "Watch alerts failed: ${it::class.java.simpleName}: ${it.message}" }
    }
}

/** The delivered-alert keys, in the app's settings. */
class PrefsAlertState(private val c: Context) : AlertState {
    override fun sentKeys(): Set<String> = Prefs.watchAlertKeys(c)
    override fun saveSentKeys(keys: Set<String>) = Prefs.setWatchAlertKeys(c, keys)
}

/** Sends through the app's shared watch link (opens Royal Pebble on the watch when needed). Blocks; call off the main thread. */
class WatchLinkSender(private val c: Context) : WatchSender {
    override fun sendNotices(count: Int, packed: ByteArray): SendResult {
        val ok = runBlocking { WatchLink.sendNotice(c, count, packed) }
        return SendResult(ok, if (ok) "watch ACKed" else "watch didn't confirm (not connected or Royal Pebble not reachable)")
    }
}
