package io.github.mrarron.royalpricecheck

import android.content.Context
import io.github.mrarron.royalpebble.alerts.AlertBooking
import io.github.mrarron.royalpebble.alerts.AlertDrop
import io.github.mrarron.royalpebble.alerts.AlertInput
import io.github.mrarron.royalpebble.alerts.AlertState
import io.github.mrarron.royalpebble.alerts.AlertReport
import io.github.mrarron.royalpebble.alerts.WatchAlerts
import io.github.mrarron.royalpebble.alerts.WatchSender

/** Glue between a price-check result and the plain-Kotlin watch alerts in `:royal`. */
object WatchAlertBridge {
    /** Where the watch sender comes from; set by the watch link when it is built (null: no watch link yet). */
    @Volatile
    var senderFactory: ((Context) -> WatchSender)? = null

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
