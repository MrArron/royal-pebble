package io.github.mrarron.royalpebble.settings

/**
 * How often the app pulls from Royal Caribbean (the app's RoyalRefresh and RoyalSync). Royal's endpoints are
 * unofficial, so the same data is never pulled twice within a few minutes, whichever screen or background
 * job asks. Plain rules, so they run in JVM tests.
 */
object PullRules {
    /** The least time between two full refreshes (pull down on Trip, Today or Prices). */
    const val MIN_GAP_MS = 10L * 60_000
    /** A sailing's schedule and bookings downloaded this recently are kept as they are (Trip's Download included). */
    const val SYNC_FRESH_MS = 10L * 60_000
    /** A price check this recent is not run again by a refresh. */
    const val CHECK_FRESH_MS = 10L * 60_000
    /** A pull down also renews the Cruise Planner list when it is this old (or not loaded yet). */
    const val CATALOG_PULL_MAX_AGE_MS = 6L * 3_600_000

    /** After a refresh where nothing worked (no internet, say), the next try is allowed this soon. */
    const val RETRY_AFTER_FAIL_MS = 2L * 60_000

    /** When the next full refresh may start, after one that started at [startMs] and pulled something ([anyOk]) or not. */
    fun nextAllowed(startMs: Long, anyOk: Boolean): Long = startMs + if (anyOk) MIN_GAP_MS else RETRY_AFTER_FAIL_MS

    /** Ms until a full refresh may run again (0: now). [nextAllowedMs] 0 = never refreshed. */
    fun refreshWait(nextAllowedMs: Long, nowMs: Long): Long {
        if (nextAllowedMs <= 0) return 0
        val wait = nextAllowedMs - nowMs
        if (wait > MIN_GAP_MS) return 0   // the clock moved back: don't lock the refresh out
        return wait.coerceAtLeast(0)
    }

    /**
     * True when a download of the same sailing done [lastOkMs] ago (with a login or not: [lastWithLogin]) already
     * covers this one ([withLogin], [withCatalog] with the planner list last loaded at [catalogAtMs]).
     */
    fun syncIsFresh(lastOkMs: Long, lastWithLogin: Boolean, withLogin: Boolean, withCatalog: Boolean, catalogAtMs: Long, nowMs: Long): Boolean {
        if (lastOkMs <= 0) return false
        val since = nowMs - lastOkMs
        if (since !in 0 until SYNC_FRESH_MS) return false
        if (withLogin && !lastWithLogin) return false
        if (withCatalog && (catalogAtMs <= 0 || nowMs - catalogAtMs !in 0 until SYNC_FRESH_MS)) return false
        return true
    }

    /** True when a price check that finished at [lastCheckMs] (ok or not: [lastOk]) is recent enough to keep. */
    fun checkIsFresh(lastCheckMs: Long, lastOk: Boolean, nowMs: Long): Boolean =
        lastOk && lastCheckMs > 0 && nowMs - lastCheckMs in 0 until CHECK_FRESH_MS

    /** True when a pull down should also renew the planner list (not loaded yet, or [CATALOG_PULL_MAX_AGE_MS] old). */
    fun catalogWanted(count: Int, catalogAtMs: Long, nowMs: Long): Boolean =
        count == 0 || catalogAtMs <= 0 || nowMs - catalogAtMs !in 0 until CATALOG_PULL_MAX_AGE_MS

    /** A wait in whole minutes for the screen, rounded up, at least 1. */
    fun waitMinutes(waitMs: Long): Long = ((waitMs + 59_999) / 60_000).coerceAtLeast(1)
}
