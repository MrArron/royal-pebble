package io.github.mrarron.royalpebble.linktest

import io.rebble.pebblekit2.client.BasePebbleListenerService
import io.rebble.pebblekit2.common.model.PebbleDictionary
import io.rebble.pebblekit2.common.model.ReceiveResult
import io.rebble.pebblekit2.common.model.WatchIdentifier
import java.util.UUID

// Logs every watch-to-phone message the Pebble app hands this app. It always
// ACKs: PebbleKit JS answers the same messages, and a NACK from here could make
// the watch retry a message JS already handled.
class LinkListenerService : BasePebbleListenerService() {
    override suspend fun onMessageReceived(
        watchappUUID: UUID,
        data: PebbleDictionary,
        watch: WatchIdentifier,
    ): ReceiveResult {
        val type = Protocol.intValue(data[Protocol.KEY_MSG_TYPE])
        val bytes = data.values.sumOf { it.size }
        LinkLog.add(this, "got ${Protocol.name(type)} from the watch (${data.size} keys, $bytes bytes)")
        return ReceiveResult.Ack
    }

    override fun onAppOpened(watchappUUID: UUID, watch: WatchIdentifier) {
        LinkLog.add(this, "Royal Pebble opened on the watch")
    }

    override fun onAppClosed(watchappUUID: UUID, watch: WatchIdentifier) {
        LinkLog.add(this, "Royal Pebble closed on the watch")
    }
}
