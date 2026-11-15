package io.github.mrarron.royalpricecheck

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
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

    init {
        reload()
    }

    private fun reload() {
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
                status = "Save your account on the Account tab first."
                return
            }
            if (missingPasswords.isNotEmpty()) {
                status = "Enter your password on the Account tab first; background checks need it."
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
            status = "Password needed. Enter it on the Account tab."
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
            withContext(Dispatchers.IO) { WatchAlertBridge.afterCheck(ctx, r) }?.let {
                lines.add(it)
                log.add(it)
            }
            Prefs.saveLast(ctx, r, lines)
            Notifier.notifyChanges(ctx, previous, r, background = false)
            result = r
            running = false
        }
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
