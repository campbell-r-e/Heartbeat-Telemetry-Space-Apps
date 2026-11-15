package org.heartbeat.watch.sensors

import java.time.Duration
import java.time.Instant

/** Lets through at most one sample per [interval], for sensors that report far more often than we need. */
class SampleThrottle(private val interval: Duration) {
    private var lastAccepted: Instant? = null

    fun accept(at: Instant): Boolean {
        val last = lastAccepted
        if (last != null && Duration.between(last, at) < interval) return false
        lastAccepted = at
        return true
    }
}
