package io.github.mrarron.royalpricecheck.cruise

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.DirectionsBoat
import androidx.compose.material.icons.filled.Event
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Share
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Stable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private class Screen(val title: String, val icon: ImageVector)

private val SCREENS = listOf(
    Screen("Cruise", Icons.Filled.DirectionsBoat),
    Screen("Days", Icons.Filled.CalendarMonth),
    Screen("Filters", Icons.Filled.FilterList),
    Screen("Events", Icons.Filled.Event),
    Screen("Me", Icons.Filled.Person),
    Screen("Share", Icons.Filled.Share),
)

/**
 * What the top-right pill does. A screen with edits it holds back until you press Save
 * (Me) sets [action]; the other screens save as you go, so the pill reads "Saved".
 */
@Stable
internal class SaveControl {
    var action: (() -> Unit)? by mutableStateOf(null)
}

internal val LocalSave = staticCompositionLocalOf { SaveControl() }

/**
 * The native version of the Pebble app's settings page: the same six screens
 * (docs/DESIGN.md §12), saving into the cruise store as you go. Until a sailing
 * is downloaded the screens show a demo cruise. Laid out like the settings page:
 * bottom navigation, the screen's name with a Save pill at the top right.
 */
@Composable
fun CruiseHost(vm: CruiseViewModel) {
    var tab by rememberSaveable { mutableIntStateOf(0) }
    val save = remember { SaveControl() }
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(start = 20.dp, end = 16.dp, top = 8.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(SCREENS[tab].title, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f))
            val action = save.action
            if (action != null) Button(onClick = action) { Text("Save") }
            else FilledTonalButton(onClick = {}, enabled = false) { Text("Saved") }
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            CompositionLocalProvider(LocalSave provides save) {
                when (tab) {
                    0 -> CruiseTab(vm, goTo = { tab = it })
                    1 -> DaysTab(vm)
                    2 -> FiltersTab(vm)
                    3 -> EventsTab(vm)
                    4 -> MeTab(vm)
                    else -> ShareTab(vm)
                }
            }
        }
        NavigationBar(windowInsets = WindowInsets(0, 0, 0, 0), containerColor = MaterialTheme.colorScheme.surfaceContainer) {
            SCREENS.forEachIndexed { i, sc ->
                NavigationBarItem(
                    selected = tab == i,
                    onClick = { save.action = null; tab = i },
                    icon = { Icon(sc.icon, contentDescription = null) },
                    label = { Text(sc.title, maxLines = 1, fontSize = 11.sp) },
                )
            }
        }
    }
}

/** Screen scaffolding: scrolling column with the usual padding. */
@Composable
internal fun Page(content: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) { content() }
}

@Composable
internal fun Section(title: String? = null, content: @Composable () -> Unit) {
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (title != null) Text(title, style = MaterialTheme.typography.titleMedium)
            content()
        }
    }
}

@Composable
internal fun Note(text: String) = Text(text, style = MaterialTheme.typography.bodySmall)

@Composable
internal fun ErrorText(text: String) = Text(text, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)

@Composable
internal fun SwitchRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit, sub: String? = null) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Switch(checked, onChange)
        Column(Modifier.weight(1f)) {
            Text(label)
            if (sub != null) Note(sub)
        }
    }
}

/** A wrapping row of single-choice chips. */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
internal fun <T> Choice(options: List<T>, selected: T?, label: (T) -> String, onPick: (T) -> Unit) {
    androidx.compose.foundation.layout.FlowRow(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        options.forEach { o -> FilterChip(selected == o, { onPick(o) }, label = { Text(label(o)) }) }
    }
}
