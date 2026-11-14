package io.github.mrarron.royalpebble.watch

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.CompletableDeferred
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long

/** A JS engine: QuickJS in the app (Zipline) and in the tests. One thread only. */
interface JsRuntime : AutoCloseable {
    /** Runs [script]; returns a string result as a String (the only kind used here). */
    fun evaluate(script: String, fileName: String): Any?
}

/** Where the server's messages go: the watch, through PebbleKit Android 2. */
fun interface WatchSink {
    /** Sends one AppMessage; true when the watch ACKed it. */
    suspend fun send(dict: WireDict): Boolean
}

/**
 * Serves the watch from the Android app by running the phone companion itself,
 * src/pkjs/index.js, in [runtime] with the host in host.js: the same slices,
 * directory pages, routes, voice cards and star acks as PebbleKit JS, and the
 * same usage log, from the same code (docs/WATCH_PROTOCOL.md, Android companion
 * app). [store] is its localStorage.
 *
 * Every input (the app opening on the watch, a message from it, a timer, a
 * change to the store) is handled to the end on [scope]'s single thread before
 * the next: the JS runs, then its messages go out one at a time, each
 * followed by its send result, then timers that are due, as on the phone.
 * [clock] is the time the server schedules timers by; [pinClock] also gives
 * it to the JS's Date (tests).
 */
