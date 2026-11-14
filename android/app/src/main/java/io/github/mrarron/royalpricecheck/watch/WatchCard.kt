package io.github.mrarron.royalpricecheck.watch

import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

/** Settings > Watch: "App serves the watch", the test log and the watch message log. */
@Composable
fun WatchCard() {
    val c = LocalContext.current
    var serves by remember { mutableStateOf(WatchPrefs.serves(c)) }
    var wire by remember { mutableStateOf(WatchPrefs.wireLog(c)) }
    var status by remember { mutableStateOf(WatchHost.status(c)) }
    LaunchedEffect(serves) {
        while (true) {
            status = WatchHost.status(c)
            delay(2_000)
        }
    }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Watch", style = MaterialTheme.typography.titleMedium)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Switch(serves, { v ->
                    serves = v
                    WatchPrefs.setServes(c, v)
                    WatchHost.servesChanged(c, v)
                })
                Text("App serves the watch")
            }
            Text(
                "This app sends Royal Pebble its schedule and answers the watch (directory, routes, voice, " +
                    "stars) instead of the Pebble app's own phone side. Turn on \"Android app serves the watch\" " +
                    "on Royal Pebble's settings page (Me > Help) too, so the two don't both answer. " +
                    "The watch then uses this app's cruise data: until you download a cruise here, it shows " +
                    "NO CRUISE YET.",
                style = MaterialTheme.typography.bodySmall,
            )
            Text(status, style = MaterialTheme.typography.bodySmall)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Switch(wire, { v ->
                    wire = v
                    WatchPrefs.setWireLog(c, v)
                    WatchHost.logApp(c, "switch", "watch message log: " + if (v) "off -> on" else "on -> off")
                })
                Text("Log every message to and from the watch")
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = {
                    val send = Intent(Intent.ACTION_SEND).setType("text/plain")
                        .putExtra(Intent.EXTRA_TEXT, WatchHost.testLogText(c))
                    c.startActivity(Intent.createChooser(send, "Share the test log"))
                }) { Text("Share test log") }
                OutlinedButton(onClick = {
                    WatchHost.clearWireLog(c)
                    WatchHost.clearAppLog(c)
                }) { Text("Clear") }
            }
            Text("The test log says which build and switches served the watch, then the app's usage log" +
                (if (wire) " and every watch message" else "") + ". It holds your cruise's titles and cabin " +
                "details. Keep it private.",
                style = MaterialTheme.typography.bodySmall)
        }
    }
}
