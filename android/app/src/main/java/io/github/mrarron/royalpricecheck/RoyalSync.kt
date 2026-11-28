package io.github.mrarron.royalpricecheck

import android.app.Application
import android.content.Context
import io.github.mrarron.royalpebble.royal.RoyalClient
import io.github.mrarron.royalpebble.royal.RoyalParse
import io.github.mrarron.royalpebble.royal.UrlConnectionTransport
import io.github.mrarron.royalpebble.settings.DownloadOutcome
import io.github.mrarron.royalpebble.settings.DownloadService
import io.github.mrarron.royalpebble.settings.formatStamp
import io.github.mrarron.royalpricecheck.cruise.CruiseHome
import io.github.mrarron.royalpricecheck.watch.WatchHost
import java.time.ZoneId

/**
 * The one way the app pulls the sailing's data from Royal Caribbean (Kotlin side): the schedule, your
 * booking details and, when it's wanted, the Cruise Planner list, all on one sign-in and saved in one
 * place. The Trip download, the background schedule refresh and Prices > Refresh from Royal all come
 * through [run], so Trip and Prices show the same data and say when it was fetched ([status]).
 *
 * The price check itself is jdeath's unchanged Python script (PythonBridge), which signs in on its own
 * and prices what you have booked and watch; its time is shown beside these.
 */
object RoyalSync {
    private val lock = Any()
    private const val CATALOG_MAX_AGE_MS = 24L * 3600 * 1000

    private fun sp(c: Context) = c.getSharedPreferences("royal_sync", Context.MODE_PRIVATE)

    /** What the last sync fetched and when (0 = never). */
    data class Status(
        val scheduleAt: Long, val bookingsOk: Boolean, val bookingsNote: String?,
        val catalogAt: Long, val catalogCount: Int, val why: String,
    )

    fun status(c: Context): Status = sp(c).let {
        Status(it.getLong("schedule_at", 0), it.getBoolean("bookings_ok", false), it.getString("bookings_note", null),
            it.getLong("catalog_at", 0), Prefs.catalogItems(c).size, it.getString("why", "") ?: "")
    }

    /** True when a planner list is loaded and is a day old: the background refresh renews it on its own sign-in. */
    fun catalogDue(c: Context, now: Long): Boolean {
        val s = status(c)
        return s.catalogCount > 0 && now - s.catalogAt >= CATALOG_MAX_AGE_MS
    }

    fun stamp(ms: Long): String = formatStamp(ms, ZoneId.systemDefault())

    /**
     * Downloads [sailDate] for [ship] (with [login], also the booking details; with [withCatalog] and a
     * login, also the planner list on the same sign-in) and keeps the result. Blocks; one sync at a time.
     * Writes one `sync` line to the app log. [why] names the caller there.
     */
    fun run(app: Application, ship: RoyalParse.Ship, sailDate: String, login: DownloadService.Login?, withCatalog: Boolean, why: String, makeActive: Boolean = true): DownloadOutcome {
        synchronized(lock) {
            val started = System.currentTimeMillis()
            val service = DownloadService(RoyalClient(UrlConnectionTransport()), CruiseHome.store(app))
            val outcome = service.download(ship, sailDate, login, withCatalog && login != null, makeActive)
            val ms = System.currentTimeMillis() - started
            when (outcome) {
                is DownloadOutcome.Done -> {
                    val e = sp(app).edit().putLong("schedule_at", started).putString("why", why)
                    var catalogText = "planner list not asked for"
                    if (login != null) {
                        e.putBoolean("bookings_ok", outcome.mineError == null).putString("bookings_note", outcome.mineError)
                    }
                    if (withCatalog && login != null) {
                        val r = outcome.catalog
                        if (r != null && r.items.isNotEmpty()) {
                            Prefs.setCatalogItems(app, r.items)
                            e.putLong("catalog_at", started)
                            catalogText = "planner list ${r.items.size} items" + (if (r.failed.isNotEmpty()) " (failed: ${r.failed.joinToString()})" else "")
                        } else {
                            catalogText = "planner list " + (outcome.catalogError ?: if (r != null) "empty" else "not loaded") + ", kept the old one"
                        }
                    }
                    e.apply()
                    WatchHost.logApp(app, "sync", "$why: schedule ok, " +
                        (if (login == null) "bookings not asked for" else if (outcome.mineError == null) "bookings ok" else "bookings failed (${outcome.mineError})") +
                        ", $catalogText, one sign-in, $ms ms")
                }
                is DownloadOutcome.Failed -> WatchHost.logApp(app, "sync", "$why: FAILED (${outcome.error}), $ms ms")
            }
            return outcome
        }
    }
}
