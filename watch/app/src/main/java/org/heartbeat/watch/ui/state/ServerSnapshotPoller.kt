package org.heartbeat.watch.ui.state

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import org.heartbeat.watch.domain.DerivedValues
import org.heartbeat.watch.domain.LatestReadingsRepository
import org.heartbeat.watch.domain.Reading
import org.heartbeat.watch.domain.ServerResult
import org.heartbeat.watch.domain.StatusReport
import org.heartbeat.watch.domain.StatusRepository
import org.heartbeat.watch.domain.StatusSnapshot
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds

/** What the server last told the watch: latest readings (astronaut and ship), statuses and derived values. */
data class ServerSnapshot(
    val readings: List<Reading> = emptyList(),
    val statuses: StatusSnapshot? = null,
    val derived: DerivedValues = DerivedValues.NONE_YET,
)

/** Polls the server for everything the screens show that the watch does not measure itself. */
class ServerSnapshotPoller(
    private val latest: LatestReadingsRepository,
    private val statuses: StatusRepository,
    private val astronautId: suspend () -> String,
    private val log: (String) -> Unit,
    private val interval: Duration = DEFAULT_INTERVAL,
) {
    /** Latest readings per subject (astronaut id or ship), kept separately so one failing does not blank the other. */
    private val latestBySubject = MutableStateFlow<Map<String, List<Reading>>>(emptyMap())
    private val _snapshot = MutableStateFlow(ServerSnapshot())
    private var lastStatus = StatusReport.NOT_AVAILABLE

    val snapshot: StateFlow<ServerSnapshot> = _snapshot.asStateFlow()

    suspend fun run() {
        while (currentCoroutineContext().isActive) {
            refresh()
            delay(interval)
        }
    }

    suspend fun refresh() {
        val astronaut = astronautId()
        refreshLatest(astronaut)
        refreshLatest(SHIP_ID)
        refreshStatus(astronaut)
        _snapshot.value = ServerSnapshot(
            readings = latestBySubject.value.values.flatten(),
            statuses = lastStatus.statuses,
            derived = lastStatus.derived,
        )
    }

    /** On failure keeps the last verdict, like the readings; a server without the endpoint yields neutral. */
    private suspend fun refreshStatus(astronautId: String) {
        when (val result = statuses.status(astronautId)) {
            is ServerResult.Found -> lastStatus = result.value
            is ServerResult.Failed -> log("Could not load the status for $astronautId: ${result.failure}")
        }
    }

    /** On failure keeps what the server sent last time, so a dropped connection does not blank the tiles. */
    private suspend fun refreshLatest(subjectId: String) {
        when (val result = latest.latest(subjectId)) {
            is ServerResult.Found -> latestBySubject.update { it + (subjectId to result.value) }
            is ServerResult.Failed -> log("Could not load latest readings for $subjectId: ${result.failure}")
        }
    }

    private companion object {
        const val SHIP_ID = "ship"
        val DEFAULT_INTERVAL = 30.seconds
    }
}
