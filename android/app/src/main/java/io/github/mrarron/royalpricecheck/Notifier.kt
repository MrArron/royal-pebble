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
import io.github.mrarron.royalpebble.alerts.PriceWatches
import io.github.mrarron.royalpebble.alerts.WatchHit
import io.github.mrarron.royalpebble.alerts.WatchRule
import org.json.JSONArray
import org.json.JSONObject

/** One phone notification, ready to post now or to hold for quiet hours ([AlertDelivery]). */
data class PhoneNotice(
    val channel: String,
    val id: Int,
    val title: String,
    val text: String,
    /** Set on price alerts: the notification gets a Mute button for this key. */
    val muteKey: String? = null,
    val muteLabel: String? = null,
    /** "price", "watch", "checkin" or "status", for the test log's counts. */
    val kind: String = "status",
) {
    fun toJson(): JSONObject = JSONObject().put("channel", channel).put("id", id).put("title", title).put("text", text)
        .put("muteKey", muteKey ?: "").put("muteLabel", muteLabel ?: "").put("kind", kind)

    companion object {
        fun fromJson(o: JSONObject) = PhoneNotice(
            o.optString("channel"), o.optInt("id"), o.optString("title"), o.optString("text"),
            o.optString("muteKey").ifBlank { null }, o.optString("muteLabel").ifBlank { null }, o.optString("kind", "status"),
        )

        fun listToJson(list: List<PhoneNotice>): String = JSONArray().apply { list.forEach { put(it.toJson()) } }.toString()
        fun listFromJson(text: String): List<PhoneNotice> = runCatching {
            val a = JSONArray(text)
            (0 until a.length()).mapNotNull { a.optJSONObject(it)?.let(::fromJson) }
        }.getOrDefault(emptyList())

        /** A stable id per muted thing, so a lower price replaces its earlier notification. */
        fun idFor(key: String) = 0x10000 + (key.hashCode() and 0xFFFFFF)
    }
}

object Notifier {
    const val CH_PRICE = "price_drops"
    const val CH_WATCH = "price_watches"
    const val CH_CHECKIN = "checkin"
    const val CH_STATUS = "status"

    fun createChannels(c: Context) {
        val nm = c.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CH_PRICE, "Price drops", NotificationManager.IMPORTANCE_HIGH))
        nm.createNotificationChannel(NotificationChannel(CH_WATCH, "Price watches", NotificationManager.IMPORTANCE_HIGH))
        nm.createNotificationChannel(NotificationChannel(CH_CHECKIN, "Check-in changes", NotificationManager.IMPORTANCE_DEFAULT))
        nm.createNotificationChannel(NotificationChannel(CH_STATUS, "Check problems", NotificationManager.IMPORTANCE_LOW))
    }

    fun allowed(c: Context) = Build.VERSION.SDK_INT < 33 ||
        ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun open(c: Context) = PendingIntent.getActivity(
        c, 0, Intent(c, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    /** Posts [n]; returns false when notifications aren't allowed. */
    fun post(c: Context, n: PhoneNotice): Boolean {
        if (!allowed(c)) return false
        val b = NotificationCompat.Builder(c, n.channel)
            .setSmallIcon(android.R.drawable.stat_notify_more)
            .setContentTitle(n.title)
            .setContentText(n.text.lineSequence().first())
            .setStyle(NotificationCompat.BigTextStyle().bigText(n.text))
            .setContentIntent(open(c))
            .setAutoCancel(true)
        if (n.muteKey != null) {
            b.addAction(0, if (n.kind == "watch") "Mute this watch" else "Mute this alert", MuteReceiver.intent(c, n.muteKey, n.muteLabel ?: n.title, n.id))
        }
        return try {
            NotificationManagerCompat.from(c).notify(n.id, b.build())
            true
        } catch (_: SecurityException) {
            false
        }
    }

    fun cancel(c: Context, id: Int) = NotificationManagerCompat.from(c).cancel(id)

    /**
     * What is NEW compared with the previous run, so a periodic check doesn't repeat the same alert
     * every few hours: price drops worth rebooking (one notification each, with Mute), price watches
     * below their trigger, check-in label changes and a failed background check. Muted alerts are
     * left out. Marks the price alerts as notified, so call it once per check.
     */
    fun collect(c: Context, previous: RunResult?, current: RunResult, background: Boolean): List<PhoneNotice> {
        val out = ArrayList<PhoneNotice>()
        val seen = Prefs.notifiedKeys(c)
        val muted = Prefs.mutedKeys(c)
        val drops = current.alerts.filter { it.muteKey !in muted }
        drops.filter { it.key !in seen }.forEach { d ->
            out.add(PhoneNotice(
                CH_PRICE, PhoneNotice.idFor(d.muteKey),
                "Rebook to save ${money(d.saving, d.currency)}: ${d.itemName}",
                "${d.itemName} (${d.guestName}): now ${money(d.current, d.currency)} vs paid ${money(d.paid, d.currency)}" +
                    (if (d.perNight) " per night" else "") + ". Cancel and rebook in the Royal app's Cruise Planner.",
                d.muteKey, "${d.itemName} (${d.guestName})", "price",
            ))
        }
        val hits = if (current.ok) PriceWatches.hits(Prefs.priceWatches(c), muted) else emptyList()
        hits.filter { it.key !in seen }.forEach { out.add(watchNotice(it)) }
        // Remember the alerts that are still current; forget ones that went away (a later drop to the
        // same price alerts again). A failed check keeps the old list, so the next good one doesn't repeat them.
        if (current.ok) Prefs.setNotifiedKeys(c, (drops.map { it.key } + hits.map { it.key }).toSet())

        val before = previous?.bookings?.associate { it.reservationId to it.checkinLabel } ?: emptyMap()
        current.bookings.forEachIndexed { i, b ->
            val old = before[b.reservationId]
            if (old != null && old != b.checkinLabel) {
                out.add(PhoneNotice(CH_CHECKIN, 100 + i, "${b.shipName} ${prettyDate(b.sailDate)}", "Check-in: $old → ${b.checkinLabel}", kind = "checkin"))
            }
        }

        if (background && current.exitCode == 1) {
            out.add(PhoneNotice(CH_STATUS, 2, "Price check failed", current.error ?: "Open the app and look at the log."))
        }
        return out
    }

    fun watchNotice(h: WatchHit): PhoneNotice {
        val now = money(h.price, h.currency)
        val base = h.baseline
        val why = when {
            h.rule == WatchRule.BELOW -> "below your ${money(h.trigger, h.currency)}"
            base != null -> "down ${h.percentOff ?: 0}% from ${money(base, h.currency)} when you set the watch"
            else -> "at or below ${money(h.trigger, h.currency)}"
        }
        return PhoneNotice(
            CH_WATCH, PhoneNotice.idFor(h.muteKey), "Price watch: ${h.name}",
            "${h.name} is $now, $why. Book it in the Royal app's Cruise Planner.",
            h.muteKey, h.name, "watch",
        )
    }

    fun money(v: Double, currency: String) = String.format(java.util.Locale.US, "%.2f %s", v, currency).trim()
}
