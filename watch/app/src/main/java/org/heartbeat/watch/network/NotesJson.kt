package org.heartbeat.watch.network

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.heartbeat.watch.domain.SurgeonNote
import java.time.Instant

/**
 * The relay's onboard views: `GET /api/astronauts/:id/notes` (`OnboardNote[]`), the read receipt event that
 * `POST .../notes/:noteId/read` answers with (`{"payload":{"readAt"}}`), and `GET .../relayed-alerts` (`OnboardAlert[]`).
 */
object NotesJson {

    /** Throws [MalformedResponseException] if the body is not the agreed shape. */
    fun decodeNotes(body: String): List<SurgeonNote> =
        decodingServerReply("Note list") {
            Json.parseToJsonElement(body).jsonArray.map { entry ->
                val note = entry.jsonObject
                SurgeonNote(
                    noteId = note.getValue("noteId").jsonPrimitive.content,
                    text = note.getValue("text").jsonPrimitive.content,
                    alertId = note.optionalString("alertId"),
                    sentAt = Instant.parse(note.getValue("sentAt").jsonPrimitive.content),
                    readAt = note.optionalString("readAt")?.let(Instant::parse),
                )
            }
        }

    /** A string field that may be missing or null. */
    private fun JsonObject.optionalString(name: String): String? = get(name)?.jsonPrimitive?.contentOrNull

    /** Throws [MalformedResponseException] if the body is not the agreed shape. */
    fun decodeReadAt(body: String): Instant =
        decodingServerReply("Read receipt") {
            val payload = Json.parseToJsonElement(body).jsonObject.getValue("payload").jsonObject
            Instant.parse(payload.getValue("readAt").jsonPrimitive.content)
        }

    /** Throws [MalformedResponseException] if the body is not the agreed shape. */
    fun decodeAlertTitles(body: String): Map<String, String> =
        decodingServerReply("Relayed alert list") {
            Json.parseToJsonElement(body).jsonArray.associate { entry ->
                val alert = entry.jsonObject
                alert.getValue("alertId").jsonPrimitive.content to alert.getValue("title").jsonPrimitive.content
            }
        }
}
