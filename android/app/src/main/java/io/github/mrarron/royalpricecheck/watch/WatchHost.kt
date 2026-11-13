package io.github.mrarron.royalpricecheck.watch

import android.content.Context
import io.github.mrarron.royalpebble.watch.AppMessageCodec
import io.github.mrarron.royalpebble.watch.JsBundle
import io.github.mrarron.royalpebble.watch.StoreDir
import io.github.mrarron.royalpebble.watch.WatchServer
import io.github.mrarron.royalpebble.watch.WireDict
import io.rebble.pebblekit2.client.DefaultPebbleInfoRetriever
import io.rebble.pebblekit2.common.model.WatchIdentifier
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.io.File
import java.text.DateFormat
import java.util.Date
import java.util.TimeZone
import java.util.concurrent.Executors

/**
 * Runs the watch server while Royal Pebble is open on the watch and "App
 * serves the watch" is on: one QuickJS running src/pkjs/index.js on its own
 * thread, its localStorage in the cruise store's folder. Started by the
 * listener service when the watch opens the app (or on the first message
 * after the switch is turned on), stopped when it closes.
 */
object WatchHost {
    private val thread = Executors.newSingleThreadExecutor { r ->
        Thread(null, r, "royal-pebble-js", 4L * 1024 * 1024).apply { isDaemon = true }
    }
    private val scope = CoroutineScope(SupervisorJob() + thread.asCoroutineDispatcher())
    private var server: WatchServer? = null
    private var serving: WatchIdentifier? = null
    private var since: Long = 0
    private var messages = 0

    /**
     * The cruise store's folder (io.github.mrarron.royalpebble.store.CruiseStore):
     * the app's downloads and settings screens use the same one.
     */
    fun storeDir(c: Context) = File(c.filesDir, "cruise")

    private fun wireFile(c: Context) = File(c.filesDir, "watch-wire.log")

    /** Royal Pebble opened on [watch]: what PebbleKit JS's `ready` is. */
    @Synchronized
    fun opened(c: Context, watch: WatchIdentifier) {
        if (!WatchPrefs.serves(c)) return
        stop()
        start(c, watch).ready()
    }

    /** A message from the watch. Starts the server when the switch was turned on while the app was open. */
    @Synchronized
    fun received(c: Context, watch: WatchIdentifier, dict: WireDict) {
        if (!WatchPrefs.serves(c)) {
            if (server != null) stop()
            return
        }
        val s = server ?: start(c, watch).also { it.ready() }
        messages++
        s.received(dict)
    }

    /** Royal Pebble closed on the watch. */
    @Synchronized
    fun closed() = stop()

    @Synchronized
    fun stop() {
        server?.stop()
        server = null
        serving = null
        WatchLink.serverStopped()
    }

    /** One line for the app's screen. */
    @Synchronized
    fun status(c: Context): String {
        val s = server
        return when {
            !WatchPrefs.serves(c) -> "Off: PebbleKit JS serves the watch."
            s == null -> "On. Waiting for Royal Pebble to open on the watch."
            s.startError != null -> "Couldn't start: ${s.startError}"
            else -> "Serving the watch since ${DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(since))}: " +
                "$messages messages from it" +
                (if (s.errors > 0) ", ${s.errors} errors (see the usage log)" else "") +
                (s.timeZoneDrift?.let { ", engine time zone off by $it min" } ?: "")
        }
    }

    private fun start(c: Context, watch: WatchIdentifier): WatchServer {
        val app = c.applicationContext
        // QuickJS reads local time through the C library, which follows TZ.
        runCatching { android.system.Os.setenv("TZ", TimeZone.getDefault().id, true) }
        val wire = WatchPrefs.wireLog(app)
        val s = WatchServer(
            scope = scope,
            runtime = ZiplineRuntime(),
            script = { JsBundle.build(JsBundle.Resources()) },
            keys = WatchLink.keys,
            store = StoreDir(storeDir(app)),
            sink = { dict -> WatchLink.sendFromServer(app, dict, watch) },
            onWire = { sent, dict -> if (wire) logWire(app, sent, dict) },
        )
        s.start(null) { ms -> -TimeZone.getDefault().getOffset(ms) / 60000 }
        server = s
        serving = watch
        since = System.currentTimeMillis()
        messages = 0
        // What Pebble.getActiveWatchInfo() gives PebbleKit JS (the Round 2 gets its own layouts).
        scope.launch {
            val info = runCatching {
                withTimeoutOrNull(3_000) { DefaultPebbleInfoRetriever(app).getConnectedWatches().first() }
                    ?.firstOrNull { it.id == watch }
            }.getOrNull()
            if (info != null) {
                s.watchInfo(JsonObject(mapOf(
                    "platform" to JsonPrimitive(info.platform.lowercase()),
                    "model" to JsonPrimitive(info.name),
                    "firmware" to JsonObject(mapOf(
                        "major" to JsonPrimitive(info.firmwareVersionMajor),
                        "minor" to JsonPrimitive(info.firmwareVersionMinor),
                        "patch" to JsonPrimitive(info.firmwareVersionPatch),
                        "suffix" to JsonPrimitive(info.firmwareVersionTag),
                    )),
                )).toString())
            }
        }
        return s
    }

    // ">" sent to the watch, "<" from it; the newest half kept past 512 KB. App storage only.
    @Synchronized
    private fun logWire(c: Context, sent: Boolean, dict: WireDict) {
        val f = wireFile(c)
        f.appendText("${System.currentTimeMillis()} ${if (sent) ">" else "<"} ${AppMessageCodec.describe(dict)}\n")
        if (f.length() > 512 * 1024) {
            val lines = f.readLines()
            f.writeText(lines.drop(lines.size / 2).joinToString("\n", postfix = "\n"))
        }
    }

    /** The wire log's text, or empty. */
    fun wireLogText(c: Context): String = wireFile(c).takeIf { it.exists() }?.readText() ?: ""

    fun clearWireLog(c: Context) {
        wireFile(c).delete()
    }
}
