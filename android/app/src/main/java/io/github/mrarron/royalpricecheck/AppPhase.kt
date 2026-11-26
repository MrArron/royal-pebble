package io.github.mrarron.royalpricecheck

import android.app.Application
import android.content.Context
import io.github.mrarron.royalpebble.settings.CruiseData
import io.github.mrarron.royalpebble.settings.TripPhase
import io.github.mrarron.royalpricecheck.cruise.CruiseHome
import io.github.mrarron.royalpricecheck.watch.WatchHost
import java.time.LocalDate

/**
 * The app's trip phase (TripPhase): the owner's pick (Auto, Planning, On board)
 * and, for Auto, the downloaded sailing's dates. Every change of the phase the app
 * shows writes a test log line: `phase  planning -> onboard (auto)`.
 */
object AppPhase {
    private fun sp(c: Context) = c.getSharedPreferences("trip_phase", Context.MODE_PRIVATE)

    fun mode(c: Context): TripPhase.Mode = TripPhase.Mode.of(sp(c).getString("mode", null))

    fun setMode(c: Context, mode: TripPhase.Mode) {
        val before = mode(c)
        sp(c).edit().putString("mode", mode.key).apply()
        if (before != mode) WatchHost.logApp(c, "phase", "mode: ${before.key} -> ${mode.key}")
    }

    /** Auto's answer right now. */
    fun auto(c: Context): TripPhase.Phase {
        val bundle = CruiseHome.store(c.applicationContext as Application).bundle()
        val dates = CruiseData.itinerary(bundle).map { it.date }
        return TripPhase.auto(dates, LocalDate.now().toString(), isDemo = bundle == null)
    }

    /** The phase to show; logs when it differs from the one shown last. */
    fun current(c: Context): TripPhase.Phase {
        val mode = mode(c)
        val phase = TripPhase.effective(mode, auto(c))
        val last = sp(c).getString("last", null)
        if (last != phase.key) {
            sp(c).edit().putString("last", phase.key).apply()
            WatchHost.logApp(c, "phase", "${last ?: "none"} -> ${phase.key} (${mode.key})")
        }
        return phase
    }

    /** Price checks keep running on board only when the owner asks (Prices > Checks). */
    fun checksAtSea(c: Context): Boolean = sp(c).getBoolean("checks_at_sea", false)

    fun setChecksAtSea(c: Context, on: Boolean) {
        sp(c).edit().putBoolean("checks_at_sea", on).apply()
        WatchHost.logApp(c, "switch", "price checks on board: " + if (on) "off -> on" else "on -> off")
    }
}
