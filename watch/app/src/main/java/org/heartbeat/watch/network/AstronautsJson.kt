package org.heartbeat.watch.network

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.heartbeat.watch.domain.Astronaut

/** `GET /api/astronauts`: `[{"id","name","watchId","age"}]`; the watch only needs id and name. */
object AstronautsJson {
    /** Throws [MalformedResponseException] if the body is not the agreed shape. */
    fun decode(body: String): List<Astronaut> =
        decodingServerReply("Crew list") {
            Json.parseToJsonElement(body).jsonArray.map { entry ->
                val astronaut = entry.jsonObject
                Astronaut(
                    id = astronaut.getValue("id").jsonPrimitive.content,
                    name = astronaut.getValue("name").jsonPrimitive.content,
                )
            }
        }
}
