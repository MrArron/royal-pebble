package io.github.mrarron.royalpricecheck

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

class MainActivity : ComponentActivity() {
    private val vm: MainViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            val dark = isSystemInDarkTheme()
            val scheme = if (Build.VERSION.SDK_INT >= 31) {
                if (dark) dynamicDarkColorScheme(this) else dynamicLightColorScheme(this)
            } else if (dark) darkColorScheme() else lightColorScheme()
            MaterialTheme(colorScheme = scheme) { AppScreen(vm, dark) }
        }
    }
}

@Composable
private fun AppScreen(vm: MainViewModel, dark: Boolean) {
    var tab by rememberSaveable { mutableIntStateOf(if (vm.hasConfig) 0 else 3) }
    val titles = listOf("Summary", "Log", "Account", "Settings", "Cruise")

    val askNotifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= 33) askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    Scaffold { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            TabRow(selectedTabIndex = tab) {
                titles.forEachIndexed { i, t -> Tab(selected = tab == i, onClick = { tab = i }, text = { Text(t) }) }
            }
            when (tab) {
                0 -> SummaryTab(vm)
                1 -> LogTab(vm, dark)
                2 -> AccountTab(vm)
                4 -> io.github.mrarron.royalpricecheck.cruise.CruiseHost(
                    androidx.lifecycle.viewmodel.compose.viewModel<io.github.mrarron.royalpricecheck.cruise.CruiseViewModel>(),
                )
                else -> SettingsTab(vm)
            }
        }
    }
}

@Composable
private fun SummaryTab(vm: MainViewModel) {
    val r = vm.result
    LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Button(onClick = vm::runNow, enabled = !vm.running && vm.hasConfig) {
                    Text(if (vm.running) "Checking…" else "Run now")
                }
                if (vm.running) CircularProgressIndicator(Modifier.padding(4.dp))
            }
            if (!vm.hasConfig) Text("Enter your account on the Account tab first.")
            vm.status?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
        if (r == null) {
            item { Text("No check has run yet.") }
            return@LazyColumn
        }
        item {
            val when_ = java.text.DateFormat.getDateTimeInstance().format(java.util.Date(r.finishedAt))
            Text(
                if (r.ok) "Last check: $when_ (${r.itemsChecked} items)" else "Last check failed: $when_\n${r.error ?: ""}",
                color = if (r.ok) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.error,
            )
            if (r.script.isNotBlank()) Text("Script: ${r.script}", style = MaterialTheme.typography.bodySmall)
        }
        if (r.alerts.isNotEmpty()) {
            item { Text("Rebook to save", style = MaterialTheme.typography.titleMedium) }
            items(r.alerts) { DropCard(it) }
        }
        item { Text("Bookings", style = MaterialTheme.typography.titleMedium) }
        items(r.bookings) { b ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp)) {
                    Text("${b.shipName} · ${prettyDate(b.sailDate)}", style = MaterialTheme.typography.titleSmall)
                    Text("Check-in: ${b.checkinLabel}")
                    if (b.stateroom.isNotBlank()) Text("Stateroom: ${b.stateroom}")
                    if (b.finalPaymentDate.isNotBlank()) Text("Final payment: ${prettyDate(b.finalPaymentDate)}")
                    b.balanceDue?.let { Text(if (it) "Balance due" else "Paid in full") }
                }
            }
        }
        if (r.guestCheckin.isNotEmpty()) {
            item { Text("Check-in by guest", style = MaterialTheme.typography.titleMedium) }
            items(r.guestCheckin) { g ->
                Text(g.status + if (g.window.isNotBlank()) "\nBoarding window: ${g.window}" else "")
            }
        }
        val others = r.drops.filter { !it.alert }
        if (others.isNotEmpty()) {
            item { Text("Other price drops", style = MaterialTheme.typography.titleMedium) }
            items(others) { DropCard(it) }
        }
    }
}

@Composable
private fun DropCard(d: PriceDrop) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp)) {
            Text(d.itemName, style = MaterialTheme.typography.titleSmall)
            if (d.alert) {
                Text(
                    if (d.decision == "rebook") "Rebook" else "Consider rebooking",
                    color = MaterialTheme.colorScheme.primary,
                    style = MaterialTheme.typography.labelLarge,
                )
            }
            Text(d.guestName)
            Text(
                "Paid ${Notifier.money(d.paid, d.currency)} → now ${Notifier.money(d.current, d.currency)} " +
                    "(save ${Notifier.money(d.saving, d.currency)}${if (d.perNight) " per night" else ""})",
            )
        }
    }
}

