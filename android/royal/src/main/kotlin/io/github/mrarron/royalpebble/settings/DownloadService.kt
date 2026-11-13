package io.github.mrarron.royalpebble.settings

import io.github.mrarron.royalpebble.royal.RoyalClient
import io.github.mrarron.royalpebble.royal.RoyalException
import io.github.mrarron.royalpebble.royal.RoyalParse
import io.github.mrarron.royalpebble.store.CruiseStore
import io.github.mrarron.royalpebble.store.SaveResult
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime

/** How a download ended. Texts are fixed wording plus counts: safe to show and to log. */
sealed class DownloadOutcome {
    /** The sailing is saved. [mineError] says why the booking details are missing (a login download only). */
    data class Done(
        val summary: String,
        val withLogin: Boolean,
        val mineError: String?,
        val bookingSummary: String?,
        val saved: SaveResult,
    ) : DownloadOutcome()

    data class Failed(val error: String) : DownloadOutcome()
}

/**
 * The Cruise screen's downloads (the settings page's Download and Advanced
 * download, `src/pkjs/index.js startDownload`): signs in when asked, downloads,
 * keeps the result in the [CruiseStore] and records a failure for the screen
 * to show until the next download works.
 *
 * The password is only passed on to [RoyalClient.login]; it is never stored,
 * logged or put into an outcome here. Calls block: run them off the main thread.
 */
class DownloadService(
    private val client: RoyalClient,
    private val store: CruiseStore,
    private val zone: ZoneId = ZoneId.systemDefault(),
    private val clock: () -> Long = System::currentTimeMillis,
) {
    /** Royal's ships: the saved list when it is under 30 days old, else a fresh one (saved for next time). */
    fun ships(forceRefresh: Boolean = false): List<RoyalParse.Ship> {
        if (!forceRefresh) {
            store.ships(clock())?.let { saved -> if (saved.isNotEmpty()) return saved.map { RoyalParse.Ship(it.first, it.second) } }
        }
        val fresh = client.fetchShips()
        if (fresh.isNotEmpty()) store.saveShips(fresh.map { it.code to it.name }, clock())
        return fresh
    }

    /** Sail dates from today on (yesterday's too, for a cruise under way), as `YYYY-MM-DD`. */
    fun sailDates(shipCode: String): List<String> {
        val from = LocalDate.now(zone).minusDays(14).toString()
        return client.fetchSailDates(shipCode, from)
    }

    /** The settings page's status time: `Nov 13, 5:24p`. */
    fun stamp(): String = formatStamp(clock(), zone)

    /**
     * Downloads [sailDate] for [ship]. With [login] it also signs in and adds the
     * booking details. A failure is recorded in the store (status) and returned.
     */
    fun download(ship: RoyalParse.Ship, sailDate: String, login: Login? = null): DownloadOutcome {
        val at = stamp()
        return try {
            val (bundle, mineError) = if (login != null) {
                client.downloadWithLogin(ship, sailDate, login.email, login.password).let { it.bundle to it.mineError }
            } else {
                client.download(ship, sailDate) to null
            }
            val saved = store.saveDownload(bundle, at, mineError)
            val mine = store.bundle()?.get("mine")
            DownloadOutcome.Done(
                summary = RoyalParse.scheduleSummary(bundle["schedule"]!!),
                withLogin = login != null,
                mineError = mineError,
                bookingSummary = if (login != null && mineError == null && mine != null) RoyalParse.mineSummary(mine) else null,
                saved = saved,
            )
        } catch (e: RoyalException) {
            fail(e.message ?: "The download failed.", at)
        } catch (e: Exception) {
            // Never e.message here: an unexpected error could quote a request.
            fail("The download failed unexpectedly (${e.javaClass.simpleName}). Try again.", at)
        }
    }

    private fun fail(error: String, at: String): DownloadOutcome.Failed {
        store.recordFailure(error, at)
        return DownloadOutcome.Failed(error)
    }

    /** Email and password for one sign-in. [toString] hides both so a stray log line can't leak them. */
    class Login(val email: String, val password: String) {
        override fun toString(): String = "Login(<private>)"
    }
}

private val MONTHS = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

/** slice.js formatSync: `Nov 13, 5:24p`. */
fun formatStamp(ms: Long, zone: ZoneId): String {
    val t = ZonedDateTime.ofInstant(java.time.Instant.ofEpochMilli(ms), zone)
    val h12 = if (t.hour % 12 == 0) 12 else t.hour % 12
    return "${MONTHS[t.monthValue - 1]} ${t.dayOfMonth}, $h12:${t.minute.toString().padStart(2, '0')}${if (t.hour < 12) "a" else "p"}"
}
