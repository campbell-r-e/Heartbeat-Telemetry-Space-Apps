package org.heartbeat.watch.sensors.motion

import java.time.Duration
import java.time.Instant

/**
 * Turns accelerometer samples into [WristAngleMinute]s as described in [WristAngle]. Samples are first put back in
 * time order ([TimeOrderedSamples]), since the sensor hub can deliver a batch after a newer one. Then each axis is
 * replaced by its median over the samples within 2.5 s either side, the z-angle is taken from those medians, and the
 * angles are averaged per 5-second epoch aligned to the clock (12 per UTC minute). A minute is emitted once a later
 * minute starts, and only when all 12 of its epochs are covered ([WristAngle.MIN_SAMPLES_PER_EPOCH] samples each): a
 * minute with a gap (watch off the wrist, sensor paused) is left out, never filled in. A minute therefore comes out
 * [reorderWindow] after the samples that complete it. One instance per stream; not thread-safe.
 */
class WristAngleMinutes(reorderWindow: Duration = WristAngle.REORDER_WINDOW) {
    private val inOrder = TimeOrderedSamples(reorderWindow)
    private val angles = CenteredMedianAngles(WristAngle.MEDIAN_WINDOW)
    private val minutes = EpochMinutes()

    /** Adds the next sample as delivered; returns the minutes it completed (usually none). */
    fun add(sample: AccelerationSample): List<WristAngleMinute> =
        inOrder.add(sample).flatMap(angles::add).mapNotNull(minutes::add)
}

/**
 * Puts samples delivered out of time order back in order. Each sample is held until one more than [holdBack] newer
 * has arrived, then released oldest first. A sample at or before one already released, or with the same time as one
 * held, cannot be placed and is dropped.
 */
internal class TimeOrderedSamples(private val holdBack: Duration) {
    private val held = ArrayDeque<AccelerationSample>()
    private var lastReleased: Instant? = null

    fun add(sample: AccelerationSample): List<AccelerationSample> {
        val released = lastReleased
        if (released != null && !sample.at.isAfter(released)) return emptyList()
        if (!insertInOrder(sample)) return emptyList()
        val releaseBefore = held.last().at.minus(holdBack)
        val ready = mutableListOf<AccelerationSample>()
        while (held.first().at.isBefore(releaseBefore)) ready += held.removeFirst()
        ready.lastOrNull()?.let { lastReleased = it.at }
        return ready
    }

    /** Inserts from the newest end, where a sample almost always belongs; false for a duplicate time. */
    private fun insertInOrder(sample: AccelerationSample): Boolean {
        var index = held.size
        while (index > 0 && held[index - 1].at.isAfter(sample.at)) index--
        if (index > 0 && held[index - 1].at == sample.at) return false
        held.add(index, sample)
        return true
    }
}

/** A z-angle in degrees at the time of the sample it was computed for. */
internal data class TimedAngle(val at: Instant, val degrees: Double)

/**
 * The z-angle of each sample from the per-axis medians of a [window] centered on it. A sample's angle is known once a
 * sample more than half a window later arrives; samples out of time order are ignored.
 */
internal class CenteredMedianAngles(window: Duration) {
    private val halfWindow = window.dividedBy(2)
    private val samples = ArrayDeque<AccelerationSample>()
    private var nextCenter = 0

    fun add(sample: AccelerationSample): List<TimedAngle> {
        val newest = samples.lastOrNull()
        if (newest != null && !sample.at.isAfter(newest.at)) return emptyList()
        samples.addLast(sample)
        val completed = mutableListOf<TimedAngle>()
        while (samples[nextCenter].at.plus(halfWindow).isBefore(sample.at)) {
            completed += angleAround(samples[nextCenter])
            nextCenter++
        }
        dropSamplesNoLongerNeeded()
        return completed
    }

    private fun angleAround(center: AccelerationSample): TimedAngle {
        val window = samples.filter { Duration.between(center.at, it.at).abs() <= halfWindow }
        val degrees = WristAngle.zAngleDegrees(median(window.map { it.x }), median(window.map { it.y }), median(window.map { it.z }))
        return TimedAngle(center.at, degrees)
    }

    /** Keeps only the samples the next center's window can reach back to. */
    private fun dropSamplesNoLongerNeeded() {
        val nextCenterAt = samples[nextCenter].at
        while (samples.first().at.plus(halfWindow).isBefore(nextCenterAt)) {
            samples.removeFirst()
            nextCenter--
        }
    }
}

/** The middle value, or the mean of the two middle values for an even count (as R's median). */
internal fun median(values: List<Double>): Double {
    val sorted = values.sorted()
    val middle = sorted.size / 2
    return if (sorted.size % 2 == 1) sorted[middle] else (sorted[middle - 1] + sorted[middle]) / 2
}

/** Averages angles per clock-aligned 5-second epoch and gathers each minute's 12 covered epochs. */
internal class EpochMinutes {
    private var epoch: Long? = null
    private var sum = 0.0
    private var count = 0
    private val minuteEpochs = arrayOfNulls<Double>(WristAngle.EPOCHS_PER_MINUTE)

    /** Adds the next angle; returns the previous minute when this angle starts a new one and that minute is complete. */
    fun add(angle: TimedAngle): WristAngleMinute? {
        val angleEpoch = Math.floorDiv(angle.at.toEpochMilli(), EPOCH_MS)
        val finished = if (angleEpoch != epoch) startEpoch(angleEpoch) else null
        sum += angle.degrees
        count++
        return finished
    }

    private fun startEpoch(next: Long): WristAngleMinute? {
        val current = epoch
        var finished: WristAngleMinute? = null
        if (current != null) {
            if (count >= WristAngle.MIN_SAMPLES_PER_EPOCH) {
                minuteEpochs[Math.floorMod(current, WristAngle.EPOCHS_PER_MINUTE.toLong()).toInt()] = sum / count
            }
            if (minuteOf(next) != minuteOf(current)) finished = takeMinute(minuteOf(current))
        }
        epoch = next
        sum = 0.0
        count = 0
        return finished
    }

    /** The gathered minute if all its epochs have an angle; either way the next minute starts empty. */
    private fun takeMinute(minute: Long): WristAngleMinute? {
        val angles = minuteEpochs.filterNotNull()
        minuteEpochs.fill(null)
        if (angles.size < WristAngle.EPOCHS_PER_MINUTE) return null
        return WristAngleMinute(Instant.ofEpochMilli(minute * MINUTE_MS), angles)
    }

    private fun minuteOf(epoch: Long): Long = Math.floorDiv(epoch, WristAngle.EPOCHS_PER_MINUTE.toLong())

    private companion object {
        val EPOCH_MS = WristAngle.EPOCH.toMillis()
        val MINUTE_MS = EPOCH_MS * WristAngle.EPOCHS_PER_MINUTE
    }
}
