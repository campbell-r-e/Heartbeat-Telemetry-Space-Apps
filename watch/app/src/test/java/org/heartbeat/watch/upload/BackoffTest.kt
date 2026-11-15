package org.heartbeat.watch.upload

import org.junit.Assert.assertEquals
import org.junit.Test
import kotlin.time.Duration.Companion.seconds

class BackoffTest {
    @Test
    fun `doubles from the first wait up to the maximum`() {
        val backoff = Backoff(5.seconds, 30.seconds)

        assertEquals(listOf(5.seconds, 10.seconds, 20.seconds, 30.seconds), (1..4).map(backoff::delayAfter))
    }
}
