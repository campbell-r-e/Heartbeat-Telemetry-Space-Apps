package org.heartbeat.watch.domain

import java.time.Instant

/** A single measurement, as measured on this watch or as reported back by the server. */
data class Reading(
    val metric: Metric,
    val value: ReadingValue,
    val takenAt: Instant,
    val source: ReadingSource,
)

sealed interface ReadingValue {
    /** One number, for example a heart rate. */
    data class Scalar(val number: Double) : ReadingValue

    /** A series of numbers, for example an ECG trace in millivolts or beat-to-beat intervals in milliseconds. */
    data class Series(val samples: List<Double>) : ReadingValue
}

/** Where a reading came from. The server names its own sources; the watch only ever writes [WATCH]. */
@JvmInline
value class ReadingSource(val name: String) {
    companion object {
        val WATCH = ReadingSource("watch")
    }
}

fun watchReading(metric: Metric, number: Double, takenAt: Instant): Reading =
    Reading(metric, ReadingValue.Scalar(number), takenAt, ReadingSource.WATCH)
