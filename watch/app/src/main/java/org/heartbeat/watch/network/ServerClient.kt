package org.heartbeat.watch.network

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import org.heartbeat.watch.domain.Astronaut
import org.heartbeat.watch.domain.AstronautDirectory
import org.heartbeat.watch.domain.ConnectionFailure
import org.heartbeat.watch.domain.DeviceInfo
import org.heartbeat.watch.domain.FoodRepository
import org.heartbeat.watch.domain.LatestReadingsRepository
import org.heartbeat.watch.domain.MealLog
import org.heartbeat.watch.domain.MenuFood
import org.heartbeat.watch.domain.PointsRepository
import org.heartbeat.watch.domain.PointsSummary
import org.heartbeat.watch.domain.Reading
import org.heartbeat.watch.domain.ReadingsUploader
import org.heartbeat.watch.domain.ReceiptResult
import org.heartbeat.watch.domain.ScheduleRepository
import org.heartbeat.watch.domain.ScheduledTask
import org.heartbeat.watch.domain.ServerHealthCheck
import org.heartbeat.watch.domain.ServerResult
import org.heartbeat.watch.domain.StatusReport
import org.heartbeat.watch.domain.StatusRepository
import org.heartbeat.watch.domain.SurgeonNote
import org.heartbeat.watch.domain.SurgeonNotesRepository
import org.heartbeat.watch.domain.UploadResult
import org.heartbeat.watch.settings.ConnectionSettings
import java.io.IOException
import java.time.Instant

/**
 * The onboard server's HTTP API as the watch uses it. Reads the current [ConnectionSettings] on every
 * call, so a change made on the settings screen applies to the next request. Every readings post carries [device].
 */
