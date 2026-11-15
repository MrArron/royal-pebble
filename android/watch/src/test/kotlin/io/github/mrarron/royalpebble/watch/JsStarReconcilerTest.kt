package io.github.mrarron.royalpebble.watch

import io.github.mrarron.royalpebble.store.CruiseStore
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.util.Calendar
import java.util.concurrent.TimeUnit

/**
 * Issue 129: a re-download in the app moves stars of events Royal moved and
 * drops those it cancelled, through slice.js in QuickJS, and queues the same
 * watch notices as PebbleKit JS. Compared with Node on the same inputs.
 */
class JsStarReconcilerTest {
    @get:Rule val tmp = TemporaryFolder()
    private val repo = File(System.getProperty("repo") ?: "../..")
    private val sources = JsBundle.Dir(File(repo, "src/pkjs"))

    private fun ev(title: String, venue: Int, time: String) =
        """["$title",$venue,0,"2027-03-07","$time",60,0,0]"""

    private fun bundle(vararg events: String): JsonObject = Json.parseToJsonElement("""{
        "format":"cruise-watch","v":1,"generated":"2027-03-07T12:00:00Z",
        "ship":{"code":"HM","name":"Harmony of the Seas"},"sailDate":"2027-03-06",
        "itinerary":[
          {"day":1,"date":"2027-03-06","port":"Orlando (Port Canaveral), Fl","type":"EMBARK","arrive":null,"depart":"16:00"},
          {"day":2,"date":"2027-03-07","port":"Cruising","type":"CRUISING","arrive":null,"depart":null},
          {"day":3,"date":"2027-03-08","port":"Orlando (Port Canaveral), Fl","type":"DEBARK","arrive":"06:00","depart":null}],
        "schedule":{"published":true,"cats":[["Entertainment","Shows"]],"venues":["Studio B","Boardwalk","Promenade"],
          "fields":["title","venue","cat","date","time","minutes","featured","reservation"],
          "events":[${events.joinToString(",")}]}}""").jsonObject

    private val ice = "Ice Show|2027-03-07|20:00|Studio B"
    private val iceLate = "Ice Show|2027-03-07|21:30|Studio B"
    private val comedy = "Comedy|2027-03-07|21:00|Boardwalk"
    private val trivia = "Trivia|2027-03-07|22:00|Promenade"

    private val old = bundle(ev("Ice Show", 0, "20:00"), ev("Comedy", 1, "21:00"), ev("Trivia", 2, "22:00"))
    private val fresh = bundle(ev("Ice Show", 0, "21:30"), ev("Comedy", 1, "21:00"))

    private val now = Calendar.getInstance().apply { clear(); set(2027, 2, 7, 16, 0) }.timeInMillis

    @Test
    fun movedAndCancelledStarsFollowTheNewSchedule() {
        val r = JsStarReconciler({ QuickJsRuntime() }, sources)
        val store = CruiseStore(File(tmp.root, "cruise"), r)
        store.saveDownload(old, "first")
        store.applyStarChanges(mapOf(ice to true, "R|$ice" to true, comedy to true, trivia to true), nowMs = 1000)

        val saved = store.saveDownload(fresh, "again", nowMs = now)

        assertNull(r.lastError)
        assertEquals(2, saved.starChanges)
        assertEquals(setOf(iceLate, "R|$iceLate", comedy), store.stars().keys)  // the reserved mark moves with its star
        assertEquals(1000L, store.starTimes()[iceLate])
        val changes = (store.read(CruiseStore.STAR_CHANGES) as JsonObject)["list"] as JsonArray
        assertEquals("moved 1, cancelled 1, check 0", starChangeCounts(changes))
        val notices = store.read(CruiseStore.NOTICES) as JsonArray
        assertEquals(2, notices.size)
        assertEquals(listOf("0", "1"), notices.map { (it as JsonObject)["kind"].toString() })  // moved, cancelled
    }

    @Test
    fun matchesNode() {
        val stars = mapOf(ice to true, comedy to true, trivia to true)
        val times = mapOf(ice to 5L, "Gone|2027-03-07|10:00|" to 6L)
        val settings = JsonObject(emptyMap())
        val js = JsStarReconciler({ QuickJsRuntime() }, sources).reconcile(old, fresh, stars, settings, now, times)
        val node = listOf("node", "/usr/bin/node", "/usr/local/bin/node").firstOrNull {
            runCatching { ProcessBuilder(it, "--version").start().waitFor(10, TimeUnit.SECONDS) }.getOrDefault(false)
        }
        assumeTrue("node not found", node != null)
        val args = JsonObject(mapOf("old" to old, "new" to fresh,
            "stars" to JsonObject(stars.mapValues { JsonPrimitive(it.value) }), "settings" to settings,
            "now" to JsonPrimitive(now), "times" to JsonObject(times.mapValues { JsonPrimitive(it.value) })))
        val p = ProcessBuilder(node, File(repo, "android/watch/src/test/js/reconcile.js").path)
            .redirectError(ProcessBuilder.Redirect.INHERIT).start()
        p.outputStream.use { it.write(args.toString().toByteArray()) }
        val out = Json.parseToJsonElement(p.inputStream.readBytes().toString(Charsets.UTF_8)).jsonObject
        assertEquals(out["changes"].toString(), JsonArray(js.changes).toString())
        assertEquals(out["notices"].toString(), JsonArray(js.notices).toString())
        assertEquals(out["stars"]!!.jsonObject.keys, js.stars.keys)
        assertEquals(out["times"]!!.jsonObject.keys, js.times.keys)
    }

    @Test
    fun aBrokenScriptKeepsTheStars() {
        val broken = JsStarReconciler({ QuickJsRuntime() }, JsBundle.Sources { null })
        val r = broken.reconcile(old, fresh, mapOf(ice to true), JsonObject(emptyMap()), now, emptyMap())
        assertEquals(mapOf(ice to true), r.stars)
        assertNotNull(broken.lastError)
    }
}
