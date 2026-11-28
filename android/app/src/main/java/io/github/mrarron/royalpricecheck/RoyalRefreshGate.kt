package io.github.mrarron.royalpricecheck

import android.content.Context
import io.github.mrarron.royalpebble.settings.PullRules

/**
 * When the pull-down refresh last started, and when it may start again ([PullRules.nextAllowed]): kept on the
 * phone so the gap holds after the app is closed and opened again. Times only, nothing about the account.
 */
object RoyalRefreshGate {
    private fun sp(c: Context) = c.getSharedPreferences("royal_refresh", Context.MODE_PRIVATE)

    fun lastStart(c: Context): Long = sp(c).getLong("started_at", 0)

    fun nextAllowed(c: Context): Long = sp(c).getLong("next_at", 0)

    /** A refresh started at [now]: no second one until it finishes (and the gap after it). */
    fun started(c: Context, now: Long) {
        sp(c).edit().putLong("started_at", now).putLong("next_at", PullRules.nextAllowed(now, true)).apply()
    }

    /** It finished; when nothing worked the next try is allowed sooner. */
    fun finished(c: Context, startedAt: Long, anyOk: Boolean) {
        sp(c).edit().putLong("next_at", PullRules.nextAllowed(startedAt, anyOk)).apply()
    }
}
