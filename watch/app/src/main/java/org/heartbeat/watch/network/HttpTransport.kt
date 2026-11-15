package org.heartbeat.watch.network

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

data class HttpResponse(val code: Int, val body: String) {
    val isSuccessful: Boolean get() = code in HTTP_OK_RANGE

    private companion object {
        val HTTP_OK_RANGE = 200..299
    }
}

/** The smallest HTTP surface the server client needs; faked in unit tests. Throws [IOException] when the server can't be reached. */
interface HttpTransport {
    suspend fun get(url: String): HttpResponse

    suspend fun postJson(url: String, json: String, bearerToken: String): HttpResponse
}

/** Opens the connection for one request; decides which network it goes over. */
fun interface ConnectionOpener {
    suspend fun open(url: URL): HttpURLConnection
}

/** [HttpTransport] on the platform's [HttpURLConnection], so the app needs no extra HTTP library. */
class UrlConnectionTransport(private val opener: ConnectionOpener) : HttpTransport {

    override suspend fun get(url: String): HttpResponse = request(url) { }

    override suspend fun postJson(url: String, json: String, bearerToken: String): HttpResponse =
        request(url) {
            requestMethod = "POST"
            doOutput = true
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("Authorization", "Bearer $bearerToken")
            outputStream.use { it.write(json.toByteArray(Charsets.UTF_8)) }
        }

    private suspend fun request(url: String, send: HttpURLConnection.() -> Unit): HttpResponse =
        withContext(Dispatchers.IO) {
            val connection = opener.open(URL(url))
            try {
                connection.connectTimeout = CONNECT_TIMEOUT_MS
                connection.readTimeout = READ_TIMEOUT_MS
                connection.setRequestProperty("Accept", "application/json")
                connection.send()
                HttpResponse(connection.responseCode, connection.readBody())
            } finally {
                connection.disconnect()
            }
        }

    private fun HttpURLConnection.readBody(): String {
        val stream = if (responseCode < HTTP_ERROR_THRESHOLD) inputStream else errorStream
        return stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
    }

    private companion object {
        const val CONNECT_TIMEOUT_MS = 10_000
        const val READ_TIMEOUT_MS = 20_000
        const val HTTP_ERROR_THRESHOLD = 400
    }
}
