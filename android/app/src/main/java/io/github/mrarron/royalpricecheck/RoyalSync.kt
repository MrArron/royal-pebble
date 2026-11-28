package io.github.mrarron.royalpricecheck

import android.app.Application
import android.content.Context
import io.github.mrarron.royalpebble.royal.RoyalClient
import io.github.mrarron.royalpebble.royal.RoyalParse
import io.github.mrarron.royalpebble.royal.SignInCache
import io.github.mrarron.royalpebble.royal.UrlConnectionTransport
import io.github.mrarron.royalpebble.settings.DownloadOutcome
import io.github.mrarron.royalpebble.settings.DownloadService
import io.github.mrarron.royalpebble.settings.PullRules
import io.github.mrarron.royalpebble.settings.formatStamp
import io.github.mrarron.royalpricecheck.cruise.CruiseHome
import io.github.mrarron.royalpricecheck.watch.WatchHost
import java.time.ZoneId

/**
 * The one way the app pulls the sailing's data from Royal Caribbean (Kotlin side): the schedule, your
 * booking details and, when it's wanted, the Cruise Planner list, all on one sign-in and saved in one
 * place. The pull-down refresh ([RoyalRefresh]), Trip's Download and the background schedule refresh all
 * come through [run], so every screen shows the same data and says when it was fetched ([status]).
 *
 * The sign-in is [signIn], shared with the price check: jdeath's unchanged script is handed the same
 * token (PythonBridge), so one refresh signs in to Royal once. A sailing downloaded with the same or more
 * in the last few minutes is not pulled again ([PullRules.syncIsFresh]).
 */
object RoyalSync {
    private val lock = Any()
    private const val CATALOG_MAX_AGE_MS = 24L * 3600 * 1000

    /** The app's one Royal sign-in, in memory, reused for a few minutes (see [SignInCache]). */
    val signIn = SignInCache()

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

    private fun sailingKey(ship: String, date: String) = ship.uppercase() + "_" + date.replace("-", "")

    /**
     * Downloads [sailDate] for [ship] (with [login], also the booking details; with [withCatalog] and a
     * login, also the planner list on the same sign-in) and keeps the result. Blocks; one sync at a time.
     * Writes one `sync` line to the app log. [why] names the caller there. Returns [DownloadOutcome.Fresh]
     * without asking Royal when this sailing was downloaded with as much a few minutes ago.
     */
    fun run(app: Application, ship: RoyalParse.Ship, sailDate: String, login: DownloadService.Login?, withCatalog: Boolean, why: String, makeActive: Boolean = true): DownloadOutcome {
        synchronized(lock) {
            val started = System.currentTimeMillis()
            val key = sailingKey(ship.code, sailDate)
            val p = sp(app)
            val wantCatalog = withCatalog && login != null
            val lastOk = p.getLong("ok_at_$key", 0)
            if (PullRules.syncIsFresh(lastOk, p.getBoolean("ok_login_$key", false), login != null, wantCatalog, p.getLong("catalog_at", 0), started)) {
                val min = (started - lastOk) / 60_000
                WatchHost.logApp(app, "sync", "$why: skipped, ${ship.code} $sailDate was downloaded $min min ago (kept that copy, nothing asked of Royal)")
                if (makeActive) CruiseHome.store(app).activate(ship.code, sailDate)
                return DownloadOutcome.Fresh(min)
            }
            val reusedBefore = login?.let { signIn.peek(it.email) } != null
            val service = DownloadService(RoyalClient(UrlConnectionTransport()), CruiseHome.store(app))
            val outcome = service.download(ship, sailDate, login, wantCatalog, makeActive, signIn)
            val ms = System.currentTimeMillis() - started
            val signInText = if (login == null) "no sign-in" else if (reusedBefore) "reused sign-in" else "one sign-in"
            when (outcome) {
                is DownloadOutcome.Done -> {
                    val e = p.edit().putLong("schedule_at", started).putString("why", why)
                        .putLong("ok_at_$key", started).putBoolean("ok_login_$key", login != null && outcome.mineError == null)
                    var catalogText = "planner list not asked for"
                    if (login != null) {
                        e.putBoolean("bookings_ok", outcome.mineError == null).putString("bookings_note", outcome.mineError)
                    }
                    if (wantCatalog) {
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
                        ", $catalogText, $signInText, $ms ms")
                }
                is DownloadOutcome.Failed -> {
                    // A rejected or refused sign-in must not be handed on to the price check.
                    if (login != null) signIn.forget()
                    WatchHost.logApp(app, "sync", "$why: FAILED (${outcome.error}), $signInText, $ms ms")
                }
                is DownloadOutcome.Fresh -> {}
            }
            return outcome
        }
    }
}
