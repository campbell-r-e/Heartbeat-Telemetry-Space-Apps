package org.heartbeat.watch.upload

import kotlinx.coroutines.test.runTest
import org.heartbeat.watch.domain.ConnectionFailure
import org.heartbeat.watch.domain.Reading
import org.heartbeat.watch.domain.UploadResult
import org.heartbeat.watch.readings
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BatchDeliveryTest {
    private val all = readings(8)
    private val bad = all[5]
    private val rejected = ConnectionFailure.Rejected(400, "wrong_value_shape")

    /** Refuses any batch that contains [refuse], like the server's validation does. */
    private class RefusingUploader(private val refuse: Set<Reading>, private val failure: ConnectionFailure) {
        val accepted = mutableListOf<Reading>()
        var calls = 0

        fun upload(batch: List<Reading>): UploadResult {
            calls++
            if (batch.any { it in refuse }) return UploadResult.Failed(failure)
            accepted += batch
            return UploadResult.Accepted(batch.size, 0)
        }
    }

    @Test
    fun `a refusal of the whole request is not narrowed down, and every reading stays queued for a retry`() = runTest {
        val unknownAstronaut = ConnectionFailure.UnknownAstronaut("a7")
        val server = RefusingUploader(all.toSet(), unknownAstronaut)

        val delivery = BatchDelivery({ server.upload(it) }) { _, _ -> error("nothing may be dropped") }.deliver(all)

        assertEquals(1, server.calls)
        assertEquals(Delivery(unsent = all, stoppedBy = unknownAstronaut), delivery)
    }

    @Test
    fun `a refused batch is narrowed down until only the bad reading is dropped`() = runTest {
        val server = RefusingUploader(setOf(bad), rejected)
        val dropped = mutableListOf<Reading>()

        val delivery = BatchDelivery({ server.upload(it) }) { reading, _ -> dropped += reading }.deliver(all)

        assertEquals(all - bad, server.accepted)
        assertEquals(listOf(bad), dropped)
        assertEquals(Delivery(delivered = 7, rejected = 1), delivery)
    }

    @Test
    fun `several bad readings are each dropped on their own`() = runTest {
        val server = RefusingUploader(setOf(all[0], all[7]), rejected)

        val delivery = BatchDelivery({ server.upload(it) }).deliver(all)

        assertEquals(6, delivery.delivered)
        assertEquals(2, delivery.rejected)
        assertNull(delivery.stoppedBy)
    }

    @Test
    fun `a retryable failure while narrowing hands back everything not yet sent`() = runTest {
        var call = 0
        val delivery = BatchDelivery({ batch ->
            call++
            when (call) {
                1 -> UploadResult.Failed(rejected)
                2 -> UploadResult.Accepted(batch.size, 0)
                else -> UploadResult.Failed(ConnectionFailure.Unreachable("Wi-Fi lost"))
            }
        }).deliver(all)

        assertEquals(4, delivery.delivered)
        assertEquals(all.drop(4), delivery.unsent)
        assertEquals(ConnectionFailure.Unreachable("Wi-Fi lost"), delivery.stoppedBy)
    }

    @Test
    fun `an accepted batch is sent in one request`() = runTest {
        val server = RefusingUploader(emptySet(), rejected)

        BatchDelivery({ server.upload(it) }).deliver(all)

        assertEquals(1, server.calls)
    }
}
