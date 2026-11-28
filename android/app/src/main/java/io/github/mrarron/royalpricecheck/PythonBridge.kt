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
        val sailing = io.github.mrarron.royalpricecheck.cruise.CruiseHome.store(context.applicationContext as android.app.Application).sailing() ?: return all
        val fixed = all.map {
            if (it.reservationId.isBlank() && (it.shipCode.isBlank() || it.sailDate.isBlank())) it.copy(shipCode = sailing.shipCode, sailDate = sailing.sailDate) else it
        }
        Prefs.setPriceWatches(context, fixed)
        io.github.mrarron.royalpricecheck.watch.WatchHost.logApp(context, "watches", "${fixed.count { it !in all }} older watches tied to the downloaded sailing")
        return fixed
    }

    fun workDir(context: Context): File = File(context.filesDir, "rcp").apply { mkdirs() }

    /** What [sharedSignIn] decided: the JSON for the script (or ""), a log note, and an error that stops the check. */
    private class Shared(val json: String, val note: String, val stop: String? = null)

    /**
     * The app's Royal sign-in for the script, so a refresh signs in once ([RoyalSync.signIn]: reused when the sync
     * just signed in, else made here and kept for the sync that may follow). Only for the app's own simple
     * config.yaml with a Royal Caribbean login; an owner-written config.yaml signs in as before. A rejected
     * login stops the check (trying the same password again would only risk the account); any other problem
     * lets the script sign in itself as it always has.
     */
    private fun sharedSignIn(context: Context, configYaml: String): Shared {
        val account = RoyalAccount.current(context)?.takeIf { it.cruiseLine == "royal" } ?: return Shared("", "script signs in (no shared Royal login)")
        val simple = RoyalAccount.parseSimple(configYaml)
        if (simple == null || !simple.username.equals(account.email, ignoreCase = true)) return Shared("", "script signs in (own config.yaml)")
        return try {
            val (auth, reused) = RoyalSync.signIn.get(account.email, account.password) {
                io.github.mrarron.royalpebble.royal.RoyalClient(io.github.mrarron.royalpebble.royal.UrlConnectionTransport()).login(account.email, account.password)
            }
            val json = org.json.JSONObject().put("username", account.email).put("token", auth.tokenForPriceScript()).toString()
            Shared(json, if (reused) "reused the app's sign-in" else "app signed in once for the check")
        } catch (e: io.github.mrarron.royalpebble.royal.RoyalException) {
            if (e.message == io.github.mrarron.royalpebble.royal.RoyalClient.ERR_LOGIN_REJECTED) Shared("", "sign-in rejected", e.message)
            else Shared("", "app sign-in failed (${e.message}), script signs in itself")
        } catch (e: Exception) {
            Shared("", "app sign-in failed (${e::class.java.simpleName}), script signs in itself")
        }
    }

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
            val shared = sharedSignIn(context, config.readText())
            if (shared.stop != null) {
                io.github.mrarron.royalpricecheck.watch.WatchHost.logApp(context, "prices", "check not started: ${shared.note}")
                return@synchronized RunResult.failure(shared.stop)
            }
            try {
                temp.writeText(injected.yaml)
                io.github.mrarron.royalpricecheck.watch.WatchHost.logApp(context, "prices", "check started, config copy written, ${shared.note}")
                val json = module(context).callAttr(
                    "run",
                    temp.absolutePath,
                    dir.absolutePath,
                    LineSink { onLine(it) },
                    Prefs.useLatestScript(context),
                    io.github.mrarron.royalpebble.alerts.PriceWatches.scriptJson(assignSailing(context)),
                    shared.json,
                ).toString()
                val result = RunResult.parse(json, System.currentTimeMillis())
                if (shared.json.isNotEmpty()) {
                    val used = runCatching { JSONObject(json).optBoolean("sharedSignIn") }.getOrDefault(false)
                    io.github.mrarron.royalpricecheck.watch.WatchHost.logApp(context, "prices",
                        if (used) "check used the app's sign-in (no second sign-in)" else "check signed in itself (the script did not ask in the usual way)")
                }
                result
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
