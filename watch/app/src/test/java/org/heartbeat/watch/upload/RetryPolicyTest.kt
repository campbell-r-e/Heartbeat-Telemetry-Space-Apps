package org.heartbeat.watch.upload

import org.heartbeat.watch.domain.ConnectionFailure
import org.junit.Assert.assertEquals
import org.junit.Test
import kotlin.time.Duration.Companion.seconds

class RetryPolicyTest {
    private val ok = FlushReport.NOTHING_TO_SEND
    private val down = ok.copy(failure = ConnectionFailure.Unreachable("no route"))
    private val rejected = ok.copy(failure = ConnectionFailure.Rejected(400, "bad"))
    private val policy = RetryPolicy(interval = 15.seconds, firstRetry = 5.seconds, maxRetry = 30.seconds)

    @Test
    fun `waits the normal interval while uploads succeed`() {
        assertEquals(15.seconds, policy.delayAfter(ok))
    }

    @Test
    fun `backs off exponentially up to the maximum while the server is down`() {
        val delays = List(5) { policy.delayAfter(down) }

        assertEquals(listOf(5.seconds, 10.seconds, 20.seconds, 30.seconds, 30.seconds), delays)
    }

    @Test
    fun `returns to the normal interval after a success`() {
        repeat(3) { policy.delayAfter(down) }

        assertEquals(15.seconds, policy.delayAfter(ok))
        assertEquals(5.seconds, policy.delayAfter(down))
    }

    @Test
    fun `a rejected batch does not slow uploads down`() {
        assertEquals(15.seconds, policy.delayAfter(rejected))
    }
}
