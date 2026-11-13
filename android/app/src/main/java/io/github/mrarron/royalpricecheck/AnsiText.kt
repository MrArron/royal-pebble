package io.github.mrarron.royalpricecheck

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle

private val ansi = Regex("\u001B\\[([0-9;]*)m")

fun stripAnsi(s: String) = ansi.replace(s, "")

/** Turn the script's terminal colours (red = rebook, green = ok, ...) into Compose styles. */
fun ansiToAnnotated(line: String, dark: Boolean): AnnotatedString = buildAnnotatedString {
    var color: Color? = null
    var bold = false
    var last = 0
    for (m in ansi.findAll(line)) {
        appendStyled(line.substring(last, m.range.first), color, bold)
        val codes = m.groupValues[1].split(';').mapNotNull { it.toIntOrNull() }.ifEmpty { listOf(0) }
        for (code in codes) when (code) {
            0 -> { color = null; bold = false }
            1 -> bold = true
            31, 91 -> color = if (dark) Color(0xFFFF6B6B) else Color(0xFFC62828)
            32, 92 -> color = if (dark) Color(0xFF81C784) else Color(0xFF2E7D32)
            33, 93 -> color = if (dark) Color(0xFFFFD54F) else Color(0xFF9A6700)
            34, 94, 36, 96 -> color = if (dark) Color(0xFF64B5F6) else Color(0xFF1565C0)
            35, 95 -> color = if (dark) Color(0xFFCE93D8) else Color(0xFF7B1FA2)
            39 -> color = null
        }
        last = m.range.last + 1
    }
    appendStyled(line.substring(last), color, bold)
}

private fun AnnotatedString.Builder.appendStyled(text: String, color: Color?, bold: Boolean) {
    if (text.isEmpty()) return
    if (color == null && !bold) append(text)
    else withStyle(SpanStyle(color = color ?: Color.Unspecified, fontWeight = if (bold) FontWeight.Bold else null)) {
        append(text)
    }
}