class WatchServer(
    private val scope: CoroutineScope,
    private val runtime: JsRuntime,
    /** The bundled phone companion (JsBundle.build), made on the engine's thread. */
    private val script: () -> String,
    private val keys: MessageKeys,
    private val store: StoreDir,
    private val sink: WatchSink,
    private val clock: () -> Long = System::currentTimeMillis,
    private val pinClock: Boolean = false,
    /** Every message sent to the watch (true) or received from it (false); for the wire log. */
    private val onWire: (sent: Boolean, dict: WireDict) -> Unit = { _, _ -> },
    /** The JS's console output, when not null. */
    private val onConsole: ((String) -> Unit)? = null,
    /**
     * What index.js logs about the app (host.js __host.info): JSON
     * {version, commit, serves, wireLog}, or null.
     */
    private val hostInfo: String? = null,
) {
    private sealed interface Input {
        object Ready : Input
        class Message(val dict: WireDict) : Input
        object Tick : Input
        object StoreChanged : Input
        class Call(val block: () -> Unit, val done: CompletableDeferred<Unit>) : Input
    }

    private val inputs = Channel<Input>(Channel.UNLIMITED)
    private var loop: Job? = null
    private var timerJob: Job? = null
    private var timers: List<Pair<Int, Long>> = emptyList()  // (id, at), earliest first
    private val waiting = ArrayDeque<Pair<Int, JsonObject>>()  // messages index.js queued, not yet sent
    private val json = Json

    /** The time zone offset the engine's Date uses minus the one expected, in minutes, or null when they agree. */
    var timeZoneDrift: Int? = null
        private set

    /** Inputs the JS threw on (it logs them itself), and the last message; for the app log. */
    var errors = 0
        private set
    var lastError: String? = null
        private set

    /** Why the companion didn't load, or null. */
    @Volatile
    var startError: String? = null
        private set

    /** Messages that couldn't be sent because they didn't convert (a bug in the JS); for the app log. */
    var badMessages = 0
        private set

    /**
     * Loads the host, the bundle and the store into the engine. [watchInfo] is
     * what Pebble.getActiveWatchInfo() returns (JSON), [expectedOffset] the
     * device's offset as Date.getTimezoneOffset() gives it (minutes west of UTC).
     */
    fun start(watchInfo: String?, expectedOffset: (Long) -> Int) {
        check(loop == null) { "started twice" }
        loop = scope.launch {
            try {
                runtime.evaluate(JsBundle.hostScript(), "host.js")
                if (pinClock) eval("__host.setClock(${clock()})")
                eval("__host.setConsole(${onConsole != null})")
                eval("__host.setWatch(${str(watchInfo)})")
                eval("__host.setInfo(${str(hostInfo)})")
                eval("__host.load(${str(JsonObject(store.readAll().mapValues { JsonPrimitive(it.value) }).toString())})")
                runtime.evaluate(script(), "royal-pebble-pkjs.js")
                val now = clock()
                val got = (runtime.evaluate("String(new Date($now).getTimezoneOffset())", "tz.js") as String).toInt()
                timeZoneDrift = (got - expectedOffset(now)).takeIf { it != 0 }
                drain()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // The companion didn't load: nothing is answered (the app says so).
                startError = e.message ?: e.toString()
            }
            for (input in inputs) {
                if (input is Input.Call) {
                    try {
                        input.block()
                    } finally {
                        input.done.complete(Unit)
                    }
                    continue
                }
                if (startError != null) continue
                // index.js's guard() logs what it throws in the usage log; what it
                // queued before that still goes out.
                try {
                    handle(input)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    errors++
                    lastError = e.message
                }
                drain()
            }
        }
    }

    private fun handle(input: Input) {
        when (input) {
            Input.Ready -> { sync(); eval("__host.event('ready', null)") }
            is Input.Message -> {
                onWire(false, input.dict)
                sync()
                eval("__host.event('appmessage', ${str(AppMessageCodec.toJs(input.dict, keys).toString())})")
            }
            Input.Tick -> sync()
            Input.StoreChanged -> { sync(); eval("__host.event('storechanged', null)") }
            is Input.Call -> {}
        }
    }

    /** Royal Pebble opened on the watch: PebbleKit JS's `ready` (index.js sends a slice). */
    fun ready() {
        inputs.trySend(Input.Ready)
    }

    /**
     * The app's own screens saved cruise data or settings in the store: the JS
     * reads the changes and sends the watch a fresh slice (index.js `storechanged`).
     */
    fun storeChanged() {
        inputs.trySend(Input.StoreChanged)
    }

    /** A message from the watch: PebbleKit JS's `appmessage`. */
    fun received(dict: WireDict) {
        inputs.trySend(Input.Message(dict))
    }

    /** What Pebble.getActiveWatchInfo() returns from now on (JSON), once the app knows the watch. */
    fun watchInfo(json: String?) {
        inputs.trySend(Input.Call({ if (startError == null) eval("__host.setWatch(${str(json)})") }, CompletableDeferred()))
    }

    /** Runs [block] on the engine's thread between inputs (tests: move the pinned clock). */
    suspend fun onEngine(block: () -> Unit) {
        val done = CompletableDeferred<Unit>()
        inputs.send(Input.Call(block, done))
        done.await()
    }

    /** Waits until every input sent so far has been handled. */
    suspend fun idle() = onEngine {}

    /** [clock] moved (tests, with pinClock): gives the JS the new time, then fires timers now due. */
    suspend fun clockMoved() {
        onEngine { eval("__host.setClock(${clock()})") }
        inputs.send(Input.Tick)
        idle()
    }

    /** Ends the loop and closes the engine. */
    fun stop() {
        timerJob?.cancel()
        inputs.close()
        loop?.invokeOnCompletion { runtime.close() }
    }

    private fun eval(js: String): Any? = runtime.evaluate(js, "host-call.js")

    // Keys the app changed since the JS last saw them go into its localStorage.
    private fun sync() {
        for ((k, v) in store.changes(clock())) eval("__host.put(${str(k)}, ${str(v)})")
    }

    // Takes what the JS did, then sends its messages one at a time (each
    // followed by its result) and fires due timers, until nothing is left.
    private suspend fun drain() {
        take()
        while (true) {
            val next = waiting.removeFirstOrNull()
            if (next != null) {
                val (id, msg) = next
                val dict = try {
                    AppMessageCodec.toWire(msg, keys)
                } catch (e: IllegalArgumentException) {
                    badMessages++
                    null
                }
                val ok = dict != null && sink.send(dict).also { onWire(true, dict) }
                safely { eval("__host.sent($id, $ok, null)") }
                take()
                continue
            }
            val due = timers.firstOrNull { it.second <= clock() }
            if (due != null) {
                safely { eval("__host.fire(${due.first})") }
                take()
                continue
            }
            break
        }
        scheduleTimer()
    }

    private fun safely(block: () -> Unit) {
        try {
            block()
        } catch (e: Exception) {
            errors++
            lastError = e.message
        }
    }

    private fun take() {
        val r = json.parseToJsonElement(eval("__host.take()") as String).jsonObject
        for ((k, v) in r["dirty"]!!.jsonObject) store.write(k, if (v is JsonNull) null else v.jsonPrimitive.content)
        for (o in r["out"]!!.jsonArray) {
            waiting.addLast(o.jsonObject["id"]!!.jsonPrimitive.int to o.jsonObject["msg"]!!.jsonObject)
        }
        timers = r["timers"]!!.jsonArray.map { it.jsonObject["id"]!!.jsonPrimitive.int to it.jsonObject["at"]!!.jsonPrimitive.long }
        onConsole?.let { f -> (r["logs"] as? JsonArray)?.forEach { f(it.jsonPrimitive.content) } }
    }

    private fun scheduleTimer() {
        timerJob?.cancel()
        val first = timers.firstOrNull() ?: return
        // A pinned clock only moves with setClock, which ticks.
        if (pinClock) return
        timerJob = scope.launch {
            delay(maxOf(0L, first.second - clock()))
            inputs.trySend(Input.Tick)
        }
    }

    private fun str(s: String?): String = if (s == null) "null" else JsonPrimitive(s).toString()
}
