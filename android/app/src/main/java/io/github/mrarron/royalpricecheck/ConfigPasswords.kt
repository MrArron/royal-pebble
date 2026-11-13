package io.github.mrarron.royalpricecheck

/**
 * Keeps passwords out of config.yaml. When the config is saved, every `password:` value is swapped
 * for a placeholder like `'@password-0'` and the real value goes to [PasswordVault]. When a check
 * runs, the placeholders are swapped back into a temporary copy that is deleted right afterwards.
 *
 * Pure string handling on purpose, so it is covered by plain JVM unit tests.
 */
object ConfigPasswords {
    private val LINE = Regex("""^(\s*(?:-\s*)?password\s*:[ \t]*)(.*)$""", RegexOption.MULTILINE)
    private val PLACEHOLDER = Regex("""^@password-(\d+)$""")

    class Extracted(val yaml: String, val passwords: Map<Int, String>, val indices: Set<Int>)
    class Injected(val yaml: String, val missing: List<Int>)

    fun placeholder(index: Int) = "@password-$index"

    private fun quote(s: String) = "'" + s.replace("'", "''") + "'"

    /** The value of a YAML scalar as written on a `password:` line (quotes and comments removed). */
    internal fun parseScalar(raw: String): String {
        val t = raw.trim()
        if (t.startsWith("'")) {
            val sb = StringBuilder()
            var i = 1
            while (i < t.length) {
                val c = t[i]
                if (c == '\'') {
                    if (i + 1 < t.length && t[i + 1] == '\'') {
                        sb.append('\'')
                        i += 2
                        continue
                    }
                    break
                }
                sb.append(c)
                i++
            }
            return sb.toString()
        }
        if (t.startsWith("\"")) {
            val sb = StringBuilder()
            var i = 1
            while (i < t.length) {
                val c = t[i]
                if (c == '\\' && i + 1 < t.length) {
                    val n = t[i + 1]
                    if (n == '\\' || n == '"') {
                        sb.append(n)
                    } else {
                        sb.append(c).append(n)
                    }
                    i += 2
                    continue
                }
                if (c == '"') break
                sb.append(c)
                i++
            }
            return sb.toString()
        }
        val hash = Regex("""\s#""").find(t)
        return (if (hash != null) t.substring(0, hash.range.first) else t).trim()
    }

    private fun placeholderIndex(rawValue: String): Int? =
        PLACEHOLDER.find(parseScalar(rawValue))?.groupValues?.get(1)?.toIntOrNull()

    /**
     * Replace every real password in [yaml] with a placeholder. [known] are indices already held in
     * the vault, so a new password never reuses one of them.
     */
    fun extract(yaml: String, known: Set<Int> = emptySet()): Extracted {
        val used = LINE.findAll(yaml).mapNotNull { placeholderIndex(it.groupValues[2]) }.toMutableSet()
        var next = ((used + known).maxOrNull() ?: -1) + 1
        val found = LinkedHashMap<Int, String>()
        val out = LINE.replace(yaml) { m ->
            val value = parseScalar(m.groupValues[2])
            if (value.isEmpty() || placeholderIndex(m.groupValues[2]) != null) {
                m.value
            } else {
                val index = next++
                found[index] = value
                used.add(index)
                m.groupValues[1] + quote(placeholder(index))
            }
        }
        return Extracted(out, found, used)
    }

    /** Put real passwords back in place of placeholders. Placeholders without a password are listed in `missing`. */
    fun inject(yaml: String, passwords: Map<Int, String>): Injected {
        val missing = ArrayList<Int>()
        val out = LINE.replace(yaml) { m ->
            val index = placeholderIndex(m.groupValues[2])
            when {
                index == null -> m.value
                passwords[index] == null -> {
                    missing.add(index)
                    m.value
                }
                else -> m.groupValues[1] + quote(passwords.getValue(index))
            }
        }
        return Injected(out, missing)
    }
}
