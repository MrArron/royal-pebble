package io.github.mrarron.royalpebble.update

import io.github.mrarron.royalpebble.royal.HttpRequest
import io.github.mrarron.royalpebble.royal.Transport
import io.github.mrarron.royalpebble.royal.parseJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/** A published Royal Pebble release that carries the Android app's APK. */
data class ReleaseInfo(
    val tag: String,
    /** The tag without its "v": "1.6.31". */
    val version: String,
    val apkName: String,
    val apkUrl: String,
    val apkSize: Long,
    /** Lower-case hex SHA-256 of the APK when GitHub lists one, else null. */
    val sha256: String?,
    /** The release notes' first lines, for the update card. */
    val notes: String,
)

/**
 * The in-app update check: finds the newest `v1.x.y` release of MrArron/royal-pebble
 * on GitHub and says whether it is newer than the build running. Plain Kotlin (no
 * Android), so `:royal:test` covers it with a fake [Transport]. Free forever: one
 * anonymous GET to api.github.com that carries no account or cruise data; the app
 * sends it only when the owner asks, or once a day while the app is open if left on.
 *
 * "Newer" compares the release tag with the Royal Pebble version bundled in the app
 * (package.json, the number the usage log and Settings > About show), because the
 * APK's own versionName is `0.1.0-<commit>`.
 */
object UpdateCheck {
    const val REPO = "MrArron/royal-pebble"
    const val LATEST_URL = "https://api.github.com/repos/$REPO/releases/latest"

    sealed interface Result {
        /** The newest release is this build's version, or older. */
        data class UpToDate(val latest: String) : Result
        data class Available(val release: ReleaseInfo) : Result
        /** [reason] is short and safe to show and to put in the log. */
        data class Failed(val reason: String) : Result
    }

    fun check(transport: Transport, installedVersion: String): Result {
        val response = try {
            transport.send(HttpRequest("GET", LATEST_URL, mapOf(
                "Accept" to "application/vnd.github+json",
                "User-Agent" to "royal-pebble-update-check",
            )))
        } catch (e: IOException) {
            return Result.Failed("can't reach GitHub (${e.javaClass.simpleName})")
        }
        if (response.status == 403 || response.status == 429) return Result.Failed("GitHub is limiting requests, try later (HTTP ${response.status})")
        if (response.status != 200) return Result.Failed("GitHub answered HTTP ${response.status}")
        val release = try { parseRelease(response.body) } catch (e: IllegalArgumentException) {
            return Result.Failed(e.message ?: "unreadable answer")
        }
        return if (isNewer(release.version, installedVersion)) Result.Available(release) else Result.UpToDate(release.version)
    }

    /** One release from GitHub's `releases/latest` JSON. Throws [IllegalArgumentException] with a short reason. */
    fun parseRelease(json: String): ReleaseInfo {
        val o = try { parseJson(json) as? JsonObject } catch (e: Exception) { null }
            ?: throw IllegalArgumentException("unreadable answer")
        fun str(e: JsonObject, k: String) = (e[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
        val tag = str(o, "tag_name") ?: throw IllegalArgumentException("no release tag")
        val version = tag.removePrefix("v")
        if (parseVersion(version) == null) throw IllegalArgumentException("release tag $tag isn't a version")
        val asset = (o["assets"] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }
            .firstOrNull { (str(it, "name") ?: "").let { n -> n.startsWith("royal-pebble-android-") && n.endsWith(".apk") } }
            ?: throw IllegalArgumentException("release $tag has no APK")
        val url = str(asset, "browser_download_url") ?: throw IllegalArgumentException("the APK has no download link")
        require(url.startsWith("https://")) { "the APK link isn't https" }
        val digest = str(asset, "digest")?.removePrefix("sha256:")?.lowercase()?.takeIf { Regex("[0-9a-f]{64}").matches(it) }
        val size = (asset["size"] as? JsonPrimitive)?.content?.toLongOrNull() ?: -1L
        val notes = (str(o, "body") ?: "").lines().map { it.trim() }.filter { it.isNotEmpty() }.take(6).joinToString("\n")
        return ReleaseInfo(tag, version, str(asset, "name")!!, url, size, digest, notes)
    }

    /** "1.6.31" to [1, 6, 31]; null when it isn't dotted numbers (a pre-release suffix is ignored). */
    fun parseVersion(v: String): List<Int>? {
        val parts = v.trim().removePrefix("v").substringBefore('-').split('.')
        if (parts.size < 2 || parts.size > 4) return null
        return parts.map { it.toIntOrNull() ?: return null }
    }

    /** True when [candidate] is a higher version than [installed]; an unknown installed version ("?") never updates. */
    fun isNewer(candidate: String, installed: String): Boolean {
        val c = parseVersion(candidate) ?: return false
        val i = parseVersion(installed) ?: return false
        for (n in 0 until maxOf(c.size, i.size)) {
            val a = c.getOrElse(n) { 0 }
            val b = i.getOrElse(n) { 0 }
            if (a != b) return a > b
        }
        return false
    }

    /**
     * Downloads [release]'s APK to [dest] (GitHub redirects to its file host; https only),
     * calling [progress] with bytes so far and the total (-1 when unknown), then checks the
     * size and, when GitHub listed one, the SHA-256. Deletes a bad file and throws [IOException].
     */
    fun download(release: ReleaseInfo, dest: File, progress: (Long, Long) -> Unit = { _, _ -> }) {
        dest.parentFile?.mkdirs()
        val tmp = File(dest.path + ".part")
        try {
            var url = URL(release.apkUrl)
            var conn: HttpURLConnection
            var hops = 0
            while (true) {
                conn = url.openConnection() as HttpURLConnection
                conn.instanceFollowRedirects = false
                conn.connectTimeout = 20_000
                conn.readTimeout = 30_000
                conn.setRequestProperty("User-Agent", "royal-pebble-update-check")
                val code = conn.responseCode
                if (code in 301..308) {
                    val next = URL(url, conn.getHeaderField("Location") ?: throw IOException("redirect without a place"))
                    conn.disconnect()
                    if (next.protocol != "https" || ++hops > 5) throw IOException("unsafe or endless redirect")
                    url = next
                    continue
                }
                if (code != 200) { conn.disconnect(); throw IOException("download answered HTTP $code") }
                break
            }
            val total = conn.contentLengthLong.takeIf { it > 0 } ?: release.apkSize
            val md = MessageDigest.getInstance("SHA-256")
            var done = 0L
            conn.inputStream.use { input ->
                tmp.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        md.update(buf, 0, n)
                        done += n
                        progress(done, total)
                    }
                }
            }
            conn.disconnect()
            if (release.apkSize > 0 && done != release.apkSize) throw IOException("downloaded $done bytes, expected ${release.apkSize}")
            val sum = md.digest().joinToString("") { "%02x".format(it) }
            if (release.sha256 != null && sum != release.sha256) throw IOException("checksum doesn't match the release's")
            dest.delete()
            if (!tmp.renameTo(dest)) throw IOException("couldn't save the file")
        } finally {
            tmp.delete()
        }
    }

    /** Once-a-day rule for the automatic check: true when [lastMs] is unset or at least [intervalMs] ago. */
    fun due(lastMs: Long, nowMs: Long, intervalMs: Long = 24L * 60 * 60 * 1000): Boolean =
        lastMs <= 0 || nowMs - lastMs >= intervalMs || nowMs < lastMs
}
