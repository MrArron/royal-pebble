package io.github.mrarron.royalpricecheck

import androidx.compose.material3.Text
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import io.github.mrarron.royalpricecheck.cruise.Section

/**
 * What the app has pulled from Royal Caribbean and when, the same card on Trip and on Prices so the two
 * pages show one story: schedule and bookings and the Cruise Planner list (RoyalSync), and the price check
 * (jdeath's script), all from one pull-down refresh on one sign-in. [tick] makes it redraw after a sync.
 */
@Composable
internal fun RoyalDataCard(vm: MainViewModel, tick: Int = 0, title: String? = "Royal data") {
    val c = LocalContext.current
    @Suppress("UNUSED_VARIABLE") val t = tick + vm.syncTick
    val s = RoyalSync.status(c)
    Section(title) {
        Text(
            if (s.scheduleAt == 0L) "Schedule and bookings: not fetched since this version. Download your sailing in Trip, or pull down to refresh."
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
        Text("Trip, Prices and Price watches all read this one copy. Pull down on Trip, Today or Prices to refresh the schedule, bookings, planner list and prices together, on one sign-in.",
            style = MaterialTheme.typography.bodySmall)
    }
}

/**
 * Where the pull-down refresh stands: the step it's on while it runs, then what it did. Pull-to-refresh is easy
 * to miss, so the screens that have it say so here until the first refresh.
 */
@Composable
internal fun RefreshHint(vm: MainViewModel) {
    val step = vm.refreshStep
    when {
        vm.refreshing -> Text("Refreshing from Royal: ${step ?: "starting…"}", style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.primary)
        vm.syncMessage != null -> Text(vm.syncMessage!!, style = MaterialTheme.typography.bodySmall)
        else -> Text("Pull down to refresh the schedule, bookings and prices.", style = MaterialTheme.typography.bodySmall)
    }
}
