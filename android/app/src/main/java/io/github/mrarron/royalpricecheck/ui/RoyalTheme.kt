package io.github.mrarron.royalpricecheck.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/**
 * The Royal Pebble look: the Pebble settings page's palette (docs/DESIGN.md §2,
 * "Settings page palette"), as a fixed Material 3 scheme. Dynamic colour is off on
 * purpose, so the phone's wallpaper never changes how the app looks.
 *
 * The settings page is light only. The dark scheme keeps its teal hues and is
 * mapped by the Material 3 tonal rules (primary at tone 80 on dark surfaces).
 */
private val LightScheme = lightColorScheme(
    primary = Color(0xFF006A6A),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFF9CF1F0),
    onPrimaryContainer = Color(0xFF002020),
    secondary = Color(0xFF4A6363),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFCCE8E7),
    onSecondaryContainer = Color(0xFF051F1F),
    tertiary = Color(0xFF3B5F8F),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFD3E4FF),
    onTertiaryContainer = Color(0xFF001C38),
    background = Color(0xFFF4FBFA),
    onBackground = Color(0xFF161D1D),
    surface = Color(0xFFF4FBFA),
    onSurface = Color(0xFF161D1D),
    surfaceVariant = Color(0xFFDAE5E4),
    onSurfaceVariant = Color(0xFF3F4948),
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFEFF5F4),
    surfaceContainer = Color(0xFFE9EFEE),
    surfaceContainerHigh = Color(0xFFE3E9E9),
    surfaceContainerHighest = Color(0xFFDDE4E3),
    outline = Color(0xFF6F7979),
    outlineVariant = Color(0xFFBEC9C8),
    error = Color(0xFFBA1A1A),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFFDAD6),
    onErrorContainer = Color(0xFF410002),
)

private val DarkScheme = darkColorScheme(
    primary = Color(0xFF80D4D3),
    onPrimary = Color(0xFF003737),
    primaryContainer = Color(0xFF004F4F),
    onPrimaryContainer = Color(0xFF9CF1F0),
    secondary = Color(0xFFB0CCCB),
    onSecondary = Color(0xFF1B3534),
    secondaryContainer = Color(0xFF324B4B),
    onSecondaryContainer = Color(0xFFCCE8E7),
    tertiary = Color(0xFFA4C9FE),
    onTertiary = Color(0xFF00315B),
    tertiaryContainer = Color(0xFF214876),
    onTertiaryContainer = Color(0xFFD3E4FF),
    background = Color(0xFF0E1514),
    onBackground = Color(0xFFDDE4E3),
    surface = Color(0xFF0E1514),
    onSurface = Color(0xFFDDE4E3),
    surfaceVariant = Color(0xFF3F4948),
    onSurfaceVariant = Color(0xFFBEC9C8),
    surfaceContainerLowest = Color(0xFF090F0F),
    surfaceContainerLow = Color(0xFF161D1D),
    surfaceContainer = Color(0xFF1A2121),
    surfaceContainerHigh = Color(0xFF252B2B),
    surfaceContainerHighest = Color(0xFF303636),
    outline = Color(0xFF899392),
    outlineVariant = Color(0xFF3F4948),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005),
    errorContainer = Color(0xFF93000A),
    onErrorContainer = Color(0xFFFFDAD6),
)

/** Cards 28 dp, text fields 12 dp, filter chips 36 dp tall (so 18 dp corners). Buttons stay pills. */
private val RoyalShapes = Shapes(
    extraSmall = RoundedCornerShape(12.dp),
    small = RoundedCornerShape(18.dp),
    medium = RoundedCornerShape(28.dp),
    large = RoundedCornerShape(28.dp),
    extraLarge = RoundedCornerShape(28.dp),
)

/** Colours the Material 3 roles don't cover: the settings page's "warning" container. */
class RoyalExtras(val warningContainer: Color, val onWarningContainer: Color)

private val LightExtras = RoyalExtras(Color(0xFFFFDDB5), Color(0xFF2A1700))
private val DarkExtras = RoyalExtras(Color(0xFF5B3A00), Color(0xFFFFDDB5))

private val LocalExtras = staticCompositionLocalOf { LightExtras }

val MaterialTheme.royal: RoyalExtras
    @Composable @ReadOnlyComposable get() = LocalExtras.current

@Composable
fun RoyalTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalExtras provides if (dark) DarkExtras else LightExtras) {
        MaterialTheme(colorScheme = if (dark) DarkScheme else LightScheme, shapes = RoyalShapes, content = content)
    }
}

/** Where a filled value came from, so the chip can say so. */
enum class ChipKind { Source, Edited }

/**
 * The settings page's small status chips: `From booking` (secondary container) and
 * `Edited` (warning container).
 */
@Composable
fun StatusChip(text: String, kind: ChipKind = ChipKind.Source, modifier: Modifier = Modifier) {
    val (bg, fg) = when (kind) {
        ChipKind.Source -> MaterialTheme.colorScheme.secondaryContainer to MaterialTheme.colorScheme.onSecondaryContainer
        ChipKind.Edited -> MaterialTheme.royal.warningContainer to MaterialTheme.royal.onWarningContainer
    }
    Row(modifier.clip(RoundedCornerShape(50)).background(bg)) {
        Text(text, color = fg, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
    }
}
