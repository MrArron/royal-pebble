package io.github.mrarron.royalpricecheck

import android.content.Context
import io.github.mrarron.royalpebble.alerts.BookingNotice
import io.github.mrarron.royalpebble.alerts.NoticeEncoder
import io.github.mrarron.royalpebble.alerts.ScheduleAlert
import io.github.mrarron.royalpebble.alerts.ScheduleCounts
import io.github.mrarron.royalpricecheck.watch.WatchHost
import org.json.JSONObject

/**
 * The "schedule is up" alert after a background schedule refresh ([ScheduleAlert] decides):
 * one phone notification with Mute, and a `SCHEDULE UP` notice on the watch. Follows the alert
 * hours ([AlertDelivery.deliver]) and Watch alerts. The watch's copy waits here until the watch
 * confirms it, so a watch that is away gets it on a later check. Log lines (kind `schedule`):
 *
 * - `schedule  alert first: up: 412 events, 380 free, 45 to reserve`
 * - `schedule  alert none: not up yet (0 events, 0 free, 0 to reserve, not published)`
 */
object ScheduleNotify {
    private fun sp(c: Context) = c.getSharedPreferences("schedule_alert", Context.MODE_PRIVATE)

    private fun baseline(c: Context, sailing: String) = sp(c).getInt("base|$sailing", 0)

    fun afterRefresh(c: Context, shipCode: String, shipName: String, sailDate: String, before: ScheduleCounts, after: ScheduleCounts) {
        val sailingKey = ScheduleAlert.sailingKey(shipCode, sailDate)
        val muteKey = ScheduleAlert.muteKey(shipCode, sailDate)
        val base = baseline(c, sailingKey)
        val d = ScheduleAlert.decide(before, after, base, muteKey in Prefs.mutedKeys(c))
        if (d.baseline != base) sp(c).edit().putInt("base|$sailingKey", d.baseline).apply()
        WatchHost.logApp(c, "schedule", "alert ${d.reason ?: "none"}: ${d.logText}")
        val reason = d.reason ?: return
        val sailing = ScheduleAlert.sailingName(shipName, sailDate)
        if (Prefs.watchAlerts(c)) setPending(c, muteKey, ScheduleAlert.watchNotice(sailing, after))
        AlertDelivery.deliver(c, listOf(PhoneNotice(
            Notifier.CH_SCHEDULE, PhoneNotice.idFor(muteKey),
            ScheduleAlert.phoneTitle(reason, sailing), ScheduleAlert.phoneText(reason, after, base),
            muteKey, "Schedule alerts for $sailing", "schedule",
        )))
    }

    private fun setPending(c: Context, muteKey: String, n: BookingNotice) {
        val o = JSONObject().put("mute", muteKey).put("kind", n.kind).put("title", n.title).put("first", n.first).put("second", n.second)
        sp(c).edit().putString("watch_pending", o.toString()).apply()
    }

    private fun clearPending(c: Context) = sp(c).edit().remove("watch_pending").apply()

    /** Sends the waiting watch notice, if any. Blocks; returns a log line or null when nothing waits. */
    fun sendPendingWatch(c: Context): String? {
        val o = sp(c).getString("watch_pending", null)?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return null
        if (!Prefs.watchAlerts(c)) { clearPending(c); return null }
        if (o.optString("mute") in Prefs.mutedKeys(c)) { clearPending(c); return "Schedule watch alert: muted" }
        val sender = WatchAlertBridge.senderFactory?.invoke(c) ?: return "Schedule watch alert: no watch link in this build"
        val n = BookingNotice(o.optInt("kind"), o.optString("title"), o.optString("first"), o.optString("second"))
        return runCatching {
            val r = sender.sendNotices(1, NoticeEncoder.pack(listOf(n)))
            if (r.delivered) clearPending(c)
            "Schedule watch alert: ${r.detail}" + if (r.delivered) "" else " (waits for the next check)"
        }.getOrElse { "Schedule watch alert failed: ${it::class.java.simpleName}" }
    }
}
