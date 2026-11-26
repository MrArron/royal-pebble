package io.github.mrarron.royalpricecheck

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import java.io.File

/**
 * Copy and Share for a text report (the price check's results and its full output),
 * like Settings > Watch > Share log file: Share sends a .txt file through the same
 * FileProvider (cache/logs), with the text itself too when it is short.
 */
object ReportShare {
    fun copy(c: Context, label: String, text: String) {
        (c.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText(label, text))
    }

    fun share(c: Context, fileName: String, title: String, text: String) {
        val dir = File(c.cacheDir, "logs").apply { mkdirs() }
        val f = File(dir, fileName).apply { writeText(text) }
        val uri = FileProvider.getUriForFile(c, c.packageName + ".logs", f)
        val send = Intent(Intent.ACTION_SEND).setType("text/plain")
            .putExtra(Intent.EXTRA_STREAM, uri)
            .putExtra(Intent.EXTRA_SUBJECT, f.name)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        if (text.length <= 50_000) send.putExtra(Intent.EXTRA_TEXT, text)
        c.startActivity(Intent.createChooser(send, title))
    }

    /** The Summary as plain text: what the screen shows, in the same order. */
    fun summaryText(r: RunResult, notes: List<io.github.mrarron.royalpebble.prices.PriceNote> = emptyList()): String = buildString {
        val at = java.text.DateFormat.getDateTimeInstance().format(java.util.Date(r.finishedAt))
        appendLine(if (r.ok) "Last check: $at (${r.itemsChecked} items)" else "Last check failed: $at")
        if (!r.ok && !r.error.isNullOrBlank()) appendLine(r.error)
        if (r.script.isNotBlank()) appendLine("Script: ${r.script}")
        fun drop(d: PriceDrop) {
            appendLine("- ${d.itemName}" + if (d.alert) (if (d.decision == "rebook") " (Rebook)" else " (Consider rebooking)") else "")
            if (d.guestName.isNotBlank()) appendLine("  ${d.guestName}")
            appendLine("  Paid ${Notifier.money(d.paid, d.currency)} -> now ${Notifier.money(d.current, d.currency)} " +
                "(save ${Notifier.money(d.saving, d.currency)}${if (d.perNight) " per night" else ""})")
        }
        if (r.alerts.isNotEmpty()) { appendLine(); appendLine("Rebook to save"); r.alerts.forEach(::drop) }
        if (r.bookings.isNotEmpty()) {
            appendLine(); appendLine("Bookings")
            r.bookings.forEach { b ->
                appendLine("- ${b.shipName} · ${prettyDate(b.sailDate)}")
                appendLine("  Check-in: ${b.checkinLabel}")
                if (b.stateroom.isNotBlank()) appendLine("  Stateroom: ${b.stateroom}")
                if (b.finalPaymentDate.isNotBlank()) appendLine("  Final payment: ${prettyDate(b.finalPaymentDate)}")
                b.balanceDue?.let { appendLine(if (it) "  Balance due" else "  Paid in full") }
            }
        }
        if (notes.isNotEmpty()) { appendLine(); appendLine("Notes on this check"); append(io.github.mrarron.royalpebble.prices.PriceCheckNotes.text(notes)); appendLine() }
        if (r.guestCheckin.isNotEmpty()) {
            appendLine(); appendLine("Check-in by guest")
            r.guestCheckin.forEach { g -> appendLine("- ${g.status}" + if (g.window.isNotBlank()) " (boarding window ${g.window})" else "") }
        }
        val others = r.drops.filter { !it.alert }
        if (others.isNotEmpty()) { appendLine(); appendLine("Other price drops"); others.forEach(::drop) }
    }

    /** The script's whole output without terminal colours. */
    fun logText(lines: List<String>): String = lines.joinToString("\n") { stripAnsi(it) } + "\n"
}

/** Copy and Share buttons with a one-line result under them. [text] is built only when pressed. */
@Composable
fun ReportButtons(label: String, fileName: String, text: () -> String) {
    val c = LocalContext.current
    var said by remember { mutableStateOf<String?>(null) }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = {
                val t = text()
                said = runCatching { ReportShare.copy(c, label, t); "Copied ${t.lines().size} lines" }
                    .getOrElse { "Couldn't copy: ${it.message}" }
            }) { Text("Copy") }
            OutlinedButton(onClick = {
                said = runCatching { ReportShare.share(c, fileName, "Share the $label", text()); null }
                    .getOrElse { "Couldn't share: ${it.message}" }
            }) { Text("Share") }
        }
        said?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
    }
}
