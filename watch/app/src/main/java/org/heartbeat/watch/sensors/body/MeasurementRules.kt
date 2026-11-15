package org.heartbeat.watch.sensors.body

import org.heartbeat.watch.domain.EcgSpec
import org.heartbeat.watch.domain.Measurement
import org.heartbeat.watch.domain.MeasurementHint
import org.heartbeat.watch.domain.Metric
import org.heartbeat.watch.domain.Reading
import org.heartbeat.watch.domain.ReadingSource
import org.heartbeat.watch.domain.ReadingValue
import java.time.Instant

/**
 * Status codes the Samsung Health Sensor SDK uses, and what each one means for the person measuring.
 * Kept free of SDK types so the logic is unit-tested without the .aar.
 */
object Spo2Codes {
    const val CALCULATING = 0
    const val COMPLETED = 2
    const val DEVICE_MOVING = -4
    const val LOW_SIGNAL = -5

    fun hintFor(status: Int): MeasurementHint =
        when (status) {
            DEVICE_MOVING -> MeasurementHint.MOVING
            LOW_SIGNAL -> MeasurementHint.LOW_SIGNAL
            else -> MeasurementHint.HOLD_STILL
        }
}

object HeartRateCodes {
    /** Inter-beat interval status for a clean beat. */
    const val VALID_INTERVAL = 0

    fun validIntervals(intervalsMs: List<Int>, statuses: List<Int>): List<Int> =
        intervalsMs.zip(statuses).filter { (_, status) -> status == VALID_INTERVAL }.map { (interval, _) -> interval }
}

object SkinTemperatureCodes {
    const val SUCCESSFUL_MEASUREMENT = 0
}

/**
 * Collects ECG samples while a finger is on the key, until [targetSamples] have been recorded.
 * Samples taken with the finger off the key are not kept.
 */
class EcgRecording(private val targetSamples: Int = TARGET_SAMPLES) {
    private val samplesMv = ArrayList<Double>(targetSamples)
    private var startedAt: Instant? = null

    val isComplete: Boolean get() = samplesMv.size >= targetSamples

    fun add(samplesMv: List<Float>, leadOff: Int, at: Instant): Measurement {
        if (leadOff != LEAD_ON) return inProgress(MeasurementHint.TOUCH_KEY)
        if (startedAt == null) startedAt = at
        this.samplesMv += samplesMv.take(targetSamples - this.samplesMv.size).map(Float::toDouble)
        return if (isComplete) Measurement.Finished(toReading()) else inProgress(MeasurementHint.RECORDING)
    }

    private fun inProgress(hint: MeasurementHint) =
        Measurement.InProgress(
            hint = hint,
            recordedFraction = samplesMv.size.toDouble() / targetSamples,
            recentTrace = samplesMv.takeLast(TRACE_SAMPLES),
        )

    private fun toReading(): Reading =
        Reading(Metric.ECG, ReadingValue.Series(samplesMv.toList()), checkNotNull(startedAt), ReadingSource.WATCH)

    companion object {
        /** The SDK reports LEAD_OFF = 0 while a finger touches the key. */
        const val LEAD_ON = 0
        const val TARGET_SAMPLES = EcgSpec.TARGET_SAMPLES

        /** The live line shows the last two seconds. */
        const val TRACE_SAMPLES = EcgSpec.SAMPLE_RATE_HZ * 2
    }
}
