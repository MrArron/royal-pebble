package io.github.mrarron.royalpricecheck.cruise

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import io.github.mrarron.royalpebble.settings.CruiseData
import io.github.mrarron.royalpebble.settings.Readiness
import kotlinx.serialization.json.JsonPrimitive

/** Settings > Cruise (docs/DESIGN.md §12.2): download, download with login, ready to sail, backup paste. */
@Composable
fun CruiseTab(vm: CruiseViewModel, goTo: (Int) -> Unit) {
    LaunchedEffect(Unit) { vm.loadShips() }
    val sailing = vm.read { store.sailing() }
    val status = vm.read { store.status() }
    val demo = vm.read { isDemo }
    Page {
        if (demo) {
            Section("Demo mode") {
                Text("You're looking at a made-up cruise, so every screen has something to try. Download your sailing below to replace it. Settings you save now are kept.")
            }
        }
        if (sailing != null) {
            Section("Your sailing") {
                Text("${sailing.shipName} · sails ${CruiseData.sailText(sailing.sailDate)}", style = MaterialTheme.typography.titleSmall)
                Text("${sailing.days} days, ${sailing.events} events" + if (sailing.events == 0) " (schedule not published yet)" else "")
                Text(if (sailing.hasBooking) "Booking details saved on this phone." else "No booking details. Use Download with your Royal login for stateroom, excursions and port times.")
            }
        }
        val statusError = (status["error"] as? JsonPrimitive)?.content
        if (statusError != null) {
            Section((status["title"] as? JsonPrimitive)?.content ?: "Last download failed") {
                ErrorText(statusError)
                (status["at"] as? JsonPrimitive)?.content?.let { Note(it) }
            }
        }
        DownloadCard(vm)
        if (sailing != null) ReadyCard(vm, goTo)
        BackupCard(vm)
    }
}

@Composable
private fun DownloadCard(vm: CruiseViewModel) {
    var shipMenu by remember { mutableStateOf(false) }
    var dateMenu by remember { mutableStateOf(false) }
    var loginOpen by rememberSaveable { mutableStateOf(false) }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var keepLogin by rememberSaveable { mutableStateOf(false) }
    val saved = remember(vm.version) { vm.savedLogin() }
    LaunchedEffect(saved) {
        // Offer the login kept for this session or saved on the phone.
        if (saved != null && email.isEmpty()) { email = saved.first; password = saved.second; keepLogin = vm.hasSavedLogin() }
    }

    Section("Download your sailing") {
        vm.shipsError?.let { ErrorText(it) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(Modifier.weight(1f)) {
                OutlinedButton(onClick = { shipMenu = true }, modifier = Modifier.fillMaxWidth(), enabled = vm.ships.isNotEmpty()) {
                    Text(vm.selectedShip?.name ?: if (vm.ships.isEmpty()) "Loading ships…" else "Choose a ship")
                }
                DropdownMenu(shipMenu, { shipMenu = false }) {
                    vm.ships.forEach { s -> DropdownMenuItem(text = { Text(s.name) }, onClick = { shipMenu = false; vm.selectShip(s) }) }
                }
            }
            if (vm.shipsError != null) TextButton({ vm.loadShips(true) }) { Text("Retry") }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(Modifier.weight(1f)) {
                OutlinedButton(onClick = { dateMenu = true }, modifier = Modifier.fillMaxWidth(), enabled = vm.sailDates.isNotEmpty()) {
                    Text(vm.selectedDate?.let { CruiseData.sailText(it) } ?: if (vm.sailingsLoading) "Loading sailings…" else "Choose a sailing")
                }
                DropdownMenu(dateMenu, { dateMenu = false }) {
                    vm.sailDates.forEach { d -> DropdownMenuItem(text = { Text(CruiseData.sailText(d)) }, onClick = { dateMenu = false; vm.selectDate(d) }) }
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Button(onClick = { vm.download() }, enabled = vm.canDownload) { Text("Download") }
            if (vm.busy) CircularProgressIndicator(Modifier.padding(4.dp))
        }
        vm.message?.let { Text(it) }
        vm.error?.let { ErrorText(it) }
        Note("Sailings list the schedule from about two weeks out. This needs the internet once; the watch works offline afterwards.")

        OutlinedButton(onClick = { loginOpen = !loginOpen }) {
            Text(if (loginOpen) "Hide advanced download" else "Advanced: download with your Royal login")
        }
        if (loginOpen) {
            OutlinedTextField(email, { email = it }, label = { Text("Royal Caribbean email") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), modifier = Modifier.fillMaxWidth())
            OutlinedTextField(password, { password = it }, label = { Text("Password") }, singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), modifier = Modifier.fillMaxWidth())
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Checkbox(keepLogin, { keepLogin = it })
                Text("Remember on this phone (encrypted with the Android Keystore)", Modifier.weight(1f))
            }
            Button(
                onClick = { vm.download(email, password, keepLogin) },
                enabled = vm.canDownload && email.isNotBlank() && password.isNotEmpty(),
            ) { Text("Download with login") }
            if (vm.hasSavedLogin()) TextButton({ vm.forgetLogin(); password = ""; keepLogin = false }) { Text("Forget the saved login") }
            Note("Your email and password go from this app to Royal Caribbean only, to sign in for this one download. " +
                "They are never put in the usage log or sent anywhere else. Royal sends back your booking details " +
                "(stateroom, deck, muster station, terminal time, booked excursions and purchases); those are saved on " +
                "this phone like the rest of your cruise data. The password stays in memory until you close the app, " +
                "and is saved only if you tick Remember. This uses Royal's website sign-in, which Royal could change " +
                "without notice; if it stops working, use the Windows sync tool.")
        }
    }
}

@Composable
private fun ReadyCard(vm: CruiseViewModel, goTo: (Int) -> Unit) {
    val checks = vm.read {
        Readiness.checks(bundle(), settings(), stars(), me()["stateroom"] ?: booking()?.stateroom)
    }
    val left = checks.count { !it.ok }
    Section("READY TO SAIL?") {
        Text(if (left == 0) "You're ready to go offline" else "$left ${if (left == 1) "thing" else "things"} left before you go offline",
            style = MaterialTheme.typography.titleSmall)
        checks.forEach { c ->
            Column {
                Text((if (c.ok) "✓ " else "! ") + c.title, style = MaterialTheme.typography.bodyLarge)
                Note(c.text)
            }
        }
        if (checks.any { it.title.startsWith("Stateroom") && !it.ok }) TextButton({ goTo(4) }) { Text("Set it on the Me screen") }
        if (checks.any { it.title.startsWith("Too many") }) TextButton({ goTo(2) }) { Text("Hide categories") }
    }
}

@Composable
private fun BackupCard(vm: CruiseViewModel) {
    var open by rememberSaveable { mutableStateOf(false) }
    var text by rememberSaveable { mutableStateOf("") }
    var problem by remember { mutableStateOf<String?>(null) }
    var done by remember { mutableStateOf(false) }
    Section("Backup: paste cruise data") {
        OutlinedButton(onClick = { open = !open }) { Text(if (open) "Hide" else "Paste data from the Windows sync tool") }
        if (open) {
            OutlinedTextField(text, { text = it; problem = null; done = false }, label = { Text("Cruise data (JSON)") }, minLines = 4,
                modifier = Modifier.fillMaxWidth())
            Button(onClick = { problem = vm.pasteBundle(text); done = problem == null; if (done) text = "" }, enabled = text.isNotBlank()) {
                Text("Use this data")
            }
            problem?.let { ErrorText(it) }
            if (done) Text("Cruise data saved.")
        }
    }
}
