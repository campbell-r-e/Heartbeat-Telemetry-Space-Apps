package org.heartbeat.watch.upload

import kotlinx.coroutines.test.runTest
import org.heartbeat.watch.T0
import org.heartbeat.watch.domain.Metric
import org.heartbeat.watch.domain.UploadResult
import org.heartbeat.watch.reading
import org.junit.Assert.assertEquals
import org.junit.Test

class ReadingRecorderTest {
    private val queue = UploadQueue({ UploadResult.Accepted(it.size, 0) })
    private val recorder = ReadingRecorder(queue)

    @Test
    fun `keeps the newest reading per metric and queues every reading`() = runTest {
        val newer = reading(Metric.HEART_RATE, 2.0, T0.plusSeconds(10))
        recorder.record(newer)
        recorder.record(reading(Metric.HEART_RATE, 1.0, T0))

        assertEquals(newer, recorder.newestByMetric.value[Metric.HEART_RATE])
        assertEquals(2, queue.pendingCount.value)
    }
}
