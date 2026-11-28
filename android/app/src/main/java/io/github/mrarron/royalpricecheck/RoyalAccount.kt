package io.github.mrarron.royalpricecheck

import android.content.Context

/**
 * The one Royal Caribbean login the app asks for, shared by the price check
 * (Account tab, config.yaml) and the Cruise screen's Download with your login.
 *
 * It lives in [PasswordVault]'s Royal Pebble login slot: in memory until the app
 * closes, and encrypted with the Android Keystore only when the owner ticks
 * Remember. Saving it also writes the simple config.yaml (the password replaced
 * by a placeholder, as before) unless the owner wrote their own config.yaml,
 * which is left alone. An older install whose simple config.yaml holds the
 * account, with no shared login yet, still counts as signed in once its password is known.
 */
object RoyalAccount {
    const val SIMPLE_HEADER = "# Created by Royal Pebble for Android."

    data class Account(val email: String, val password: String, val cruiseLine: String) {
        override fun toString(): String = "Account(<private>)"
    }

    /** The account of a config.yaml the app wrote (one account), or null for an owner-written one. */
    data class Simple(val username: String, val passwordIndex: Int?, val cruiseLine: String)

    fun parseSimple(yaml: String): Simple? {
        if (!yaml.startsWith(SIMPLE_HEADER)) return null
        val users = Regex("""^\s*-\s*username\s*:[ \t]*(.*)$""", RegexOption.MULTILINE).findAll(yaml).toList()
        if (users.size != 1) return null
        val user = ConfigPasswords.parseScalar(users[0].groupValues[1])
        val pass = Regex("""^\s*password\s*:[ \t]*(.*)$""", RegexOption.MULTILINE).find(yaml)
            ?.let { ConfigPasswords.parseScalar(it.groupValues[1]) }
        val index = pass?.let { Regex("""^@password-(\d+)$""").find(it)?.groupValues?.get(1)?.toIntOrNull() }
        val line = Regex("""^\s*cruiseLine\s*:[ \t]*(.*)$""", RegexOption.MULTILINE).find(yaml)
            ?.let { ConfigPasswords.parseScalar(it.groupValues[1]) } ?: "royal"
        return if (user.isEmpty()) null else Simple(user, index, line)
    }

    /** The shared login, if known: the saved or typed one, else the simple config.yaml's with its password. */
    fun current(c: Context): Account? {
        PasswordVault.pebbleLogin(c)?.let { (e, p) ->
            val simple = parseSimple(Prefs.readConfig(c))
            val line = if (simple != null && simple.username.equals(e, ignoreCase = true)) simple.cruiseLine else "royal"
            return Account(e, p, line)
        }
        val s = parseSimple(Prefs.readConfig(c)) ?: return null
        val p = s.passwordIndex?.let { PasswordVault.all(c)[it] } ?: return null
        return Account(s.username, p, s.cruiseLine)
    }

    /** The email to show while the password is still unknown (after a restart without Remember). */
    fun knownEmail(c: Context): String? =
        PasswordVault.pebbleLogin(c)?.first ?: parseSimple(Prefs.readConfig(c))?.username

    fun remembered(c: Context): Boolean = PasswordVault.hasPebbleLogin(c)

    /**
     * Saves the login for both uses. Writes the simple config.yaml when there is
     * none or it is the app's own; returns true when it did (the caller reloads it).
     */
    fun save(c: Context, email: String, password: String, cruiseLine: String, remember: Boolean): Boolean {
        val e = email.trim()
        if (!remember) PasswordVault.forgetPebbleLogin(c)
        PasswordVault.rememberPebbleLogin(c, e, password, remember)
        val yaml = Prefs.readConfig(c)
        val ours = !Prefs.hasConfig(c) || yaml.isBlank() || parseSimple(yaml) != null
        if (ours) Prefs.saveConfigScrubbed(c, Prefs.simpleConfig(e, password, cruiseLine))
        return ours
    }

    /**
     * After a restart the price check's password is gone from memory; when the
     * shared login is remembered and matches the simple config.yaml, it fills
     * that gap so the owner isn't asked again. True when it filled one.
     */
    fun fillPriceChecker(c: Context): Boolean {
        val s = parseSimple(Prefs.readConfig(c)) ?: return false
        val index = s.passwordIndex ?: return false
        if (PasswordVault.all(c).containsKey(index)) return false
        val (e, p) = PasswordVault.pebbleLogin(c) ?: return false
        if (!e.equals(s.username, ignoreCase = true)) return false
        PasswordVault.remember(mapOf(index to p))
        return true
    }

    /** Forgets the shared login (memory and saved copies). config.yaml stays, with its placeholder. */
    fun forget(c: Context) {
        RoyalSync.signIn.forget()   // the sign-in made with it goes too
        PasswordVault.forgetPebbleLogin(c)
        // The simple config.yaml's password is the same login: drop it too, so nothing still signs in.
        parseSimple(Prefs.readConfig(c))?.passwordIndex?.let { i ->
            PasswordVault.retain(c, PasswordVault.all(c).keys - i)
        }
    }

    /** 'a•••@example.com' for the screen. */
    fun masked(email: String): String {
        val at = email.indexOf('@')
        return if (at <= 0) email.take(1) + "•••" else email.take(1) + "•••" + email.substring(at)
    }
}
