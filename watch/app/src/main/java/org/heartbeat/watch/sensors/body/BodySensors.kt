package org.heartbeat.watch.sensors.body

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import org.heartbeat.watch.domain.Measurement
import org.heartbeat.watch.domain.Metric
import org.heartbeat.watch.domain.Reading
import org.heartbeat.watch.domain.ReadingSource
import org.heartbeat.watch.domain.ReadingValue
import java.time.Instant

/**
 * The seam for sensors that only the Samsung Health Sensor SDK provides: beat-to-beat intervals (for HRV),
 * skin temperature, SpO₂ and ECG. Built from `src/samsung` when the SDK .aar is in `app/libs`,
 * otherwise from `src/noSamsung`, which reports [BodySensorsState.SdkNotBundled].
 */
interface BodySensors {
    val state: StateFlow<BodySensorsState>

    /** Valid inter-beat intervals in milliseconds, as the heart rate tracker reports them. */
    fun interBeatIntervals(): Flow<BeatIntervals>

    fun skinTemperature(): Flow<Reading>

    /** One on-demand SpO₂ measurement: progress hints, then exactly one final [Measurement.Finished] or [Measurement.Failed]. */
    fun measureSpo2(): Flow<Measurement>

    /** One on-demand ECG recording, reported the same way as [measureSpo2]. */
    fun recordEcg(): Flow<Measurement>
}

/**
 * One batch of beat-to-beat intervals from the heart rate tracker, valid-status intervals only.
 * [reportedAt] is the tracker's time stamp for the batch, taken to be the time of its last beat.
 */
data class BeatIntervals(val validIntervalsMs: List<Int>, val reportedAt: Instant) {

    /**
     * The batch as an `ibi` reading, sent raw so the server can derive HRV with the agreed method.
     * Time-stamped at the first beat: the last beat minus all the intervals that follow the first one.
     * `null` when the batch has no valid intervals.
     */
    fun toReading(): Reading? {
        if (validIntervalsMs.isEmpty()) return null
        val firstBeatAt = reportedAt.minusMillis(validIntervalsMs.sumOf(Int::toLong))
        val intervals = ReadingValue.Series(validIntervalsMs.map(Int::toDouble))
        return Reading(Metric.IBI, intervals, firstBeatAt, ReadingSource.WATCH)
    }
}

sealed interface BodySensorsState {
    data object SdkNotBundled : BodySensorsState
    data object Connecting : BodySensorsState
    data class Connected(val supported: Set<BodySensor>) : BodySensorsState
    data class Unavailable(val reason: String) : BodySensorsState
}

enum class BodySensor { BEAT_INTERVALS, SKIN_TEMPERATURE, SPO2, ECG }
