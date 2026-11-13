package io.github.mrarron.royalpebble.alerts

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/** The message keys are hard-coded for the Android app; this fails if package.json's order moves them. */
class WatchProtocolTest {
    private val pkg: JsonObject by lazy {
        val dir = File(System.getProperty("fixtures")!!).parentFile.parentFile
        Json.parseToJsonElement(File(dir, "package.json").readText()).jsonObject
    }
    private val keys: List<String> by lazy {
        (pkg["pebble"]!!.jsonObject["messageKeys"] as JsonArray).map { it.jsonPrimitive.content }
    }

    @Test
    fun keysMatchPackageJson() {
        assertEquals(WatchProtocol.KEY_MSG_TYPE, 10000 + keys.indexOf("msg_type"))
        assertEquals(WatchProtocol.KEY_NOTICE_COUNT, 10000 + keys.indexOf("notice_count"))
        assertEquals(WatchProtocol.KEY_NOTICES, 10000 + keys.indexOf("notices"))
    }
}
