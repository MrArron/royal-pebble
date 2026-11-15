package io.github.mrarron.royalpricecheck

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The shared Royal login reads the account from the config.yaml the app writes, and leaves owner-written ones alone. */
class RoyalAccountTest {
    @Test
    fun readsTheAppsOwnConfigAfterScrubbing() {
        val yaml = ConfigPasswords.extract(Prefs.simpleConfig("someone@example.com", "it's secret", "royal")).yaml
        assertEquals(RoyalAccount.Simple("someone@example.com", 0, "royal"), RoyalAccount.parseSimple(yaml))
        val celebrity = ConfigPasswords.extract(Prefs.simpleConfig("o'brien", "x", "celebrity"), setOf(0, 1)).yaml
        assertEquals(RoyalAccount.Simple("o'brien", 2, "celebrity"), RoyalAccount.parseSimple(celebrity))
    }

    @Test
    fun ownerWrittenConfigsAreNotTheSharedAccount() {
        assertNull(RoyalAccount.parseSimple("accountInfo:\n  - username: 'a'\n    password: '@password-0'\n"))
        val two = Prefs.simpleConfig("a", "x", "royal") + "  - username: 'b'\n    password: 'y'\n"
        assertNull(RoyalAccount.parseSimple(two))
        assertNull(RoyalAccount.parseSimple(""))
    }

    @Test
    fun masksTheEmail() {
        assertEquals("s•••@example.com", RoyalAccount.masked("someone@example.com"))
        assertEquals("u•••", RoyalAccount.masked("username"))
    }
}
