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
    var status by mutableStateOf<String?>(null); private set
    val log = mutableStateListOf<String>()

    init {
        reload()
    }

    private fun reload() {
        hasConfig = Prefs.hasConfig(ctx)
        config = Prefs.readConfig(ctx)
        autoHours = Prefs.autoCheckHours(ctx)
        useLatest = Prefs.useLatestScript(ctx)
        result = Prefs.loadLastResult(ctx)
        log.clear()
        log.addAll(Prefs.loadLastLog(ctx))
    }

    fun saveSimple(username: String, password: String, cruiseLine: String) {
        saveConfig(Prefs.simpleConfig(username, password, cruiseLine))
    }

    fun saveConfig(yaml: String) {
        Prefs.writeConfig(ctx, yaml)
        config = yaml
        hasConfig = true
        status = "Saved."
    }

    fun changeAutoHours(h: Int) {
        Prefs.setAutoCheckHours(ctx, h)
        CheckWorker.schedule(ctx, h)
        autoHours = h
    }

    fun changeUseLatest(v: Boolean) {
        Prefs.setUseLatestScript(ctx, v)
        useLatest = v
    }

    fun runNow() {
        if (running) return
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
        }
    }
}
