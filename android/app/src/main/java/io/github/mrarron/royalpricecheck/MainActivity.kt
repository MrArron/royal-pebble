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
        takeShared(intent)
        setContent {
            val dark = isSystemInDarkTheme()
            io.github.mrarron.royalpricecheck.ui.RoyalTheme(dark) { AppShell(vm, dark) }
        }
    }

    override fun onResume() {
        super.onResume()
        vm.update.permissionMayHaveChanged()
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        takeShared(intent)
    }

    /** Share > Royal Pebble with a Cruise Planner link: Settings > Price watches opens with it filled in. */
    private fun takeShared(intent: android.content.Intent?) {
        if (intent?.action != android.content.Intent.ACTION_SEND) return
        val text = intent.getStringExtra(android.content.Intent.EXTRA_TEXT) ?: return
        if (io.github.mrarron.royalpebble.alerts.ProductLink.parse(text) != null) vm.sharedLink = text.trim()
        else vm.sharedLink = null
    }
}

@Composable
internal fun SummaryTab(vm: MainViewModel) {
    val r = vm.result
    androidx.compose.foundation.text.selection.SelectionContainer {
    LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Button(onClick = vm::runNow, enabled = !vm.running && vm.hasConfig) {
                    Text(if (vm.running) "Checking…" else "Run now")
                }
                if (vm.running) CircularProgressIndicator(Modifier.padding(4.dp))
            }
            if (!vm.hasConfig) Text("Add your Royal account in Settings first.")
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
            ReportButtons("price check report", "royal-pebble-price-report.txt") { ReportShare.summaryText(r) }
        }
        if (r.alerts.isNotEmpty()) {
            item { Text("Rebook to save", style = MaterialTheme.typography.titleMedium) }
            items(r.alerts) { DropCard(it, vm) }
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
            items(others) { DropCard(it, null) }
        }
    }
    }
}

@Composable
private fun DropCard(d: PriceDrop, vm: MainViewModel?) {
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
            if (vm != null) {
                val muted = vm.mutes.any { it.key == d.muteKey }
                OutlinedButton({ vm.setMuted(d.muteKey, "${d.itemName} (${d.guestName})", !muted) }) {
                    Text(if (muted) "Unmute alerts for this item" else "Mute alerts for this item")
                }
            }
        }
    }
}

@Composable
internal fun LogTab(vm: MainViewModel, dark: Boolean) {
    val state = androidx.compose.foundation.lazy.rememberLazyListState()
    LaunchedEffect(vm.log.size) { if (vm.log.isNotEmpty()) state.scrollToItem(vm.log.size - 1) }
    Column(Modifier.fillMaxSize()) {
        if (vm.log.isNotEmpty() && !vm.running) {
            Column(Modifier.padding(start = 8.dp, end = 8.dp, top = 8.dp)) {
                ReportButtons("price check output", "royal-pebble-price-output.txt") { ReportShare.logText(vm.log.toList()) }
            }
        }
        androidx.compose.foundation.text.selection.SelectionContainer(Modifier.weight(1f)) {
            LazyColumn(Modifier.fillMaxSize().padding(8.dp), state = state) {
                if (vm.log.isEmpty()) item { Text("The script's output appears here while a check runs.") }
                items(vm.log) { Text(ansiToAnnotated(it, dark), fontFamily = FontFamily.Monospace, fontSize = 11.sp) }
            }
        }
    }
}

