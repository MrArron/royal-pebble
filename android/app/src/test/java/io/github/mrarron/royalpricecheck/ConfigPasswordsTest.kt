package io.github.mrarron.royalpricecheck

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ConfigPasswordsTest {
    private val simple = """
        accountInfo:
          - username: 'me@example.com'
            password: 'p''w # not a comment'
            cruiseLine: 'royal'
    """.trimIndent() + "\n"

    @Test
    fun extractReplacesPasswordWithPlaceholder() {
        val r = ConfigPasswords.extract(simple)
        assertFalse(r.yaml.contains("p''w"))
        assertTrue(r.yaml.contains("password: '@password-0'"))
        assertEquals("p'w # not a comment", r.passwords[0])
        assertTrue(r.yaml.contains("username: 'me@example.com'"))
    }

    @Test
    fun injectRestoresPasswordAndQuotesIt() {
        val r = ConfigPasswords.extract(simple)
        val back = ConfigPasswords.inject(r.yaml, r.passwords)
        assertTrue(back.missing.isEmpty())
        assertTrue(back.yaml.contains("password: 'p''w # not a comment'"))
    }

    @Test
    fun injectReportsMissingPasswords() {
        val r = ConfigPasswords.extract(simple)
        val back = ConfigPasswords.inject(r.yaml, emptyMap())
        assertEquals(listOf(0), back.missing)
        assertTrue(back.yaml.contains("@password-0"))
    }

    @Test
    fun extractIsIdempotentAndKeepsPlaceholders() {
        val once = ConfigPasswords.extract(simple)
        val twice = ConfigPasswords.extract(once.yaml)
        assertEquals(once.yaml, twice.yaml)
        assertTrue(twice.passwords.isEmpty())
        assertEquals(setOf(0), twice.indices)
    }

    @Test
    fun twoAccountsGetDistinctIndicesAndNewOnesNeverReuse() {
        val yaml = "accountInfo:\n  - username: a\n    password: \"x\\\"y\"\n  - username: b\n    password: plain # note\n"
        val r = ConfigPasswords.extract(yaml, known = setOf(0, 1))
        assertEquals("x\"y", r.passwords[2])
        assertEquals("plain", r.passwords[3])
        assertEquals(setOf(2, 3), r.indices)
    }

    @Test
    fun blankPasswordIsLeftAlone() {
        val yaml = "accountInfo:\n  - username: a\n    password: ''\n"
        val r = ConfigPasswords.extract(yaml)
        assertEquals(yaml, r.yaml)
        assertTrue(r.passwords.isEmpty())
    }

    @Test
    fun otherKeysContainingPasswordAreNotTouched() {
        val yaml = "notes: my password: is fine\nfoo_password: abc\n"
        assertEquals(yaml, ConfigPasswords.extract(yaml).yaml)
    }
}
