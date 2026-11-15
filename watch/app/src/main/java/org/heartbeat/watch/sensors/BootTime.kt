package org.heartbeat.watch.sensors

import android.os.SystemClock
import java.time.Instant

/** Sensors time-stamp samples from boot; this converts those stamps to wall-clock instants. */
object BootTime {
    private const val NANOS_PER_MILLI = 1_000_000L

    fun bootInstant(): Instant =
        Instant.ofEpochMilli(System.currentTimeMillis() - SystemClock.elapsedRealtime())

    fun fromElapsedNanos(elapsedRealtimeNanos: Long): Instant =
        bootInstant().plusMillis(elapsedRealtimeNanos / NANOS_PER_MILLI)
}
