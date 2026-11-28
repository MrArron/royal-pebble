package io.github.mrarron.royalpricecheck

import android.Manifest
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.DirectionsBoat
import androidx.compose.material.icons.filled.Event
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Hotel
import androidx.compose.material.icons.filled.Sell
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import io.github.mrarron.royalpebble.settings.TripPhase
import io.github.mrarron.royalpricecheck.cruise.CruiseTab
import io.github.mrarron.royalpricecheck.cruise.CruiseViewModel
import io.github.mrarron.royalpricecheck.cruise.LocalSave
import io.github.mrarron.royalpricecheck.cruise.MeTab
import io.github.mrarron.royalpricecheck.cruise.ModeChips
import io.github.mrarron.royalpricecheck.cruise.PlanScreen
import io.github.mrarron.royalpricecheck.cruise.SaveControl
import io.github.mrarron.royalpricecheck.cruise.TodayScreen
import io.github.mrarron.royalpricecheck.cruise.TripHero
import io.github.mrarron.royalpricecheck.watch.WatchCard
import io.github.mrarron.royalpricecheck.watch.WatchHost

/** A bottom-bar destination. Planning shows Trip, Prices, Plan, Settings; On board shows Today, Events, Cabin, Settings. */
private enum class Dest(val label: String, val icon: ImageVector) {
    TRIP("Trip", Icons.Filled.DirectionsBoat),
    PRICES("Prices", Icons.Filled.Sell),
    PLAN("Plan", Icons.Filled.Star),
    TODAY("Today", Icons.Filled.Home),
    EVENTS("Events", Icons.Filled.Event),
    CABIN("Cabin", Icons.Filled.Hotel),
    SETTINGS("Settings", Icons.Filled.Settings),
}

private val PLANNING_TABS = listOf(Dest.TRIP, Dest.PRICES, Dest.PLAN, Dest.SETTINGS)
private val ONBOARD_TABS = listOf(Dest.TODAY, Dest.EVENTS, Dest.CABIN, Dest.SETTINGS)

/** A page opened from Settings (or a card), with a back arrow. */
private enum class Sub(val title: String) {
    ACCOUNT("Royal account"), CABIN("Me and my stateroom"), WATCH("Watch and logs"),
    PRICES("Prices"), ABOUT("About"),
}

/** The sections of Prices (a tab while planning, a Settings row on board): everything price-related in one place. */
internal enum class PriceSeg(val label: String) { SUMMARY("Summary"), WATCHES("Watches"), CHECKS("Checks"), REPORT("Report") }

