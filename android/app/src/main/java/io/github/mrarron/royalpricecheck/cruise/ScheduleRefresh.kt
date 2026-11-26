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

    /** Runs the refresh if it's due. Blocks: call it off the main thread. */
    fun runIfDue(c: Context) {
        val app = c.applicationContext as Application
        val store = CruiseHome.store(app)
        val bundle = store.bundle()
        val sailing = store.sailing()
        val account = RoyalAccount.current(app)?.takeIf { it.cruiseLine == "royal" }
        val now = System.currentTimeMillis()
        val skip = RefreshRules.skipReason(
            enabled(app), sailing?.sailDate, CruiseData.itinerary(bundle).lastOrNull()?.date,
            LocalDate.now(ZoneId.systemDefault()), account != null, lastRun(app), now,
        )
        if (skip != null) {
            if (skip != "off") WatchHost.logApp(app, "schedule", "background refresh skipped: $skip")
            return
        }
        sailing!!; account!!
        sp(app).edit().putLong("last_run", now).apply()
        val ship = RoyalParse.Ship(sailing.shipCode, sailing.shipName)
        val started = System.currentTimeMillis()
        val before = io.github.mrarron.royalpebble.alerts.ScheduleCounts.of(bundle)
        // The same shared sync as Trip's download; a planner list loaded earlier is renewed here once it's a day old.
        val withCatalog = io.github.mrarron.royalpricecheck.RoyalSync.catalogDue(app, now)
        when (val outcome = io.github.mrarron.royalpricecheck.RoyalSync.run(app, ship, sailing.sailDate, DownloadService.Login(account.email, account.password), withCatalog, "background refresh")) {
            is DownloadOutcome.Done -> {
                WatchHost.logApp(app, "schedule", "background refresh done in ${System.currentTimeMillis() - started} ms: " +
                    outcome.summary + (outcome.mineError?.let { "; booking details failed: $it" } ?: ""))
                afterDownload(app, store, outcome)
                // The schedule is up: phone and watch alert (before the watch gets the new data).
                runCatching {
                    io.github.mrarron.royalpricecheck.ScheduleNotify.afterRefresh(
                        app, sailing.shipCode, sailing.shipName, sailing.sailDate,
                        if (outcome.saved.sameSailing) before else io.github.mrarron.royalpebble.alerts.ScheduleCounts.NONE,
                        io.github.mrarron.royalpebble.alerts.ScheduleCounts.of(store.bundle()),
                    )
                }.onFailure { WatchHost.logApp(app, "schedule", "alert failed unexpectedly (${it::class.java.simpleName})") }
                WatchHost.storeChanged(app, "schedule refreshed (${sailing.shipCode} ${sailing.sailDate})")
            }
            is DownloadOutcome.Failed -> WatchHost.logApp(app, "schedule", "background refresh FAILED: ${outcome.error}")
        }
    }

    /**
     * The test log's lines after any download (Cruise screen or background):
     * what a re-download did to stars (counts only, as useBundle's `resync`
     * entries) and how bookings matched the schedule (`booked`, as useBundle).
     */
    fun afterDownload(app: Application, store: CruiseStore, outcome: DownloadOutcome.Done) {
        val err = CruiseHome.reconciler.lastError
        if (err != null) {
            WatchHost.logApp(app, "stars", "reconcile failed, stars kept: $err")
        } else if (outcome.saved.sameSailing) {
            val list = ((store.read(CruiseStore.STAR_CHANGES) as? JsonObject)?.get("list") as? JsonArray).orEmpty()
            WatchHost.logApp(app, "stars", "re-download: " + starChangeCounts(list) + ", " +
                "${store.stars().count { it.value && !it.key.startsWith(CruiseStore.RESERVED_PREFIX) }} starred now")
        }
        CruiseData.bookedSummary(store.bundle())?.let { WatchHost.logApp(app, "booked", it.logText()) }
    }
}
