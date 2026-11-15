package org.heartbeat.watch.upload

import kotlinx.coroutines.test.runTest
import org.heartbeat.watch.T0
import org.heartbeat.watch.domain.ConnectionFailure
import org.heartbeat.watch.domain.Metric
import org.heartbeat.watch.domain.Reading
import org.heartbeat.watch.domain.ReadingSource
import org.heartbeat.watch.domain.ReadingValue
import org.heartbeat.watch.domain.UploadResult
import org.heartbeat.watch.reading
import org.heartbeat.watch.readings
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class PersistentQueueTest {
    @get:Rule
    val folder = TemporaryFolder()

    private val errors = mutableListOf<String>()
    private fun storeAt(file: File) = FileQueueStore(file) { message, _ -> errors += message }
    private val file: File get() = File(folder.root, "queue.jsonl")

    private val down = { _: List<Reading> -> UploadResult.Failed(ConnectionFailure.Unreachable("down")) }
    private val up = { batch: List<Reading> -> UploadResult.Accepted(batch.size, 0) }

    @Test
    fun `every kind of reading survives a round trip through the file`() = runTest {
        val store = storeAt(file)
        val mixed = listOf(
            reading(Metric.HEART_RATE, 72.0),
            Reading(Metric.IBI, ReadingValue.Series(listOf(800.0, 810.0)), T0, ReadingSource.WATCH),
            Reading(Metric.ECG, ReadingValue.Series(listOf(0.12, -0.3)), T0.plusSeconds(1), ReadingSource.WATCH),
        )

        store.append(mixed.take(1))
        store.append(mixed.drop(1))

        assertEquals(mixed, storeAt(file).loadAll())
    }

    @Test
    fun `undelivered readings come back after a restart and are sent first`() = runTest {
        UploadQueue(down, storeAt(file)).apply {
            enqueue(readings(3))
            flush()
        }

        val sent = mutableListOf<Reading>()
        val restarted = UploadQueue({ batch -> sent += batch; up(batch) }, storeAt(file))
        restarted.restore()
        restarted.enqueue(listOf(reading(value = 99.0, at = T0.plusSeconds(60))))
        restarted.flush()

        assertEquals(readings(3) + reading(value = 99.0, at = T0.plusSeconds(60)), sent)
        assertEquals(emptyList<Reading>(), storeAt(file).loadAll())
    }

    @Test
    fun `delivered readings leave the file`() = runTest {
        val queue = UploadQueue(up, storeAt(file))
        queue.enqueue(readings(5))

        queue.flush()

        assertEquals(emptyList<Reading>(), storeAt(file).loadAll())
    }

    @Test
    fun `the cap applies to restored readings and to the file`() = runTest {
        storeAt(file).append(readings(10))

        val queue = UploadQueue(down, storeAt(file), capacity = 4)
        queue.restore()

        assertTrue(queue.pendingCount.value <= 4)
        assertEquals(readings(10).takeLast(queue.pendingCount.value), storeAt(file).loadAll())
    }

    @Test
    fun `a full queue drops a chunk of the oldest at once`() = runTest {
        val queue = UploadQueue(down, storeAt(file), capacity = 100)
        queue.enqueue(readings(100))

        queue.enqueue(listOf(reading(value = 1000.0, at = T0.plusSeconds(1000))))

        assertEquals(97, queue.pendingCount.value)
        assertEquals(4, queue.losses.value.droppedQueueFull)
        assertEquals(97, storeAt(file).loadAll().size)
    }

    @Test
    fun `readings recorded before the stored queue is loaded stay behind it and are not duplicated`() = runTest {
        storeAt(file).append(readings(2))
        val sent = mutableListOf<Reading>()
        val queue = UploadQueue({ batch -> sent += batch; up(batch) }, storeAt(file))

        queue.enqueue(listOf(reading(value = 50.0, at = T0.plusSeconds(50))))
        queue.restore()
        queue.flush()

        assertEquals(readings(2) + reading(value = 50.0, at = T0.plusSeconds(50)), sent)
    }

    @Test
    fun `only the reading the server refuses leaves the queue as dropped`() = runTest {
        val all = readings(4)
        val queue = UploadQueue({ batch ->
            if (all[2] in batch) UploadResult.Failed(ConnectionFailure.Rejected(400, "bad")) else up(batch)
        }, storeAt(file))
        queue.enqueue(all)

        val report = queue.flush()

        assertEquals(3, report.deliveredReadings)
        assertEquals(1, report.discardedReadings)
        assertEquals(ReadingLosses(rejected = 1, droppedQueueFull = 0), queue.losses.value)
        assertEquals(emptyList<Reading>(), storeAt(file).loadAll())
    }

    @Test
    fun `the stored format is the watch's own, versioned, and refuses other versions`() {
        val line = StoredReadingFormat.encode(reading(Metric.HEART_RATE, 72.0))

        assertTrue(line.contains("\"v\":1"))
        assertFalse(line.contains("astronautId"))
        assertEquals(reading(Metric.HEART_RATE, 72.0), StoredReadingFormat.decode(line))
        assertThrows(UnreadableStoredReadingException::class.java) { StoredReadingFormat.decode(line.replace("\"v\":1", "\"v\":2")) }
    }

    @Test
    fun `a line from before the format was versioned is read as version 1`() {
        val roundOne = """{"metric":"heartRate","value":72.0,"unit":"bpm","takenAt":"${reading(Metric.HEART_RATE, 72.0).takenAt}","source":"watch"}"""

        assertEquals(reading(Metric.HEART_RATE, 72.0), StoredReadingFormat.decode(roundOne))
    }

    @Test
    fun `a damaged line is skipped and reported, not fatal`() = runTest {
        storeAt(file).append(readings(1))
        file.appendText("{\"metric\":\"heartRate\",\"val\n")

        assertEquals(readings(1), storeAt(file).loadAll())
        assertEquals(1, errors.size)
    }
}
