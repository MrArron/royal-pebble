package io.github.mrarron.royalpricecheck.cruise

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import io.github.mrarron.royalpricecheck.ui.ChipKind
import io.github.mrarron.royalpricecheck.ui.StatusChip
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import io.github.mrarron.royalpebble.settings.CruiseData
import io.github.mrarron.royalpebble.settings.SettingsRules

/** Settings > Me (docs/DESIGN.md §12.6): cabin details, units, theme, reminders. */
@Composable
fun MeTab(vm: CruiseViewModel) {
    val settings = vm.read { settings() }
    val me = vm.read { me() }
    val booking = vm.read { booking() }
    // Fields start from what is saved; "Use booking" brings in what Royal's booking says.
    var stateroom by remember(me["stateroom"]) { mutableStateOf(me["stateroom"] ?: "") }
    var deck by remember(me["deck"]) { mutableStateOf(me["deck"] ?: "") }
    var stairs by remember(me["stairs"]) { mutableStateOf(me["stairs"] ?: "") }
    var muster by remember(me["muster"]) { mutableStateOf(me["muster"] ?: "") }
    var dining by remember(me["dining"]) { mutableStateOf(me["dining"] ?: "") }
    var units by remember(settings) { mutableStateOf(SettingsRules.units(settings)) }
    var theme by remember(settings) { mutableStateOf(SettingsRules.theme(settings)) }
    var lead by remember(settings) { mutableStateOf(SettingsRules.reminderLead(settings)) }
    var reserveAt by remember(settings) { mutableStateOf(SettingsRules.reserveAlertAt(settings)) }
    var hints by remember(settings) { mutableStateOf(SettingsRules.alwaysHints(settings)) }
    var saved by remember { mutableStateOf(false) }

    // The Save pill at the top right of the screen holds this screen's save.
    val control = LocalSave.current
    val doSave = {
        vm.edit {
            saveMe(mapOf("stateroom" to stateroom, "deck" to deck, "stairs" to stairs, "muster" to muster, "dining" to dining))
            saveBasics(theme, lead, reserveAt, units, hints)
        }
        saved = true
    }
    SideEffect { control.action = if (saved) null else doSave }
    DisposableEffect(Unit) { onDispose { control.action = null } }

    Page {
        Section("Stateroom and muster") {
            OutlinedTextField(stateroom, { stateroom = it.filter { c -> c.isDigit() }.take(6); saved = false }, label = { Text("Stateroom") },
                singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth(),
                supportingText = { Text(if (stateroom.isEmpty()) "Not assigned yet, or not set" else "Used for directions from your cabin") })
            SourceRow(stateroom, booking?.stateroom, "no cabin assigned yet") { stateroom = it; saved = false }
            OutlinedTextField(deck, { deck = it.take(30); saved = false }, label = { Text("Deck (e.g. Deck 9)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            booking?.deck?.takeIf { it.isNotBlank() }?.let { b -> if (b.all { c -> c.isDigit() }) "Deck $b" else b }.let { b ->
                SourceRow(deck, b, "no deck") { deck = it; saved = false }
            }
            OutlinedTextField(stairs, { stairs = it.take(40); saved = false }, label = { Text("Nearest stairs") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(muster, { muster = it.take(40); saved = false }, label = { Text("Muster station") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            SourceRow(muster, booking?.muster, "no muster station") { muster = it; saved = false }
            OutlinedTextField(dining, { dining = it.take(40); saved = false }, label = { Text("Main dining room") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        }
        Section("Walking distances") {
            Choice(SettingsRules.UNITS, units, { when (it) { "m" -> "Metres"; "ft" -> "Feet"; else -> "Steps" } }) { units = it; saved = false }
        }
        Section("Theme") {
            Choice(listOf("light", "dark"), theme, { it.replaceFirstChar { c -> c.uppercase() } }) { theme = it; saved = false }
            WatchThemePreview(dark = theme == "dark")
            SwitchRow("Always show button hints", hints, { hints = it; saved = false }, "On Home, at every open.")
        }
        Section("Alerts") {
            Text("Reminder lead time")
            Choice(SettingsRules.REMINDER_LEADS, lead, { "$it min" }) { lead = it; saved = false }
            Text("Evening reminder to reserve")
            Choice(SettingsRules.RESERVE_ALERT_TIMES, reserveAt, { CruiseData.clock(it).replace(":00 ", " ") }) { reserveAt = it; saved = false }
        }
        Note("The ship's cabin table and map lookups (deck and nearest stairs from your cabin number) are still done by the Pebble app's settings page.")
    }
}

/**
 * `From booking` when the field holds what Royal's booking says, `Edited` when it
 * doesn't. An edit is kept, never refilled by itself; Use booking brings the booking value back
 * (docs/DESIGN.md §12.1).
 */
@Composable
private fun SourceRow(value: String, booking: String?, missing: String, onUse: (String) -> Unit) {
    val b = booking?.takeIf { it.isNotBlank() }
    if (value.isEmpty() && b == null) return
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        if (b != null && value == b) StatusChip("From booking")
        else if (value.isNotEmpty() || b != null) {
            StatusChip("Edited", ChipKind.Edited)
            Note("Your change is kept. Booking says ${b ?: missing}")
            if (b != null) TextButton({ onUse(b) }) { Text("Use booking") }
        }
    }
}

/** A dark card showing the watch's colours for the chosen theme (docs/DESIGN.md §2, watch tokens). */
@Composable
private fun WatchThemePreview(dark: Boolean) {
    val bg = if (dark) Color.Black else Color.White
    val text = if (dark) Color.White else Color.Black
    val muted = if (dark) Color(0xFFAAAAAA) else Color(0xFF555555)
    val sea = if (dark) Color(0xFF00AAFF) else Color(0xFF0055AA)
    val port = if (dark) Color(0xFFFFAA00) else Color(0xFFAA5500)
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(bg).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text("NEXT", color = sea, style = MaterialTheme.typography.labelLarge)
        Text("Welcome aboard show", color = text, style = MaterialTheme.typography.titleMedium)
        Text("7:30 PM · Royal Theater", color = muted, style = MaterialTheme.typography.bodyMedium)
        Text("ALL ABOARD IN 2:10", color = port, style = MaterialTheme.typography.labelLarge)
    }
}
