package org.heartbeat.watch.domain

import java.time.LocalTime

/**
 * One daily task from the server's schedule (`GET /api/astronauts/:id/schedule`), the same list as the
 * dashboard's "Today's tasks". [kind] is `null` for a kind the watch does not know; it is still reminded.
 */
data class ScheduledTask(
    val id: String,
    val kind: TaskKind?,
    val kindName: String,
    val label: String,
    val localTime: LocalTime,
)

/** Task kinds the watch knows, by their name in the schedule. */
enum class TaskKind(val wireName: String) {
    ECG("ecg"),
    SPO2("spo2"),
    CHECK_IN("checkIn"),
    MEAL("meal");

    companion object {
        private val byWireName = entries.associateBy(TaskKind::wireName)

        fun fromWireName(name: String): TaskKind? = byWireName[name]
    }
}

/** The astronaut's daily schedule from the server. */
fun interface ScheduleRepository {
    suspend fun schedule(astronautId: String): ServerResult<List<ScheduledTask>>
}
