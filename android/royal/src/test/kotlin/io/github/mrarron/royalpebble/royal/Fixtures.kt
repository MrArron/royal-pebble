package io.github.mrarron.royalpebble.royal

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import java.io.File
import java.net.SocketTimeoutException
import java.util.Base64

/** The shared fixtures in test/fixtures/ (also read by test/pkjs/royal.test.js and test_cruise_sync.py). */
object Fixtures {
    private val dir = File(System.getProperty("fixtures") ?: "../../test/fixtures")

    fun text(name: String): String = File(dir, name).readText()
    fun json(name: String): JsonElement = Json.parseToJsonElement(text(name))

    val login: JsonObject by lazy { json("login-HM-sample.json") as JsonObject }

    private fun b64url(json: String): String = Base64.getUrlEncoder().withoutPadding().encodeToString(json.toByteArray())
    val TOKEN = b64url("""{"alg":"none"}""") + "." + b64url("""{"sub":"ACC1","name":"x"}""") + ".sig"
}

/** One request the fake saw: the path without the API host (as royal.test.js names them). */
data class Call(val method: String, val path: String, val query: String, val headers: Map<String, String>, val body: String?)

/**
 * A fake Royal answering from the shared made-up login fixture, like
 * royal.test.js fakeRoyal: [replies] override it by path, [fail] paths answer
 * 404, [login] is the sign-in's status and body, [script] answers by call number.
 */
class FakeRoyal(
    private val replies: Map<String, String> = emptyMap(),
    private val fail: Set<String> = emptySet(),
    private val login: Pair<Int, String> = 200 to """{"access_token":"${Fixtures.TOKEN}"}""",
    private val script: Map<Int, Any> = emptyMap(),
) : Transport {
    val calls = mutableListOf<Call>()

    private val extra: Map<String, String> = mapOf(
        "/v3/ships/HM/sailDate/20270306" to """{"payload":{"sailingInfo":[{"itinerary":{"events":[
            {"day":1,"port":{"portName":"Port Canaveral","portCode":"PCN","portType":"EMBARK",
             "arrivalDateTime":"20270306T000000","departureDateTime":"20270306T163000"}}]}}]}}""",
        "/v3/products" to """{"payload":{"products":[{"productType":{"productType":"SHOREX"},"productTitle":"Beach Day",
            "productID":"X1","productLocation":{},"offering":[{"offeringDate":"20270309","offeringTime":"0900",
            "meetingTime":"0845","offeringDurationInMinutes":"150"}]}]}}""",
    ) + replies

    override fun send(request: HttpRequest): HttpResponse {
        val q = request.url.indexOf('?')
        val path = (if (q == -1) request.url else request.url.substring(0, q))
            .replace(RoyalClient.COMMERCE, "").replace(RoyalClient.API + "/en/royal/web", "").replace(RoyalClient.API, "")
        calls += Call(request.method, path, if (q == -1) "" else request.url.substring(q + 1), request.headers, request.body)
        script[calls.size]?.let {
            when (it) {
                is Int -> return HttpResponse(it, "{}")
                is String -> return HttpResponse(200, it)
                is Exception -> throw it
            }
        }
        if (path.endsWith("oauth2/access_token")) return HttpResponse(login.first, login.second)
        if (path in fail) return HttpResponse(404, "{}")
        extra[path]?.let { return HttpResponse(200, it) }
        (Fixtures.login["replies"] as JsonObject)[path]?.let { return HttpResponse(200, it.toString()) }
        return HttpResponse(404, "{}")
    }
}

class Timeout : SocketTimeoutException("slow")
