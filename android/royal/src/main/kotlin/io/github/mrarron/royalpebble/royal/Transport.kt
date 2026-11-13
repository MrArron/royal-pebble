package io.github.mrarron.royalpebble.royal

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** One HTTP request, as the Royal client sends it. */
data class HttpRequest(
    val method: String,
    val url: String,
    val headers: Map<String, String>,
    val body: String? = null,
) {
    // The sign-in body holds the password: keep it out of logs and crash reports.
    override fun toString(): String = "HttpRequest($method ${url.substringBefore('?')})"
}

data class HttpResponse(val status: Int, val body: String)

/**
 * Sends one request. Throws [java.net.SocketTimeoutException] when Royal doesn't
 * answer in time and another [IOException] when it can't be reached. Tests use a
 * fake that answers from the shared fixtures; the app uses [UrlConnectionTransport].
 */
fun interface Transport {
    @Throws(IOException::class)
    fun send(request: HttpRequest): HttpResponse
}

/** java.net.HttpURLConnection, which Android and plain JVMs both have (no extra library). */
class UrlConnectionTransport(private val timeoutMs: Int = RoyalClient.TIMEOUT_MS) : Transport {
    override fun send(request: HttpRequest): HttpResponse {
        val conn = URL(request.url).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = request.method
            conn.connectTimeout = timeoutMs
            conn.readTimeout = timeoutMs
            conn.useCaches = false
            request.headers.forEach { (k, v) -> conn.setRequestProperty(k, v) }
            val body = request.body
            if (body != null) {
                conn.doOutput = true
                val bytes = body.toByteArray(Charsets.UTF_8)
                conn.setFixedLengthStreamingMode(bytes.size)
                conn.outputStream.use { it.write(bytes) }
            }
            val status = conn.responseCode
            val stream = if (status >= 400) conn.errorStream else conn.inputStream
            val text = stream?.use { it.readBytes().toString(Charsets.UTF_8) } ?: ""
            return HttpResponse(status, text)
        } finally {
            conn.disconnect()
        }
    }
}
