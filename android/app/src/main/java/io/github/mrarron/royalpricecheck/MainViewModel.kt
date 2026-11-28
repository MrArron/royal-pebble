package io.github.mrarron.royalpricecheck

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.github.mrarron.royalpebble.alerts.AlertMutes
import io.github.mrarron.royalpebble.alerts.Muted
import io.github.mrarron.royalpebble.alerts.PriceWatch
import io.github.mrarron.royalpebble.alerts.ProductLink
import io.github.mrarron.royalpebble.alerts.QuietHours
import io.github.mrarron.royalpebble.alerts.WatchRule
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainViewModel(app: Application) : AndroidViewModel(app) {
    private val ctx get() = getApplication<Application>()

    var result by mutableStateOf<RunResult?>(null); private set
    var config by mutableStateOf(""); private set
    var hasConfig by mutableStateOf(false); private set
    var autoHours by mutableStateOf(0); private set
    var useLatest by mutableStateOf(true); private set
    var watchAlerts by mutableStateOf(false); private set
    var status by mutableStateOf<String?>(null); private set
    var followUpstream by mutableStateOf(false); private set
    var scriptVersion by mutableStateOf(""); private set
    var missingPasswords by mutableStateOf<List<Int>>(emptyList()); private set
    /** The shared Royal login's email (masked on screen), known even before its password is. */
    var accountEmail by mutableStateOf<String?>(null); private set
    var accountRemembered by mutableStateOf(false); private set
    var accountReady by mutableStateOf(false); private set
    val log = mutableStateListOf<String>()
    /** Settings > About: the in-app update check, download and install. */
    val update = AppUpdate(app, viewModelScope)

    // Prices > Watches and the alert hours.
    var watches by mutableStateOf<List<PriceWatch>>(emptyList()); private set
    var mutes by mutableStateOf<List<Muted>>(emptyList()); private set
    var quiet by mutableStateOf(QuietHours()); private set
    /** A Cruise Planner link shared to the app (Share > Royal Pebble): opens Price watches with it filled in. */
    var sharedLink by mutableStateOf<String?>(null)
    /** The Cruise Planner items loaded from Royal for the picker (kept by [RoyalSync]). */
    var catalog by mutableStateOf<List<io.github.mrarron.royalpebble.royal.CatalogItem>>(emptyList()); private set
    /**
     * The one refresh (pull down on Trip, Today or Prices, [refresh]): running, the step it is on, what it said,
     * and a counter the shell watches to redraw Trip and the other screens.
     */
    var refreshing by mutableStateOf(false); private set
    var refreshStep by mutableStateOf<String?>(null); private set
    var syncMessage by mutableStateOf<String?>(null); private set
    var syncTick by mutableIntStateOf(0); private set

    // The sailing picker limits what the Prices screens show. Background checks, schedule refresh and alerts
    // read Prefs directly and always cover every booking and watch.
    var selectedSailingKey by mutableStateOf(""); private set

    /**
     * Picks what Prices shows. A sailing kept on the phone (downloaded in Trip) also becomes the one the whole app
     * follows (Trip, Days, Events, Filters, the schedule and the watch); a booked sailing that isn't downloaded
     * only limits Prices. All sailings leaves the app on the sailing it follows.
     */
    fun selectSailing(key: String) {
        selectedSailingKey = key
        Prefs.setSelectedSailing(ctx, key)
        if (key != io.github.mrarron.royalpebble.alerts.SailingView.ALL) {
            val store = io.github.mrarron.royalpricecheck.cruise.CruiseHome.store(ctx)
            val target = store.sailings().firstOrNull { !it.active && io.github.mrarron.royalpebble.alerts.SailingView.key(it.sailing.shipCode, it.sailing.sailDate) == key }
            if (target != null && store.activate(target.sailing.shipCode, target.sailing.sailDate)) {
                io.github.mrarron.royalpricecheck.watch.WatchHost.logApp(ctx, "sailing", "app now follows ${target.sailing.shipCode} ${target.sailing.sailDate} (picked in Prices)")
                io.github.mrarron.royalpricecheck.watch.WatchHost.storeChanged(ctx, "sailing switched")
            }
        }
        lastActiveKey = io.github.mrarron.royalpricecheck.cruise.CruiseHome.store(ctx).sailing()?.let { io.github.mrarron.royalpebble.alerts.SailingView.key(it.shipCode, it.sailDate) }
        syncTick++   // redraws Trip and the other screens that read the saved sailing
    }

    private var optionsTick by mutableIntStateOf(0)
    private var lastActiveKey: String? = null

    /**
     * Trip kept, switched or removed a sailing (called after every save there). When the sailing the app follows
     * changed and a specific sailing is picked in Prices, the pick follows it; the picker's list is read again.
     */
    fun sailingsChanged() {
        val store = io.github.mrarron.royalpricecheck.cruise.CruiseHome.store(ctx)
        val active = store.sailing()?.let { io.github.mrarron.royalpebble.alerts.SailingView.key(it.shipCode, it.sailDate) }
        if (lastActiveKey != null && active != lastActiveKey && selectedSailingKey != io.github.mrarron.royalpebble.alerts.SailingView.ALL) {
            selectedSailingKey = active ?: io.github.mrarron.royalpebble.alerts.SailingView.ALL
            Prefs.setSelectedSailing(ctx, selectedSailingKey)
        }
        lastActiveKey = active
        optionsTick++
    }

    private var optionsFor: Triple<RunResult?, Int, Int>? = null
    private var optionsCache: List<io.github.mrarron.royalpebble.alerts.SailingOption> = emptyList()

    /** Sailings from the last check's bookings, plus the sailings kept in Trip (read again after a check or a sync). */
    fun sailingOptions(): List<io.github.mrarron.royalpebble.alerts.SailingOption> {
        val stamp = Triple(result, syncTick, optionsTick)
        if (optionsFor == stamp) return optionsCache
        val bookings = result?.bookings.orEmpty().map { io.github.mrarron.royalpebble.alerts.BookingRef(it.reservationId, it.shipCode, it.shipName, it.sailDate) }
        // Every sailing kept on the phone (downloaded or added in Trip) is listed, booked or not.
        val added = io.github.mrarron.royalpricecheck.cruise.CruiseHome.store(ctx).sailings().map {
            io.github.mrarron.royalpebble.alerts.BookingRef("", it.sailing.shipCode, it.sailing.shipName, it.sailing.sailDate)
        }
        optionsCache = io.github.mrarron.royalpebble.alerts.SailingView.options(bookings, added)
        optionsFor = stamp
        return optionsCache
    }

    /** The picked sailing, or null for all sailings. */
    fun selectedSailing(): io.github.mrarron.royalpebble.alerts.SailingOption? =
        io.github.mrarron.royalpebble.alerts.SailingView.selected(sailingOptions(), selectedSailingKey)

    init {
        reload()
    }

    private fun reload() {
        catalog = Prefs.catalogItems(ctx)
        selectedSailingKey = Prefs.selectedSailing(ctx)
        runCatching { Prefs.migratePlainPasswords(ctx) }
        hasConfig = Prefs.hasConfig(ctx)
        config = Prefs.readConfig(ctx)
        autoHours = Prefs.autoCheckHours(ctx)
        useLatest = Prefs.useLatestScript(ctx)
        watchAlerts = Prefs.watchAlerts(ctx)
        followUpstream = Prefs.followUpstream(ctx)
        scriptVersion = runCatching { PythonBridge.downloadedVersion(ctx) }.getOrDefault("")
        refreshMissing()
        result = Prefs.loadLastResult(ctx)
        refreshAlerts()
        log.clear()
        log.addAll(Prefs.loadLastLog(ctx))
    }

    /** Account tab: the one Royal login, for the price check and the Cruise screen's download with login. */
    fun saveAccount(username: String, password: String, cruiseLine: String, remember: Boolean) {
        val wroteConfig = RoyalAccount.save(ctx, username, password, cruiseLine, remember)
        if (wroteConfig) {
            config = Prefs.readConfig(ctx)
            hasConfig = true
        }
        refreshMissing()
        status = if (wroteConfig) "Saved. The price check and Cruise downloads both use this login. Your password is not stored in config.yaml."
        else "Saved for Cruise downloads. Your own config.yaml was left as it is."
    }

    fun forgetAccount() {
        RoyalAccount.forget(ctx)
        refreshMissing()
        status = "Login forgotten on this phone."
    }

    fun saveConfig(yaml: String) {
        config = Prefs.saveConfigScrubbed(ctx, yaml)
        hasConfig = true
        refreshMissing()
        status = "Saved. Your password is not stored in the file."
    }

    private fun refreshMissing() {
        RoyalAccount.fillPriceChecker(ctx)
        missingPasswords = ConfigPasswords.inject(config, PasswordVault.all(ctx)).missing
        accountEmail = RoyalAccount.knownEmail(ctx)
        accountRemembered = RoyalAccount.remembered(ctx)
        accountReady = RoyalAccount.current(ctx) != null
    }

    /** Another screen (Cruise) changed the shared login: pick up the config.yaml it may have written. */
    fun accountChanged() {
        hasConfig = Prefs.hasConfig(ctx)
        config = Prefs.readConfig(ctx)
        refreshMissing()
    }

    /** Passwords typed again after a restart (index -> password). */
    fun enterPasswords(passwords: Map<Int, String>) {
        PasswordVault.remember(passwords)
        if (autoHours > 0) PasswordVault.saveEncrypted(ctx)
        refreshMissing()
        status = if (missingPasswords.isEmpty()) "Password ready." else null
    }

    fun changeAutoHours(h: Int) {
        if (h > 0) {
            refreshMissing()
            if (!hasConfig || ConfigPasswords.extract(config).indices.isEmpty()) {
                status = "Add your Royal account in Settings first."
                return
            }
            if (missingPasswords.isNotEmpty()) {
                status = "Enter your password in Settings > Royal account first; background checks need it."
                return
            }
            PasswordVault.saveEncrypted(ctx) // only while checks are on
        } else {
            PasswordVault.deleteSaved(ctx)
        }
        Prefs.setAutoCheckHours(ctx, h)
        CheckWorker.schedule(ctx, h)
        autoHours = h
        status = null
    }

    fun changeWatchAlerts(v: Boolean) {
        Prefs.setWatchAlerts(ctx, v)
        watchAlerts = v
    }

    fun changeUseLatest(v: Boolean) {
        Prefs.setUseLatestScript(ctx, v)
        useLatest = v
    }

    fun changeFollowUpstream(v: Boolean) {
        Prefs.setFollowUpstream(ctx, v)
        followUpstream = v
    }

    fun refreshAlerts() {
        catalog = Prefs.catalogItems(ctx)
        watches = Prefs.priceWatches(ctx)
        mutes = Prefs.mutes(ctx)
        quiet = Prefs.quietHours(ctx)
    }

    /**
     * Add a price watch from a Cruise Planner link. [priceNow] is the price shown now (optional:
     * without it the next check sets the starting price). Returns an error to show, or null.
     */
    fun addWatch(link: String, name: String, priceNow: String, rule: WatchRule, percent: String, target: String, guestAge: String): String? {
        val l = ProductLink.parse(link) ?: return "Paste the item's Cruise Planner link (it has /category/.../product/... in it)."
        return addWatchFor(l.prefix, l.product, l.bookingId, name, priceNow, rule, percent, target, guestAge, "link")
    }

    /** Adds a watch for a known product: from a pasted link ([how] = "link") or picked from the schedule ("schedule"). */
    fun addWatchFor(prefix: String, product: String, bookingId: String, name: String, priceNow: String, rule: WatchRule, percent: String, target: String, guestAge: String, how: String): String? {
        fun num(t: String) = t.trim().removePrefix("$").replace(",", "").toDoubleOrNull()
        val base = num(priceNow)?.takeIf { it > 0 }
        val pct = num(percent) ?: 0.0
        val tgt = num(target) ?: 0.0
        if (rule == WatchRule.PERCENT && (pct <= 0 || pct >= 100)) return "Enter a percent between 1 and 99."
        if (rule == WatchRule.BELOW && tgt <= 0) return "Enter your price."
        val all = Prefs.priceWatches(ctx)
        // Watches are for a sailing, linked bookings included. A link's booking id is only kept when its booking is
        // not on the downloaded sailing (or is not known from a check yet); then it stays on that booking.
        // New watches go to the picked sailing (Prices > sailing picker), else the sailing downloaded in Trip.
        val picked = selectedSailing()?.takeIf { it.shipCode.isNotBlank() }
        val downloaded = io.github.mrarron.royalpricecheck.cruise.CruiseHome.store(ctx).sailing()
        val scopeShip = picked?.shipCode ?: downloaded?.shipCode
        val scopeDate = picked?.sailDate ?: downloaded?.sailDate
        val linked = if (bookingId.isNotBlank()) Prefs.loadLastResult(ctx)?.bookings?.firstOrNull { it.reservationId == bookingId } else null
        val onSailing = scopeShip != null && scopeDate != null &&
            (bookingId.isBlank() || (linked != null && linked.sailDate.replace("-", "") == scopeDate.replace("-", "")))
        val reservation = if (onSailing) "" else bookingId
        if (all.any { it.code == "$prefix/$product" && it.reservationId == reservation && it.guestAge == guestAge && (!onSailing || it.sailDate == scopeDate) }) return "You already watch this item."
        val w = PriceWatch(
            id = java.util.UUID.randomUUID().toString().take(8), name = name.trim(), prefix = prefix, product = product,
            reservationId = reservation, shipCode = if (onSailing) scopeShip!! else "", sailDate = if (onSailing) scopeDate!! else "", guestAge = guestAge, rule = rule, percent = pct, target = tgt, baseline = base,
            createdAt = System.currentTimeMillis(),
        )
        Prefs.setPriceWatches(ctx, all + w)
        io.github.mrarron.royalpricecheck.watch.WatchHost.logApp(ctx, "watches", "added ${w.name.ifBlank { w.code }} ($how, ${w.code}, ${w.rule.code}${if (base != null) ", starting price typed" else ", starting price from next check"})")
        refreshAlerts()
        sharedLink = null
        return null
    }

    /** What can be watched without a link: the schedule's shore excursions plus the loaded Cruise Planner items (docs/DESIGN.md, Price watches). */
    fun watchCandidates(): List<io.github.mrarron.royalpebble.alerts.WatchCandidate> {
        val bundle = io.github.mrarron.royalpricecheck.cruise.CruiseHome.store(ctx).bundle()
        return io.github.mrarron.royalpebble.alerts.WatchCandidates.all(bundle, catalog, Prefs.priceWatches(ctx).mapTo(HashSet()) { it.code })
    }

    /** True when there is anything to refresh: a downloaded sailing, or a Royal account for the price check. */
    fun canRefresh(): Boolean = io.github.mrarron.royalpricecheck.cruise.CruiseHome.store(ctx).sailing() != null || hasConfig

    /**
     * The app's one refresh, started by pulling down on Trip, Today or Prices: the shown sailing's schedule and
     * booking details (plus the Cruise Planner list when it isn't loaded or is 6 hours old), then the price check,
     * on one sign-in ([RoyalSync.signIn]; the script is handed the same token). To go easy on Royal it never runs
     * twice within [io.github.mrarron.royalpebble.settings.PullRules.MIN_GAP_MS] (2 minutes after one where nothing
     * worked), a sailing downloaded in the last few minutes isn't pulled again, and a price check from the last
     * few minutes is kept. Writes one `refresh` line to the app log with what ran and what was skipped.
     */
    fun refresh() {
        if (refreshing) return
        val rules = io.github.mrarron.royalpebble.settings.PullRules
        val now = System.currentTimeMillis()
        val wait = rules.refreshWait(RoyalRefreshGate.nextAllowed(ctx), now)
        if (wait > 0) {
            syncMessage = "Up to date: refreshed from Royal at ${RoyalSync.stamp(RoyalRefreshGate.lastStart(ctx))}. " +
                "To go easy on Royal's servers, pull again in ${rules.waitMinutes(wait)} min."
            io.github.mrarron.royalpricecheck.watch.WatchHost.logApp(ctx, "refresh", "pull down skipped: last refresh ${(now - RoyalRefreshGate.lastStart(ctx)) / 60_000} min ago")
            syncTick++   // the indicator springs back
            return
        }
        refreshMissing()
        val store = io.github.mrarron.royalpricecheck.cruise.CruiseHome.store(ctx)
        val sailing = store.sailing()
        val account = RoyalAccount.current(ctx)?.takeIf { it.cruiseLine == "royal" }
        val canCheck = hasConfig && missingPasswords.isEmpty()
        if (sailing == null && !canCheck) {
            syncMessage = if (hasConfig) "Enter your password in Settings > Royal account, or download your sailing in Trip, to refresh."
            else "Download your sailing in Trip or add your Royal account in Settings to refresh."
            syncTick++
            return
        }
        refreshing = true
        syncMessage = null
        RoyalRefreshGate.started(ctx, now)
        viewModelScope.launch {
            val parts = ArrayList<String>()   // for the screen
            val logParts = ArrayList<String>()   // for the app log (counts and fixed words only)
            var anyOk = false

            // 1. The shown sailing: schedule and bookings (and the planner list), on the shared sign-in.
            if (sailing != null) {
                refreshStep = "Schedule and bookings…"
                val st = RoyalSync.status(ctx)
                val withCatalog = account != null && rules.catalogWanted(st.catalogCount, st.catalogAt, now)
                val outcome = withContext(Dispatchers.IO) {
                    runCatching {
                        RoyalSync.run(ctx, io.github.mrarron.royalpebble.royal.RoyalParse.Ship(sailing.shipCode, sailing.shipName), sailing.sailDate,
                            account?.let { io.github.mrarron.royalpebble.settings.DownloadService.Login(it.email, it.password) }, withCatalog, "pull to refresh")
                    }.getOrNull()
                }
                when (outcome) {
                    is io.github.mrarron.royalpebble.settings.DownloadOutcome.Done -> {
                        anyOk = true
                        io.github.mrarron.royalpricecheck.cruise.ScheduleRefresh.afterDownload(ctx, store, outcome)
                        io.github.mrarron.royalpricecheck.watch.WatchHost.storeChanged(ctx, "royal refreshed (pull down)")
                        parts += "Schedule: " + outcome.summary + (outcome.mineError?.let { ". Booking details failed: $it" } ?: "")
                        when {
                            !withCatalog -> {}
                            outcome.catalog?.items?.isNotEmpty() == true -> parts += "Planner list: ${outcome.catalog!!.items.size} items" +
                                (if (outcome.catalog!!.failed.isNotEmpty()) " (could not load: ${outcome.catalog!!.failed.joinToString()})" else "")
                            outcome.catalogError != null -> parts += "Planner list failed: ${outcome.catalogError}"
                        }
                        logParts += "sync ok" + if (withCatalog) " with planner list" else ""
                    }
                    is io.github.mrarron.royalpebble.settings.DownloadOutcome.Fresh -> {
                        anyOk = true
                        parts += "Schedule and bookings: kept the copy from ${outcome.minutesAgo} min ago"
                        logParts += "sync fresh (${outcome.minutesAgo} min)"
                    }
                    is io.github.mrarron.royalpebble.settings.DownloadOutcome.Failed -> { parts += "Schedule: ${outcome.error}"; logParts += "sync failed" }
                    null -> { parts += "Schedule: could not refresh from Royal Caribbean"; logParts += "sync failed" }
                }
                if (account == null) parts += "Save your Royal login (Settings > Royal account) to refresh booking details and prices too"
            }

            // 2. The price check (every booking and watch), on the same sign-in.
            val last = result
            when {
                !canCheck -> logParts += "check skipped (no account or password)"
                last != null && rules.checkIsFresh(last.finishedAt, last.ok, System.currentTimeMillis()) -> {
                    anyOk = true
                    parts += "Prices: kept the check from ${RoyalSync.stamp(last.finishedAt)}"
                    logParts += "check fresh"
                }
                else -> {
                    refreshStep = "Checking prices…"
                    log.clear()
                    val r = runCheck()
                    if (r.ok) anyOk = true
                    parts += if (r.ok) "Prices: checked ${r.itemsChecked} items" else "Prices: check failed${r.error?.let { " ($it)" } ?: ""}"
                    logParts += if (r.ok) "check ok" else "check failed"
                }
            }
            RoyalRefreshGate.finished(ctx, now, anyOk)
            io.github.mrarron.royalpricecheck.watch.WatchHost.logApp(ctx, "refresh", "pull down: " + logParts.joinToString(", ") +
                ", ${(System.currentTimeMillis() - now) / 1000} s")
            syncMessage = parts.joinToString(". ") + "."
            refreshAlerts()
            refreshStep = null
            syncTick++
            refreshing = false
        }
    }

    /** One price check as the screen runs it: output streams into [log], alerts go out at once (the user is watching). */
    private suspend fun runCheck(): RunResult {
        val previous = result
        val lines = ArrayList<String>()
        val r = withContext(Dispatchers.IO) {
            runCatching {
                PythonBridge.run(ctx) { line ->
                    lines.add(line)
                    viewModelScope.launch(Dispatchers.Main) { log.add(line) }
                }
            }.getOrElse { RunResult.failure("${it::class.java.simpleName}: ${it.message}") }
        }
        Prefs.saveLast(ctx, r, lines)
        // A check the user started: its alerts go out at once (quiet hours are for background checks).
        val extra = withContext(Dispatchers.IO) { AlertDelivery.afterCheck(ctx, previous, r, background = false) }
        lines.addAll(extra)
        log.addAll(extra)
        Prefs.saveLast(ctx, r, lines)
        result = r
        watches = Prefs.priceWatches(ctx)
        return r
    }

    fun removeWatch(id: String) {
        val w = Prefs.priceWatches(ctx).firstOrNull { it.id == id } ?: return
        Prefs.setPriceWatches(ctx, Prefs.priceWatches(ctx).filterNot { it.id == id })
        Prefs.setMutes(ctx, AlertMutes.unmute(Prefs.mutes(ctx), w.muteKey))
        io.github.mrarron.royalpricecheck.watch.WatchHost.logApp(ctx, "watches", "removed ${w.name.ifBlank { w.code }}")
        refreshAlerts()
    }

    /** Mute or unmute one alert (a watch, or a booked item's price alert). */
    fun setMuted(key: String, label: String, muted: Boolean) {
        if (muted) AlertDelivery.mute(ctx, key, label) else AlertDelivery.unmute(ctx, key)
        refreshAlerts()
    }

    fun changeQuiet(q: QuietHours) {
        Prefs.setQuietHours(ctx, q)
        io.github.mrarron.royalpricecheck.watch.WatchHost.logApp(ctx, "alerts", "alert hours set to ${q.text()}")
        quiet = q
    }

    fun updateScript() {
        viewModelScope.launch {
            status = "Updating script…"
            val (ok, msg) = withContext(Dispatchers.IO) {
                runCatching { PythonBridge.updateScript(ctx) }.getOrElse { false to (it.message ?: "failed") }
            }
            status = if (ok) "Script updated: $msg" else "Update failed, keeping the current copy: $msg"
            if (ok) scriptVersion = msg
        }
    }
}
