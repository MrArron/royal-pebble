package io.github.mrarron.royalpebble.linktest

import android.content.Context
import android.os.Handler
import android.os.Looper
import java.io.File
import java.time.LocalTime
import java.time.format.DateTimeFormatter

// What the test saw, kept in a small file so messages that arrive while the
// screen is closed still show up. No cruise data is stored, only message names.
object LinkLog {
    private const val FILE = "link-log.txt"
    private const val MAX_LINES = 300
    private val TIME = DateTimeFormatter.ofPattern("HH:mm:ss")
    private val main = Handler(Looper.getMainLooper())
    private val listeners = mutableSetOf<() -> Unit>()

    @Synchronized
    fun add(context: Context, line: String) {
        val file = File(context.filesDir, FILE)
        val lines = (if (file.exists()) file.readLines() else emptyList()) +
            "${LocalTime.now().format(TIME)}  $line"
        file.writeText(lines.takeLast(MAX_LINES).joinToString("\n") + "\n")
        main.post { listeners.toList().forEach { it() } }
    }

    @Synchronized
    fun read(context: Context): String {
        val file = File(context.filesDir, FILE)
        return if (file.exists()) file.readText() else ""
    }

    @Synchronized
    fun clear(context: Context) {
        File(context.filesDir, FILE).delete()
        main.post { listeners.toList().forEach { it() } }
    }

    fun listen(listener: () -> Unit) { listeners += listener }
    fun unlisten(listener: () -> Unit) { listeners -= listener }
}
