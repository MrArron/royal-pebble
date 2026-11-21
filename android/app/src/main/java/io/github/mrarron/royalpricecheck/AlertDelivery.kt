package io.github.mrarron.royalpricecheck

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import io.github.mrarron.royalpebble.alerts.AlertMutes
import io.github.mrarron.royalpebble.alerts.PriceWatches
import io.github.mrarron.royalpebble.alerts.QuietHours
import io.github.mrarron.royalpricecheck.watch.WatchHost
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.LocalDateTime
import java.time.ZoneId
import java.util.concurrent.TimeUnit

/**
 * Everything after a price check: price watches get their new prices, then the alerts (phone
 * notifications and the watch's NOTICE) go out, or, for a background check during quiet hours,
 * wait until the alert hours open ([ReleaseWorker]). Muted alerts never go out. Every step writes
 * a line to the test log (Settings > Watch and logs > Share log file):
 *
 * - `watches  check: 3 watches, 2 priced, 1 below the trigger, starting price set for 1` and one
 *   `watches  hit: <item> now $25.00, trigger $30.00 (any)` line per watch below its trigger;
 * - `alerts  sent: 2 phone (1 price, 1 watch), Watch alerts: ...`;
 * - `alerts  quiet hours (8:00 AM to 9:00 PM): held 2 phone, watch alerts wait; out at 8:00 AM`;
 * - `alerts  released at 8:00 AM: 2 phone, Watch alerts: ...`;
 * - `alerts  muted: <item>` and `alerts  unmuted: <item>`.
 */
object AlertDelivery {
    private fun log(c: Context, kind: String, detail: String) = WatchHost.logApp(c, kind, detail)

    /** Returns lines for the price check's own log. [background] checks follow the alert hours; Run now doesn't. */
    fun afterCheck(c: Context, previous: RunResult?, result: RunResult, background: Boolean): List<String> {
        val lines = ArrayList<String>()
        updateWatches(c, result)?.let { lines.add(it) }
        val notices = Notifier.collect(c, previous, result, background)
        val q = Prefs.quietHours(c)
        val now = LocalDateTime.now()
        if (background && !q.allowed(now.toLocalTime())) {
            val held = merge(PhoneNotice.listFromJson(Prefs.heldNotices(c)), notices)
            Prefs.setHeldNotices(c, PhoneNotice.listToJson(held))
            val at = q.nextAllowed(now)
            scheduleRelease(c, at)
            val line = "quiet hours (${q.text()}): held ${held.size} phone, watch alerts wait; out at ${QuietHours.clock(at.hour * 60 + at.minute)}"
            log(c, "alerts", line)
            lines.add("Alerts: $line")
        } else {
            val held = takeHeld(c)
            val all = merge(held, notices)
            val posted = all.count { Notifier.post(c, it) }
            val watch = WatchAlertBridge.afterCheck(c, result)
            val line = "sent: $posted phone${counts(all)}${if (held.isNotEmpty()) " (${held.size} held from quiet hours)" else ""}, ${watch ?: "Watch alerts off"}"
            log(c, "alerts", line)
            lines.add("Alerts: $line")
            watch?.let { lines.add(it) }
        }
        return lines
    }

    /** Quiet hours are over: post what was held and send the watch what is still waiting. */
    fun release(c: Context) {
        val held = takeHeld(c)
        val posted = held.count { Notifier.post(c, it) }
        val watch = Prefs.loadLastResult(c)?.let { WatchAlertBridge.afterCheck(c, it) }
        log(c, "alerts", "released at ${QuietHours.clock(LocalDateTime.now().let { it.hour * 60 + it.minute })}: $posted phone${counts(held)}, ${watch ?: "Watch alerts off"}")
    }

    private fun updateWatches(c: Context, result: RunResult): String? {
        val watches = Prefs.priceWatches(c)
        if (watches.isEmpty() || !result.ok) return null
        val muted = Prefs.mutedKeys(c)
        val u = PriceWatches.apply(watches, result.watched, result.finishedAt, muted)
        // Keep watches added or removed on screen while the check ran.
        val now = Prefs.priceWatches(c).associateBy { it.id }
        Prefs.setPriceWatches(c, now.values.map { w -> u.watches.firstOrNull { it.id == w.id }?.takeIf { it.code == w.code } ?: w })
        log(c, "watches", "check: ${u.summary}")
        PriceWatches.hits(u.watches, emptySet()).forEach { h ->
            log(c, "watches", "hit: ${h.name} now ${Notifier.money(h.price, h.currency)}, trigger ${Notifier.money(h.trigger, h.currency)} (${h.rule.code})${if (h.muteKey in muted) " muted" else ""}")
        }
        return "Price watches: ${u.summary}"
    }

