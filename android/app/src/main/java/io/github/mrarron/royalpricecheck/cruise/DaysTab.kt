package io.github.mrarron.royalpricecheck.cruise

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
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
import androidx.compose.ui.unit.dp
import io.github.mrarron.royalpebble.settings.CruiseData
import io.github.mrarron.royalpebble.settings.ItineraryDay
import io.github.mrarron.royalpebble.settings.isHhmm
import io.github.mrarron.royalpebble.settings.SettingsRules
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Settings > Days (docs/DESIGN.md §12.3): per-day ship clock, all-aboard, warning period and itinerary changes. */
@Composable
fun DaysTab(vm: CruiseViewModel) {
    val days = vm.read { itinerary() }
    val bundle = vm.read { bundle() }
    val settings = vm.read { settings() }
    var open by rememberSaveable { mutableStateOf<String?>(null) }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Note("Changes save as you make them.") }
        items(days) { d ->
            val v = SettingsRules.dayView(bundle, d, settings)
            DayCard(vm, d, v, expanded = open == d.date, onToggle = { open = if (open == d.date) null else d.date })
        }
        item { Note("") }
    }
}

private fun mmText(m: Int?): String = if (m == null) "none" else CruiseData.clock(m)

@Composable
private fun DayCard(vm: CruiseViewModel, d: ItineraryDay, v: SettingsRules.DayView, expanded: Boolean, onToggle: () -> Unit) {
    fun set(field: String, value: JsonElement?) = vm.edit {
        val cur = (settings()["days"] as? JsonObject)?.get(d.date) as? JsonObject
        saveDay(d.date, SettingsRules.setDayField(cur, d, field, value))
    }
    Card(Modifier.fillMaxWidth().clickable { onToggle() }) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Day ${d.day} · ${CruiseData.sailText(d.date)}", style = MaterialTheme.typography.labelLarge)
            Text(v.port.ifBlank { "Day ${d.day}" } + if (v.tender) "  (tender)" else "", style = MaterialTheme.typography.titleMedium)
            val summary = when {
                v.allAboard != null -> "All aboard ${mmText(v.allAboard)}" + if (v.edited) " · Edited" else ""
                else -> v.type.lowercase().replaceFirstChar { it.uppercase() } + if (v.edited) " · Edited" else ""
            }
            Text(summary)
            if (!expanded) return@Column

            // Ship clock vs local clock.
            val offset = v.set["offset"]?.let { (it as? JsonPrimitive)?.content?.toIntOrNull() } ?: 0
            Text("Local time vs ship: ${SettingsRules.offsetText(offset)}", style = MaterialTheme.typography.titleSmall)
            Stepper("30 min", onMinus = { set("offset", JsonPrimitive(offset - 30).takeIf { offset - 30 != 0 }) },
                onPlus = { set("offset", JsonPrimitive(offset + 30).takeIf { offset + 30 != 0 }) })

            if (v.type != "DEBARK" && v.type != "CRUISING") {
                Text("All aboard", style = MaterialTheme.typography.titleSmall)
                v.departMinutes?.let { Note("Ship leaves ${mmText(it)} (port time)") }
                if (v.royalGangway) {
                    val shift = (v.set["shift"] as? JsonPrimitive)?.content?.toIntOrNull() ?: 0
                    Note("Royal's gangway time, shifted ${if (shift == 0) "not at all" else "$shift min"}")
                    Stepper("5 min", onMinus = { if (shift > -SettingsRules.MAX_SHIFT) set("shift", JsonPrimitive(shift - 5).takeIf { shift - 5 != 0 }) },
                        onPlus = { if (shift < SettingsRules.MAX_SHIFT) set("shift", JsonPrimitive(shift + 5).takeIf { shift + 5 != 0 }) })
                } else {
                    val buffer = (v.set["buffer"] as? JsonPrimitive)?.content?.toIntOrNull() ?: SettingsRules.defaultBuffer(v.type)
                    Note("Minutes before departure")
                    Choice(SettingsRules.BUFFERS, buffer, { "$it min" }) { b ->
                        set("buffer", JsonPrimitive(b).takeIf { b != SettingsRules.defaultBuffer(v.type) })
                    }
                }
                ExactTime(v.set["allAboard"].let { (it as? JsonPrimitive)?.content }, onSet = { set("allAboard", it?.let { t -> JsonPrimitive(t) }) })
                Text("Warning period", style = MaterialTheme.typography.titleSmall)
                Note("The first alert buzzes ${v.warn} minutes before all aboard.")
                Choice(SettingsRules.WARN_PERIODS, v.warn, { "$it min" }) { w ->
                    set("warn", JsonPrimitive(w).takeIf { w != SettingsRules.defaultBuffer(v.type) })
                }
                if (v.tender) Note("Tender port. Boats back to the ship can have long lines, so the warning period is 60 minutes today. Make it longer if you like.")
            }

            ItineraryEdit(d, v, onEdit = { edit -> set("edit", edit) })
            if (v.edited) TextButton({ vm.edit { saveDay(d.date, null) } }) { Text("Reset this day") }
        }
    }
}

