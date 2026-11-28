package io.github.mrarron.royalpebble.royal

import java.security.MessageDigest

/**
 * One Royal Caribbean sign-in shared by everything one refresh pulls: the schedule and booking download
 * ([RoyalClient.downloadWithAuth]), the Cruise Planner list and the price check (the bundled script is
 * handed the same token in memory). A sign-in is reused for [MAX_AGE_MS] at most, and never within
 * [EXPIRY_MARGIN_MS] of the expiry Royal puts in the token, so a background check hours later signs in
 * afresh. A login Royal rejected is remembered for [REJECTED_HOLD_MS]: the same email and password are not
 * sent again in that time (a wrong password tried over and over risks locking the account), so the sync
 * and the price check of one refresh never both try it. Memory only: nothing here is written anywhere.
 * The password is kept only as a SHA-256 to notice a changed login.
 */
class SignInCache(private val clock: () -> Long = System::currentTimeMillis) {
    companion object {
        /** A refresh (sync, then price check) takes a few minutes at most; reuse a sign-in for 15. */
        const val MAX_AGE_MS = 15L * 60_000
        /** Never hand out a token that runs out within 5 minutes. */
        const val EXPIRY_MARGIN_MS = 5L * 60_000
        /** A rejected email and password are not tried again for 30 minutes (a new password is tried at once). */
        const val REJECTED_HOLD_MS = 30L * 60_000
    }

    private class Held(val email: String, val passwordHash: String, val auth: RoyalAuth, val at: Long)

    private var held: Held? = null
    private var rejected: Triple<String, String, Long>? = null

    /** A sign-in and whether it was reused (true) or new. [login] makes a new one; it throws as [RoyalClient.login]. */
    @Synchronized
    fun get(email: String, password: String, login: () -> RoyalAuth): Pair<RoyalAuth, Boolean> {
        val key = email.trim().lowercase()
        val hash = sha256(password)
        val now = clock()
        held?.let { h ->
            val fresh = now - h.at in 0 until MAX_AGE_MS
            val notExpiring = h.auth.expiresAtMs?.let { it - now > EXPIRY_MARGIN_MS } ?: true
            if (h.email == key && h.passwordHash == hash && fresh && notExpiring) return h.auth to true
        }
        held = null
        rejected?.let { (e, h, at) ->
            if (e == key && h == hash && now - at in 0 until REJECTED_HOLD_MS) throw RoyalException(RoyalClient.ERR_LOGIN_REJECTED)
        }
        val auth = try {
            login()
        } catch (e: RoyalException) {
            if (e.message == RoyalClient.ERR_LOGIN_REJECTED) rejected = Triple(key, hash, now)
            throw e
        }
        rejected = null
        held = Held(key, hash, auth, now)
        return auth to false
    }

    /** The held sign-in when it is still good for [email] (for the price check), else null. Never signs in. */
    @Synchronized
    fun peek(email: String): RoyalAuth? {
        val h = held ?: return null
        val now = clock()
        if (h.email != email.trim().lowercase() || now - h.at !in 0 until MAX_AGE_MS) return null
        if (h.auth.expiresAtMs?.let { it - now <= EXPIRY_MARGIN_MS } == true) return null
        return h.auth
    }

    /**
     * Forgets the sign-in (the login was forgotten or changed, or Royal turned the token away). A remembered
     * rejection stays: it only clears with a different password or after [REJECTED_HOLD_MS].
     */
    @Synchronized
    fun forget() {
        held = null
    }

    private fun sha256(s: String): String =
        MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }
}
