package org.heartbeat.watch.upload

import kotlin.time.Duration

/** Exponential backoff: [first] after the first failure, doubling each time, never more than [max]. */
class Backoff(private val first: Duration, private val max: Duration) {

    /** The wait after the [failures]-th failure in a row (1-based). */
    fun delayAfter(failures: Int): Duration {
        val doublings = (failures - 1).coerceIn(0, MAX_DOUBLINGS)
        return minOf(first * (1L shl doublings).toDouble(), max)
    }

    private companion object {
        /** Caps the shift so the multiplier can never overflow. */
        const val MAX_DOUBLINGS = 20
    }
}