@Composable
private fun Stepper(unit: String, onMinus: () -> Unit, onPlus: () -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(onMinus) { Text("− $unit") }
        OutlinedButton(onPlus) { Text("+ $unit") }
    }
}

/** An exact all-aboard time (wins over the buffer and Royal's time), `HH:MM` 24 h. */
@Composable
private fun ExactTime(current: String?, onSet: (String?) -> Unit) {
    var text by remember(current) { mutableStateOf(current ?: "") }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(text, { text = it.take(5) }, label = { Text("Exact time (24 h, e.g. 16:30)") }, singleLine = true,
            modifier = Modifier.weight(1f), isError = text.isNotEmpty() && !isHhmm(text))
        TextButton({ onSet(text.takeIf { isHhmm(it) }) },
            enabled = text.isEmpty() && current != null || isHhmm(text)) {
            Text(if (text.isEmpty()) "Clear" else "Set")
        }
    }
}

/** Change itinerary: a skipped or added port, or changed times. Only differences from Royal's day are kept. */
@Composable
private fun ItineraryEdit(d: ItineraryDay, v: SettingsRules.DayView, onEdit: (JsonObject?) -> Unit) {
    var open by rememberSaveable(d.date) { mutableStateOf(false) }
    OutlinedButton({ open = !open }) { Text(if (open) "Hide itinerary changes" else "Change itinerary") }
    if (open) ItineraryFields(d, v, onEdit)
}

@Composable
private fun ItineraryFields(d: ItineraryDay, v: SettingsRules.DayView, onEdit: (JsonObject?) -> Unit) {
    var port by remember(v.port) { mutableStateOf(v.port) }
    var arrive by remember(v.arrive) { mutableStateOf(v.arrive ?: "") }
    var depart by remember(v.depart) { mutableStateOf(v.depart ?: "") }
    fun cur(): MutableMap<String, JsonElement> = LinkedHashMap((v.set["edit"] as? JsonObject) ?: emptyMap())
    Note("Royal lists: ${d.type.lowercase()}, ${d.port}")
    Choice(SettingsRules.DAY_TYPES, v.type, { it.lowercase().replaceFirstChar { c -> c.uppercase() } }) { t ->
        onEdit(JsonObject(cur().also { it["type"] = JsonPrimitive(t) }))
    }
    OutlinedTextField(port, { port = it.take(60) }, label = { Text("Port") }, singleLine = true, modifier = Modifier.fillMaxWidth())
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(arrive, { arrive = it.take(5) }, label = { Text("Arrive HH:MM") }, singleLine = true, modifier = Modifier.weight(1f),
            isError = arrive.isNotEmpty() && !isHhmm(arrive))
        OutlinedTextField(depart, { depart = it.take(5) }, label = { Text("Depart HH:MM") }, singleLine = true, modifier = Modifier.weight(1f),
            isError = depart.isNotEmpty() && !isHhmm(depart))
    }
    val valid = (arrive.isEmpty() || isHhmm(arrive)) && (depart.isEmpty() || isHhmm(depart))
    TextButton(onClick = {
        val e = cur()
        e["port"] = JsonPrimitive(port.trim())
        e["arrive"] = if (arrive.isEmpty()) JsonNull else JsonPrimitive(arrive)
        e["depart"] = if (depart.isEmpty()) JsonNull else JsonPrimitive(depart)
        onEdit(JsonObject(e))
    }, enabled = valid) { Text("Save itinerary change") }
}
