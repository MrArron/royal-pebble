package io.github.mrarron.royalpebble.watch

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.TimeZone
import java.util.concurrent.TimeUnit

/** The app's test log draws usage log entries exactly as src/pkjs/log.js does. */
class TestLogTest {
    private val ny = TimeZone.getTimeZone("America/New_York")

    @Test
    fun entriesLookLikeLogJs() {
        val e = Json.parseToJsonElement("""[1790000000000, 2, 840, "slice", "[app] cruise HM 2026-09-30, day 2"]""").jsonArray
        assertEquals("2026-09-21 10:13:20  D3 14:00  slice  [app] cruise HM 2026-09-30, day 2", TestLog.renderEntry(e, ny))
        val none = Json.parseToJsonElement("""[1790000000000, null, null, "phone", "x"]""").jsonArray
        assertEquals("2026-09-21 10:13:20  -- --:--  phone  x", TestLog.renderEntry(none, ny))
        val before = Json.parseToJsonElement("""[1790000000000, -3, 65, "sync", "y"]""").jsonArray
        assertEquals("2026-09-21 10:13:20  D-3 01:05  sync  y", TestLog.renderEntry(before, ny))
    }

    @Test
    fun sameAsLogJsRenderEntry() {
        val repo = File(System.getProperty("repo") ?: "../..")
        val entry = """[1790000000000, 0, 1500, "dir", "[app] page 0 \"Ship by deck\": 15 rows"]"""
        val script = "process.stdout.write(require(process.argv[1]).renderEntry($entry))"
        val p = runCatching {
            ProcessBuilder("node", "-e", script, File(repo, "src/pkjs/log.js").path)
                .also { it.environment()["TZ"] = "America/New_York" }.start()
        }.getOrNull() ?: return  // no node: the test above still runs
        val out = p.inputStream.readBytes().toString(Charsets.UTF_8)
        assertTrue(p.waitFor(30, TimeUnit.SECONDS))
        assertEquals(out, TestLog.renderEntry(Json.parseToJsonElement(entry).jsonArray, ny))
    }

    @Test
    fun wholeText() {
        val usage = """{"on":true,"entries":[[1790000000000,null,null,"phone","[app] Android app 0.1.0 serves the watch"]]}"""
        val t = TestLog.text(listOf("Royal Pebble Android app test log", "App 0.1.0"),
            listOf(TestLog.appLine(1790000000000, "switch", "App serves the watch: off -> on", ny)), usage, null, ny)
        assertTrue(t, t.contains("\n== App lines (1)\n2026-09-21 10:13:20  app  switch  App serves the watch: off -> on\n"))
        assertTrue(t, t.contains("== Usage log in the app (1 entries; PebbleKit JS keeps its own)\n" +
            "2026-09-21 10:13:20  -- --:--  phone  [app] Android app 0.1.0 serves the watch\n"))
        assertTrue(t, !t.contains("== Watch messages"))
        assertEquals(emptyList<String>(), TestLog.usageLines("not json"))
    }
}
