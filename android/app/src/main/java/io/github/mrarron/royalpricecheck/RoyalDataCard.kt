package io.github.mrarron.royalpricecheck

import androidx.compose.material3.Text
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import io.github.mrarron.royalpricecheck.cruise.Section

/**
 * What the app has pulled from Royal Caribbean and when, the same card on Trip and on Prices so the two
 * pages show one story: schedule and bookings and the Cruise Planner list (RoyalSync, one sign-in), and
 * the price check (jdeath's script, its own sign-in). [tick] makes it redraw after a sync.
 */
@Composable
internal fun RoyalDataCard(vm: MainViewModel, tick: Int = 0, title: String? = "Royal data") {
    val c = LocalContext.current
    @Suppress("UNUSED_VARIABLE") val t = tick + vm.syncTick
    val s = RoyalSync.status(c)
    Section(title) {
        Text(
            if (s.scheduleAt == 0L) "Schedule and bookings: not fetched since this version. Download your sailing in Trip."
            else "Schedule and bookings: ${RoyalSync.stamp(s.scheduleAt)} (${s.why})" +
                if (!s.bookingsOk) " · booking details not loaded" else "",
        )
        Text(
            if (s.catalogCount == 0) "Planner list: not loaded"
            else "Planner list: ${s.catalogCount} items" + if (s.catalogAt > 0) ", ${RoyalSync.stamp(s.catalogAt)}" else "",
        )
        val r = vm.result
        Text(
            if (r == null) "Price check: none yet"
            else "Price check: ${RoyalSync.stamp(r.finishedAt)}" + if (r.ok) "" else " (failed)",
            color = if (r != null && !r.ok) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
        )
        Text("Trip, Prices and Price watches all read this one copy. Refresh from Royal in Prices updates the schedule, bookings and planner list on a single sign-in.",
            style = MaterialTheme.typography.bodySmall)
    }
}
