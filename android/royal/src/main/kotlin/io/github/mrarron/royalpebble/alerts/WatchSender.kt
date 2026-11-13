package io.github.mrarron.royalpebble.alerts

import java.util.UUID

/** Constants of docs/WATCH_PROTOCOL.md that sending a NOTICE needs. */
object WatchProtocol {
    val APP_UUID: UUID = UUID.fromString("c2b564f0-f418-4968-b545-08825e3fef19")

    // AppMessage keys are 10000 + the key's index in package.json "messageKeys";
    // WatchProtocolTest checks them against the file.
    const val KEY_MSG_TYPE = 10000
    const val KEY_NOTICE_COUNT = 10026
    const val KEY_NOTICES = 10027

    const val MSG_NOTICE = 6

    /** The watch keeps at most this many notices from one NOTICE message. */
    const val MAX_NOTICES = 8
}

/** What came of one send. [detail] is for the log. */
data class SendResult(val delivered: Boolean, val detail: String)

/**
 * Sends a packed NOTICE message (the `notices` bytes and their `count`) to the watch app. The
 * PebbleKit implementation lives in the app module; tests use a fake.
 */
interface WatchSender {
    fun sendNotices(count: Int, packed: ByteArray): SendResult
}
