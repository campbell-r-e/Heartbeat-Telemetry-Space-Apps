package org.heartbeat.watch.upload

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import org.heartbeat.watch.domain.Metric
import org.heartbeat.watch.domain.Reading

/**
 * The one place a reading measured on this watch goes: it becomes the newest local value for the screens,
 * and it waits in the [UploadQueue] until the server has it.
 */
class ReadingRecorder(private val queue: UploadQueue) {
    private val _newestByMetric = MutableStateFlow<Map<Metric, Reading>>(emptyMap())

    val newestByMetric: StateFlow<Map<Metric, Reading>> = _newestByMetric.asStateFlow()

    suspend fun record(reading: Reading) {
        _newestByMetric.update { newest -> newest.withNewer(reading) }
        queue.enqueue(listOf(reading))
    }

    private fun Map<Metric, Reading>.withNewer(reading: Reading): Map<Metric, Reading> {
        val current = this[reading.metric]
        return if (current != null && current.takenAt.isAfter(reading.takenAt)) this else this + (reading.metric to reading)
    }
}
