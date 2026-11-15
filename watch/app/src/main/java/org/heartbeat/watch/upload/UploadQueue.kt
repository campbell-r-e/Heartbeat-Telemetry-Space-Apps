package org.heartbeat.watch.upload

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.heartbeat.watch.domain.ConnectionFailure
import org.heartbeat.watch.domain.Reading
import org.heartbeat.watch.domain.ReadingsUploader

/**
 * Holds readings until the server has accepted them, and sends them in batches.
 * A batch that fails for a retryable reason goes back to the front of the queue, so nothing is lost
 * while the server is unreachable; the server ignores duplicates, so resending is safe. A batch the server refuses
 * is narrowed down by [BatchDelivery] so only the refused readings are dropped.
 * Everything not yet delivered is mirrored to the [store], so the queue survives restarts. The stored readings are
 * loaded before the first enqueue or flush, whichever comes first, so they always stay ahead of new ones.
 * When more than [capacity] readings are waiting, the oldest are dropped (a chunk at a time, so a full
 * queue does not rewrite its store on every new reading) and counted.
 */
class UploadQueue(
    private val delivery: BatchDelivery,
    private val store: QueueStore = QueueStore.InMemoryOnly,
    private val capacity: Int = DEFAULT_CAPACITY,
    private val batchSize: Int = DEFAULT_BATCH_SIZE,
) {
    constructor(
        uploader: ReadingsUploader,
        store: QueueStore = QueueStore.InMemoryOnly,
        capacity: Int = DEFAULT_CAPACITY,
        batchSize: Int = DEFAULT_BATCH_SIZE,
    ) : this(BatchDelivery(uploader), store, capacity, batchSize)

    private val waiting = ArrayDeque<Reading>()
    private val lock = Mutex()
    private val flushLock = Mutex()
    private val _pendingCount = MutableStateFlow(0)
    private var inFlight: List<Reading> = emptyList()
    private val _losses = MutableStateFlow(ReadingLosses())
    private var restored = false
    private val dropChunk = maxOf(1, capacity / DROP_CHUNK_DIVISOR)

    val pendingCount: StateFlow<Int> = _pendingCount.asStateFlow()

    /** Readings lost since start: refused by the server, or dropped because the queue was full. */
    val losses: StateFlow<ReadingLosses> = _losses.asStateFlow()

    init {
        require(capacity > 0) { "capacity must be positive" }
        require(batchSize in 1..SERVER_MAX_BATCH) { "batchSize must be 1..$SERVER_MAX_BATCH, the server's limit" }
    }

    /** Loads the readings a previous run left undelivered now, rather than on first use (call on app start). */
    suspend fun restore() {
        lock.withLock { restoreOnce() }
    }

    suspend fun enqueue(readings: List<Reading>) {
        lock.withLock {
            restoreOnce()
            waiting.addAll(readings)
            if (dropOldestOverCapacity()) store.replaceAll(snapshot()) else store.append(readings)
            publishCount()
        }
    }

    /** Sends every waiting reading, batch by batch, until the queue is empty or a retryable failure stops it. */
    suspend fun flush(): FlushReport = flushLock.withLock { sendUntilEmptyOrStopped() }

    private suspend fun sendUntilEmptyOrStopped(): FlushReport {
        var report = FlushReport.NOTHING_TO_SEND
        var batch = takeBatch()
        while (batch.isNotEmpty()) {
            val result = delivery.deliver(batch)
            report = report.after(result)
            finishBatch(result)
            if (result.stoppedBy != null) break
            batch = takeBatch()
        }
        return report
    }

    /** The stored readings go in ahead of anything already queued, once per process. */
    private suspend fun restoreOnce() {
        if (restored) return
        restored = true
        val stored = store.loadAll()
        stored.asReversed().forEach(waiting::addFirst)
        if (dropOldestOverCapacity() || stored.isNotEmpty()) store.replaceAll(snapshot())
        publishCount()
    }

    private suspend fun takeBatch(): List<Reading> =
        lock.withLock {
            restoreOnce()
            inFlight = List(minOf(batchSize, waiting.size)) { waiting.removeFirst() }
            publishCount()
            inFlight
        }

    /**
     * Readings that must be retried go back to the front, ahead of anything recorded while they were in flight;
     * delivered and rejected readings leave the store.
     */
    private suspend fun finishBatch(result: Delivery) {
        lock.withLock {
            result.unsent.asReversed().forEach(waiting::addFirst)
            inFlight = emptyList()
            if (result.rejected > 0) _losses.update { it.copy(rejected = it.rejected + result.rejected) }
            val dropped = dropOldestOverCapacity()
            if (result.delivered + result.rejected > 0 || dropped) store.replaceAll(snapshot())
            publishCount()
        }
    }

    /** Returns true when readings were dropped. */
    private fun dropOldestOverCapacity(): Boolean {
        if (waiting.size + inFlight.size <= capacity) return false
        val target = capacity - (dropChunk - 1)
        while (waiting.isNotEmpty() && waiting.size + inFlight.size > target) {
            waiting.removeFirst()
            _losses.update { it.copy(droppedQueueFull = it.droppedQueueFull + 1) }
        }
        return true
    }

    /** Everything not yet delivered, oldest first: the batch in flight, then the waiting readings. */
    private fun snapshot(): List<Reading> = inFlight + waiting

    private fun publishCount() {
        _pendingCount.value = waiting.size + inFlight.size
    }

    companion object {
        /** The server accepts at most this many readings in one `POST /api/readings`. */
        const val SERVER_MAX_BATCH = 5_000

        /**
         * Every heart-rate sample is sent (about one per second), so a normal 15 s upload carries ~15 readings.
         * After an outage the backlog drains 1,000 per request: an hour of heart rate takes four requests,
         * and each request stays around 150 KB, well under the server's limit.
         */
        const val DEFAULT_BATCH_SIZE = 1_000

        /** Six hours of one-per-second heart rate plus the slower sensors (approved by the owner). */
        const val DEFAULT_CAPACITY = 25_000

        /** A full queue drops 1/25 of its capacity at once (1,000 of 25,000). */
        private const val DROP_CHUNK_DIVISOR = 25
    }
}

/** Readings that will never reach the server, counted since the app started. */
data class ReadingLosses(val rejected: Int = 0, val droppedQueueFull: Int = 0) {
    val any: Boolean get() = rejected > 0 || droppedQueueFull > 0
}

/** What one [UploadQueue.flush] achieved. */
data class FlushReport(
    /** Readings now stored on the server (newly accepted, or already there as duplicates). */
    val deliveredReadings: Int,
    /** Readings the server refused as invalid; they are not sent again. */
    val discardedReadings: Int,
    /** The retryable failure that stopped this flush, or `null` if it ran to the end. */
    val failure: ConnectionFailure?,
) {
    fun after(batch: Delivery): FlushReport =
        FlushReport(
            deliveredReadings = deliveredReadings + batch.delivered,
            discardedReadings = discardedReadings + batch.rejected,
            failure = batch.stoppedBy,
        )

    companion object {
        val NOTHING_TO_SEND = FlushReport(deliveredReadings = 0, discardedReadings = 0, failure = null)
    }
}
