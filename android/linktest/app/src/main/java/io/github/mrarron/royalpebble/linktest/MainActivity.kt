package io.github.mrarron.royalpebble.linktest

import android.app.Activity
import android.os.Bundle
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import io.rebble.pebblekit2.client.DefaultPebbleAndroidAppPicker
import io.rebble.pebblekit2.client.DefaultPebbleSender
import io.rebble.pebblekit2.common.model.TransmissionResult
import io.rebble.pebblekit2.common.model.WatchIdentifier
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

// One screen: open Royal Pebble on the watch, send it one test notice, and show
// what the watch sent this app.
class MainActivity : Activity() {
    private val scope = MainScope()
    private lateinit var sender: DefaultPebbleSender
    private lateinit var logView: TextView
    private val refresh: () -> Unit = { logView.text = LinkLog.read(this).ifEmpty { "Nothing yet." } }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        sender = DefaultPebbleSender(this)

        val pad = (16 * resources.displayMetrics.density).toInt()
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad * 3, pad, pad)
        }
        fun button(label: String, onClick: () -> Unit) =
            column.addView(Button(this).apply { text = label; setOnClickListener { onClick() } },
                LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))

        column.addView(TextView(this).apply {
            text = "Royal Pebble link test\n\n" +
                "1. Open Royal Pebble on the watch.\n" +
                "2. Send the test notice: the watch should buzz and show " +
                "SCHEDULE CHANGE / MOVED for \"Android app link test\".\n" +
                "3. Use Royal Pebble as usual and watch the log below fill with " +
                "what the watch sends.\n"
        })
        button("Open Royal Pebble on the watch") { openApp() }
        button("Send test notice") { sendNotice() }
        button("Clear log") { LinkLog.clear(this) }
        logView = TextView(this).apply { setTextIsSelectable(true); typeface = android.graphics.Typeface.MONOSPACE }
        column.addView(logView)
        setContentView(ScrollView(this).apply { addView(column) })

        scope.launch {
            val pebbleApp = DefaultPebbleAndroidAppPicker.getInstance(this@MainActivity).getCurrentlySelectedApp()
            LinkLog.add(this@MainActivity, "Pebble app: ${pebbleApp ?: "none found"}")
        }
    }

    override fun onResume() {
        super.onResume()
        LinkLog.listen(refresh)
        refresh()
    }

    override fun onPause() {
        LinkLog.unlisten(refresh)
        super.onPause()
    }

    override fun onDestroy() {
        scope.cancel()
        sender.close()
        super.onDestroy()
    }

    private fun openApp() = scope.launch {
        val result = sender.startAppOnTheWatch(Protocol.APP_UUID)
        LinkLog.add(this@MainActivity, "open app: ${describe(result)}")
    }

    private fun sendNotice() = scope.launch {
        val result = sender.sendDataToPebble(Protocol.APP_UUID, Protocol.testNotice())
        LinkLog.add(this@MainActivity, "sent NOTICE: ${describe(result)}")
    }

    private fun describe(result: Map<WatchIdentifier, TransmissionResult>?): String = when {
        result == null -> "Pebble app not reachable"
        result.isEmpty() -> "no watch connected"
        else -> result.values.joinToString { r ->
            when (r) {
                TransmissionResult.Success -> "watch ACKed"
                TransmissionResult.FailedWatchNacked -> "watch NACKed"
                TransmissionResult.FailedWatchNotConnected -> "watch not connected"
                TransmissionResult.FailedTimeout -> "timed out"
                TransmissionResult.FailedDifferentAppOpen -> "Royal Pebble isn't open on the watch"
                TransmissionResult.FailedNoPermissions -> "no permission (companionApp entry or Pebble app permission)"
                is TransmissionResult.Unknown -> "unknown (${r.message})"
            }
        }
    }
}
