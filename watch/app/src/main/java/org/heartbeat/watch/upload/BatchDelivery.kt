package org.heartbeat.watch.upload

import org.heartbeat.watch.domain.ConnectionFailure
import org.heartbeat.watch.domain.Reading
import org.heartbeat.watch.domain.ReadingsUploader
import org.heartbeat.watch.domain.UploadResult

/** What happened to one batch: how many readings reached the server, how many were refused, and what is still unsent. */
data class Delivery(
    val delivered: Int = 0,
    /** Single readings the server refused as invalid (400); they are dropped and counted, never resent. */
    val rejected: Int = 0,
    /** Readings not sent because a retryable failure stopped delivery; they go back to the front of the queue. */
    val unsent: List<Reading> = emptyList(),
    /** The retryable failure that stopped delivery, or `null` if it ran to the end. */
    val stoppedBy: ConnectionFailure? = null,
) {
    operator fun plus(later: Delivery) = Delivery(
        delivered = delivered + later.delivered,
        rejected = rejected + later.rejected,
        unsent = unsent + later.unsent,
        stoppedBy = later.stoppedBy ?: stoppedBy,
    )
}

/**
 * Sends one batch. When the server refuses readings in a batch as invalid (400), the batch is split in halves and each
 * half is sent on its own, down to single readings, so only the readings the server actually refuses are dropped
 * (owner decision). Any other failure, including a refusal of the whole request (unknown astronaut, 413), stops
 * delivery and hands the rest back unsent, to be retried (owner decision).
 */
class BatchDelivery(
    private val uploader: ReadingsUploader,
    private val onRejected: (Reading, ConnectionFailure) -> Unit = { _, _ -> },
) {

    suspend fun deliver(batch: List<Reading>): Delivery {
        if (batch.isEmpty()) return Delivery()
        return when (val result = uploader.upload(batch)) {
            is UploadResult.Accepted -> Delivery(delivered = batch.size)
            is UploadResult.Failed -> afterFailure(batch, result.failure)
        }
    }

    private suspend fun afterFailure(batch: List<Reading>, failure: ConnectionFailure): Delivery =
        when {
            failure.isRetryable -> Delivery(unsent = batch, stoppedBy = failure)
            batch.size == 1 -> Delivery(rejected = 1).also { onRejected(batch.single(), failure) }
            else -> deliverHalves(batch)
        }

    private suspend fun deliverHalves(batch: List<Reading>): Delivery {
        val middle = batch.size / 2
        val first = deliver(batch.subList(0, middle).toList())
        val rest = batch.subList(middle, batch.size).toList()
        return if (first.stoppedBy != null) first + Delivery(unsent = rest) else first + deliver(rest)
    }
}
