package org.heartbeat.watch.upload

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import org.heartbeat.watch.domain.ConnectionFailure
import java.time.Instant

/** What the settings screen shows about the link to the server. */
data class ConnectionStatus(
    /** Outcome of the most recent upload or connection test; `null` until one has happened. */
    val lastOutcome: ConnectionOutcome? = null,
    val lastUpload: UploadRecord? = null,
    val pendingReadings: Int = 0,
    val losses: ReadingLosses = ReadingLosses(),
    val testing: Boolean = false,
)

sealed interface ConnectionOutcome {
    val at: Instant

    data class Reached(override val at: Instant) : ConnectionOutcome

    data class Failed(override val at: Instant, val failure: ConnectionFailure) : ConnectionOutcome
}

data class UploadRecord(val at: Instant, val readingCount: Int)

/** Collects connection events from uploads and connection tests into one [ConnectionStatus]. */
class ConnectionMonitor {
    private val _status = MutableStateFlow(ConnectionStatus())

    val status: StateFlow<ConnectionStatus> = _status.asStateFlow()

    fun recordFlush(at: Instant, report: FlushReport) {
        val failure = report.failure
        when {
            failure != null -> recordFailure(at, failure)
            report.deliveredReadings > 0 -> _status.update {
                it.copy(lastOutcome = ConnectionOutcome.Reached(at), lastUpload = UploadRecord(at, report.deliveredReadings))
            }
        }
    }

    fun recordTestStarted() = _status.update { it.copy(testing = true) }

    fun recordTestResult(at: Instant, failure: ConnectionFailure?) {
        val outcome = failure?.let { ConnectionOutcome.Failed(at, it) } ?: ConnectionOutcome.Reached(at)
        _status.update { it.copy(lastOutcome = outcome, testing = false) }
    }

    fun recordPending(count: Int) = _status.update { it.copy(pendingReadings = count) }

    fun recordLosses(losses: ReadingLosses) = _status.update { it.copy(losses = losses) }

    private fun recordFailure(at: Instant, failure: ConnectionFailure) =
        _status.update { it.copy(lastOutcome = ConnectionOutcome.Failed(at, failure)) }
}
