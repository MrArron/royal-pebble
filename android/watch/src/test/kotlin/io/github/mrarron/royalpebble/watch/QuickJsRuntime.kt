package io.github.mrarron.royalpebble.watch

import app.cash.zipline.QuickJs

/** Zipline's desktop QuickJS: the engine the app runs (zipline-android), on the JVM. */
class QuickJsRuntime : JsRuntime {
    private val js = QuickJs.create().apply {
        // The bundle (all ship data) needs more than QuickJS's small default stack.
        maxStackSize = 4L * 1024 * 1024
    }

    override fun evaluate(script: String, fileName: String): Any? = js.evaluate(script, fileName)

    override fun close() = js.close()
}