    private fun counts(list: List<PhoneNotice>): String {
        if (list.isEmpty()) return ""
        return " (" + list.groupingBy { it.kind }.eachCount().entries.sortedBy { it.key }.joinToString(", ") { "${it.value} ${it.key}" } + ")"
    }

    /** Newer notices replace held ones with the same id (a lower price replaces the earlier one). */
    private fun merge(old: List<PhoneNotice>, new: List<PhoneNotice>): List<PhoneNotice> {
        val ids = new.mapTo(HashSet()) { it.id }
        return old.filter { it.id !in ids } + new
    }

    private fun takeHeld(c: Context): List<PhoneNotice> {
        val held = PhoneNotice.listFromJson(Prefs.heldNotices(c)).filter { it.muteKey == null || it.muteKey !in Prefs.mutedKeys(c) }
        Prefs.setHeldNotices(c, "[]")
        Prefs.setHeldUntil(c, 0)
        WorkManager.getInstance(c).cancelUniqueWork(ReleaseWorker.NAME)
        return held
    }

    private fun scheduleRelease(c: Context, at: LocalDateTime) {
        val atMs = at.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
        Prefs.setHeldUntil(c, atMs)
        val delay = (atMs - System.currentTimeMillis()).coerceAtLeast(0)
        val req = OneTimeWorkRequestBuilder<ReleaseWorker>().setInitialDelay(delay, TimeUnit.MILLISECONDS).build()
        WorkManager.getInstance(c).enqueueUniqueWork(ReleaseWorker.NAME, ExistingWorkPolicy.REPLACE, req)
    }

    /** Held alerts and when they go out, for Settings ("2 alerts wait until 8:00 AM"), or null. */
    fun heldText(c: Context): String? {
        val n = PhoneNotice.listFromJson(Prefs.heldNotices(c)).size
        val at = Prefs.heldUntil(c)
        if (at == 0L) return null
        val t = java.time.Instant.ofEpochMilli(at).atZone(ZoneId.systemDefault()).toLocalTime()
        return "$n ${if (n == 1) "alert waits" else "alerts wait"} for ${QuietHours.clock(t.hour * 60 + t.minute)}"
    }

    // ---- Mute and unmute ----

    fun mute(c: Context, key: String, label: String) {
        Prefs.setMutes(c, AlertMutes.mute(Prefs.mutes(c), key, label, System.currentTimeMillis()))
        Notifier.cancel(c, PhoneNotice.idFor(key))
        log(c, "alerts", "muted: $label")
    }

    fun unmute(c: Context, key: String) {
        val label = Prefs.mutes(c).firstOrNull { it.key == key }?.label ?: key
        Prefs.setMutes(c, AlertMutes.unmute(Prefs.mutes(c), key))
        // A booked item alerts again at its current price on the next check.
        Prefs.setNotifiedKeys(c, Prefs.notifiedKeys(c).filterNot { it.startsWith(key.removePrefix("price|") + "|") || it.startsWith("$key|") }.toSet())
        log(c, "alerts", "unmuted: $label")
    }
}

/** The Mute button on a price notification. */
class MuteReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val key = intent.getStringExtra(EXTRA_KEY) ?: return
        AlertDelivery.mute(context, key, intent.getStringExtra(EXTRA_LABEL) ?: key)
    }

    companion object {
        private const val EXTRA_KEY = "mute_key"
        private const val EXTRA_LABEL = "mute_label"

        fun intent(c: Context, key: String, label: String, requestCode: Int): PendingIntent = PendingIntent.getBroadcast(
            c, requestCode,
            Intent(c, MuteReceiver::class.java).putExtra(EXTRA_KEY, key).putExtra(EXTRA_LABEL, label),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }
}

/** Runs when the alert hours open and sends what quiet hours held. */
class ReleaseWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val c = applicationContext
        val q = Prefs.quietHours(c)
        val now = LocalDateTime.now()
        if (!q.allowed(now.toLocalTime())) {
            // The hours changed since: wait for the new opening.
            val at = q.nextAllowed(now)
            val delay = at.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli() - System.currentTimeMillis()
            Prefs.setHeldUntil(c, System.currentTimeMillis() + delay)
            // APPEND_OR_REPLACE: runs after this one ends (REPLACE would cancel this very run).
            WorkManager.getInstance(c).enqueueUniqueWork(
                NAME, ExistingWorkPolicy.APPEND_OR_REPLACE,
                OneTimeWorkRequestBuilder<ReleaseWorker>().setInitialDelay(delay.coerceAtLeast(0), TimeUnit.MILLISECONDS).build(),
            )
            return@withContext Result.success()
        }
        AlertDelivery.release(c)
        Result.success()
    }

    companion object {
        const val NAME = "release-held-alerts"
    }
}
