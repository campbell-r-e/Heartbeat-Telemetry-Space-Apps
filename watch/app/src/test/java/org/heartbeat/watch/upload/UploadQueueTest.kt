package org.heartbeat.watch.upload

import kotlinx.coroutines.test.runTest
import org.heartbeat.watch.domain.ConnectionFailure
import org.heartbeat.watch.domain.Reading
import org.heartbeat.watch.domain.ReadingsUploader
import org.heartbeat.watch.domain.UploadResult
import org.heartbeat.watch.readings
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UploadQueueTest {

    private class RecordingUploader(vararg results: UploadResult) : ReadingsUploader {
        private val scripted = ArrayDeque(results.toList())
        val batches = mutableListOf<List<Reading>>()
        var onUpload: () -> Unit = {}

        override suspend fun upload(readings: List<Reading>): UploadResult {
            batches += readings
            onUpload()
            return scripted.removeFirstOrNull() ?: UploadResult.Accepted(readings.size, 0)
        }
    }

    @Test
    fun `sends waiting readings in batches of the batch size`() = runTest {
        val uploader = RecordingUploader()
        val queue = UploadQueue(uploader, capacity = 100, batchSize = 2)
        queue.enqueue(readings(5))

        val report = queue.flush()

        assertEquals(listOf(2, 2, 1), uploader.batches.map { it.size })
        assertEquals(5, report.deliveredReadings)
        assertNull(report.failure)
        assertEquals(0, queue.pendingCount.value)
    }

    @Test
    fun `keeps a batch and stops when the failure is retryable`() = runTest {
        val unreachable = ConnectionFailure.Unreachable("timeout")
        val uploader = RecordingUploader(UploadResult.Failed(unreachable))
        val queue = UploadQueue(uploader, capacity = 100, batchSize = 2)
        queue.enqueue(readings(3))

        val report = queue.flush()

        assertEquals(1, uploader.batches.size)
        assertEquals(unreachable, report.failure)
        assertEquals(3, queue.pendingCount.value)
        queue.flush()
        assertEquals(readings(3), uploader.batches.drop(1).flatten())
    }

    @Test
    fun `drops only the reading the server rejects as invalid and carries on`() = runTest {
        val bad = readings(3)[1]
        val queue = UploadQueue(
            { batch -> if (bad in batch) UploadResult.Failed(ConnectionFailure.Rejected(400, "bad metric")) else UploadResult.Accepted(batch.size, 0) },
            capacity = 100,
            batchSize = 2,
        )
        queue.enqueue(readings(3))

        val report = queue.flush()

        assertEquals(1, report.discardedReadings)
        assertEquals(2, report.deliveredReadings)
        assertEquals(0, queue.pendingCount.value)
    }

    @Test
    fun `drops the oldest readings when full`() = runTest {
        val uploader = RecordingUploader()
        val queue = UploadQueue(uploader, capacity = 3, batchSize = 10)
        val all = readings(5)
        queue.enqueue(all)

        queue.flush()

        assertEquals(all.takeLast(3), uploader.batches.single())
        assertEquals(2, queue.losses.value.droppedQueueFull)
    }

    @Test
    fun `counts a batch in flight as still waiting`() = runTest {
        val uploader = RecordingUploader()
        val queue = UploadQueue(uploader, capacity = 100, batchSize = 10)
        var pendingDuringUpload = -1
        uploader.onUpload = { pendingDuringUpload = queue.pendingCount.value }
        queue.enqueue(readings(4))

        queue.flush()

        assertEquals(4, pendingDuringUpload)
    }

    @Test
    fun `an hour of one-per-second heart rate drains in a few requests within the server limit`() = runTest {
        val uploader = RecordingUploader()
        val queue = UploadQueue(uploader)
        val oneHourAtOneHertz = readings(3_600)
        queue.enqueue(oneHourAtOneHertz)

        val report = queue.flush()

        assertEquals(listOf(1_000, 1_000, 1_000, 600), uploader.batches.map { it.size })
        assertTrue(uploader.batches.all { it.size <= UploadQueue.SERVER_MAX_BATCH })
        assertEquals(3_600, report.deliveredReadings)
        assertEquals(oneHourAtOneHertz, uploader.batches.flatten())
    }

    @Test
    fun `six hours of heart rate fit in the queue without dropping any`() = runTest {
        val queue = UploadQueue(RecordingUploader())

        queue.enqueue(readings(6 * 3_600))

        assertEquals(0, queue.losses.value.droppedQueueFull)
        assertEquals(6 * 3_600, queue.pendingCount.value)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `refuses a batch size above the server limit`() {
        UploadQueue(RecordingUploader(), batchSize = UploadQueue.SERVER_MAX_BATCH + 1)
    }

    @Test
    fun `an empty queue sends nothing`() = runTest {
        val uploader = RecordingUploader()

        val report = UploadQueue(uploader).flush()

        assertEquals(FlushReport.NOTHING_TO_SEND, report)
        assertEquals(emptyList<List<Reading>>(), uploader.batches)
    }
}
