package io.github.mrarron.royalpebble.settings

import io.github.mrarron.royalpebble.royal.FakeRoyal
import io.github.mrarron.royalpebble.royal.RoyalClient
import io.github.mrarron.royalpebble.royal.RoyalParse
import io.github.mrarron.royalpebble.royal.SignInCache
import io.github.mrarron.royalpebble.store.CruiseStore
import java.nio.file.Files
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class PullRulesTest {
    private val min = 60_000L

    @Test
    fun aFullRefreshWaitsTenMinutesAndTwoAfterOneWhereNothingWorked() {
        assertEquals(0L, PullRules.refreshWait(0, 1_000_000))
        val start = 10_000_000L
        assertEquals(10L * min, PullRules.refreshWait(PullRules.nextAllowed(start, true), start))
        assertEquals(3L * min, PullRules.refreshWait(PullRules.nextAllowed(start, true), start + 7 * min))
        assertEquals(0L, PullRules.refreshWait(PullRules.nextAllowed(start, true), start + 10 * min))
        assertEquals(2L * min, PullRules.refreshWait(PullRules.nextAllowed(start, false), start))
        // The phone's clock moved back an hour: never locked out.
        assertEquals(0L, PullRules.refreshWait(PullRules.nextAllowed(start, true), start - 60 * min))
        assertEquals(3L, PullRules.waitMinutes(2 * min + 1))
        assertEquals(1L, PullRules.waitMinutes(5_000))
    }

    @Test
    fun theSameSailingIsNotPulledAgainWithinAFewMinutes() {
        val now = 50_000_000L
        assertFalse(PullRules.syncIsFresh(0, true, true, false, 0, now))
        assertTrue(PullRules.syncIsFresh(now - 3 * min, true, true, false, 0, now))
        assertTrue(PullRules.syncIsFresh(now - 3 * min, true, false, false, 0, now))   // less than last time
        assertFalse(PullRules.syncIsFresh(now - 3 * min, false, true, false, 0, now))  // now with booking details
        assertFalse(PullRules.syncIsFresh(now - 11 * min, true, true, false, 0, now))
        assertFalse(PullRules.syncIsFresh(now - 3 * min, true, true, true, now - 60 * min, now))  // planner list is old
        assertTrue(PullRules.syncIsFresh(now - 3 * min, true, true, true, now - 3 * min, now))
        assertFalse(PullRules.syncIsFresh(now + 3 * min, true, true, false, 0, now))   // clock moved back
    }

    @Test
    fun aRecentCheckIsKeptAndThePlannerListRenewsEverySixHours() {
        val now = 50_000_000L
        assertTrue(PullRules.checkIsFresh(now - 5 * min, true, now))
        assertFalse(PullRules.checkIsFresh(now - 5 * min, false, now))
        assertFalse(PullRules.checkIsFresh(now - 15 * min, true, now))
        assertTrue(PullRules.catalogWanted(0, now, now))
        assertFalse(PullRules.catalogWanted(40, now - 60 * min, now))
        assertTrue(PullRules.catalogWanted(40, now - 7 * 60 * min, now))
    }

    @Test
    fun oneSignInServesTheWholeRefreshAndIsDroppedWhenOldOrChanged() {
        var t = 1_000_000L
        val cache = SignInCache { t }
        val fake = FakeRoyal()
        val client = RoyalClient(fake, sleep = {})
        val (a, reused) = cache.get("Me@example.com", "pw") { client.login("me@example.com", "pw") }
        assertFalse(reused)
        t += 5 * min
        val (b, reused2) = cache.get("me@example.com", "pw") { error("should reuse") }
        assertTrue(reused2)
        assertSame(a, b)
        assertSame(a, cache.peek("ME@example.com"))
        assertNull(cache.peek("other@example.com"))
        // A changed password signs in again.
        assertFalse(cache.get("me@example.com", "new") { client.login("me@example.com", "new") }.second)
        // Too old: signs in again.
        t += SignInCache.MAX_AGE_MS
        assertNull(cache.peek("me@example.com"))
        assertFalse(cache.get("me@example.com", "new") { client.login("me@example.com", "new") }.second)
        cache.forget()
        assertNull(cache.peek("me@example.com"))
        assertEquals(3, fake.calls.count { it.path.endsWith("oauth2/access_token") })
    }

    @Test
    fun aRejectedPasswordIsSentOnceNotAgainByTheNextStep() {
        var t = 1_000_000L
        val cache = SignInCache { t }
        val fake = FakeRoyal(login = 401 to "{}")
        val client = RoyalClient(fake, sleep = {})
        fun attempt(pw: String) = try {
            cache.get("me@example.com", pw) { client.login("me@example.com", pw) }; null
        } catch (e: io.github.mrarron.royalpebble.royal.RoyalException) { e.message }
        assertEquals(RoyalClient.ERR_LOGIN_REJECTED, attempt("bad"))   // the sync's sign-in
        cache.forget()                                                  // RoyalSync forgets on failure
        assertEquals(RoyalClient.ERR_LOGIN_REJECTED, attempt("bad"))   // the price check's: not sent
        assertEquals(1, fake.calls.count { it.path.endsWith("oauth2/access_token") })
        attempt("other")                                                // a new password is tried at once
        assertEquals(2, fake.calls.count { it.path.endsWith("oauth2/access_token") })
        t += SignInCache.REJECTED_HOLD_MS
        attempt("bad")                                                  // and the old one after the hold
        assertEquals(3, fake.calls.count { it.path.endsWith("oauth2/access_token") })
    }

    @Test
    fun aDownloadReusesTheSignInThePriceCheckJustMade() {
        val dir = Files.createTempDirectory("pull").toFile()
        val store = CruiseStore(dir)
        val fake = FakeRoyal()
        val client = RoyalClient(fake, sleep = {})
        val cache = SignInCache()
        cache.get("me@example.com", "pw") { client.login("me@example.com", "pw") }
        val service = DownloadService(client, store, ZoneId.of("UTC")) { 1_000_000L }
        val out = service.download(RoyalParse.Ship("HM", "Harmony of the Seas"), "2027-03-06",
            DownloadService.Login("me@example.com", "pw"), signIn = cache)
        assertTrue(out is DownloadOutcome.Done)
        assertEquals(1, fake.calls.count { it.path.endsWith("oauth2/access_token") })
        dir.deleteRecursively()
    }
}
