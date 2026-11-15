package org.heartbeat.watch.network

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.heartbeat.watch.domain.Area
import org.heartbeat.watch.domain.DerivedHrv
import org.heartbeat.watch.domain.DerivedValues
import org.heartbeat.watch.domain.ExerciseToday
import org.heartbeat.watch.domain.Metric
import org.heartbeat.watch.domain.Status
import org.heartbeat.watch.domain.StatusReport
import org.heartbeat.watch.domain.StatusSnapshot
import java.time.Instant

/**
 * `GET /api/astronauts/:id/status` (shared `AstronautStatus`, SPEC §10). Every field the watch uses is checked:
 * a status that is not normal/watch/alert, a missing field or a wrong type makes the whole reply malformed rather than
 * half-trusted. Areas and metrics this version of the watch does not know are skipped.
 */
object StatusJson {
    private val STATUSES = mapOf("normal" to Status.NORMAL, "watch" to Status.WATCH, "alert" to Status.ALERT)
    private val AREAS = mapOf(
        "vitals" to Area.VITALS,
        "radiation" to Area.RADIATION,
        "gravity" to Area.GRAVITY,
        "cabin" to Area.CABIN,
        "nutrition" to Area.FOOD,
        "mind" to Area.MIND,
    )

    /** Throws [MalformedResponseException] if the body is not the agreed shape. */
    fun decode(body: String): StatusReport =
        decodingServerReply("Status") {
            val json = Json.parseToJsonElement(body).jsonObject
            StatusReport(statuses = snapshot(json), derived = derived(json.getValue("derived").jsonObject))
        }

    private fun snapshot(json: JsonObject): StatusSnapshot =
        StatusSnapshot(
            areas = areaStatuses(json),
            metrics = metricStatuses(json),
            noRecentData = json.getValue("noRecentData").jsonArray.mapNotNull { Metric.fromWireName(it.jsonPrimitive.content) }.toSet(),
        )

    /** `status: null` means the server could not rate the area; such areas stay neutral. */
    private fun areaStatuses(json: JsonObject): Map<Area, Status> =
        json.getValue("areas").jsonArray.mapNotNull { entry ->
            val area = entry.jsonObject
            val name = AREAS[area.getValue("area").jsonPrimitive.content] ?: return@mapNotNull null
            nullableStatus(area.getValue("status"))?.let { name to it }
        }.toMap()

    private fun metricStatuses(json: JsonObject): Map<Metric, Status> =
        json.getValue("metrics").jsonArray.mapNotNull { entry ->
            val metric = entry.jsonObject
            val name = Metric.fromWireName(metric.getValue("metric").jsonPrimitive.content) ?: return@mapNotNull null
            name to status(metric.getValue("status"))
        }.toMap()

    private fun derived(json: JsonObject): DerivedValues =
        DerivedValues(
            hrv = nullableObject(json.getValue("hrv"))?.let {
                DerivedHrv(rmssdMs = it.getValue("rmssdMs").jsonPrimitive.double, windowStart = instant(it.getValue("at")))
            },
            exercise = exercise(json.getValue("exerciseToday").jsonObject),
            radiationTimesNormal = nullableObject(json.getValue("radiationDailyDose"))?.getValue("multiple")?.jsonPrimitive?.double,
        )

    /** `minutes` is null when the age is unknown (then `thresholdBpm` is null too) or no heart rate came today. */
    private fun exercise(json: JsonObject): ExerciseToday =
        ExerciseToday(
            minutes = nullableInt(json.getValue("minutes")),
            goalMinutes = nullableInt(json.getValue("goalMinutes")),
            ageKnown = json.getValue("thresholdBpm") !is JsonNull,
        )

    private fun status(element: JsonElement): Status =
        requireNotNull(nullableStatus(element)) { "a metric status cannot be null" }

    private fun nullableStatus(element: JsonElement): Status? {
        if (element is JsonNull) return null
        val text = element.jsonPrimitive.content
        return requireNotNull(STATUSES[text]) { "unknown status \"$text\"" }
    }

    private fun nullableObject(element: JsonElement): JsonObject? = if (element is JsonNull) null else element.jsonObject

    private fun nullableInt(element: JsonElement): Int? = if (element is JsonNull) null else element.jsonPrimitive.int

    private fun instant(element: JsonElement): Instant {
        require(element is JsonPrimitive && element.isString) { "a time must be a string" }
        return Instant.parse(element.content)
    }
}
