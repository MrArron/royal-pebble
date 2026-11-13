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

    private fun module(context: Context) = synchronized(lock) {
        if (!Python.isStarted()) Python.start(AndroidPlatform(context.applicationContext))
        Python.getInstance().getModule("rcp_runner")
    }

    fun workDir(context: Context): File = File(context.filesDir, "rcp").apply { mkdirs() }

    fun run(context: Context, onLine: (String) -> Unit): RunResult {
        val config = Prefs.configFile(context)
        if (!config.exists()) {
            return RunResult.failure("No configuration yet. Open Settings and enter your account.")
        }
        val json = module(context).callAttr(
            "run",
            config.absolutePath,
            workDir(context).absolutePath,
            LineSink { onLine(it) },
            Prefs.useLatestScript(context),
        ).toString()
        return RunResult.parse(json, System.currentTimeMillis())
    }

    /** Download the newest upstream script from GitHub. Returns (ok, version-or-error). */
    fun updateScript(context: Context): Pair<Boolean, String> {
        val json = JSONObject(module(context).callAttr("update_script", workDir(context).absolutePath).toString())
        return if (json.optBoolean("ok")) true to json.optString("version")
        else false to json.optString("error")
    }

    fun downloadedVersion(context: Context): String =
        module(context).callAttr("downloaded_version", workDir(context).absolutePath).toString()

    fun deleteDownloaded(context: Context) {
        module(context).callAttr("delete_downloaded", workDir(context).absolutePath)
    }
}