/**
 * The app's one navigation (docs/DESIGN.md §13): a bottom bar whose tabs follow the
 * trip phase (TripPhase: Auto, Planning or On board, picked on Trip and Today), with
 * Settings as a list of pages. Replaces the old top tab row and the Cruise tab's own
 * bottom bar.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppShell(vm: MainViewModel, dark: Boolean) {
    val ctx = LocalContext.current
    val cvm: CruiseViewModel = viewModel()
    val askNotifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= 33) askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
    // Once a day while the app is open (switch in Settings > About); a failure is silent.
    LaunchedEffect(Unit) { vm.update.autoCheck() }

    var mode by remember { mutableStateOf(AppPhase.mode(ctx)) }
    // Recomputed after a mode pick or a cruise change (a download can start or end the sailing).
    val phase = remember(mode, cvm.version) { AppPhase.current(ctx) }
    val tabs = if (phase == TripPhase.Phase.ONBOARD) ONBOARD_TABS else PLANNING_TABS
    var tabName by rememberSaveable { mutableStateOf(tabs[0].name) }
    val tab = Dest.valueOf(tabName).takeIf { it in tabs } ?: tabs[0]
    var subName by rememberSaveable { mutableStateOf<String?>(null) }
    var segName by rememberSaveable { mutableStateOf(PriceSeg.SUMMARY.name) }
    val seg = PriceSeg.valueOf(segName)
    /** Opens Prices at [s]: the tab while planning, the Settings page on board. */
    val openPrices: (PriceSeg) -> Unit = { s ->
        segName = s.name
        if (Dest.PRICES in tabs) { subName = null; tabName = Dest.PRICES.name } else subName = Sub.PRICES.name
    }
    val sub = subName?.let { n -> runCatching { Sub.valueOf(n) }.getOrNull() }
    val save = remember { SaveControl() }
    val pickMode: (TripPhase.Mode) -> Unit = { m -> AppPhase.setMode(ctx, m); mode = m }

    BackHandler(sub != null) { subName = null }
    // A Cruise Planner link shared to the app opens Prices > Watches with it filled in.
    LaunchedEffect(vm.sharedLink) { if (vm.sharedLink != null) openPrices(PriceSeg.WATCHES) }
    // A refresh from Prices changed the shared Royal data: redraw Trip and the rest.
    LaunchedEffect(vm.syncTick) { if (vm.syncTick > 0) cvm.changed() }
    // Trip kept, switched or removed a sailing: the Prices picker follows.
    LaunchedEffect(cvm.version) { vm.sailingsChanged() }
    // Another screen can change the shared Royal login or config.yaml: pick it up on every move.
    LaunchedEffect(tab, sub) { vm.accountChanged(); vm.refreshAlerts(); save.action = null }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(sub?.title ?: tab.label) },
                navigationIcon = {
                    if (sub != null) IconButton({ subName = null }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                },
                actions = {
                    save.action?.let { a -> Button(onClick = a, modifier = Modifier.padding(end = 12.dp)) { Text("Save") } }
                },
            )
        },
        bottomBar = {
            if (sub == null) {
                NavigationBar {
                    tabs.forEach { d ->
                        NavigationBarItem(
                            selected = tab == d,
                            onClick = { tabName = d.name },
                            icon = { Icon(d.icon, contentDescription = null) },
                            label = { Text(d.label, maxLines = 1) },
                        )
                    }
                }
            }
        },
    ) { pad ->
        // Pull down to refresh (docs/DESIGN.md §13): Trip, Today and Prices, the screens that show Royal's data.
        val pullable = if (sub != null) sub == Sub.PRICES else tab == Dest.TRIP || tab == Dest.TODAY || tab == Dest.PRICES
        val body: @Composable () -> Unit = {
            CompositionLocalProvider(LocalSave provides save) {
                if (sub != null) {
                    when (sub) {
                        Sub.ACCOUNT -> AccountTab(vm)
                        Sub.CABIN -> MeTab(cvm)
                        Sub.WATCH -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) { WatchCard() }
                        Sub.PRICES -> PricesScreen(vm, dark, seg) { segName = it.name }
                        Sub.ABOUT -> AboutPage(vm.update)
                    }
                } else {
                    when (tab) {
                        Dest.TRIP -> CruiseTab(
                            cvm,
                            onCabin = { subName = Sub.CABIN.name },
                            onFilters = { tabName = Dest.PLAN.name },
                            header = {
                                ModeChips(mode, phase, pickMode)
                                TripHero(cvm)
                                RefreshHint(vm)
                                PriceGlance(vm, cvm.version, onOpen = { openPrices(PriceSeg.SUMMARY) }, onWatches = { openPrices(PriceSeg.WATCHES) })
                            },
                        )
                        Dest.PRICES -> PricesScreen(vm, dark, seg) { segName = it.name }
                        Dest.PLAN, Dest.EVENTS -> PlanScreen(cvm)
                        Dest.TODAY -> TodayScreen(cvm, mode, phase, pickMode, onEvents = { tabName = Dest.EVENTS.name },
                            watchStatus = remember(cvm.version) { WatchHost.status(ctx) }, top = { RefreshHint(vm) })
                        Dest.CABIN -> MeTab(cvm)
                        Dest.SETTINGS -> SettingsList(phase, vm.update.state, open = { subName = it.name })
                    }
                }
            }
        }
        Box(Modifier.padding(pad).fillMaxSize()) {
            if (pullable) {
                androidx.compose.material3.pulltorefresh.PullToRefreshBox(
                    isRefreshing = vm.refreshing, onRefresh = { vm.refresh() }, modifier = Modifier.fillMaxSize(),
                ) { body() }
            } else body()
        }
    }
}

