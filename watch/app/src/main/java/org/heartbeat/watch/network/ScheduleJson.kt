package org.heartbeat.watch.network

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.heartbeat.watch.domain.ScheduledTask
import org.heartbeat.watch.domain.TaskKind
import java.time.LocalTime
import java.time.format.DateTimeFormatter

/**
 * The schedule's JSON: a list of `{"id","kind","label","localTime":"HH:MM"}`; times are spacecraft local time, UTC
 * (SPEC §10).
 * Also used to cache the last good schedule on the watch, in the same shape.
 */
object ScheduleJson {
    private val LOCAL_TIME: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")

    /** Throws [MalformedResponseException] if the body is not the agreed shape. */
    fun decode(body: String): List<ScheduledTask> =
        decodingServerReply("Schedule") { Json.parseToJsonElement(body).jsonArray.mapNotNull { decodeTask(it.jsonObject) } }

    fun encode(tasks: List<ScheduledTask>): String = JsonArray(tasks.map(::encodeTask)).toString()

    /** A task with no set time (`localTime: null`, the daily exercise goal) has nothing to remind at, so it is skipped. */
    private fun decodeTask(task: JsonObject): ScheduledTask? {
        val time = task.getValue("localTime")
        if (time is JsonNull) return null
        val kindName = task.getValue("kind").jsonPrimitive.content
        return ScheduledTask(
            id = task.getValue("id").jsonPrimitive.content,
            kind = TaskKind.fromWireName(kindName),
            kindName = kindName,
            label = task.getValue("label").jsonPrimitive.content,
            localTime = LocalTime.parse(time.jsonPrimitive.content, LOCAL_TIME),
        )
    }

    private fun encodeTask(task: ScheduledTask): JsonObject =
        buildJsonObject {
            put("id", task.id)
            put("kind", task.kindName)
            put("label", task.label)
            put("localTime", LOCAL_TIME.format(task.localTime))
        }
}
