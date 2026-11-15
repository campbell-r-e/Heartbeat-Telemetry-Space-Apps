package org.heartbeat.watch.upload

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.heartbeat.watch.domain.Metric
import org.heartbeat.watch.domain.Reading
import org.heartbeat.watch.domain.ReadingSource
import org.heartbeat.watch.domain.ReadingValue
import java.time.Instant
import java.time.format.DateTimeParseException

/** A stored queue line that cannot be read back (for example cut short by a crash, or from a newer format). */
class UnreadableStoredReadingException(message: String, cause: Throwable? = null) : Exception(message, cause)

/**
 * How the upload queue keeps one reading on one line of its file. This is the watch's own storage format, versioned
 * and independent of the server's JSON contract, so either can change without breaking the other.
 */
object StoredReadingFormat {
    private const val VERSION = 1
    private const val KEY_VERSION = "v"
    private const val KEY_METRIC = "metric"
    private const val KEY_VALUE = "value"
    private const val KEY_TAKEN_AT = "takenAt"
    private const val KEY_SOURCE = "source"

    fun encode(reading: Reading): String =
        buildJsonObject {
            put(KEY_VERSION, VERSION)
            put(KEY_METRIC, reading.metric.wireName)
            put(KEY_VALUE, encodeValue(reading.value))
            put(KEY_TAKEN_AT, reading.takenAt.toString())
            put(KEY_SOURCE, reading.source.name)
        }.toString()

    /** `null` for a metric this version of the app no longer knows; throws [UnreadableStoredReadingException] otherwise. */
    fun decode(line: String): Reading? =
        try {
            decodeLine(line)
        } catch (e: IllegalArgumentException) {
            throw UnreadableStoredReadingException("Stored reading is not readable: ${e.message}", e)
        } catch (e: NoSuchElementException) {
            throw UnreadableStoredReadingException("Stored reading is missing a field: ${e.message}", e)
        } catch (e: DateTimeParseException) {
            throw UnreadableStoredReadingException("Stored reading has an invalid time: ${e.parsedString}", e)
        }

    private fun decodeLine(line: String): Reading? {
        val json = Json.parseToJsonElement(line).jsonObject
        // Lines written before the format was versioned (round 1) have the same fields and no "v": they are version 1.
        val version = json[KEY_VERSION]?.jsonPrimitive?.int ?: VERSION
        if (version != VERSION) throw UnreadableStoredReadingException("Stored reading has format version $version")
        val metric = Metric.fromWireName(json.getValue(KEY_METRIC).jsonPrimitive.content) ?: return null
        return Reading(
            metric = metric,
            value = decodeValue(json.getValue(KEY_VALUE)),
            takenAt = Instant.parse(json.getValue(KEY_TAKEN_AT).jsonPrimitive.content),
            source = ReadingSource(json.getValue(KEY_SOURCE).jsonPrimitive.content),
        )
    }

    private fun encodeValue(value: ReadingValue): JsonElement =
        when (value) {
            is ReadingValue.Scalar -> JsonPrimitive(value.number)
            is ReadingValue.Series -> JsonArray(value.samples.map(::JsonPrimitive))
        }

    private fun decodeValue(element: JsonElement): ReadingValue =
        when (element) {
            is JsonArray -> ReadingValue.Series(element.map { requireNotNull(it.jsonPrimitive.doubleOrNull) })
            else -> ReadingValue.Scalar(requireNotNull(element.jsonPrimitive.doubleOrNull))
        }
}