/** The price check at a glance on Trip: last check, rebook alerts, the first booking's check-in. */
@Composable
private fun PriceGlance(vm: MainViewModel, tick: Int, onOpen: () -> Unit, onWatches: () -> Unit) {
    val r = vm.result
    io.github.mrarron.royalpricecheck.cruise.Section("Prices") {
        when {
            !vm.hasConfig -> Text("Add your Royal account in Settings to check prices and bookings.")
            r == null -> Text("No price check yet.")
            else -> {
                val at = java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.MEDIUM, java.text.DateFormat.SHORT).format(java.util.Date(r.finishedAt))
                Text(if (r.ok) "Last check $at" else "Last check failed $at")
                if (r.alerts.isNotEmpty()) Text("${r.alerts.size} ${if (r.alerts.size == 1) "drop" else "drops"} worth rebooking", color = MaterialTheme.colorScheme.primary)
                val below = vm.watches.count { w -> w.lastPrice?.let { w.isHit(it) } == true }
                if (vm.watches.isNotEmpty()) {
                    Text("${vm.watches.size} price ${if (vm.watches.size == 1) "watch" else "watches"}" + if (below > 0) ", $below below your trigger" else "",
                        color = if (below > 0) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
                }
                r.bookings.firstOrNull()?.let { b ->
                    Text("Check-in: ${b.checkinLabel}")
                    b.balanceDue?.let { Text(if (it) "Balance due" else "Paid in full") }
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            androidx.compose.material3.OutlinedButton(onOpen) { Text("Open Prices") }
            androidx.compose.material3.OutlinedButton(onWatches) { Text("Price watches") }
        }
    }
    RoyalDataCard(vm, tick, title = null)
}

/**
 * Prices: everything price-related in one place. Summary (the check's results; pull down to refresh), Watches (items you haven't bought, mutes), Checks (background checks, alert hours, script) and
 * Report (the full output).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PricesScreen(vm: MainViewModel, dark: Boolean, seg: PriceSeg, onSeg: (PriceSeg) -> Unit) {
    val segs = PriceSeg.entries
    Column(Modifier.fillMaxSize()) {
        SailingPicker(vm)
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
            segs.forEachIndexed { i, t ->
                SegmentedButton(seg == t, { onSeg(t) }, SegmentedButtonDefaults.itemShape(i, segs.size), label = { Text(t.label, maxLines = 1) })
            }
        }
        Box(Modifier.weight(1f)) {
            when (seg) {
                PriceSeg.SUMMARY -> SummaryTab(vm)
                PriceSeg.WATCHES -> PriceWatchesPage(vm)
                PriceSeg.CHECKS -> PriceChecksPage(vm)
                PriceSeg.REPORT -> LogTab(vm, dark)
            }
        }
    }
}

/**
 * The sailing picker: all sailings, or one (from your bookings, or the sailing you added in Trip). It only
 * limits what Summary and Watches show here; checks, alerts and refreshes still cover every booking and watch.
 */
@Composable
private fun SailingPicker(vm: MainViewModel) {
    val options = vm.sailingOptions()
    if (options.isEmpty()) return
    var open by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(false) }
    val current = vm.selectedSailing()
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)) {
        Box {
            androidx.compose.material3.OutlinedButton({ open = true }, Modifier.fillMaxWidth()) {
                Text("Sailing: " + (current?.label ?: "All sailings"), maxLines = 1)
            }
            androidx.compose.material3.DropdownMenu(open, { open = false }) {
                androidx.compose.material3.DropdownMenuItem(text = { Text("All sailings") }, onClick = { vm.selectSailing(io.github.mrarron.royalpebble.alerts.SailingView.ALL); open = false })
                options.forEach { o ->
                    androidx.compose.material3.DropdownMenuItem(text = { Text(o.label) }, onClick = { vm.selectSailing(o.key); open = false })
                }
            }
        }
        if (current != null) Text("Showing this sailing only. Background checks and alerts still cover all bookings and watches.", style = MaterialTheme.typography.bodySmall)
    }
}

