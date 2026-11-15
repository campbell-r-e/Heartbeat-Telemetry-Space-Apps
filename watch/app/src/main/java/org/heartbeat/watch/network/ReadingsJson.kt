package org.heartbeat.watch.network

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.heartbeat.watch.domain.DeviceInfo
import org.heartbeat.watch.domain.Metric
import org.heartbeat.watch.domain.Reading
import org.heartbeat.watch.domain.ReadingSource
import org.heartbeat.watch.domain.ReadingValue
import org.heartbeat.watch.domain.UploadResult
import java.time.Instant

/** Translates between domain readings and the server's JSON contract (`POST /api/readings`, `GET .../latest`). */
object ReadingsJson {

    fun encodeUpload(astronautId: String, readings: List<Reading>, device: DeviceInfo): String =
        buildJsonObject {
            put("readings", buildJsonArray { readings.forEach { add(encodeReading(astronautId, it)) } })
            put(
                "device",
                buildJsonObject {
                    put("watchId", device.watchId)
                    put("batteryPct", device.batteryPct)
                },
            )
        }.toString()

    /** Decodes the `POST /api/readings` answer; throws [MalformedResponseException] if it is not the agreed shape. */
    fun decodeUploadCounts(body: String): UploadResult.Accepted =
        decodingServerReply("Upload reply") {
            val json = Json.parseToJsonElement(body).jsonObject
            UploadResult.Accepted(
                accepted = json.getValue("accepted").jsonPrimitive.int,
                duplicates = json["duplicates"]?.jsonPrimitive?.int ?: 0,
            )
        }

    /**
     * Decodes `GET /api/astronauts/:id/latest`; metrics the watch does not know are skipped.
     * Throws [MalformedResponseException] if the body is not the agreed shape.
     */
    fun decodeLatest(body: String): List<Reading> =
        decodingServerReply("Latest readings") { Json.parseToJsonElement(body).jsonArray.mapNotNull { decodeLatestEntry(it.jsonObject) } }

    private fun encodeReading(astronautId: String, reading: Reading): JsonObject =
        buildJsonObject {
            put("astronautId", astronautId)
            put("metric", reading.metric.wireName)
            put("value", encodeValue(reading.value))
            put("unit", reading.metric.unit)
            put("takenAt", reading.takenAt.toString())
            put("source", reading.source.name)
        }

    private fun encodeValue(value: ReadingValue): JsonElement =
        when (value) {
            is ReadingValue.Scalar -> JsonPrimitive(value.number)
            is ReadingValue.Series -> JsonArray(value.samples.map(::JsonPrimitive))
        }

    private fun decodeLatestEntry(entry: JsonObject): Reading? {
        val metric = Metric.fromWireName(entry.getValue("metric").jsonPrimitive.content) ?: return null
        val value = decodeValue(entry.getValue("value")) ?: return null
        return Reading(
            metric = metric,
            value = value,
            takenAt = Instant.parse(entry.getValue("takenAt").jsonPrimitive.content),
            source = ReadingSource(entry.getValue("source").jsonPrimitive.content),
        )
    }

    private fun decodeValue(element: JsonElement): ReadingValue? =
        when (element) {
            is JsonArray -> ReadingValue.Series(element.mapNotNull { it.jsonPrimitive.doubleOrNull })
            is JsonPrimitive -> element.doubleOrNull?.let(ReadingValue::Scalar)
            else -> null
        }
}