@Composable
internal fun AccountTab(vm: MainViewModel) {
    var user by rememberSaveable { mutableStateOf(vm.accountEmail ?: "") }
    var pass by rememberSaveable { mutableStateOf("") }
    var line by rememberSaveable { mutableStateOf("royal") }
    var keepLogin by rememberSaveable { mutableStateOf(vm.accountRemembered) }
    var yaml by remember(vm.config) { mutableStateOf(vm.config) }
    Column(Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Royal account", style = MaterialTheme.typography.titleMedium)
        val email = vm.accountEmail
        Text(
            when {
                email == null -> "Not set. One login for the price check and for Cruise > Download with your Royal login."
                vm.accountReady -> "Signed in as ${RoyalAccount.masked(email)}" + (if (vm.accountRemembered) ", remembered on this phone." else ", until you close the app.") +
                    " Used by the price check and by Cruise downloads."
                else -> "${RoyalAccount.masked(email)}: enter the password again (the app was closed and it wasn't remembered)."
            },
        )
        OutlinedTextField(user, { user = it }, label = { Text("Royal Caribbean email or username") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(
            pass, { pass = it }, label = { Text("Password") }, singleLine = true,
            visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth(),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(line == "royal", { line = "royal" }, label = { Text("Royal Caribbean") })
            FilterChip(line == "celebrity", { line = "celebrity" }, label = { Text("Celebrity") })
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            androidx.compose.material3.Checkbox(keepLogin, { keepLogin = it })
            Text("Remember on this phone (encrypted with the Android Keystore)", Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { vm.saveAccount(user, pass, line, keepLogin); pass = "" }, enabled = user.isNotBlank() && pass.isNotEmpty()) {
                Text("Save account")
            }
            if (email != null) OutlinedButton(onClick = { vm.forgetAccount(); pass = ""; keepLogin = false }) { Text("Forget login") }
        }
        Text(
            "Your password is never written to config.yaml. It stays in memory until you close the app, and is saved " +
                "encrypted with the Android Keystore only if you tick Remember (or while background checks are on, " +
                "for the price check). Cruise downloads with your login work for Royal Caribbean accounts only.",
            style = MaterialTheme.typography.bodySmall,
        )
        // The app's own config.yaml is the account above; its password is typed there.
        if (vm.missingPasswords.isNotEmpty() && RoyalAccount.parseSimple(vm.config) == null) PasswordPrompt(vm)
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

/** Settings > Price checks: background checks, on board, watch alerts, script updates. */
@Composable
internal fun PriceChecksPage(vm: MainViewModel) {
    Column(Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Background checks", style = MaterialTheme.typography.titleMedium)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(0 to "Off", 6 to "6 h", 12 to "12 h", 24 to "24 h").forEach { (h, label) ->
                FilterChip(vm.autoHours == h, { vm.changeAutoHours(h) }, label = { Text(label) })
            }
        }
        Text("Checks run only with a network connection. Keep them at 6 hours or slower to be gentle with Royal's servers. You are told only about things that are new since the last check.", style = MaterialTheme.typography.bodySmall)
        Text("Background checks save your password encrypted with the Android Keystore. Turning them off deletes it.", style = MaterialTheme.typography.bodySmall)
        val c = androidx.compose.ui.platform.LocalContext.current
        var atSea by remember { mutableStateOf(AppPhase.checksAtSea(c)) }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Switch(atSea, { v -> atSea = v; AppPhase.setChecksAtSea(c, v) })
            Text("Keep checking while on board")
        }
        Text("Off: background checks pause while the app is in On board mode (there's often no internet at sea), and start again after the cruise. Check now still works.", style = MaterialTheme.typography.bodySmall)
        var refresh by remember { mutableStateOf(io.github.mrarron.royalpricecheck.cruise.ScheduleRefresh.enabled(c)) }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Switch(refresh, { v -> refresh = v; io.github.mrarron.royalpricecheck.cruise.ScheduleRefresh.setEnabled(c, v) })
            Text("Also refresh the schedule")
        }
        Text("Each background check also downloads your sailing again with your remembered Royal login, so moved or cancelled events, their stars and new bookings reach the watch. From 21 days before sailing to the last day, at most every 6 hours, and paused on board like the price checks. The watch gets it right away when App serves the watch is on. When the daily schedule is first posted, or a lot more of it appears, you get a Schedule is up alert on the phone and the watch.", style = MaterialTheme.typography.bodySmall)
        OutlinedButton(onClick = { CheckWorker.runOnce(c) }) { Text("Run a background check now") }
        Text("Watch alerts", style = MaterialTheme.typography.titleMedium)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Switch(vm.watchAlerts, vm::changeWatchAlerts)
            Text("Send new price drops, price watches, check-in changes and payment reminders to my Pebble")
        }
        Text("Each alert is sent once, after a check finds it. If Royal Pebble isn't open on the watch, the alert waits for the next check. Needs Royal Pebble 1.6.20 or later on the watch.", style = MaterialTheme.typography.bodySmall)
        AlertHoursSection(vm)
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
    }
}
