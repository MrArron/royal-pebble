package io.github.mrarron.royalpricecheck

import android.content.Context
import com.chaquo.python.Python
import com.chaquo.python.android.AndroidPlatform
import org.json.JSONObject
import java.io.File

/** Receives each line the upstream script prints. Called from Python. */
fun interface LineSink {
    fun onLine(line: String)
}

/**
 * Runs jdeath's CheckRoyalCaribbeanPrice.py (unchanged) through app/src/main/python/rcp_runner.py.
 * Every call blocks, so call it from a background thread.
 */
object PythonBridge {
    private val lock = Any()

    /** One check at a time: a background check and Run now used to share one temp config file. */
    private val runLock = Any()

    private fun module(context: Context) = synchronized(lock) {
        if (!Python.isStarted()) Python.start(AndroidPlatform(context.applicationContext))
        Python.getInstance().getModule("rcp_runner")
    }

    /**
     * Watches set before they were tied to a sailing (no booking, no sailing) belong to the cruise
     * downloaded now: assign it once and keep it, so they stop being checked on other sailings.
     */
    private fun assignSailing(context: Context): List<io.github.mrarron.royalpebble.alerts.PriceWatch> {
        val all = Prefs.priceWatches(context)
        if (all.none { it.reservationId.isBlank() && (it.shipCode.isBlank() || it.sailDate.isBlank()) }) return all
        val sailing = io.github.mrarron.royalpricecheck.cruise.CruiseHome.store(context).sailing() ?: return all
        val fixed = all.map {
            if (it.reservationId.isBlank() && (it.shipCode.isBlank() || it.sailDate.isBlank())) it.copy(shipCode = sailing.shipCode, sailDate = sailing.sailDate) else it
        }
        Prefs.setPriceWatches(context, fixed)
        io.github.mrarron.royalpricecheck.watch.WatchHost.logApp(context, "watches", "${fixed.count { it !in all }} older watches tied to the downloaded sailing")
        return fixed
    }

    fun workDir(context: Context): File = File(context.filesDir, "rcp").apply { mkdirs() }

    fun run(context: Context, onLine: (String) -> Unit): RunResult {
        val config = Prefs.configFile(context)
        if (!config.exists()) {
            return RunResult.failure("No configuration yet. Open Settings > Royal account and enter your account.")
        }
        // The password lives in PasswordVault, not in config.yaml; put it into a short-lived copy.
        val injected = ConfigPasswords.inject(config.readText(), PasswordVault.all(context))
        if (injected.missing.isNotEmpty()) {
            return RunResult.failure(
                "Password needed. Open Settings > Royal account and enter it again " +
                    "(it is only kept after a restart while background checks are on).",
            )
        }
        // Only one check at a time. Earlier builds had a bug: a background check and "Run now" (or a second
        // background check) shared one fixed file name: the first to finish deleted the file the
        // other was about to read, and Python reported FileNotFoundError for injected-config.yaml.
        return synchronized(runLock) {
            val dir = workDir(context)
            // Recreate the folder if Android cleared it, and sweep leftovers from a killed run.
            dir.mkdirs()
            dir.listFiles { f -> f.name.startsWith("injected-config") }?.forEach { it.delete() }
            val temp = File(dir, "injected-config.yaml")
            try {
                temp.writeText(injected.yaml)
                io.github.mrarron.royalpricecheck.watch.WatchHost.logApp(context, "prices", "check started, config copy written")
                val json = module(context).callAttr(
                    "run",
                    temp.absolutePath,
                    dir.absolutePath,
                    LineSink { onLine(it) },
                    Prefs.useLatestScript(context),
                    io.github.mrarron.royalpebble.alerts.PriceWatches.scriptJson(assignSailing(context)),
                ).toString()
                RunResult.parse(json, System.currentTimeMillis())
            } catch (e: Exception) {
                // Python's FileNotFoundError arrives as a PyException. Should not happen now; if it does,
                // put it in the exported log with the folder state, then fail as before.
                io.github.mrarron.royalpricecheck.watch.WatchHost.logApp(
                    context, "prices",
                    "check failed to start (${e::class.java.simpleName}); config copy exists=${temp.exists()} dir exists=${dir.exists()}",
                )
                throw e
            } finally {
                temp.delete()
            }
        }
    }

    /**
     * Download a newer price script: the copy Royal Pebble verified, or jdeath's main branch when
     * the advanced setting is on. Returns (ok, version-or-error).
     */
    fun updateScript(context: Context): Pair<Boolean, String> {
        val json = JSONObject(
            module(context).callAttr(
                "update_script", workDir(context).absolutePath, Prefs.followUpstream(context),
            ).toString(),
        )
        return if (json.optBoolean("ok")) true to json.optString("version")
        else false to json.optString("error")
    }

    fun downloadedVersion(context: Context): String =
        module(context).callAttr("downloaded_version", workDir(context).absolutePath).toString()

    fun deleteDownloaded(context: Context) {
        module(context).callAttr("delete_downloaded", workDir(context).absolutePath)
    }
}
