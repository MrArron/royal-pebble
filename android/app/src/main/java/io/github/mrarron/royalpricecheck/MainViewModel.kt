package io.github.mrarron.royalpricecheck

import android.app.Application
import androidx.compose.runtime.getValue
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

    var running by mutableStateOf(false); private set
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

    // Settings > Price watches and the alert hours.
    var watches by mutableStateOf<List<PriceWatch>>(emptyList()); private set
    var mutes by mutableStateOf<List<Muted>>(emptyList()); private set
    var quiet by mutableStateOf(QuietHours()); private set
    /** A Cruise Planner link shared to the app (Share > Royal Pebble): opens Price watches with it filled in. */
    var sharedLink by mutableStateOf<String?>(null)
    /** The Cruise Planner items loaded from Royal for the picker, and the state of loading them. */
    var catalog by mutableStateOf<List<io.github.mrarron.royalpebble.royal.CatalogItem>>(emptyList()); private set
    var catalogBusy by mutableStateOf(false); private set
    var catalogMessage by mutableStateOf<String?>(null); private set

    init {
        reload()
    }

    private fun reload() {
        catalog = Prefs.catalogItems(ctx)
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

    fun runNow() {
        if (running) return
        refreshMissing()
        if (missingPasswords.isNotEmpty()) {
            status = "Password needed. Enter it in Settings > Royal account."
            return
        }
        running = true
        status = null
        log.clear()
        viewModelScope.launch {
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
            // Run now is watched by the user, so its alerts go out at once (quiet hours are for background checks).
            val extra = withContext(Dispatchers.IO) { AlertDelivery.afterCheck(ctx, previous, r, background = false) }
            lines.addAll(extra)
            log.addAll(extra)
            Prefs.saveLast(ctx, r, lines)
            result = r
            watches = Prefs.priceWatches(ctx)
            running = false
        }
    }

    fun refreshAlerts() {
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
        if (all.any { it.code == "$prefix/$product" && it.reservationId == bookingId && it.guestAge == guestAge }) return "You already watch this item."
        val w = PriceWatch(
            id = java.util.UUID.randomUUID().toString().take(8), name = name.trim(), prefix = prefix, product = product,
            reservationId = bookingId, guestAge = guestAge, rule = rule, percent = pct, target = tgt, baseline = base,
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

    /** True when a sailing is downloaded and a Royal login is saved, so the Cruise Planner list can be loaded. */
    fun canLoadCatalog(): Boolean = catalogSailing() != null && RoyalAccount.current(ctx)?.takeIf { it.cruiseLine == "royal" } != null

    private fun catalogSailing(): Pair<String, String>? {
        val bundle = io.github.mrarron.royalpricecheck.cruise.CruiseHome.store(ctx).bundle() ?: return null
        val ship = (bundle["ship"] as? kotlinx.serialization.json.JsonObject)?.get("code")?.let { (it as? kotlinx.serialization.json.JsonPrimitive)?.content }
        val date = (bundle["sailDate"] as? kotlinx.serialization.json.JsonPrimitive)?.content
        if (ship.isNullOrBlank() || date.isNullOrBlank()) return null
        return ship to date.replace("-", "")
    }

    /**
     * Loads drinks, internet, dining, activities and spa from the Cruise Planner for the downloaded sailing,
     * signed in with the saved Royal login (about 10 to 20 requests, a pause between each). The list is kept
     * on the phone and refreshed only when asked.
     */
    fun loadCatalog() {
        if (catalogBusy) return
        val sailing = catalogSailing()
        val account = RoyalAccount.current(ctx)?.takeIf { it.cruiseLine == "royal" }
        if (sailing == null || account == null) {
            catalogMessage = "Download your sailing in Trip and save your Royal login (Settings > Royal account) first."
            return
        }
        catalogBusy = true
        catalogMessage = "Loading from Royal Caribbean..."
        viewModelScope.launch {
            val outcome = withContext(Dispatchers.IO) {
                try {
                    val client = io.github.mrarron.royalpebble.royal.RoyalClient(io.github.mrarron.royalpebble.royal.UrlConnectionTransport())
                    val auth = client.login(account.email, account.password)
                    Result.success(client.fetchCatalog(auth, sailing.first, sailing.second))
                } catch (e: io.github.mrarron.royalpebble.royal.RoyalException) {
                    Result.failure<io.github.mrarron.royalpebble.royal.CatalogResult>(e)
                } catch (e: Exception) {
                    Result.failure<io.github.mrarron.royalpebble.royal.CatalogResult>(RuntimeException("Could not load the list from Royal Caribbean."))
                }
            }
            outcome.onSuccess { r ->
                if (r.items.isNotEmpty()) { Prefs.setCatalogItems(ctx, r.items); catalog = r.items }
                catalogMessage = if (r.items.isEmpty()) "Royal Caribbean listed nothing${if (r.failed.isNotEmpty()) " (" + r.failed.joinToString() + " failed)" else ""}. Try again later."
                else "Loaded ${r.items.size} items" + (if (r.failed.isNotEmpty()) ". Could not load: ${r.failed.joinToString()}." else ".")
                io.github.mrarron.royalpricecheck.watch.WatchHost.logApp(ctx, "watches", "planner list loaded: ${r.items.size} items" + (if (r.failed.isNotEmpty()) ", failed: ${r.failed.joinToString()}" else ""))
            }.onFailure { e ->
                catalogMessage = e.message ?: "Could not load the list."
                io.github.mrarron.royalpricecheck.watch.WatchHost.logApp(ctx, "watches", "planner list failed: ${e.message}")
            }
            catalogBusy = false
        }
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
