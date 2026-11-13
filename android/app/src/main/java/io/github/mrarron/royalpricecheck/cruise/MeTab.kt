package io.github.mrarron.royalpricecheck.cruise

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
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

    Page {
        Section("Stateroom and muster") {
            OutlinedTextField(stateroom, { stateroom = it.filter { c -> c.isDigit() }.take(6); saved = false }, label = { Text("Stateroom") },
                singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth(),
                supportingText = { Text(if (stateroom.isEmpty()) "Not assigned yet, or not set" else "Used for directions from your cabin") })
            booking?.stateroom?.takeIf { it != stateroom }?.let { b ->
                TextButton({ stateroom = b; saved = false }) { Text("Use booking") }
            }
            OutlinedTextField(deck, { deck = it.take(30); saved = false }, label = { Text("Deck (e.g. Deck 9)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            booking?.deck?.takeIf { it.isNotBlank() && "Deck $it" != deck && it != deck }?.let { b ->
                TextButton({ deck = if (b.all { c -> c.isDigit() }) "Deck $b" else b; saved = false }) { Text("Use booking") }
            }
            OutlinedTextField(stairs, { stairs = it.take(40); saved = false }, label = { Text("Nearest stairs") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(muster, { muster = it.take(40); saved = false }, label = { Text("Muster station") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            booking?.muster?.takeIf { it.isNotBlank() && it != muster }?.let { b ->
                TextButton({ muster = b; saved = false }) { Text("Use booking") }
            }
            OutlinedTextField(dining, { dining = it.take(40); saved = false }, label = { Text("Main dining room") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        }
        Section("Walking distances") {
            Choice(SettingsRules.UNITS, units, { when (it) { "m" -> "Metres"; "ft" -> "Feet"; else -> "Steps" } }) { units = it; saved = false }
        }
        Section("Theme") {
            Choice(listOf("light", "dark"), theme, { it.replaceFirstChar { c -> c.uppercase() } }) { theme = it; saved = false }
            SwitchRow("Always show button hints", hints, { hints = it; saved = false }, "On Home, at every open.")
        }
        Section("Alerts") {
            Text("Reminder lead time")
            Choice(SettingsRules.REMINDER_LEADS, lead, { "$it min" }) { lead = it; saved = false }
            Text("Evening reminder to reserve")
            Choice(SettingsRules.RESERVE_ALERT_TIMES, reserveAt, { CruiseData.clock(it).replace(":00 ", " ") }) { reserveAt = it; saved = false }
        }
        Button(onClick = {
            vm.edit {
                saveMe(mapOf("stateroom" to stateroom, "deck" to deck, "stairs" to stairs, "muster" to muster, "dining" to dining))
                saveBasics(theme, lead, reserveAt, units, hints)
            }
            saved = true
        }) { Text("Save") }
        if (saved) Text("Saved.")
        Note("The ship's cabin table and map lookups (deck and nearest stairs from your cabin number) are still done by the Pebble app's settings page.")
    }
}
