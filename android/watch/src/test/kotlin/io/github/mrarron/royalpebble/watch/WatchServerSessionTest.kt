package io.github.mrarron.royalpebble.watch

import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files
import java.util.TimeZone
import java.util.concurrent.TimeUnit

/**
 * The gate for serving the watch from the app: for the same saved data and the
 * same watch session, the app (WatchServer running the bundled src/pkjs in
 * QuickJS) sends the watch exactly what PebbleKit JS sends (index.js in Node,
 * android/watch/src/test/js/session.js), compared as AppMessages byte for byte,
 * and leaves the same storage behind, usage log included. Needs `node`
 * (skipped without it; CI and the Pebble SDK machine have it).
 */
class WatchServerSessionTest {
    private val repo = File(System.getProperty("repo") ?: "../..")
    private val keys = MessageKeys.fromPackageJson(File(repo, "package.json").readText())

    private fun node(scenario: String): JsonObject {
        val node = listOf("node", "/usr/bin/node", "/usr/local/bin/node").firstOrNull { runCatching {
            ProcessBuilder(it, "--version").start().waitFor(10, TimeUnit.SECONDS)
        }.getOrDefault(false) }
        assumeTrue("node not found", node != null)
        val p = ProcessBuilder(node, File(repo, "android/watch/src/test/js/session.js").path, scenario)
            .redirectError(ProcessBuilder.Redirect.INHERIT).start()
        val out = p.inputStream.readBytes().toString(Charsets.UTF_8)
        check(p.waitFor(120, TimeUnit.SECONDS) && p.exitValue() == 0) { "session.js $scenario failed" }
        return Json.parseToJsonElement(out).jsonObject
    }

    private class Run(val sent: List<WireDict>, val store: Map<String, String>, val server: WatchServer)

    private suspend fun TestScope.runApp(spec: JsonObject, dir: File): Run {
        val store = StoreDir(dir)
        for ((k, v) in spec["store"]!!.jsonObject) store.write(k, v.jsonPrimitive.content)
        var now = spec["now"]!!.jsonPrimitive.long
        val sent = ArrayList<WireDict>()
        val runtime = QuickJsRuntime()
        val server = WatchServer(
            scope = this, runtime = runtime, script = { JsBundle.build(JsBundle.Dir(File(repo, "src/pkjs"))) },
            keys = keys, store = store, sink = { sent += it; true }, clock = { now }, pinClock = true,
        )
        server.start(null) { ms -> -TimeZone.getDefault().getOffset(ms) / 60000 }
        for (step in spec["steps"]!!.jsonArray) {
            val s = step.jsonObject
            when {
                "ready" in s -> server.ready()
                "message" in s -> server.received(AppMessageCodec.toWire(s["message"]!!.jsonObject, keys))
                "storeChanged" in s -> {
                    // Written by someone else (the app's screens), as CruiseStore does.
                    val other = StoreDir(dir)
                    for ((k, v) in s["storeChanged"]!!.jsonObject) other.write(k, v.jsonPrimitive.content)
                    server.storeChanged()
                }
                "advance" in s -> {
                    now += s["advance"]!!.jsonPrimitive.long
                    server.clockMoved()
                }
            }
            server.idle()
        }
        server.stop()
        return Run(sent, StoreDir(dir).readAll(), server)
    }

    private fun check(scenario: String) = runTest(StandardTestDispatcher()) {
        val r = node(scenario)
        val dir = Files.createTempDirectory("watch-$scenario").toFile()
        try {
            val app = runApp(r["spec"]!!.jsonObject, dir)
            val js = r["node"]!!.jsonObject
            val jsSent = js["sent"]!!.jsonArray.map { AppMessageCodec.toWire(it.jsonObject, keys) }
            assertEquals("$scenario: companion loads", null, app.server.startError)
            assertEquals("$scenario: engine problems", 0, app.server.errors)
            assertEquals("$scenario: time zone", null, app.server.timeZoneDrift)
            assertEquals("$scenario: message count", jsSent.size, app.sent.size)
            jsSent.zip(app.sent).forEachIndexed { i, (a, b) ->
                assertEquals("$scenario: message ${i + 1}", AppMessageCodec.describe(a), AppMessageCodec.describe(b))
            }
            val jsStore = js["store"]!!.jsonObject.mapValues { it.value.jsonPrimitive.content }
            assertEquals("$scenario: storage keys", jsStore.keys.sorted(), app.store.keys.sorted())
            for (k in jsStore.keys) assertEquals("$scenario: storage $k", jsStore[k], app.store[k])
        } finally {
            dir.deleteRecursively()
        }
    }

    @Test
    fun demoSessionIsTheSameAsPebbleKitJs() = check("demo")

    @Test
    fun savedSailingSessionIsTheSameAsPebbleKitJs() = check("sailing")
}
