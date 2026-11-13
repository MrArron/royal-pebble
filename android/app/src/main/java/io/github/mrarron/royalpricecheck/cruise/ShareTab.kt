package io.github.mrarron.royalpricecheck.cruise

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import io.github.mrarron.royalpebble.settings.CruiseSession
import io.github.mrarron.royalpebble.settings.SharePlan

/** Share my plan (docs/DESIGN.md §12.2): send your stars, entries and day settings to a travel companion, or import theirs. */
@Composable
fun ShareTab(vm: CruiseViewModel) {
    val ctx = LocalContext.current
    var withCabin by rememberSaveable { mutableStateOf(false) }
    var pasted by rememberSaveable { mutableStateOf("") }
    var read by remember { mutableStateOf<CruiseSession.PlanRead?>(null) }
    var reviewing by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<String?>(null) }
    val take = remember { mutableStateMapOf<Int, Boolean>() }

    val counts = vm.read { SharePlan.counts(SharePlan.build(myPlan(), withCabin)) }
    Page {
        Section("Share my plan") {
            Text("Goes in the message: ${counts.stars} stars, ${counts.personal} personal entries, ${counts.daySettings} day settings, " +
                "${counts.itinerary} itinerary changes, ${counts.venues} venue fixes" + (if (withCabin) ", ${counts.cabin} cabin details." else "."))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Checkbox(withCabin, { withCabin = it })
                Text("Include cabin details (we share a cabin)", Modifier.weight(1f))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button({
                    val text = vm.read { sharePlanText(withCabin) }
                    val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
                    ctx.startActivity(Intent.createChooser(send, "Share plan").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }) { Text("Share plan") }
                OutlinedButton({
                    val text = vm.read { sharePlanText(withCabin) }
                    (ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Royal Pebble plan", text))
                    result = "Copied."
                }) { Text("Copy") }
            }
            Note("The message holds your plan as text. Whoever gets it opens Royal Pebble, goes to Share my plan and pastes it into Import plan. This works with the Pebble app's settings page too.")
        }
        Section("Import plan") {
            OutlinedTextField(pasted, {
                pasted = it; reviewing = false; result = null; take.clear()
                read = if (it.isBlank()) null else vm.session.readPlan(it)
            }, label = { Text("Paste the whole message") }, minLines = 3, modifier = Modifier.fillMaxWidth())
            when (val r = read) {
                null -> {}
                is CruiseSession.PlanRead.Error -> if (r.message.isNotEmpty()) ErrorText(r.message)
                is CruiseSession.PlanRead.Ready -> {
                    val items = r.diff.items
                    if (items.isEmpty()) {
                        Text("Nothing to import. Your plan already has everything in theirs.")
                    } else {
                        Text("${items.size} ${if (items.size == 1) "difference" else "differences"} · same ship and sail date")
                        if (!reviewing) {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button({ result = applyImport(vm, items, emptyMap()); pasted = ""; read = null }) { Text("Accept all") }
                                OutlinedButton({ reviewing = true }) { Text("Review each") }
                                TextButton({ pasted = ""; read = null }) { Text("Reject import") }
                            }
                            Note("Accept all adds their stars and uses their settings where they differ. It never unstars or deletes anything of yours.")
                        } else {
                            items.forEachIndexed { i, item ->
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Checkbox(take[i] ?: item.takeTheirs, { take[i] = it })
                                    Text(SharePlan.describe(item), Modifier.weight(1f))
                                }
                            }
                            Note("Ticked: take theirs. Unticked: keep yours.")
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button({ result = applyImport(vm, items, take.toMap()); pasted = ""; read = null; reviewing = false; take.clear() }) { Text("Apply") }
                                TextButton({ pasted = ""; read = null; reviewing = false; take.clear() }) { Text("Reject import") }
                            }
                        }
                    }
                    if (r.diff.venueFixesSkipped > 0) Note("${r.diff.venueFixesSkipped} venue fixes in this plan aren't imported here yet; the Pebble app's settings page imports them.")
                }
            }
            result?.let { Text(it) }
        }
    }
}

private fun applyImport(vm: CruiseViewModel, items: List<SharePlan.Item>, take: Map<Int, Boolean>): String {
    var done: CruiseSession.Applied? = null
    vm.edit { done = applyPlan(items, take) }
    val a = done ?: return "Nothing changed."
    return "Imported: ${a.stars} stars added, ${a.unstarred} unstarred, ${a.personal} entries, ${a.days} day settings, ${a.cabin} cabin details."
}
