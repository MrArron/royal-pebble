package io.github.mrarron.royalpricecheck.cruise

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.github.mrarron.royalpebble.royal.RoyalClient
import io.github.mrarron.royalpebble.royal.RoyalParse
import io.github.mrarron.royalpebble.royal.UrlConnectionTransport
import io.github.mrarron.royalpebble.settings.CruiseSession
import io.github.mrarron.royalpebble.settings.DownloadOutcome
import io.github.mrarron.royalpebble.settings.DownloadService
import io.github.mrarron.royalpebble.settings.Readiness
import io.github.mrarron.royalpebble.store.CruiseStore
import io.github.mrarron.royalpebble.store.StarReconciler
import io.github.mrarron.royalpebble.watch.JsStarReconciler
import io.github.mrarron.royalpricecheck.watch.ZiplineRuntime
import io.github.mrarron.royalpricecheck.RoyalAccount
import io.github.mrarron.royalpricecheck.watch.WatchHost
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** Where the cruise data lives, so every part of the app (settings screens, watch sending) shares one store. */
object CruiseHome {
    @Volatile private var store: CruiseStore? = null

    /**
     * Stars follow events Royal moved or cancelled on a re-download (issue 129):
     * slice.js in its own QuickJS, on a thread with a 4 MB stack like the watch
     * server's (QuickJS's stack limit is 1 MB; a pool thread's own stack can be smaller).
     */
    val reconciler = JsStarReconciler({ ZiplineRuntime() })

    private val bigStack = StarReconciler { old, new, stars, settings, nowMs, times ->
        var out: StarReconciler.Reconciled? = null
        val t = Thread(null, { out = reconciler.reconcile(old, new, stars, settings, nowMs, times) }, "royal-pebble-stars", 4L * 1024 * 1024)
        t.start()
        t.join()
        out ?: StarReconciler.KEEP.reconcile(old, new, stars, settings, nowMs, times)
    }

    fun store(app: Application): CruiseStore =
        store ?: synchronized(this) { store ?: CruiseStore(File(app.filesDir, "cruise"), bigStack).also { store = it } }
}

/**
 * State of the native settings screens (Cruise, Days, Filters, Events, Me, Share).
 * Screens read through [read] and call [session] to save; both touch [version] so
 * a save redraws whatever shows the data. Saves are small file writes on the main
 * thread; downloads run on a background thread.
 */
class CruiseViewModel(app: Application) : AndroidViewModel(app) {
    private val store = CruiseHome.store(app)
    val session = CruiseSession(store)
    private val service = DownloadService(RoyalClient(UrlConnectionTransport()), store)

    /** Bumped after every change to saved data, so screens that [read] it redraw. */
    var version by mutableIntStateOf(0); private set

    fun changed() { version++ }

    /** Saved data changed: redraw, and while the app serves the watch, send it a fresh slice now. */
    private fun saved(why: String) {
        changed()
        WatchHost.storeChanged(getApplication(), why)
    }

    inline fun <T> read(block: CruiseSession.() -> T): T {
        @Suppress("UNUSED_VARIABLE") val v = version
        return session.block()
    }

    /** Save through the session, redraw and tell the watch ([why] names the change for the test log). */
    fun edit(why: String = "settings saved", block: CruiseSession.() -> Unit) {
        session.block()
        saved(why)
    }

    // ------------------------------------------------------------ the Cruise screen: ships, sailings, downloads

    var ships by mutableStateOf<List<RoyalParse.Ship>>(emptyList()); private set
    var shipsError by mutableStateOf<String?>(null); private set
    var sailDates by mutableStateOf<List<String>>(emptyList()); private set
    var sailingsLoading by mutableStateOf(false); private set
    var selectedShip by mutableStateOf<RoyalParse.Ship?>(null); private set
    var selectedDate by mutableStateOf<String?>(null); private set
    var busy by mutableStateOf(false); private set
    /** What the last download did (counts only), shown until the next one. */
    var message by mutableStateOf<String?>(null); private set
    /** An error from the last download, or from loading ships and sailings (fixed wording from the client). */
    var error by mutableStateOf<String?>(null); private set

