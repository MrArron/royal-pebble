package io.github.mrarron.royalpebble.update

import io.github.mrarron.royalpebble.royal.HttpResponse
import io.github.mrarron.royalpebble.royal.Transport
import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class UpdateCheckTest {
    private fun release(tag: String, apk: String? = "royal-pebble-android-0.1.0-abc1234.apk", digest: String? = null) = """
        {"tag_name":"$tag","body":"## What's new\r\n\r\n- One\n- Two","assets":[
          {"name":"royal-pebble-$tag.pbw","browser_download_url":"https://github.com/x/y/releases/download/$tag/a.pbw","size":10}
          ${if (apk == null) "" else """,{"name":"$apk","browser_download_url":"https://github.com/x/y/releases/download/$tag/$apk","size":1234${if (digest != null) ""","digest":"sha256:$digest"""" else ""}}"""}
        ]}""".trimIndent()

    private fun transport(status: Int, body: String) = Transport { HttpResponse(status, body) }

    @Test fun versionsCompareNumerically() {
        assertTrue(UpdateCheck.isNewer("1.6.31", "1.6.30"))
        assertTrue(UpdateCheck.isNewer("1.6.100", "1.6.31"))
        assertTrue(UpdateCheck.isNewer("1.7.0", "1.6.99"))
        assertFalse(UpdateCheck.isNewer("1.6.30", "1.6.30"))
        assertFalse(UpdateCheck.isNewer("1.6.29", "1.6.30"))
        assertFalse(UpdateCheck.isNewer("1.6.31", "?"))
        assertFalse(UpdateCheck.isNewer("junk", "1.6.30"))
        assertEquals(listOf(1, 6, 31), UpdateCheck.parseVersion("v1.6.31-rc1"))
        assertNull(UpdateCheck.parseVersion("latest"))
    }

    @Test fun availableWhenTheTagIsNewer() {
        val sha = "a".repeat(64)
        val r = UpdateCheck.check(transport(200, release("v1.6.31", digest = sha)), "1.6.30")
        r as UpdateCheck.Result.Available
        assertEquals("1.6.31", r.release.version)
        assertEquals("royal-pebble-android-0.1.0-abc1234.apk", r.release.apkName)
        assertEquals(1234L, r.release.apkSize)
        assertEquals(sha, r.release.sha256)
        assertEquals("## What's new\n- One\n- Two", r.release.notes)
    }

    @Test fun upToDateWhenSameOrOlder() {
        assertEquals(UpdateCheck.Result.UpToDate("1.6.30"), UpdateCheck.check(transport(200, release("v1.6.30")), "1.6.30"))
        assertEquals(UpdateCheck.Result.UpToDate("1.6.29"), UpdateCheck.check(transport(200, release("v1.6.29")), "1.6.30"))
    }

    @Test fun failuresAreShortAndSpecific() {
        fun failed(r: UpdateCheck.Result) = (r as UpdateCheck.Result.Failed).reason
        assertTrue(failed(UpdateCheck.check(transport(200, release("v1.6.31", apk = null)), "1.6.30")).contains("no APK"))
        assertTrue(failed(UpdateCheck.check(transport(200, "<html>"), "1.6.30")).contains("unreadable"))
        assertTrue(failed(UpdateCheck.check(transport(200, release("nightly")), "1.6.30")).contains("isn't a version"))
        assertTrue(failed(UpdateCheck.check(transport(404, "{}"), "1.6.30")).contains("404"))
        assertTrue(failed(UpdateCheck.check(transport(403, "{}"), "1.6.30")).contains("limiting"))
        assertTrue(failed(UpdateCheck.check({ throw IOException("offline") }, "1.6.30")).contains("can't reach"))
    }

    @Test fun nonHttpsApkLinkIsRefused() {
        val bad = release("v1.6.31").replace("https://github.com/x/y/releases/download/v1.6.31/royal", "http://github.com/royal")
        try { UpdateCheck.parseRelease(bad); fail() } catch (e: IllegalArgumentException) { assertTrue(e.message!!.contains("https")) }
    }

    @Test fun automaticCheckRunsOnceADay() {
        val day = 24L * 60 * 60 * 1000
        assertTrue(UpdateCheck.due(0, 1_000_000))
        assertFalse(UpdateCheck.due(1_000_000, 1_000_000 + day - 1))
        assertTrue(UpdateCheck.due(1_000_000, 1_000_000 + day))
        assertTrue(UpdateCheck.due(5_000_000, 1_000_000)) // clock went back
    }
}