@Composable
private fun LogTab(vm: MainViewModel, dark: Boolean) {
    val state = androidx.compose.foundation.lazy.rememberLazyListState()
    LaunchedEffect(vm.log.size) { if (vm.log.isNotEmpty()) state.scrollToItem(vm.log.size - 1) }
    LazyColumn(Modifier.fillMaxSize().padding(8.dp), state = state) {
        if (vm.log.isEmpty()) item { Text("The script's output appears here while a check runs.") }
        items(vm.log) { Text(ansiToAnnotated(it, dark), fontFamily = FontFamily.Monospace, fontSize = 11.sp) }
    }
}

@Composable
private fun AccountTab(vm: MainViewModel) {
    var user by rememberSaveable { mutableStateOf("") }
    var pass by rememberSaveable { mutableStateOf("") }
    var line by rememberSaveable { mutableStateOf("royal") }
    var yaml by remember(vm.config) { mutableStateOf(vm.config) }
    Column(Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Quick setup", style = MaterialTheme.typography.titleMedium)
        OutlinedTextField(user, { user = it }, label = { Text("Royal Caribbean username") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(
            pass, { pass = it }, label = { Text("Password") }, singleLine = true,
            visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth(),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(line == "royal", { line = "royal" }, label = { Text("Royal Caribbean") })
            FilterChip(line == "celebrity", { line = "celebrity" }, label = { Text("Celebrity") })
        }
        Button(onClick = { vm.saveSimple(user, pass, line); pass = "" }, enabled = user.isNotBlank() && pass.isNotEmpty()) {
            Text("Save account")
        }
        Text(
            "Your password is never written to config.yaml. It stays in memory until you close the app. " +
                "Only while background checks are on, it is also saved encrypted with the Android Keystore; " +
                "turning them off deletes it.",
            style = MaterialTheme.typography.bodySmall,
        )
        if (vm.missingPasswords.isNotEmpty()) PasswordPrompt(vm)
        Text("Advanced: config.yaml", style = MaterialTheme.typography.titleMedium)
        Text("Stored only in this app's private storage. The full options are in the price checker's docs.", style = MaterialTheme.typography.bodySmall)
        OutlinedTextField(yaml, { yaml = it }, modifier = Modifier.fillMaxWidth(), minLines = 8, textStyle = androidx.compose.ui.text.TextStyle(fontFamily = FontFamily.Monospace, fontSize = 12.sp))
        OutlinedButton(onClick = { vm.saveConfig(yaml) }) { Text("Save config") }
        vm.status?.let { Text(it) }
    }
}

@Composable
private fun PasswordPrompt(vm: MainViewModel) {
    val typed = remember(vm.missingPasswords) { mutableStateMapOf<Int, String>() }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Password needed", style = MaterialTheme.typography.titleSmall)
            Text("The app was restarted, so the password is gone from memory. Enter it again.", style = MaterialTheme.typography.bodySmall)
            vm.missingPasswords.forEach { i ->
                OutlinedTextField(
                    typed[i] ?: "", { typed[i] = it }, label = { Text("Password for account ${i + 1}") },
                    singleLine = true, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth(),
                )
            }
            Button(
                onClick = { vm.enterPasswords(typed.filterValues { it.isNotEmpty() }.toMap()); typed.clear() },
                enabled = typed.values.any { it.isNotEmpty() },
            ) { Text("Use password") }
        }
    }
}

@Composable
private fun SettingsTab(vm: MainViewModel) {
    Column(Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Background checks", style = MaterialTheme.typography.titleMedium)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(0 to "Off", 6 to "6 h", 12 to "12 h", 24 to "24 h").forEach { (h, label) ->
                FilterChip(vm.autoHours == h, { vm.changeAutoHours(h) }, label = { Text(label) })
            }
        }
        Text("Checks run only with a network connection. Keep them at 6 hours or slower to be gentle with Royal's servers. You are told only about things that are new since the last check.", style = MaterialTheme.typography.bodySmall)
        Text("Background checks save your password encrypted with the Android Keystore. Turning them off deletes it.", style = MaterialTheme.typography.bodySmall)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Switch(vm.useLatest, vm::changeUseLatest)
            Text("Use the newest downloaded script when available")
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Switch(vm.followUpstream, vm::changeFollowUpstream)
            Text("Advanced: follow jdeath's main branch directly (not verified by Royal Pebble)")
        }
        OutlinedButton(onClick = vm::updateScript) { Text("Update script now") }
        vm.status?.let { Text(it) }
        if (vm.scriptVersion.isNotBlank()) Text("Downloaded script: ${vm.scriptVersion}", style = MaterialTheme.typography.bodySmall)
        Text("Bundled script: ${BuildConfig.UPSTREAM_VERSION}", style = MaterialTheme.typography.bodySmall)
        Text("App ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodySmall)
        io.github.mrarron.royalpricecheck.watch.WatchCard()
    }
}
