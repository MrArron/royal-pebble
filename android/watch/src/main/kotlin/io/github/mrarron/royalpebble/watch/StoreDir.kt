package io.github.mrarron.royalpebble.watch

import java.io.File
import java.io.IOException

/**
 * index.js's localStorage, kept in the cruise store's folder: one file per key,
 * `<key>.json`, written through a temporary file, the same layout as
 * io.github.mrarron.royalpebble.store.CruiseStore, so the app's downloads and
 * settings screens and the JS share one copy. Values are the JS's text as is
 * (usually JSON). Holds cabin and booking details: never log what it reads.
 */
class StoreDir(private val dir: File) {
    // key -> (stamp, content hash) of the file as last read or written here
    private val known = HashMap<String, Pair<Long, Int>>()

    init {
        dir.mkdirs()
    }

    private fun file(key: String): File {
        require(KEY.matches(key)) { "bad store key" }
        return File(dir, "$key.json")
    }

    private fun stamp(f: File): Long = if (f.exists()) f.lastModified() * 31 + f.length() else MISSING

    private fun keyFiles(): List<File> =
        (dir.listFiles() ?: emptyArray()).filter { it.isFile && it.name.endsWith(".json") && KEY.matches(it.name.removeSuffix(".json")) }

    /** Every key and its text, remembered as seen. */
    @Synchronized
    fun readAll(): Map<String, String> {
        known.clear()
        return keyFiles().sortedBy { it.name }.associate { f ->
            val key = f.name.removeSuffix(".json")
            val text = f.readText(Charsets.UTF_8)
            known[key] = stamp(f) to text.hashCode()
            key to text
        }
    }

    /**
     * Keys written or removed by someone else (a download, a settings screen)
     * since they were last seen here: key -> text, or null when removed. A file
     * changed in the last few seconds is compared by content too, since file
     * times can be as coarse as a second.
     */
    @Synchronized
    fun changes(nowMs: Long = System.currentTimeMillis()): Map<String, String?> {
        val out = LinkedHashMap<String, String?>()
        val files = keyFiles().associateBy { it.name.removeSuffix(".json") }
        for ((key, f) in files.toSortedMap()) {
            val s = stamp(f)
            val k = known[key]
            if (k == null || k.first != s || f.lastModified() > nowMs - RECENT_MS) {
                val text = f.readText(Charsets.UTF_8)
                if (k == null || k.first != s || k.second != text.hashCode()) out[key] = text
                known[key] = s to text.hashCode()
            }
        }
        for (key in known.keys.toList()) {
            if (key !in files) {
                known.remove(key)
                out[key] = null
            }
        }
        return out
    }

    /** Saves [text] under [key] (null removes it). A key the store can't name is skipped. */
    @Synchronized
    fun write(key: String, text: String?) {
        if (!KEY.matches(key)) return
        val f = file(key)
        if (text == null) {
            f.delete()
            known.remove(key)
            return
        }
        val tmp = File(dir, "$key.json.tmp")
        tmp.writeText(text, Charsets.UTF_8)
        if (!tmp.renameTo(f)) {
            f.delete()
            if (!tmp.renameTo(f)) throw IOException("could not save $key")
        }
        known[key] = stamp(f) to text.hashCode()
    }

    companion object {
        /** CruiseStore's key names; every key index.js and log.js use fits. */
        val KEY = Regex("[A-Za-z][A-Za-z0-9_]{0,63}")
        private const val MISSING = -1L
        private const val RECENT_MS = 3000L
    }
}
