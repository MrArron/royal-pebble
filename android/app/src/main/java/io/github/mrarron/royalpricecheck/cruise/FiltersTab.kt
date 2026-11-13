package io.github.mrarron.royalpricecheck.cruise

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.mrarron.royalpebble.settings.CruiseData

/** Settings > Filters (docs/DESIGN.md §12.4): featured events, age filters, categories. Saves as you go. */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
fun FiltersTab(vm: CruiseViewModel) {
    val settings = vm.read { settings() }
    val cats = vm.read { CruiseData.categorySummary(bundle()) }
    val hidden = CruiseData.hiddenCats(settings)
    val ages = CruiseData.ageFilters(settings)
    val featured = CruiseData.showFeatured(settings)
    fun save(h: List<String> = hidden, a: List<String> = ages, f: Boolean = featured) = vm.edit { saveFilters(h, a, f) }

    Page {
        Note("Changes save as you make them. Hidden events still show in search, marked Hidden on watch. Starred and booked events always reach the watch.")
        Section {
            SwitchRow("Featured events", featured, { save(f = it) }, "Home's fallback card when nothing else is next.")
        }
        Section("Ages") {
            SwitchRow("Hide Adult only events", "adult" in ages, { on -> save(a = if (on) ages + "adult" else ages - "adult") }, "18+ and 21+")
            SwitchRow("Hide Teen and Kid only events", "young" in ages, { on -> save(a = if (on) ages + "young" else ages - "young") }, "17 and under")
            SwitchRow("Hide Family events", "family" in ages, { on -> save(a = if (on) ages + "family" else ages - "family") },
                "Title starts with \"Family\" or contains \"All Ages\", or the venue is Adventure Ocean Theater")
            Note("Events you star always show. Events with no age listed never hide. Casino games are in the Casino category below.")
        }
        Section("Categories") {
            if (cats.isEmpty()) Note("No events yet. Download your sailing first.")
            cats.forEach { c ->
                val shown = c.name !in hidden
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    SwitchRow(c.name, shown, { on ->
                        // A category switch decides the whole category; subcategory choices start over.
                        val rest = hidden.filter { it != c.name && !it.startsWith(c.name + " / ") }
                        save(h = if (on) rest else rest + c.name)
                    }, "${c.count} events")
                    if (shown && c.subs.size > 1) {
                        androidx.compose.foundation.layout.FlowRow(
                            horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            c.subs.forEach { (sub, n) ->
                                val key = c.name + " / " + sub
                                FilterChip(key !in hidden, { save(h = if (key in hidden) hidden - key else hidden + key) },
                                    label = { Text((sub.ifEmpty { "Other" }) + " · $n") })
                            }
                        }
                    }
                }
            }
        }
    }
}
