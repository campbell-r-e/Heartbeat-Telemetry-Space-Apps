package org.heartbeat.watch.domain

/** A crew member as the server lists them (`GET /api/astronauts`). */
data class Astronaut(val id: String, val name: String)

fun interface AstronautDirectory {
    suspend fun astronauts(): ServerResult<List<Astronaut>>
}