class ServerClient(
    private val transport: HttpTransport,
    private val device: suspend () -> DeviceInfo,
    private val currentSettings: suspend () -> ConnectionSettings,
) : ReadingsUploader,
    LatestReadingsRepository,
    ScheduleRepository,
    AstronautDirectory,
    FoodRepository,
    StatusRepository,
    PointsRepository,
    SurgeonNotesRepository,
    ServerHealthCheck {

    override suspend fun upload(readings: List<Reading>): UploadResult {
        val settings = currentSettings()
        if (settings.token.isBlank()) return UploadResult.Failed(ConnectionFailure.MissingToken)
        val body = ReadingsJson.encodeUpload(settings.astronautId, readings, device())
        return when (val counts = post(settings, READINGS_PATH, body).then { decode(it, ReadingsJson::decodeUploadCounts) }) {
            is ServerResult.Found -> counts.value
            is ServerResult.Failed -> UploadResult.Failed(counts.failure)
        }
    }

    override suspend fun latest(subjectId: String): ServerResult<List<Reading>> =
        get("$ASTRONAUTS_PATH/$subjectId/latest", ReadingsJson::decodeLatest)

    override suspend fun schedule(astronautId: String): ServerResult<List<ScheduledTask>> =
        get("$ASTRONAUTS_PATH/$astronautId/schedule", ScheduleJson::decode)

    override suspend fun astronauts(): ServerResult<List<Astronaut>> = get(ASTRONAUTS_PATH, AstronautsJson::decode)

    override suspend fun mealsBetween(astronautId: String, from: Instant, to: Instant): ServerResult<List<MealLog>> =
        get("$ASTRONAUTS_PATH/$astronautId/meals?from=$from&to=$to", FoodJson::decodeMeals)

    override suspend fun menu(): ServerResult<List<MenuFood>> = get(MENU_PATH, FoodJson::decodeMenu)

    /** A 404 (no rules engine yet, or an astronaut the server does not know) leaves the watch neutral. */
    override suspend fun status(astronautId: String): ServerResult<StatusReport> =
        when (val result = get("$ASTRONAUTS_PATH/$astronautId/status", StatusJson::decode)) {
            is ServerResult.Failed -> if (result.failure.isNotFound()) ServerResult.Found(StatusReport.NOT_AVAILABLE) else result
            is ServerResult.Found -> result
        }

    override suspend fun points(astronautId: String): ServerResult<PointsSummary> =
        get("$ASTRONAUTS_PATH/$astronautId/points", PointsJson::decode)

    override suspend fun notes(astronautId: String): ServerResult<List<SurgeonNote>> =
        get("$ASTRONAUTS_PATH/$astronautId/notes", NotesJson::decodeNotes)

    /**
     * A write, so it carries the token; marking a note read again answers with the receipt already sent. Only this
     * request tells `unknown_note` apart; on any other route that 404 stays a [ConnectionFailure.RequestRefused].
     */
    override suspend fun markRead(astronautId: String, noteId: String): ReceiptResult {
        val settings = currentSettings()
        if (settings.token.isBlank()) return ReceiptResult.Failed(ConnectionFailure.MissingToken)
        val url = "${settings.baseUrl}$ASTRONAUTS_PATH/$astronautId/notes/$noteId/read"
        return when (val sent = send { transport.postJson(url, EMPTY_JSON_BODY, settings.token) }) {
            is ServerResult.Failed -> ReceiptResult.Failed(sent.failure)
            is ServerResult.Found -> receipt(sent.value)
        }
    }

    private fun receipt(response: HttpResponse): ReceiptResult {
        if (response.isUnknownNote()) return ReceiptResult.UnknownNote
        response.failureOrNull()?.let { return ReceiptResult.Failed(it) }
        return when (val readAt = decode(response, NotesJson::decodeReadAt)) {
            is ServerResult.Found -> ReceiptResult.Sent(readAt.value)
            is ServerResult.Failed -> ReceiptResult.Failed(readAt.failure)
        }
    }

    override suspend fun alertTitles(astronautId: String): ServerResult<Map<String, String>> =
        get("$ASTRONAUTS_PATH/$astronautId/relayed-alerts", NotesJson::decodeAlertTitles)

    private fun ConnectionFailure.isNotFound(): Boolean =
        this is ConnectionFailure.UnknownAstronaut || (this is ConnectionFailure.RequestRefused && httpCode == HTTP_NOT_FOUND)

    /**
     * Checks the address with `GET /api/health`, then the token by posting an empty batch (the server accepts it
     * and stores nothing), then that the astronaut id is on the server's crew list, so a wrong token or id shows on
     * the Connection screen before any reading is sent.
     */
    override suspend fun check(): ConnectionFailure? {
        val settings = currentSettings()
        healthFailure(settings)?.let { return it }
        if (settings.token.isBlank()) return ConnectionFailure.MissingToken
        (post(settings, READINGS_PATH, ReadingsJson.encodeUpload(settings.astronautId, emptyList(), device())) as? ServerResult.Failed)
            ?.let { return it.failure }
        return astronautFailure(settings.astronautId)
    }

    private suspend fun astronautFailure(astronautId: String): ConnectionFailure? =
        when (val crew = astronauts()) {
            is ServerResult.Failed -> crew.failure
            is ServerResult.Found ->
                if (crew.value.any { it.id == astronautId }) null else ConnectionFailure.UnknownAstronaut(astronautId)
        }

    private suspend fun healthFailure(settings: ConnectionSettings): ConnectionFailure? =
        (call { transport.get("${settings.baseUrl}$HEALTH_PATH") } as? ServerResult.Failed)?.failure

    private suspend fun <T> get(path: String, decodeBody: (String) -> T): ServerResult<T> =
        call { transport.get("${currentSettings().baseUrl}$path") }.then { decode(it, decodeBody) }

    private suspend fun post(settings: ConnectionSettings, path: String, json: String): ServerResult<HttpResponse> =
        call { transport.postJson("${settings.baseUrl}$path", json, settings.token) }

    /** Runs a request; an unreachable server or an HTTP error status becomes a [ConnectionFailure]. */
    private suspend fun call(request: suspend () -> HttpResponse): ServerResult<HttpResponse> =
        send(request).then { response ->
            response.failureOrNull()?.let { ServerResult.Failed(it) } ?: ServerResult.Found(response)
        }

    /** Runs a request; only an unreachable server becomes a [ConnectionFailure], any HTTP status is answered as is. */
    private suspend fun send(request: suspend () -> HttpResponse): ServerResult<HttpResponse> =
        try {
            ServerResult.Found(request())
        } catch (e: IOException) {
            ServerResult.Failed(ConnectionFailure.Unreachable(e.message ?: e.javaClass.simpleName))
        } catch (e: IllegalArgumentException) {
            ServerResult.Failed(ConnectionFailure.Unreachable("Invalid server address: ${e.message}"))
        }

    private fun <T> decode(response: HttpResponse, decodeBody: (String) -> T): ServerResult<T> =
        try {
            ServerResult.Found(decodeBody(response.body))
        } catch (e: MalformedResponseException) {
            ServerResult.Failed(ConnectionFailure.MalformedResponse(e.message.orEmpty()))
        }

    private inline fun <T, R> ServerResult<T>.then(next: (T) -> ServerResult<R>): ServerResult<R> =
        when (this) {
            is ServerResult.Found -> next(value)
            is ServerResult.Failed -> this
        }

    private fun HttpResponse.failureOrNull(): ConnectionFailure? =
        when {
            isSuccessful -> null
            code == HTTP_UNAUTHORIZED || code == HTTP_FORBIDDEN -> ConnectionFailure.TokenRefused
            code == HTTP_REQUEST_TIMEOUT || code == HTTP_TOO_MANY_REQUESTS || code >= HTTP_SERVER_ERROR ->
                ConnectionFailure.ServerError(code)
            code == HTTP_BAD_REQUEST -> ConnectionFailure.Rejected(code, body.take(MAX_ERROR_DETAIL_LENGTH))
            code == HTTP_NOT_FOUND && errorField("error") == UNKNOWN_ASTRONAUT ->
                ConnectionFailure.UnknownAstronaut(errorField("astronautId").orEmpty())
            else -> ConnectionFailure.RequestRefused(code, body.take(MAX_ERROR_DETAIL_LENGTH))
        }

    private fun HttpResponse.isUnknownNote(): Boolean = code == HTTP_NOT_FOUND && errorField("error") == UNKNOWN_NOTE

    /** A field of the server's JSON error body (`{"error": "...", ...}`), or `null` if the body is not one. */
    private fun HttpResponse.errorField(name: String): String? =
        try {
            (Json.parseToJsonElement(body) as? JsonObject)?.get(name)?.jsonPrimitive?.contentOrNull
        } catch (e: IllegalArgumentException) {
            null
        }

    private companion object {
        const val READINGS_PATH = "/api/readings"
        const val ASTRONAUTS_PATH = "/api/astronauts"
        const val HEALTH_PATH = "/api/health"
        const val MENU_PATH = "/api/menu"
        const val HTTP_BAD_REQUEST = 400
        const val HTTP_UNAUTHORIZED = 401
        const val HTTP_FORBIDDEN = 403
        const val HTTP_NOT_FOUND = 404
        const val HTTP_REQUEST_TIMEOUT = 408
        const val HTTP_TOO_MANY_REQUESTS = 429
        const val HTTP_SERVER_ERROR = 500
        const val MAX_ERROR_DETAIL_LENGTH = 200
        const val UNKNOWN_ASTRONAUT = "unknown_astronaut"
        const val UNKNOWN_NOTE = "unknown_note"

        /** The read receipt takes no body, but a JSON request needs one. */
        const val EMPTY_JSON_BODY = "{}"
    }
}
