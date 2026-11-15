package org.heartbeat.watch.upload

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.heartbeat.watch.T0
import org.heartbeat.watch.domain.Reading
import org.heartbeat.watch.domain.UploadResult
import org.heartbeat.watch.readings
import org.junit.Assert.assertEquals
import org.junit.Test
import kotlin.time.Duration.Companion.seconds

@OptIn(ExperimentalCoroutinesApi::class)
class UploadSchedulerTest {
    private val sent = mutableListOf<List<Reading>>()
    private val queue = UploadQueue({ batch -> sent += batch; UploadResult.Accepted(batch.size, 0) })
    private val monitor = ConnectionMonitor()
    private val scheduler = UploadScheduler(queue, monitor, { T0 }, RetryPolicy(interval = 15.seconds))

    @Test
    fun `flushes at start, then after each interval`() = runTest {
        queue.enqueue(readings(2))
        scheduler.start(backgroundScope)
        runCurrent()
        assertEquals(1, sent.size)

        queue.enqueue(readings(1))
        advanceTimeBy(14.seconds)
        runCurrent()
        assertEquals(1, sent.size)

        advanceTimeBy(2.seconds)
        runCurrent()
        assertEquals(2, sent.size)
        assertEquals(UploadRecord(T0, 1), monitor.status.value.lastUpload)
    }

    @Test
    fun `an upload request sends straight away`() = runTest {
        scheduler.start(backgroundScope)
        runCurrent()

        queue.enqueue(readings(3))
        scheduler.requestUpload()
        runCurrent()

        assertEquals(listOf(readings(3)), sent)
    }

    @Test
    fun `the monitor sees how many readings are waiting`() = runTest {
        scheduler.start(backgroundScope)
        runCurrent()

        queue.enqueue(readings(4))
        runCurrent()

        assertEquals(4, monitor.status.value.pendingReadings)
    }
}
