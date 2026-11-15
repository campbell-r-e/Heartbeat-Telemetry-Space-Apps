package org.heartbeat.watch.network

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.heartbeat.watch.domain.Badge
import org.heartbeat.watch.domain.PointsSummary
import java.time.LocalDate

/** `GET /api/astronauts/:id/points` (`PointsSummary` in `shared/src/gamification.ts`); the watch reads what it shows. */
object PointsJson {

    /** Throws [MalformedResponseException] if the body is not the agreed shape. */
    fun decode(body: String): PointsSummary =
        decodingServerReply("Points summary") {
            val summary = Json.parseToJsonElement(body).jsonObject
            PointsSummary(
                astronautId = summary.string("astronautId"),
                day = LocalDate.parse(summary.string("day")),
                totalPoints = summary.getValue("totalPoints").jsonPrimitive.int,
                streakDays = summary.getValue("streak").jsonObject.getValue("days").jsonPrimitive.int,
                badges = summary.getValue("badges").jsonArray.map { decodeBadge(it.jsonObject) },
            )
        }

    private fun decodeBadge(badge: JsonObject) =
        Badge(
            id = badge.string("id"),
            name = badge.string("name"),
            description = badge.string("description"),
            earnedOn = badge["earnedOn"]?.jsonPrimitive?.contentOrNull?.let(LocalDate::parse),
        )

    private fun JsonObject.string(name: String): String = getValue(name).jsonPrimitive.content
}
