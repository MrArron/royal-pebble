package io.github.mrarron.royalpricecheck

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import io.github.mrarron.royalpebble.alerts.PriceWatch
import io.github.mrarron.royalpebble.alerts.QuietHours
import io.github.mrarron.royalpebble.alerts.WatchRule

/**
 * Settings > Price watches: watch Cruise Planner items you haven't bought, and mute or unmute
 * alerts. Each background check prices every watch; an alert goes to the phone and the watch.
 */
@Composable
internal fun PriceWatchesPage(vm: MainViewModel) {
    Column(Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Watch an item you haven't bought", style = MaterialTheme.typography.titleMedium)
        Text(
            "Open the item in the Cruise Planner on royalcaribbean.com (drink package, internet, excursion, dining), " +
                "then share its link to Royal Pebble or paste it here. Each price check also prices your watches, and " +
                "you get a phone notification and a watch alert when the price drops.",
            style = MaterialTheme.typography.bodySmall,
        )
        AddWatchForm(vm)

        Text("Your watches", style = MaterialTheme.typography.titleMedium)
        if (vm.watches.isEmpty()) Text("No price watches yet.")
        val muted = vm.mutes.mapTo(HashSet()) { it.key }
        vm.watches.forEach { w -> WatchCardRow(vm, w, w.muteKey in muted) }

        val bookedMutes = vm.mutes.filter { it.key.startsWith("price|") }
        Text("Muted booked-item alerts", style = MaterialTheme.typography.titleMedium)
        if (bookedMutes.isEmpty()) {
            Text("None. Tap Mute this alert on a price notification, or Mute on a drop in Prices, to stop one item's alerts.", style = MaterialTheme.typography.bodySmall)
        }
        bookedMutes.forEach { m ->
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(m.label, Modifier.weight(1f).padding(top = 12.dp))
                OutlinedButton({ vm.setMuted(m.key, m.label, false) }) { Text("Unmute") }
            }
        }
        Text("Alerts from background checks arrive only from ${vm.quiet.text()} (Settings > Price checks > Alert hours).", style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun AddWatchForm(vm: MainViewModel) {
    var link by rememberSaveable { mutableStateOf("") }
    // A link shared to the app fills the form.
    androidx.compose.runtime.LaunchedEffect(vm.sharedLink) { vm.sharedLink?.let { link = it } }
    var name by rememberSaveable { mutableStateOf("") }
    var priceNow by rememberSaveable { mutableStateOf("") }
    var ruleCode by rememberSaveable { mutableStateOf(WatchRule.ANY_DROP.code) }
    var percent by rememberSaveable { mutableStateOf("20") }
    var target by rememberSaveable { mutableStateOf("") }
    var guest by rememberSaveable { mutableStateOf("adult") }
    var message by remember { mutableStateOf<String?>(null) }
    val rule = WatchRule.of(ruleCode)
    val money = KeyboardOptions(keyboardType = KeyboardType.Decimal)

    OutlinedTextField(link, { link = it; vm.sharedLink = null }, label = { Text("Cruise Planner link") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
    OutlinedTextField(name, { name = it }, label = { Text("Name (optional, Royal's title otherwise)") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
    OutlinedTextField(priceNow, { priceNow = it }, label = { Text("Price now (optional)") }, modifier = Modifier.fillMaxWidth(), singleLine = true, keyboardOptions = money)
    Text("Leave Price now empty and the next check sets it.", style = MaterialTheme.typography.bodySmall)
    Text("Alert me when", style = MaterialTheme.typography.labelLarge)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FilterChip(rule == WatchRule.ANY_DROP, { ruleCode = WatchRule.ANY_DROP.code }, label = { Text("Any drop") })
        FilterChip(rule == WatchRule.PERCENT, { ruleCode = WatchRule.PERCENT.code }, label = { Text("% below") })
        FilterChip(rule == WatchRule.BELOW, { ruleCode = WatchRule.BELOW.code }, label = { Text("Below my price") })
    }
    when (rule) {
        WatchRule.ANY_DROP -> Text("Any price below the price when you set the watch.", style = MaterialTheme.typography.bodySmall)
        WatchRule.PERCENT -> OutlinedTextField(percent, { percent = it }, label = { Text("Percent below the price when set") }, singleLine = true, keyboardOptions = money)
        WatchRule.BELOW -> OutlinedTextField(target, { target = it }, label = { Text("My price") }, singleLine = true, keyboardOptions = money)
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FilterChip(guest == "adult", { guest = "adult" }, label = { Text("Adult price") })
        FilterChip(guest == "child", { guest = "child" }, label = { Text("Child price") })
    }
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Button({
            val err = vm.addWatch(link, name, priceNow, rule, percent, target, guest)
            message = err ?: "Watch added. It is priced by the next check (Prices > Run now, or the background check)."
            if (err == null) { link = ""; name = ""; priceNow = ""; target = "" }
        }) { Text("Add watch") }
    }
    message?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
}

@Composable
private fun WatchCardRow(vm: MainViewModel, w: PriceWatch, muted: Boolean) {
    val sym = if (w.currency.equals("GBP", true)) "£" else if (w.currency.equals("EUR", true)) "€" else "$"
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(w.name.ifBlank { w.code }, style = MaterialTheme.typography.titleSmall)
            Text(w.ruleText(sym))
            val price = w.lastPrice
            val status = when {
                price != null -> "Now " + Notifier.money(price, w.currency) + if (w.isHit(price)) " · below your trigger" else ""
                w.lastStatus == "not_available_for_passenger" -> "Not available for this guest or sailing"
                w.lastStatus == "no_longer_for_sale" -> "Not for sale, or already booked"
                else -> "Last check: ${w.lastStatus.replace('_', ' ')}"
            }
            Text(status, color = if (price != null && w.isHit(price)) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
            if (w.lastCheckedAt > 0) {
                Text("Checked " + java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.MEDIUM, java.text.DateFormat.SHORT).format(java.util.Date(w.lastCheckedAt)), style = MaterialTheme.typography.bodySmall)
            }
            Text(w.code + (if (w.reservationId.isNotBlank()) " · booking ${w.reservationId}" else "") + " · ${w.guestAge}", style = MaterialTheme.typography.bodySmall)
            if (muted) Text("Muted: no alerts until you unmute it.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton({ vm.setMuted(w.muteKey, w.name.ifBlank { w.code }, !muted) }) { Text(if (muted) "Unmute" else "Mute") }
                TextButton({ vm.removeWatch(w.id) }) { Text("Remove") }
            }
        }
    }
}

/** Settings > Price checks > Alert hours. The choices never reach past 10 PM or before 7 AM. */
@Composable
internal fun AlertHoursSection(vm: MainViewModel) {
    val c = androidx.compose.ui.platform.LocalContext.current
    Text("Alert hours", style = MaterialTheme.typography.titleMedium)
    Text("From", style = MaterialTheme.typography.labelLarge)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        QuietHours.FROM_CHOICES.forEach { m ->
            FilterChip(vm.quiet.fromMinute == m, { vm.changeQuiet(vm.quiet.copy(fromMinute = m)) }, label = { Text(QuietHours.clock(m).replace(":00", "")) })
        }
    }
    Text("Until", style = MaterialTheme.typography.labelLarge)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        QuietHours.UNTIL_CHOICES.forEach { m ->
            FilterChip(vm.quiet.untilMinute == m, { vm.changeQuiet(vm.quiet.copy(untilMinute = m)) }, label = { Text(QuietHours.clock(m).replace(":00", "")) })
        }
    }
    Text(
        "Price alerts, price watches and check-in changes from background checks reach the phone and the watch only from " +
            "${vm.quiet.text()}. Anything found overnight waits and goes out when the hours open. Run now always shows its results right away.",
        style = MaterialTheme.typography.bodySmall,
    )
    AlertDelivery.heldText(c)?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
}
