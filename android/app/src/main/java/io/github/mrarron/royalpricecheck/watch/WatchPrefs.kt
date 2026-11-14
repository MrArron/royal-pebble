package io.github.mrarron.royalpricecheck.watch

import android.content.Context

/** The watch settings of the app, kept apart from the price checker's (Prefs). */
object WatchPrefs {
    private fun sp(c: Context) = c.getSharedPreferences("watch", Context.MODE_PRIVATE)

    /**
     * "App serves the watch": the app answers Royal Pebble on the watch
     * instead of PebbleKit JS. Off by default, so the watch keeps working with
     * PebbleKit JS alone; the JS side has its own switch that keeps it quiet
     * (Me > Help > Android app on the settings page).
     */
    fun serves(c: Context) = sp(c).getBoolean("serves", false)
    fun setServes(c: Context, v: Boolean) = sp(c).edit().putBoolean("serves", v).apply()

    /** Keep a log of every message to and from the watch (for comparing with PebbleKit JS). Holds cruise text. */
    fun wireLog(c: Context) = sp(c).getBoolean("wire_log", false)
    fun setWireLog(c: Context, v: Boolean) = sp(c).edit().putBoolean("wire_log", v).apply()
}
