package io.github.mrarron.royalpricecheck.watch

import io.rebble.pebblekit2.client.BasePebbleListenerService
import io.rebble.pebblekit2.common.model.PebbleDictionary
import io.rebble.pebblekit2.common.model.ReceiveResult
import io.rebble.pebblekit2.common.model.WatchIdentifier
import java.util.UUID

/**
 * The Pebble app binds this while Royal Pebble is open on the watch and hands
 * it every message the watch sends; PebbleKit JS gets the same messages
 * (docs/WATCH_PROTOCOL.md, Android companion app). With "App serves the watch"
 * off it only ACKs, so PebbleKit JS answers alone. It always ACKs, never
 * NACKs: a NACK could make the watch retry a message JS already handled.
 */
class WatchListenerService : BasePebbleListenerService() {
    override suspend fun onMessageReceived(
        watchappUUID: UUID,
        data: PebbleDictionary,
        watch: WatchIdentifier,
    ): ReceiveResult {
        if (watchappUUID == WatchLink.APP_UUID) {
            runCatching { WatchHost.received(this, watch, Dictionaries.fromPebble(data)) }
        }
        return ReceiveResult.Ack
    }

    override fun onAppOpened(watchappUUID: UUID, watch: WatchIdentifier) {
        if (watchappUUID == WatchLink.APP_UUID) runCatching { WatchHost.opened(this, watch) }
    }

    override fun onAppClosed(watchappUUID: UUID, watch: WatchIdentifier) {
        if (watchappUUID == WatchLink.APP_UUID) WatchHost.closed()
    }
}
