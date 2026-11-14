package io.github.mrarron.royalpricecheck.cruise

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.StarBorder
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import io.github.mrarron.royalpebble.settings.CruiseData
import io.github.mrarron.royalpebble.settings.Event
import io.github.mrarron.royalpebble.settings.SettingsRules
import io.github.mrarron.royalpebble.settings.isHhmm
import io.github.mrarron.royalpebble.store.CruiseStore
import java.time.LocalDate

/** "9:00a", "1:30p", or "no time". */
internal fun shortClock(time: String?): String {
    val m = CruiseData.minutesOf(time) ?: return "No time"
    val h = m / 60
    return "${if (h % 12 == 0) 12 else h % 12}:${(m % 60).toString().padStart(2, '0')}${if (h < 12) "a" else "p"}"
}

private fun dayText(date: String): String {
    val p = date.split("-")
    val d = runCatching { LocalDate.of(p[0].toInt(), p[1].toInt(), p[2].toInt()) }.getOrNull() ?: return date
    return d.dayOfWeek.name.take(3).lowercase().replaceFirstChar { it.uppercase() } + " " + d.dayOfMonth
}

private fun detail(e: Event): String = listOfNotNull(
    shortClock(e.time),
    e.venue.takeIf { it.isNotBlank() },
    e.minutes.takeIf { it > 0 }?.let { if (it >= 60) "${it / 60} h" + (if (it % 60 != 0) " ${it % 60}" else "") else "$it min" },
    e.ageMin?.takeIf { it > 0 }?.let { "Ages $it+" },
).joinToString(" · ")

/** Settings > Events (docs/DESIGN.md §12.5): stars, reserved marks, booked sessions, personal entries. */
@Composable
fun EventsTab(vm: CruiseViewModel) {
    val days = vm.read { itinerary() }
    val events = vm.read { events() }
    val settings = vm.read { settings() }
    val stars = vm.read { stars() }
    val personal = vm.read { SettingsRules.personal(settings()) }
    val reservations = vm.read { store.reservations() }
    val today = LocalDate.now().toString()
    var day by rememberSaveable { mutableStateOf("") }
    val selected = if (days.any { it.date == day }) day else (days.firstOrNull { it.date == today } ?: days.firstOrNull())?.date ?: ""
    var view by rememberSaveable { mutableStateOf("day") }
    var query by rememberSaveable { mutableStateOf("") }
    var showAllPaid by rememberSaveable { mutableStateOf(false) }

    fun starred(e: Event) = stars[e.key] == true
    fun reserved(e: Event) = stars[CruiseStore.RESERVED_PREFIX + e.key] == true
    fun needsReserving(e: Event) = starred(e) && e.reservation && !reserved(e)
    val toReserve = events.count { needsReserving(it) }

    val q = query.trim()
    val shown: List<Event> = when {
        q.isNotEmpty() -> events.filter { it.title.contains(q, true) || it.venue.contains(q, true) }.take(150)
        view == "starred" -> events.filter { starred(it) }
        view == "reserve" -> events.filter { needsReserving(it) }
        else -> events.filter { it.date == selected && !it.paid }
    }
    val paidToday = if (q.isEmpty() && view == "day") events.filter { it.date == selected && it.paid } else emptyList()
    val showDays = q.isNotEmpty() || view != "day"

    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            OutlinedTextField(query, { query = it }, label = { Text("Search every day") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        }
        item {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(view == "day", { view = "day" }, label = { Text("By day") })
                FilterChip(view == "starred", { view = "starred" }, label = { Text("★ Starred") })
                if (toReserve > 0) FilterChip(view == "reserve", { view = "reserve" }, label = { Text("To reserve · $toReserve") })
            }
        }
        if (view == "day" && q.isEmpty()) {
            item {
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    days.forEach { d -> FilterChip(d.date == selected, { day = d.date }, label = { Text(dayText(d.date)) }) }
                }
            }
            val res = reservations.filter { it.date == selected }
            if (res.isNotEmpty()) item {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("FROM YOUR BOOKING", style = MaterialTheme.typography.labelMedium)
                        res.forEach { r ->
                            Text(r.title, style = MaterialTheme.typography.titleSmall)
                            Text(listOfNotNull(
                                r.meet?.let { "Meet ${shortClock(it)}" } ?: r.time?.let { shortClock(it) },
                                r.end?.let { "ends ${shortClock(it)}" },
                                "${r.guests} ${if (r.guests == 1) "guest" else "guests"}",
                            ).joinToString(" · "))
                        }
                        Note("From your booking. Change it in the Royal app.")
                    }
                }
            }
            item { PersonalCard(vm, selected, personal.filter { it.date == selected }) }
        }
        if (shown.isEmpty()) item { Note(if (q.isNotEmpty()) "No events match." else if (view == "day") "No events on this day." else "Nothing here yet.") }
        itemsIndexed(shown) { i, e ->
            if (showDays && (i == 0 || shown[i - 1].date != e.date)) Text(dayText(e.date), style = MaterialTheme.typography.labelLarge)
            EventRow(e, starred(e), reserved(e), CruiseData.hiddenByFilters(e, settings) && !starred(e),
                onStar = { vm.edit { setStar(e.key, it) } },
                onReserved = { vm.edit { setStar(CruiseStore.RESERVED_PREFIX + e.key, it) } })
        }
        if (paidToday.isNotEmpty()) {
            item { Text("Booked activities and excursions", style = MaterialTheme.typography.titleMedium) }
            item { Note("Paid classes and shore excursions. Pick a session to star it and mark it reserved; only picked sessions reach the watch.") }
            items(if (showAllPaid) paidToday else paidToday.take(20)) { e ->
                val picked = starred(e)
                Card(Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Column(Modifier.weight(1f)) {
                            Text(e.title, style = MaterialTheme.typography.titleSmall)
                            Text(detail(e) + (e.price?.let { " · from \$$it" } ?: ""))
                        }
                        if (picked) Button({ vm.edit { pick(e.key, false) } }) { Text("✓ Picked") }
                        else OutlinedButton({ vm.edit { pick(e.key, true) } }) { Text("Pick") }
                    }
                }
            }
            if (!showAllPaid && paidToday.size > 20) item { TextButton({ showAllPaid = true }) { Text("Show all ${paidToday.size}") } }
        }
        item { Note("") }
    }
}

