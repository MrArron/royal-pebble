package io.github.mrarron.royalpricecheck.cruise

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.mrarron.royalpebble.settings.CruiseData
import io.github.mrarron.royalpebble.settings.SettingsRules
import io.github.mrarron.royalpebble.settings.TripPhase
import io.github.mrarron.royalpebble.store.CruiseStore
import java.time.LocalDate
import java.time.LocalTime

/** Auto · Planning · On board: which tab set the app shows (TripPhase). Shown on Trip and Today. */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
fun ModeChips(mode: TripPhase.Mode, phase: TripPhase.Phase, onPick: (TripPhase.Mode) -> Unit) {
    androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        TripPhase.Mode.entries.forEach { m ->
            val label = if (m == TripPhase.Mode.AUTO) {
                "Auto: " + if (phase == TripPhase.Phase.ONBOARD) "on board" else "planning"
            } else m.label
            FilterChip(mode == m, { onPick(m) }, label = { Text(label) })
        }
    }
}

/** The big card at the top of Trip and Today. */
@Composable
internal fun HeroCard(top: String, big: String, bottom: String, onBoard: Boolean) {
    val c = MaterialTheme.colorScheme
    Card(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (onBoard) c.tertiaryContainer else c.primaryContainer,
            contentColor = if (onBoard) c.onTertiaryContainer else c.onPrimaryContainer,
        ),
    ) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(top, style = MaterialTheme.typography.bodyMedium)
            Text(big, style = MaterialTheme.typography.displaySmall)
            if (bottom.isNotBlank()) Text(bottom, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

/** The Trip screen's top: countdown to the sailing (or the demo's note). */
@Composable
fun TripHero(vm: CruiseViewModel) {
    val demo = vm.read { isDemo }
    val ship = vm.read { shipName() }
    val sail = vm.read { sailDate() }
    if (demo) {
        HeroCard("Demo cruise", "No sailing yet", "Download yours below. The app switches to On board by itself on sail day.", onBoard = false)
        return
    }
    val days = TripPhase.daysToGo(sail, LocalDate.now().toString())
    val published = vm.read { CruiseData.schedulePublished(bundle()) }
    HeroCard(
        "$ship · sails ${CruiseData.sailText(sail)}",
        when {
            days == null -> "Your sailing"
            days > 1 -> "$days days"
            days == 1L -> "Tomorrow"
            days == 0L -> "Today"
            else -> "Sailed"
        },
        when {
            days != null && days < 0 -> "Download your next sailing below."
            published -> "The schedule is out: star events on Plan."
            else -> "The schedule comes out about 2 weeks before sailing. Plan fills in then."
        },
        onBoard = false,
    )
}

/**
 * Today (On board): today's day and all aboard, the next starred events and what to
 * reserve. Times are the schedule's (ship time).
 */
@Composable
fun TodayScreen(vm: CruiseViewModel, mode: TripPhase.Mode, phase: TripPhase.Phase, onMode: (TripPhase.Mode) -> Unit,
                onEvents: () -> Unit, watchStatus: String) {
    val today = LocalDate.now().toString()
    val days = vm.read { itinerary() }
    val bundle = vm.read { bundle() }
    val settings = vm.read { settings() }
    val events = vm.read { events() }
    val stars = vm.read { stars() }
    val day = days.firstOrNull { it.date == today }
    val now = LocalTime.now().let { it.hour * 60 + it.minute }
    Page {
        ModeChips(mode, phase, onMode)
        if (day == null) {
            HeroCard(vm.read { shipName() }, "Not a cruise day", "Today isn't on this sailing's itinerary.", onBoard = true)
        } else {
            val v = SettingsRules.dayView(bundle, day, settings)
            val aa = v.allAboard
            val left = aa?.let { it - now }
            HeroCard(
                "Day ${day.day} · ${CruiseData.sailText(day.date)} · ${v.port.ifBlank { "At sea" }}",
                when {
                    aa == null -> if (v.type == "CRUISING") "At sea" else v.type.lowercase().replaceFirstChar { it.uppercase() }
                    left != null && left > 0 -> "${left / 60}:${(left % 60).toString().padStart(2, '0')}"
                    else -> CruiseData.clock(aa)
                },
                when {
                    aa == null -> "No all aboard today"
                    left != null && left > 0 -> "until all aboard at ${CruiseData.clock(aa)}"
                    else -> "All aboard was ${CruiseData.clock(aa)}"
                },
                onBoard = true,
            )
        }
        val next = events.filter { stars[it.key] == true && (it.date > today || (it.date == today && (CruiseData.minutesOf(it.time) ?: 0) >= now)) }
            .sortedWith(compareBy({ it.date }, { CruiseData.minutesOf(it.time) ?: 0 })).take(3)
        Section("Next starred") {
            if (next.isEmpty()) Note("Nothing starred coming up. Star events on the Events tab.")
            next.forEach { e ->
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text((if (e.date == today) "" else shortDay(e.date) + " ") + shortClock(e.time), style = MaterialTheme.typography.titleSmall)
                    Column(Modifier.weight(1f)) {
                        Text("★ " + e.title, style = MaterialTheme.typography.bodyLarge)
                        if (e.venue.isNotBlank()) Note(e.venue + if (e.reservation && stars[CruiseStore.RESERVED_PREFIX + e.key] != true) " · reservation needed" else "")
                    }
                }
            }
            OutlinedButton(onEvents) { Text("All events") }
        }
        val toReserve = events.count { stars[it.key] == true && it.reservation && stars[CruiseStore.RESERVED_PREFIX + it.key] != true && it.date >= today }
        if (toReserve > 0) {
            Section("To reserve") {
                Text("$toReserve starred ${if (toReserve == 1) "event needs" else "events need"} a reservation")
                OutlinedButton(onEvents) { Text("Open To reserve") }
            }
        }
        Section("Watch") { Note(watchStatus) }
    }
}

private fun shortDay(date: String): String = runCatching {
    val d = LocalDate.parse(date)
    d.dayOfWeek.name.take(3).lowercase().replaceFirstChar { it.uppercase() }
}.getOrDefault(date)

/**
 * Plan (Planning) and Events (On board): the cruise's Events, Days, Filters and
 * Share screens under one segmented row.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlanScreen(vm: CruiseViewModel) {
    val tabs = listOf("Events", "Days", "Filters", "Share")
    var tab by rememberSaveable { mutableIntStateOf(0) }
    Column(Modifier.fillMaxSize()) {
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
            tabs.forEachIndexed { i, t ->
                SegmentedButton(tab == i, { tab = i }, SegmentedButtonDefaults.itemShape(i, tabs.size), label = { Text(t, maxLines = 1) })
            }
        }
        Column(Modifier.weight(1f)) {
            when (tab) {
                0 -> EventsTab(vm)
                1 -> DaysTab(vm)
                2 -> FiltersTab(vm)
                else -> ShareTab(vm)
            }
        }
    }
}
