package io.github.mrarron.royalpricecheck

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import io.github.mrarron.royalpebble.royal.UrlConnectionTransport
import io.github.mrarron.royalpebble.update.ReleaseInfo
import io.github.mrarron.royalpebble.update.UpdateCheck
import io.github.mrarron.royalpricecheck.watch.WatchHost
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Settings > About > App updates: finds a newer GitHub release of Royal Pebble
 * (UpdateCheck in :royal) and offers its APK as a link that opens in the browser.
 * The app installs nothing itself (no install permission: Play Protect flags apps
 * that can), so the owner taps the downloaded file as with any APK. Every step writes
 * an "update" line to the test log (Settings > Watch > Share log file). Free forever:
 * no account, no cruise data, one anonymous request to api.github.com, only on
 * Check now or once a day while the app is open (the switch in About).
 */
class AppUpdate(private val ctx: Context, private val scope: CoroutineScope) {
    sealed interface State {
        data object Idle : State
        data object Checking : State
        data class UpToDate(val latest: String) : State
        data class Available(val release: ReleaseInfo) : State
        data class Failed(val reason: String) : State
    }

    var state by mutableStateOf<State>(State.Idle); private set
    var auto by mutableStateOf(Prefs.updateCheckAuto(ctx)); private set

    private fun log(detail: String) = WatchHost.logApp(ctx, "update", detail)

    fun changeAuto(on: Boolean) {
        auto = on
        Prefs.setUpdateCheckAuto(ctx, on)
        log("automatic check: " + if (on) "on" else "off")
    }

    /** The daily check when the app opens (does nothing when off, done today, or one is running). */
    fun autoCheck() {
        if (!auto || state is State.Checking) return
        if (!UpdateCheck.due(Prefs.updateCheckedAt(ctx), System.currentTimeMillis())) return
        check(auto = true)
    }

    fun check(auto: Boolean = false) {
        if (state is State.Checking) return
        state = State.Checking
        scope.launch {
            val installed = WatchHost.jsVersion
            val result = withContext(Dispatchers.IO) { UpdateCheck.check(UrlConnectionTransport(15_000), installed) }
            if (result !is UpdateCheck.Result.Failed) Prefs.setUpdateCheckedAt(ctx, System.currentTimeMillis())
            val kind = if (auto) "daily" else "manual"
            when (result) {
                is UpdateCheck.Result.UpToDate -> {
                    log("check ($kind): up to date, installed $installed, latest ${result.latest}")
                    state = State.UpToDate(result.latest)
                }
                is UpdateCheck.Result.Available -> {
                    log("check ($kind): update available ${result.release.version} (installed $installed), ${result.release.apkName}, ${result.release.apkSize} B")
                    state = State.Available(result.release)
                }
                is UpdateCheck.Result.Failed -> {
                    log("check ($kind): failed, ${result.reason}")
                    // A failed daily check stays quiet (no internet at sea is normal); a manual one says why.
                    state = if (auto) State.Idle else State.Failed(result.reason)
                }
            }
        }
    }

    /** Download pressed: the release's APK link opens in the browser, which downloads it. */
    fun openDownload() {
        val release = (state as? State.Available)?.release ?: return
        log("download: opening ${release.apkName} in the browser")
        runCatching {
            ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(release.apkUrl)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }.onFailure {
            log("download: failed, ${it.message}")
            state = State.Failed("Couldn't open the browser: ${it.message}")
        }
    }
}
