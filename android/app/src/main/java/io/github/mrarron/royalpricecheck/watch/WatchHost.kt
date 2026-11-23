package io.github.mrarron.royalpricecheck.watch

import android.content.Context
import io.github.mrarron.royalpebble.watch.AppMessageCodec
import io.github.mrarron.royalpebble.watch.JsBundle
import io.github.mrarron.royalpebble.watch.StoreDir
import io.github.mrarron.royalpebble.watch.TestLog
import io.github.mrarron.royalpricecheck.BuildConfig
import io.github.mrarron.royalpebble.watch.WatchServer
import io.github.mrarron.royalpebble.watch.WireDict
import io.rebble.pebblekit2.client.DefaultPebbleInfoRetriever
import io.rebble.pebblekit2.common.model.WatchIdentifier
import io.rebble.pebblekit2.model.ConnectedWatch
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
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
    @Volatile private var server: WatchServer? = null
    private var serving: WatchIdentifier? = null
    private var since: Long = 0
    private var messages = 0

    /**
     * The cruise store's folder (io.github.mrarron.royalpebble.store.CruiseStore):
     * the app's downloads and settings screens use the same one.
     */
    fun storeDir(c: Context) = File(c.filesDir, "cruise")

    private fun wireFile(c: Context) = File(c.filesDir, "watch-wire.log")

    // The app's own lines for the test log (TestLog.appLine): switches, server
    // starts and stops, alerts sent. No cruise text. The newest half kept past 256 KB.
    private fun appLogFile(c: Context) = File(c.filesDir, "watch-app.log")

    /** Adds one of the app's own lines to the test log. */
    @Synchronized
    fun logApp(c: Context, kind: String, detail: String) {
        val f = appLogFile(c.applicationContext)
        runCatching {
            f.appendText(TestLog.appLine(System.currentTimeMillis(), kind, detail) + "\n")
            if (f.length() > 256 * 1024) {
                val lines = f.readLines()
                f.writeText(lines.drop(lines.size / 2).joinToString("\n", postfix = "\n"))
            }
        }
    }

    /** "0.1.0-abc1234 (abc1234)": the app's version and the commit it was built from. */
    fun buildText(): String = "${BuildConfig.VERSION_NAME} (${BuildConfig.COMMIT})"

    /** The Royal Pebble version of the bundled phone code (package.json), as the watch's usage log shows it. */
    val jsVersion: String by lazy {
        runCatching {
            val text = WatchHost::class.java.classLoader!!.getResourceAsStream("royalpebble/package.json")!!
                .use { it.readBytes().toString(Charsets.UTF_8) }
            Json.parseToJsonElement(text).jsonObject["version"]!!.jsonPrimitive.content
        }.getOrDefault("?")
    }

    /** Settings > Watch's switch moved. */
    fun servesChanged(c: Context, on: Boolean) {
        logApp(c, "switch", "App serves the watch: " + (if (on) "off -> on" else "on -> off") +
            (if (on) " (turn on Android app serves the watch on the settings page too)" else ", PebbleKit JS serves the watch"))
        if (!on) stop()
    }

    /** Royal Pebble opened on [watch]: what PebbleKit JS's `ready` is. */
    @Synchronized
    fun opened(c: Context, watch: WatchIdentifier) {
        if (!WatchPrefs.serves(c)) {
            logApp(c, "watch", "Royal Pebble opened on the watch; App serves the watch is off, so PebbleKit JS serves it")
            return
        }
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
        val s = server ?: start(c, watch).also {
            logApp(c, "server", "started by a watch message (the watch app was already open)")
            it.ready()
        }
        messages++
        s.received(dict)
    }

    /**
     * The app saved cruise data or settings in the store (a download, a
     * settings screen, a star): while serving, the watch gets a fresh slice.
     * Does nothing when the app isn't serving the watch.
     */
    @Synchronized
    fun storeChanged(c: Context, why: String) {
        val s = server
        if (s != null && s.startError == null) {
            logApp(c, "push", "$why: sent the watch a fresh slice now")
            s.storeChanged()
        } else {
            logApp(c, "push", "$why: not serving the watch right now, so it gets this when Royal Pebble next opens" +
                (if (!WatchPrefs.serves(c)) " (App serves the watch is off)" else ""))
        }
    }

    /**
     * Settings > Watch > Test alerts: four test alerts 2 to 4 minutes from now
     * (slice.js testAlarms, as the settings page's Me > Test alerts), kept for
     * an hour. Saves the time in the store's `testAlerts` key and pushes a slice.
     */
    fun testAlerts(c: Context) {
        val app = c.applicationContext as android.app.Application
        io.github.mrarron.royalpricecheck.cruise.CruiseHome.store(app)
            .write("testAlerts", JsonPrimitive(System.currentTimeMillis()))
        logApp(app, "alert", "test alerts turned on: reminder in 2 min, all-aboard in 3, two to-reserve in 4")
        storeChanged(app, "test alerts")
    }

    /** Royal Pebble closed on the watch. */
    @Synchronized
    fun closed() = stop()

    @Synchronized
    fun stop() {
        server?.let { s ->
            appContext?.let { c ->
                logApp(c, "server", "stopped after ${(System.currentTimeMillis() - since) / 1000} s, $messages messages from the watch" +
                    (if (s.errors > 0) ", ${s.errors} JS errors (last: ${s.lastError})" else "") +
                    (if (s.badMessages > 0) ", ${s.badMessages} messages that didn't convert" else "") +
                    (s.startError?.let { ", never started: $it" } ?: ""))
            }
        }
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

    // The last Pebble.getActiveWatchInfo() JSON per watch, while the app runs.
    private val knownWatches = java.util.concurrent.ConcurrentHashMap<WatchIdentifier, String>()

    // Waits (ms) before each try at the watch's type: now, then over about half a minute.
    private val WATCH_INFO_RETRIES = longArrayOf(0, 2_000, 5_000, 10_000, 15_000)

    // The shape PebbleKit JS's getActiveWatchInfo() has: platform ("emery",
    // "gabbro"), model, firmware.
    private fun watchInfoJson(info: ConnectedWatch): String = JsonObject(mapOf(
        "platform" to JsonPrimitive(info.platform.lowercase()),
        "model" to JsonPrimitive(info.name),
        "firmware" to JsonObject(mapOf(
            "major" to JsonPrimitive(info.firmwareVersionMajor),
            "minor" to JsonPrimitive(info.firmwareVersionMinor),
            "patch" to JsonPrimitive(info.firmwareVersionPatch),
            "suffix" to JsonPrimitive(info.firmwareVersionTag),
        )),
    )).toString()

    private var appContext: Context? = null

    /** The watch the server last served ("Pebble Time 2, platform emery, firmware 4.9.0"), for the log header. */
    @Volatile private var lastWatch: String? = null

    private fun start(c: Context, watch: WatchIdentifier): WatchServer {
        val app = c.applicationContext
        appContext = app
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
            hostInfo = TestLog.hostInfo(BuildConfig.VERSION_NAME, BuildConfig.COMMIT, serves = true, wireLog = wire,
                logCapChars = TestLog.LOG_CAP_CHARS),
        )
        logApp(app, "server", "serving the watch: app ${buildText()}, Royal Pebble JS $jsVersion, watch message log " +
            (if (wire) "on" else "off") + ", cruise in the app: " + cruiseText(app))
        // The watch's type from an earlier start, so the first pages are laid
        // out for it before this start's lookup answers.
        s.start(knownWatches[watch]) { ms -> -TimeZone.getDefault().getOffset(ms) / 60000 }
        server = s
        serving = watch
        since = System.currentTimeMillis()
        messages = 0
        // What Pebble.getActiveWatchInfo() gives PebbleKit JS: the Round 2 gets
        // its own layouts (textfit.platformOf), so a lookup that fails or is slow
        // must not leave it with the Time 2's. Tried again a few times while this
        // server runs; the last answer is kept for the next start.
        scope.launch {
            var info: ConnectedWatch? = null
            for ((n, wait) in WATCH_INFO_RETRIES.withIndex()) {
                delay(wait)
                if (server !== s) return@launch
                info = runCatching {
                    withTimeoutOrNull(3_000) { DefaultPebbleInfoRetriever(app).getConnectedWatches().first() }
                        ?.firstOrNull { it.id == watch }
                }.getOrNull()
                if (info != null) break
                if (n == WATCH_INFO_RETRIES.lastIndex) {
                    logApp(app, "server", "watch type unknown after ${n + 1} tries" +
                        (if (knownWatches[watch] != null) ": kept the last one known" else ": Time 2 layouts"))
                }
            }
            if (info == null) return@launch
            lastWatch = "${info.name}, platform ${info.platform.lowercase()}, firmware " +
                "${info.firmwareVersionMajor}.${info.firmwareVersionMinor}.${info.firmwareVersionPatch}" +
                (info.firmwareVersionTag?.takeIf { it.isNotBlank() }?.let { "-$it" } ?: "")
            val json = watchInfoJson(info)
            if (json != knownWatches[watch]) {
                logApp(app, "watch", "connected watch: $lastWatch" +
                    if (info.platform.equals("gabbro", ignoreCase = true)) " (Pebble Round 2 layouts)" else "")
            }
            knownWatches[watch] = json
            s.watchInfo(json)
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

    // "HM 2026-12-12" for the app's saved cruise, or "none (the watch shows NO CRUISE YET)".
    private fun cruiseText(c: Context): String {
        val f = File(storeDir(c), "bundle.json")
        if (!f.exists()) return "none (the watch shows NO CRUISE YET)"
        return runCatching {
            val b = Json.parseToJsonElement(f.readText()).jsonObject
            val ship = b["ship"]?.jsonObject?.get("code")?.jsonPrimitive?.content ?: "?"
            "$ship ${b["sailDate"]?.jsonPrimitive?.content ?: "?"}"
        }.getOrDefault("unreadable")
    }

    /**
     * Settings > Watch > Share test log: who served the watch, the app's own
     * lines, the usage log the app keeps, and the watch messages when that log
     * is on (TestLog). Holds cruise and cabin details.
     */
    fun testLogText(c: Context): String {
        val wire = WatchPrefs.wireLog(c)
        val header = listOf(
            "Royal Pebble Android app test log",
            "App ${buildText()}, Royal Pebble JS $jsVersion; Android ${android.os.Build.VERSION.RELEASE}, " +
                "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}",
            "Switches: App serves the watch ${if (WatchPrefs.serves(c)) "on" else "off"}, watch message log " +
                "${if (wire) "on" else "off"}. The settings page's Android app serves the watch is in PebbleKit JS's log.",
            "Now: ${status(c)}",
            "Cruise in the app: ${cruiseText(c)}",
            "Watch last served: ${lastWatch ?: "none since the app started"}",
            "Exported: ${TestLog.stamp(System.currentTimeMillis())}",
        )
        val appLines = appLogFile(c).takeIf { it.exists() }?.readLines()?.filter { it.isNotBlank() } ?: emptyList()
        val usage = File(storeDir(c), "usageLog.json").takeIf { it.exists() }?.readText()
        return TestLog.text(header, appLines, usage, if (wire) wireLogText(c) else null)
    }

    /**
     * Writes the test log to a file in the app's cache (logs/, older exports
     * removed) for the share sheet, and returns it. No size limit: the app's
     * own storage.
     */
    fun testLogFile(c: Context): File {
        val dir = File(c.cacheDir, "logs").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val f = File(dir, TestLog.fileName(System.currentTimeMillis()))
        f.writeText(testLogText(c))
        logApp(c, "export", "test log written: ${f.name}, ${f.length()} bytes")
        return f
    }

    /**
     * Saves the test log in the phone's Downloads folder and returns where
     * (Android 10 and later; older phones get the app's own Downloads folder).
     */
    fun saveTestLogToDownloads(c: Context): String {
        val name = TestLog.fileName(System.currentTimeMillis())
        val bytes = testLogText(c).toByteArray(Charsets.UTF_8)
        val where = if (android.os.Build.VERSION.SDK_INT >= 29) {
            val values = android.content.ContentValues().apply {
                put(android.provider.MediaStore.Downloads.DISPLAY_NAME, name)
                put(android.provider.MediaStore.Downloads.MIME_TYPE, "text/plain")
            }
            val r = c.contentResolver
            val uri = r.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: error("Android didn't make the file")
            r.openOutputStream(uri)!!.use { it.write(bytes) }
            "Downloads/$name"
        } else {
            val dir = c.getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS) ?: c.filesDir
            File(dir, name).writeBytes(bytes)
            File(dir, name).path
        }
        logApp(c, "export", "test log saved: $where, ${bytes.size} bytes")
        return where
    }

    fun clearAppLog(c: Context) {
        appLogFile(c).delete()
    }

    /** The wire log's text, or empty. */
    fun wireLogText(c: Context): String = wireFile(c).takeIf { it.exists() }?.readText() ?: ""

    fun clearWireLog(c: Context) {
        wireFile(c).delete()
    }
}
