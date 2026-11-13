package io.github.mrarron.royalpricecheck

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

object Notifier {
    const val CH_PRICE = "price_drops"
    const val CH_CHECKIN = "checkin"
    const val CH_STATUS = "status"

    fun createChannels(c: Context) {
        val nm = c.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CH_PRICE, "Price drops", NotificationManager.IMPORTANCE_HIGH))
        nm.createNotificationChannel(NotificationChannel(CH_CHECKIN, "Check-in changes", NotificationManager.IMPORTANCE_DEFAULT))
        nm.createNotificationChannel(NotificationChannel(CH_STATUS, "Check problems", NotificationManager.IMPORTANCE_LOW))
    }

    private fun allowed(c: Context) = Build.VERSION.SDK_INT < 33 ||
        ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun open(c: Context) = PendingIntent.getActivity(
        c, 0, Intent(c, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    private fun post(c: Context, channel: String, id: Int, title: String, text: String) {
        if (!allowed(c)) return
        val n = NotificationCompat.Builder(c, channel)
            .setSmallIcon(android.R.drawable.stat_notify_more)
            .setContentTitle(title)
            .setContentText(text.lineSequence().first())
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(open(c))
            .setAutoCancel(true)
            .build()
        try {
            NotificationManagerCompat.from(c).notify(id, n)
        } catch (_: SecurityException) {
        }
    }

    /**
     * Notify only about things that are NEW compared with the previous run, so a periodic check
     * doesn't repeat the same alert every few hours.
     */
    fun notifyChanges(c: Context, previous: RunResult?, current: RunResult, background: Boolean) {
        val seen = Prefs.notifiedKeys(c)
        val fresh = current.alerts.filter { it.key !in seen }
        if (fresh.isNotEmpty()) {
            val total = fresh.sumOf { it.saving }
            val body = fresh.joinToString("\n") {
                "${it.itemName} (${it.guestName}): ${money(it.current, it.currency)} vs paid ${money(it.paid, it.currency)}"
            }
            post(c, CH_PRICE, 1, "Rebook to save ${money(total, fresh.first().currency)}", body)
        }
        // Remember the alerts that are still current; forget ones that went away.
        Prefs.setNotifiedKeys(c, current.alerts.map { it.key }.toSet())

        val before = previous?.bookings?.associate { it.reservationId to it.checkinLabel } ?: emptyMap()
        current.bookings.forEachIndexed { i, b ->
            val old = before[b.reservationId]
            if (old != null && old != b.checkinLabel) {
                post(c, CH_CHECKIN, 100 + i, "${b.shipName} ${prettyDate(b.sailDate)}", "Check-in: $old → ${b.checkinLabel}")
            }
        }

        if (background && current.exitCode == 1) {
            post(c, CH_STATUS, 2, "Price check failed", current.error ?: "Open the app and look at the log.")
        }
    }

    fun money(v: Double, currency: String) = String.format(java.util.Locale.US, "%.2f %s", v, currency).trim()
}
