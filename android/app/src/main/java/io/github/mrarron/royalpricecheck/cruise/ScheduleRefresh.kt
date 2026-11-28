package io.github.mrarron.royalpricecheck.cruise

import android.app.Application
import android.content.Context
import io.github.mrarron.royalpebble.royal.RoyalParse
import io.github.mrarron.royalpebble.settings.CruiseData
import io.github.mrarron.royalpebble.settings.DownloadOutcome
import io.github.mrarron.royalpebble.settings.DownloadService
import io.github.mrarron.royalpebble.settings.RefreshRules
import io.github.mrarron.royalpebble.store.CruiseStore
import io.github.mrarron.royalpebble.watch.starChangeCounts
import io.github.mrarron.royalpricecheck.RoyalAccount
import io.github.mrarron.royalpricecheck.watch.WatchHost
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import java.time.LocalDate
import java.time.ZoneId

/**
 * The background schedule refresh (docs/DESIGN.md §12, Prices > Checks): after a background price check, the saved sailing is downloaded
 * again with the Royal login, the way Download with login does it, so moved or
 * cancelled events, their stars and new bookings reach the watch on their own.
 *
 * It runs from [io.github.mrarron.royalpricecheck.CheckWorker], so it pauses on
 * board with the price checks unless Keep checking while on board is on. On
 * top of that: only from [RefreshRules.DAYS_BEFORE] days before sailing to the last cruise
 * day (Royal publishes the schedule about two weeks out), at most once every
 * [RefreshRules.MIN_GAP_HOURS] hours, and only with a remembered Royal Caribbean login.
 * Every run, and every skip, writes one `schedule` line to the app's log. When the refresh
 * finds the schedule newly posted, or much bigger, [io.github.mrarron.royalpricecheck.ScheduleNotify]
 * sends the "schedule is up" alert.
 */
object ScheduleRefresh {
    private fun sp(c: Context) = c.getSharedPreferences("schedule_refresh", Context.MODE_PRIVATE)

    /** Prices > Checks > Also refresh the schedule. On until turned off. */
    fun enabled(c: Context): Boolean = sp(c).getBoolean("on", true)

    fun setEnabled(c: Context, on: Boolean) {
        sp(c).edit().putBoolean("on", on).apply()
        WatchHost.logApp(c, "schedule", "Also refresh the schedule: " + if (on) "on" else "off")
    }

    private fun lastRun(c: Context): Long = sp(c).getLong("last_run", 0L)

    /**
     * Runs the refresh if it's due, for every sailing kept on the phone (each one that is due, not only the one
     * the app is showing). Blocks: call it off the main thread.
     */
    fun runIfDue(c: Context) {
        val app = c.applicationContext as Application
        val store = CruiseHome.store(app)
        val account = RoyalAccount.current(app)?.takeIf { it.cruiseLine == "royal" }
        val now = System.currentTimeMillis()
        val today = LocalDate.now(ZoneId.systemDefault())
        val kept = store.sailings()
        if (kept.isEmpty()) {
            val skip = RefreshRules.skipReason(enabled(app), null, null, today, account != null, lastRun(app), now)
            if (skip != null && skip != "off") WatchHost.logApp(app, "schedule", "background refresh skipped: $skip")
            return
        }
        val skips = ArrayList<String>()
        val due = kept.filter { k ->
            val s = k.sailing
            val skip = RefreshRules.skipReason(
                enabled(app), s.sailDate, CruiseData.itinerary(store.bundleOf(s.shipCode, s.sailDate)).lastOrNull()?.date,
                today, account != null, lastRun(app), now,
            )
            if (skip != null && skip != "off") skips += "${s.shipCode} ${s.sailDate}: $skip"
            skip == null
        }
        if (due.isEmpty()) {
            if (skips.isNotEmpty()) WatchHost.logApp(app, "schedule", "background refresh skipped: " + skips.joinToString("; "))
            return
        }
        account!!
        sp(app).edit().putLong("last_run", now).apply()
        var changedActive = false
        due.forEachIndexed { i, k ->
            val sailing = k.sailing
            val ship = RoyalParse.Ship(sailing.shipCode, sailing.shipName)
            val started = System.currentTimeMillis()
            val beforeBundle = store.bundleOf(sailing.shipCode, sailing.sailDate)
            val before = io.github.mrarron.royalpebble.alerts.ScheduleCounts.of(beforeBundle)
            // The same shared sync as Trip's download; a planner list loaded earlier is renewed once (on the first sailing) when it's a day old.
            val withCatalog = i == 0 && io.github.mrarron.royalpricecheck.RoyalSync.catalogDue(app, now)
            // Never switches the sailing the app is showing: each sailing is refreshed where it is kept.
            val outcome = io.github.mrarron.royalpricecheck.RoyalSync.run(app, ship, sailing.sailDate, DownloadService.Login(account.email, account.password), withCatalog, "background refresh", makeActive = false)
            when (outcome) {
                is DownloadOutcome.Done -> {
                    WatchHost.logApp(app, "schedule", "background refresh of ${sailing.shipCode} ${sailing.sailDate} done in ${System.currentTimeMillis() - started} ms: " +
                        outcome.summary + (outcome.mineError?.let { "; booking details failed: $it" } ?: ""))
                    val afterBundle = store.bundleOf(sailing.shipCode, sailing.sailDate)
                    afterDownload(app, store, outcome, afterBundle, k.active)
                    // The schedule is up: phone and watch alert (before the watch gets the new data).
                    runCatching {
                        io.github.mrarron.royalpricecheck.ScheduleNotify.afterRefresh(
                            app, sailing.shipCode, sailing.shipName, sailing.sailDate,
                            if (outcome.saved.sameSailing) before else io.github.mrarron.royalpebble.alerts.ScheduleCounts.NONE,
                            io.github.mrarron.royalpebble.alerts.ScheduleCounts.of(afterBundle),
                        )
                    }.onFailure { WatchHost.logApp(app, "schedule", "alert failed unexpectedly (${it::class.java.simpleName})") }
                    if (k.active) changedActive = true
                }
                is DownloadOutcome.Failed -> WatchHost.logApp(app, "schedule", "background refresh of ${sailing.shipCode} ${sailing.sailDate} FAILED: ${outcome.error}")
            }
        }
        if (changedActive) WatchHost.storeChanged(app, "schedule refreshed")
    }

    /**
     * The test log's lines after any download (Cruise screen or background):
     * what a re-download did to stars (counts only, as useBundle's `resync`
     * entries) and how bookings matched the schedule (`booked`, as useBundle).
     */
    fun afterDownload(app: Application, store: CruiseStore, outcome: DownloadOutcome.Done,
                      bundle: JsonObject? = store.bundle(), active: Boolean = true) {
        val err = CruiseHome.reconciler.lastError
        if (err != null) {
            WatchHost.logApp(app, "stars", "reconcile failed, stars kept: $err")
        } else if (outcome.saved.sameSailing && active) {
            val list = ((store.read(CruiseStore.STAR_CHANGES) as? JsonObject)?.get("list") as? JsonArray).orEmpty()
            WatchHost.logApp(app, "stars", "re-download: " + starChangeCounts(list) + ", " +
                "${store.stars().count { it.value && !it.key.startsWith(CruiseStore.RESERVED_PREFIX) }} starred now")
        }
        CruiseData.bookedSummary(bundle)?.let { WatchHost.logApp(app, "booked", it.logText()) }
    }
}