    fun pasteBundle(text: String): String? {
        val (bundle, problem) = Readiness.parse(text)
        if (bundle == null) return problem
        store.saveDownload(bundle, service.stamp())
        saved("cruise pasted")
        return null
    }

    private suspend fun <T> io(block: () -> T): T = withContext(Dispatchers.IO) { block() }

    fun loadShips(force: Boolean = false) {
        if (busy || (ships.isNotEmpty() && !force)) return
        viewModelScope.launch {
            shipsError = null
            try {
                ships = io { service.ships(force) }
                if (selectedShip == null) {
                    // The saved sailing's ship first, else nothing chosen.
                    val code = store.sailing()?.shipCode
                    selectedShip = ships.firstOrNull { it.code == code }
                    selectedShip?.let { selectShip(it) }
                }
            } catch (e: Exception) {
                shipsError = e.message ?: "Couldn't load Royal's ship list."
            }
        }
    }

    fun selectShip(ship: RoyalParse.Ship) {
        selectedShip = ship
        selectedDate = null
        sailDates = emptyList()
        sailingsLoading = true
        viewModelScope.launch {
            try {
                val dates = io { service.sailDates(ship.code) }
                if (selectedShip == ship) {
                    sailDates = dates
                    val saved = store.sailing()
                    selectedDate = if (saved != null && saved.shipCode == ship.code && saved.sailDate in dates) saved.sailDate else null
                    if (dates.isEmpty()) error = "Royal Caribbean lists no upcoming sailings for ${ship.name}."
                }
            } catch (e: Exception) {
                error = e.message ?: "Couldn't load the sailings."
            } finally {
                sailingsLoading = false
            }
        }
    }

    fun selectDate(date: String) { selectedDate = date }

    val canDownload: Boolean get() = !busy && selectedShip != null && selectedDate != null

    /** Downloads the chosen sailing; with [email] and [password] it signs in too and adds the booking details. */
    fun download(email: String? = null, password: String? = null, remember: Boolean = false) {
        val ship = selectedShip ?: return
        val date = selectedDate ?: return
        if (busy) return
        val login = if (!email.isNullOrBlank() && !password.isNullOrEmpty()) DownloadService.Login(email.trim(), password) else null
        busy = true
        message = null
        error = null
        viewModelScope.launch {
            val outcome = io { service.download(ship, date, login) }
            when (outcome) {
                is DownloadOutcome.Done -> {
                    // Done means Royal accepted the sign-in; the login is kept for this session, and saved only when asked.
                    if (login != null) {
                        val app = getApplication<Application>()
                        val now = RoyalAccount.current(app)
                        // One Royal login for the whole app: a new one becomes the Account tab's too.
                        if (now == null || now.email != login.email || now.password != login.password ||
                            RoyalAccount.remembered(app) != remember) {
                            RoyalAccount.save(app, login.email, login.password, "royal", remember)
                            WatchHost.logApp(app, "account", "Royal login saved from Cruise (remembered: $remember)")
                        }
                    }
                    message = (if (outcome.withLogin) "Downloaded with your login. " else "Downloaded. ") + outcome.summary +
                        (outcome.bookingSummary?.let { ". " + it.replaceFirstChar { c -> c.uppercase() } } ?: "")
                    if (outcome.mineError != null) error = "Your sailing downloaded, but your booking details didn't: ${outcome.mineError}"
                }
                is DownloadOutcome.Failed -> error = outcome.error
            }
            busy = false
            if (outcome is DownloadOutcome.Done) ScheduleRefresh.afterDownload(getApplication(), store, outcome)
            if (outcome is DownloadOutcome.Done) saved("cruise downloaded (${ship.code} $date)") else changed()
        }
    }

    // ------------------------------------------------------------ the shared Royal login (see RoyalAccount)

    /** The shared Royal login (RoyalAccount), when it is a Royal Caribbean one with its password known. */
    fun account(): RoyalAccount.Account? = RoyalAccount.current(getApplication())?.takeIf { it.cruiseLine == "royal" }
    fun accountRemembered(): Boolean = RoyalAccount.remembered(getApplication())
}
