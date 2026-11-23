package io.github.mrarron.royalpricecheck

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.FileProvider
import io.github.mrarron.royalpebble.royal.UrlConnectionTransport
import io.github.mrarron.royalpebble.update.ReleaseInfo
import io.github.mrarron.royalpebble.update.UpdateCheck
import io.github.mrarron.royalpricecheck.watch.WatchHost
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Settings > About > App updates: finds a newer GitHub release of Royal Pebble
 * (UpdateCheck in :royal), downloads its APK into cache/updates and hands it to
 * Android's installer, which asks the owner to confirm. Every step writes a
 * "update" line to the test log (Settings > Watch > Share log file), so a test run
 * shows what the app did. Free forever: no account, no cruise data, one anonymous
 * request to api.github.com, only on Check now or once a day while the app is open
 * (the switch in About).
 */
class AppUpdate(private val ctx: Context, private val scope: CoroutineScope) {
    sealed interface State {
        data object Idle : State
        data object Checking : State
        data class UpToDate(val latest: String) : State
        data class Available(val release: ReleaseInfo) : State
        data class Downloading(val release: ReleaseInfo, val done: Long, val total: Long) : State
        /** The APK is saved and checked: Install opens Android's installer. */
        data class Ready(val release: ReleaseInfo, val file: File) : State
        /** The owner has to allow installs from Royal Pebble in Android's settings first. */
        data class NeedsPermission(val release: ReleaseInfo, val file: File) : State
        data class Failed(val reason: String) : State
    }

    var state by mutableStateOf<State>(State.Idle); private set
    var auto by mutableStateOf(Prefs.updateCheckAuto(ctx)); private set

    private fun log(detail: String) = WatchHost.logApp(ctx, "update", detail)

    fun setAuto(on: Boolean) {
        auto = on
        Prefs.setUpdateCheckAuto(ctx, on)
        log("automatic check: " + if (on) "on" else "off")
    }

    /** The daily check when the app opens (does nothing when off, done today, or one is running). */
    fun autoCheck() {
        if (!auto || state is State.Checking || state is State.Downloading) return
        if (!UpdateCheck.due(Prefs.updateCheckedAt(ctx), System.currentTimeMillis())) return
        check(auto = true)
    }

    fun check(auto: Boolean = false) {
        if (state is State.Checking || state is State.Downloading) return
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
                    lastRelease = result.release
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

    /** Downloads the APK of the offered release; ends in Ready (or NeedsPermission when Install would be refused). */
    fun download() {
        val release = (state as? State.Available)?.release ?: (state as? State.Failed)?.let { lastRelease } ?: return
        lastRelease = release
        state = State.Downloading(release, 0, release.apkSize)
        scope.launch {
            val dest = File(File(ctx.cacheDir, "updates"), release.apkName)
            log("download: start ${release.apkName}")
            val failure = withContext(Dispatchers.IO) {
                dest.parentFile?.listFiles()?.forEach { if (it.name != release.apkName) it.delete() }
                var lastPct = -1
                runCatching {
                    UpdateCheck.download(release, dest) { done, total ->
                        val pct = if (total > 0) (done * 100 / total).toInt() else -1
                        if (pct != lastPct) { lastPct = pct; state = State.Downloading(release, done, total) }
                    }
                }.exceptionOrNull()?.let { it.message ?: it.javaClass.simpleName }
            }
            if (failure != null) {
                log("download: failed, $failure")
                state = State.Failed("Download failed: $failure")
                return@launch
            }
            log("download: done ${dest.length()} B" + if (release.sha256 != null) ", checksum ok" else ", no checksum listed, size ok")
            state = if (canInstall()) State.Ready(release, dest) else State.NeedsPermission(release, dest)
        }
    }

    private var lastRelease: ReleaseInfo? = null

    private fun canInstall() = ctx.packageManager.canRequestPackageInstalls()

    /** Install pressed: Android's installer opens and asks to confirm; the app restarts when it's done. */
    fun install() {
        val (release, file) = when (val s = state) {
            is State.Ready -> s.release to s.file
            is State.NeedsPermission -> s.release to s.file
            else -> return
        }
        if (!canInstall()) {
            log("install: Android needs 'install unknown apps' allowed for Royal Pebble, opening that setting")
            state = State.NeedsPermission(release, file)
            ctx.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${ctx.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            return
        }
        val uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".logs", file)
        val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        log("install: opening Android's installer for ${release.version}")
        runCatching { ctx.startActivity(intent) }.onFailure {
            log("install: failed, ${it.message}")
            state = State.Failed("Couldn't open the installer: ${it.message}")
        }
    }

    /** After the owner allowed installs and came back: Install can go ahead. */
    fun permissionMayHaveChanged() {
        val s = state as? State.NeedsPermission ?: return
        if (canInstall()) state = State.Ready(s.release, s.file)
    }
}
