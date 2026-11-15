package org.heartbeat.watch.sensors.motion

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.filter
import org.heartbeat.watch.domain.Metric
import org.heartbeat.watch.domain.Reading
import org.heartbeat.watch.domain.ReadingSource
import org.heartbeat.watch.domain.ReadingValue
import org.heartbeat.watch.sensors.WearState
import java.time.Duration
import java.time.Instant
import kotlin.math.atan2
import kotlin.math.sqrt

// The wrist angle the server detects sleep from (SPEC §5.1, §5.7), prepared as in van Hees et al. 2018,
// "Estimating sleep parameters using an accelerometer without sleep diary", Sci Rep 8, 12975,
// doi:10.1038/s41598-018-31266-z, section "Accelerometer data preparation": the z-angle is computed from "the
// median values of the three orthogonally positioned raw acceleration sensors ... derived based on a rolling five
// second time window", and "estimated arm angles were averaged per 5 second epoch". The paper's reference code,
// GGIR 1.5-23 (R/g.metric.R), centers that window on each sample and computes
// anglez = atan(Gzm / sqrt(Gxm^2 + Gym^2)) / (pi/180).

/** One accelerometer sample. Any unit will do: the angle depends only on the ratios of the axes. */
data class AccelerationSample(val at: Instant, val x: Double, val y: Double, val z: Double)

/** One minute of wrist angles: the z-angle of each of its 12 five-second epochs, in degrees, from [minuteStart]. */
data class WristAngleMinute(val minuteStart: Instant, val epochAnglesDeg: List<Double>) {
    fun toReading(): Reading = Reading(Metric.WRIST_ANGLE, ReadingValue.Series(epochAnglesDeg), minuteStart, ReadingSource.WATCH)
}

/**
 * Keeps only samples taken while the watch has been on the wrist without a break since, judged by each sample's own
 * time: the sensor hub delivers samples in batches up to [WristAngle.MAX_BATCH_DELAY] late (and they may wait
 * [WristAngle.REORDER_WINDOW] to be put in order), so wear at delivery time would let samples from before the watch
 * went back on through, and no off-wrist sample may count.
 */
fun Flow<AccelerationSample>.onlyWornSamples(wear: WearState): Flow<AccelerationSample> = filter { wear.wornThroughoutSince(it.at) }

object WristAngle {
    /** The rolling median window: five seconds, centered on the sample. */
    val MEDIAN_WINDOW: Duration = Duration.ofSeconds(5)
    private const val EPOCH_SECONDS = 5
    val EPOCH: Duration = Duration.ofSeconds(EPOCH_SECONDS.toLong())
    const val EPOCHS_PER_MINUTE = 12

    /** The accelerometer rate the watch asks for (owner decision: 10 Hz, far below the paper's 85.7–100 Hz recorders). */
    const val SAMPLE_RATE_HZ = 10

    /**
     * How long the sensor hub may hold samples before delivering them as one batch. The Galaxy Watch5 Pro has no
     * wake-up accelerometer and a hub buffer of 300 samples, 30 s at 10 Hz. 20 s fills two thirds of it (200 samples),
     * leaving 10 s for the processor to wake and collect the batch. On that watch this alone does not stop the loss
     * while the processor sleeps, so it is kept awake while the watch is worn ([org.heartbeat.watch.collect.WornWakeLock]).
     */
    val MAX_BATCH_DELAY: Duration = Duration.ofSeconds(20)

    /**
     * How long a sample waits for older ones delivered late: two batch delays, so a whole batch delivered after a
     * newer one still falls in place. Minutes are sent this much later.
     */
    val REORDER_WINDOW: Duration = MAX_BATCH_DELAY.multipliedBy(2)

    private const val MIN_EPOCH_COVERAGE_PERCENT = 80

    /**
     * An epoch counts only with at least 80% of the samples 10 Hz gives in 5 seconds (40 of 50), so an epoch the
     * watch was off the wrist for most of, or a sensor pause, never passes as a whole epoch.
     */
    const val MIN_SAMPLES_PER_EPOCH = SAMPLE_RATE_HZ * EPOCH_SECONDS * MIN_EPOCH_COVERAGE_PERCENT / 100

    /**
     * The z-angle in degrees, atan(z / sqrt(x² + y²)). atan2 gives the same angle for every orientation and stays
     * defined when x and y are both 0 (±90°, the watch face straight up or down).
     */
    fun zAngleDegrees(x: Double, y: Double, z: Double): Double = Math.toDegrees(atan2(z, sqrt(x * x + y * y)))
}
