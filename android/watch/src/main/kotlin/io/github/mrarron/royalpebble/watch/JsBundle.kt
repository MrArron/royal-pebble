package io.github.mrarron.royalpebble.watch

import java.io.File

/**
 * Packs src/pkjs/index.js and every module it requires into one plain script
 * any JS engine can run, after the host (host.js). Like
 * tools/quickjs-probe/bundle.js: a small CommonJS loader, relative
 * `require('./x')` only (all src/pkjs uses). Running the script loads
 * index.js, which registers its PebbleKit JS handlers on the host's Pebble.
 */
object JsBundle {
    const val ENTRY = "index.js"
    private val REQUIRE = Regex("""require\(\s*'(\.[^']*)'\s*\)""")

    /** Reads a file of src/pkjs by its path there ("index.js", "data/walkways-HM.js"), or null. */
    fun interface Sources {
        fun read(path: String): String?
    }

    /** src/pkjs on disk (tests, tools). */
    class Dir(private val root: File) : Sources {
        override fun read(path: String): String? = File(root, path).takeIf { it.isFile }?.readText(Charsets.UTF_8)
    }

    /** src/pkjs packed into the app as Java resources under [prefix] (android/watch build.gradle.kts). */
    class Resources(private val prefix: String = "royalpebble/pkjs/") : Sources {
        override fun read(path: String): String? =
            JsBundle::class.java.classLoader.getResourceAsStream(prefix + path)?.use { it.readBytes().toString(Charsets.UTF_8) }
    }

    /** The host shim (host.js) from this module's resources. */
    fun hostScript(): String =
        JsBundle::class.java.classLoader.getResourceAsStream("royalpebble/host.js")!!.use { it.readBytes().toString(Charsets.UTF_8) }

    /** The bundled phone companion: defines the modules and loads [ENTRY]. */
    fun build(sources: Sources, entry: String = ENTRY): String {
        val mods = LinkedHashMap<String, Pair<String, Map<String, String>>>()  // id -> (source, require name -> id)
        fun add(id: String): String {
            if (id in mods) return id
            val src = sources.read(id) ?: throw IllegalStateException("missing $id")
            val deps = LinkedHashMap<String, String>()
            mods[id] = src to deps
            for (m in REQUIRE.findAll(src)) {
                val name = m.groupValues[1]
                val want = resolve(id, name)
                val found = listOf("$want.js", want, "$want.json").firstOrNull { sources.read(it) != null }
                    ?: throw IllegalStateException("$id: cannot resolve $name")
                deps[name] = add(found)
            }
            return id
        }
        val root = add(entry)
        val out = StringBuilder("(function(){var defs={};var cache={};\n")
        for ((id, rec) in mods) {
            val (src, deps) = rec
            val body = if (id.endsWith(".json")) "module.exports=$src;" else src
            out.append("defs[").append(str(id)).append("]={deps:{")
            deps.entries.joinTo(out, ",") { (n, d) -> str(n) + ":" + str(d) }
            out.append("},fn:function(module,exports,require){").append(body).append("\n}};\n")
        }
        out.append("function load(id){if(cache[id]){return cache[id].exports;}var d=defs[id];var m={exports:{}};cache[id]=m;")
        out.append("d.fn(m,m.exports,function(n){return load(d.deps[n]);});return m.exports;}\n")
        out.append("load(").append(str(root)).append(");})();\n")
        return out.toString()
    }

    /** `./data/x` required from `index.js` -> `data/x`; handles `..`. */
    internal fun resolve(from: String, name: String): String {
        val parts = from.split('/').dropLast(1).toMutableList()
        for (p in name.split('/')) {
            when (p) {
                ".", "" -> {}
                ".." -> if (parts.isNotEmpty()) parts.removeAt(parts.size - 1)
                else -> parts.add(p)
            }
        }
        return parts.joinToString("/")
    }

    private fun str(s: String) = kotlinx.serialization.json.JsonPrimitive(s).toString()
}
