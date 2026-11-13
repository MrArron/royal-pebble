package io.github.mrarron.royalpricecheck.watch

import android.content.Context
import io.github.mrarron.royalpebble.watch.MessageKeys
import io.github.mrarron.royalpebble.watch.WireDict
import io.github.mrarron.royalpebble.watch.WireValue
import io.rebble.pebblekit2.client.DefaultPebbleSender
import io.rebble.pebblekit2.common.model.TransmissionResult
import io.rebble.pebblekit2.common.model.WatchIdentifier
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
import java.util.UUID

/**
 * The one way the app sends to Royal Pebble on the watch (PebbleKit Android 2),
 * so messages from the watch server and from background checks never mix: one
 * message at a time, and a notice never goes out between a slice's BEGIN and
 * END (docs/WATCH_PROTOCOL.md, Android companion app).
 */
object WatchLink {
    val APP_UUID: UUID = UUID.fromString("c2b564f0-f418-4968-b545-08825e3fef19")

    private const val MSG_BEGIN = 1
    private const val MSG_END = 4
    private const val MSG_NOTICE = 6

    private val mutex = Mutex()
    private val inSlice = MutableStateFlow(false)
    @Volatile private var sender: DefaultPebbleSender? = null

    /** package.json's message keys, as the app was built with them. */
    val keys: MessageKeys by lazy {
        MessageKeys.fromPackageJson(
            WatchLink::class.java.classLoader!!.getResourceAsStream("royalpebble/package.json")!!.use {
                it.readBytes().toString(Charsets.UTF_8)
            })
    }

    private fun sender(c: Context): DefaultPebbleSender =
        sender ?: synchronized(this) { sender ?: DefaultPebbleSender(c.applicationContext).also { sender = it } }

    private fun msgType(dict: WireDict): Int? = (dict[keys.id("msg_type")!!] as? WireValue.Int32)?.value

    private suspend fun send(c: Context, dict: WireDict, watch: WatchIdentifier?): TransmissionResult? {
        val data = Dictionaries.toPebble(dict)
        // No watch named: every connected watch, as the Pebble app picks.
        val result = if (watch == null) sender(c).sendDataToPebble(APP_UUID, data)
        else sender(c).sendDataToPebble(APP_UUID, data, listOf(watch))
        return result?.values?.firstOrNull()
    }

    /** A message from the watch server; true when the watch ACKed it. */
    internal suspend fun sendFromServer(c: Context, dict: WireDict, watch: WatchIdentifier?): Boolean {
        val type = msgType(dict)
        if (type == MSG_BEGIN) inSlice.value = true
        val ok = mutex.withLock { send(c, dict, watch) } == TransmissionResult.Success
        // index.js stops a slice at the first failed message, so a failure ends it too.
        if (type == MSG_END || !ok) inSlice.value = false
        return ok
    }

    /** The server stopped (the watch app closed): no slice is under way any more. */
    internal fun serverStopped() {
        inSlice.value = false
    }

    /**
     * Sends a NOTICE (`notice_count` notices packed like pack.packNotices) to
     * Royal Pebble, opening it on the watch first when another app is open.
     * Waits (up to 30 s) for a slice that is being sent to finish. True when
     * the watch ACKed it.
     */
    suspend fun sendNotice(context: Context, noticeCount: Int, notices: ByteArray): Boolean {
        val dict: WireDict = linkedMapOf(
            keys.id("msg_type")!! to WireValue.Int32(MSG_NOTICE),
            keys.id("notice_count")!! to WireValue.Int32(noticeCount),
            keys.id("notices")!! to WireValue.Bytes(notices),
        )
        repeat(2) { attempt ->
            withTimeoutOrNull(30_000) { inSlice.first { !it } }
            val r = mutex.withLock { send(context, dict, null) }
            when {
                r == TransmissionResult.Success -> return true
                r == TransmissionResult.FailedDifferentAppOpen && attempt == 0 -> {
                    sender(context).startAppOnTheWatch(APP_UUID)
                    // Opening it starts a slice when the app serves the watch; let it begin.
                    delay(3_000)
                }
                else -> return false
            }
        }
        return false
    }
}
