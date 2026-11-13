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
import io.github.mrarron.royalpricecheck.PasswordVault
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** Where the cruise data lives, so every part of the app (settings screens, watch sending) shares one store. */
object CruiseHome {
    @Volatile private var store: CruiseStore? = null

    fun store(app: Application): CruiseStore =
        store ?: synchronized(this) { store ?: CruiseStore(File(app.filesDir, "cruise")).also { store = it } }
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

    inline fun <T> read(block: CruiseSession.() -> T): T {
        @Suppress("UNUSED_VARIABLE") val v = version
        return session.block()
    }

    /** Save through the session and redraw. */
    fun edit(block: CruiseSession.() -> Unit) {
        session.block()
        changed()
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
        changed()
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
                        PasswordVault.rememberPebbleLogin(getApplication(), login.email, login.password, remember)
                    }
                    message = (if (outcome.withLogin) "Downloaded with your login. " else "Downloaded. ") + outcome.summary +
                        (outcome.bookingSummary?.let { ". " + it.replaceFirstChar { c -> c.uppercase() } } ?: "")
                    if (outcome.mineError != null) error = "Your sailing downloaded, but your booking details didn't: ${outcome.mineError}"
                }
                is DownloadOutcome.Failed -> error = outcome.error
            }
            busy = false
            changed()
        }
    }

    // ------------------------------------------------------------ the saved login (see PasswordVault)

    fun savedLogin(): Pair<String, String>? = PasswordVault.pebbleLogin(getApplication())
    fun hasSavedLogin(): Boolean = PasswordVault.hasPebbleLogin(getApplication())
    fun forgetLogin() { PasswordVault.forgetPebbleLogin(getApplication()); changed() }
}
