package io.github.mrarron.royalpebble.watch

import app.cash.zipline.QuickJs

/** Zipline's desktop QuickJS: the engine the app runs (zipline-android), on the JVM. */
class QuickJsRuntime : JsRuntime {
    // QuickJS's default stack limit (512 KB) is enough for src/pkjs.
    private val js = QuickJs.create()

    override fun evaluate(script: String, fileName: String): Any? = js.evaluate(script, fileName)

    override fun close() = js.close()
}
