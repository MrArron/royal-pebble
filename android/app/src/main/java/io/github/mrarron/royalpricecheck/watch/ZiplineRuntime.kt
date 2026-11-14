package io.github.mrarron.royalpricecheck.watch

import app.cash.zipline.QuickJs
import io.github.mrarron.royalpebble.watch.JsRuntime

/**
 * Zipline's QuickJS, made on first use so it lives on the engine's thread
 * (QuickJS isn't thread safe; WatchHost keeps it on one thread).
 */
class ZiplineRuntime : JsRuntime {
    private var js: QuickJs? = null

    private fun engine(): QuickJs = js ?: QuickJs.create().also {
        // Some headroom over QuickJS's 512 KB default (the tests pass with it); the
        // engine's thread has a 4 MB stack (WatchHost), so the limit trips first.
        it.maxStackSize = 1L * 1024 * 1024
        js = it
    }

    override fun evaluate(script: String, fileName: String): Any? = engine().evaluate(script, fileName)

    override fun close() {
        js?.close()
        js = null
    }
}