@Composable
private fun EventRow(e: Event, starred: Boolean, reserved: Boolean, hidden: Boolean, onStar: (Boolean) -> Unit, onReserved: (Boolean) -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(start = 12.dp, top = 4.dp, bottom = 8.dp, end = 4.dp)) {
            Row {
                Column(Modifier.weight(1f).padding(top = 8.dp)) {
                    Text(e.title, style = MaterialTheme.typography.titleSmall)
                    Text(detail(e), style = MaterialTheme.typography.bodyMedium)
                }
                IconButton({ onStar(!starred) }) {
                    Icon(if (starred) Icons.Filled.Star else Icons.Outlined.StarBorder,
                        contentDescription = if (starred) "Unstar" else "Star", tint = MaterialTheme.colorScheme.primary)
                }
            }
            if (hidden) Note("Hidden on watch")
            if (e.reservation) {
                if (!starred) Note("Reservation needed · star it to track")
                else if (reserved) TextButton({ onReserved(false) }) { Text("✓ Reserved · Not reserved") }
                else Row {
                    Text("Reservation needed", Modifier.padding(top = 12.dp), style = MaterialTheme.typography.bodyMedium)
                    TextButton({ onReserved(true) }) { Text("✓ Mark reserved") }
                }
            }
        }
    }
}

@Composable
private fun PersonalCard(vm: CruiseViewModel, date: String, entries: List<SettingsRules.Personal>) {
    var open by rememberSaveable { mutableStateOf(false) }
    var title by rememberSaveable { mutableStateOf("") }
    var place by rememberSaveable { mutableStateOf("") }
    var time by rememberSaveable { mutableStateOf("") }
    var minutes by rememberSaveable { mutableStateOf("") }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("MY ENTRIES", style = MaterialTheme.typography.labelMedium)
            entries.forEach { p ->
                Row {
                    Column(Modifier.weight(1f)) {
                        Text(p.title, style = MaterialTheme.typography.titleSmall)
                        Text(listOfNotNull(p.time?.let { shortClock(it) }, p.venue.takeIf { it.isNotBlank() },
                            p.minutes.takeIf { it > 0 }?.let { "$it min" }).joinToString(" · "))
                    }
                    TextButton({ vm.edit { removePersonal(p.id) } }) { Text("Remove") }
                }
            }
            if (entries.isEmpty()) Note("Your own reminders (dinner, spa) get alerts like starred events.")
            OutlinedButton({ open = !open }) { Text(if (open) "Cancel" else "Add an entry") }
            if (open) {
                OutlinedTextField(title, { title = it.take(63) }, label = { Text("Title") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(place, { place = it.take(31) }, label = { Text("Place") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(time, { time = it.take(5) }, label = { Text("Time HH:MM") }, singleLine = true, modifier = Modifier.weight(1f),
                        isError = time.isNotEmpty() && !isHhmm(time))
                    OutlinedTextField(minutes, { minutes = it.filter { c -> c.isDigit() }.take(4) }, label = { Text("Minutes") }, singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.weight(1f))
                }
                Button(onClick = {
                    var added = false
                    vm.edit { added = addPersonal(SettingsRules.Personal(title.trim(), place.trim(), date, time.takeIf { isHhmm(it) }, minutes.toIntOrNull() ?: 0)) }
                    if (added) { title = ""; place = ""; time = ""; minutes = ""; open = false }
                }, enabled = title.isNotBlank() && (time.isEmpty() || isHhmm(time)) && date.isNotEmpty()) { Text("Add") }
            }
        }
    }
}