/** Settings: one list, each row a page. On board it also leads to Prices (not a tab then). */
@Composable
private fun SettingsList(phase: TripPhase.Phase, update: AppUpdate.State, open: (Sub) -> Unit) {
    val ctx = LocalContext.current
    val email = RoyalAccount.knownEmail(ctx)
    val rows = buildList {
        add(Triple(Sub.ACCOUNT, "Royal account", email?.let { RoyalAccount.masked(it) + if (RoyalAccount.remembered(ctx)) " · remembered" else "" } ?: "Not set"))
        if (phase == TripPhase.Phase.ONBOARD) add(Triple(Sub.PRICES, "Prices", "Summary · watches · checks · report"))
        if (phase == TripPhase.Phase.PLANNING) add(Triple(Sub.CABIN, "Me and my stateroom", "Stateroom, muster, dining, walking, theme"))
        add(Triple(Sub.WATCH, "Watch and logs", "Serve the watch · test alerts · share the log file"))
        add(Triple(Sub.ABOUT, "About", "App ${BuildConfig.VERSION_NAME}" +
            ((update as? AppUpdate.State.Available)?.let { " · update ${it.release.version} available" } ?: "")))
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        rows.forEach { (sub, title, detail) ->
            ListItem(
                headlineContent = { Text(title) },
                supportingContent = { Text(detail) },
                modifier = Modifier.clickable { open(sub) },
            )
            HorizontalDivider()
        }
    }
}

@Composable
private fun AboutPage(update: AppUpdate) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Royal Pebble for Android", style = MaterialTheme.typography.titleMedium)
        Text("App ${WatchHost.buildText()}")
        Text("Royal Pebble ${WatchHost.jsVersion}")
        Text("Bundled price script: ${BuildConfig.UPSTREAM_VERSION}")
        Text(
            "Trip and Today switch by themselves: On board from the first day of your downloaded sailing " +
                "through the last, Planning otherwise. Pick Planning or On board on either screen to stay put.",
            style = MaterialTheme.typography.bodySmall,
        )
        UpdateSection(update)
    }
}

/** App updates: Check now, and when a newer release exists, its notes and Download then Install. */
@Composable
private fun UpdateSection(u: AppUpdate) {
    val st = u.state
    HorizontalDivider(Modifier.padding(vertical = 8.dp))
    Text("App updates", style = MaterialTheme.typography.titleMedium)
    Text(
        when (st) {
            AppUpdate.State.Idle -> "Looks for a newer Royal Pebble release on GitHub. Nothing about you is sent."
            AppUpdate.State.Checking -> "Checking GitHub…"
            is AppUpdate.State.UpToDate -> "Up to date (latest release ${st.latest})."
            is AppUpdate.State.Available -> "Update ${st.release.version} is available. Download opens the file in your browser; tap it when it finishes to install over this app."
            is AppUpdate.State.Failed -> st.reason
        },
        color = if (st is AppUpdate.State.Failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
    )
    val release = when (st) {
        is AppUpdate.State.Available -> st.release
        else -> null
    }
    release?.notes?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        when (st) {
            is AppUpdate.State.Available -> Button(onClick = u::openDownload) { Text("Download ${st.release.version}") }
            else -> {}
        }
        androidx.compose.material3.OutlinedButton(onClick = { u.check() }, enabled = st !is AppUpdate.State.Checking) {
            Text("Check for updates")
        }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
        androidx.compose.material3.Switch(u.auto, u::changeAuto)
        Text("Check once a day when the app opens")
    }
    Text("Updates come from this app's GitHub releases only and install over the current app with your data kept. It's free. With no internet the check just stops quietly.",
        style = MaterialTheme.typography.bodySmall)
}
