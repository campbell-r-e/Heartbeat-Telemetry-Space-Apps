package org.heartbeat.watch.ui.model

import org.heartbeat.watch.domain.EcgSpec
import org.heartbeat.watch.domain.Measurement
import org.heartbeat.watch.domain.MeasurementHint
import org.heartbeat.watch.domain.MeasurementKind
import org.heartbeat.watch.domain.ReadingValue
import org.heartbeat.watch.time.UtcTime
import org.heartbeat.watch.upload.UploadRecord
import java.util.Locale
import kotlin.math.floor

/** Where a running measurement stands, as the ViewModel tracks it. */
data class MeasurementProgress(val kind: MeasurementKind, val latest: Measurement)

/** The SpO₂ / ECG screens (approved mockups watch-measure-spo2, -ecg and -result); no judgment on the watch. */
class MeasurementPresenter {

    fun measurement(progress: MeasurementProgress, lastUpload: UploadRecord?): MeasurementUi {
        val title = TITLES.getValue(progress.kind)
        return when (val latest = progress.latest) {
            is Measurement.InProgress -> measuring(progress, latest, title)
            is Measurement.Finished -> result(progress.kind, title, latest, lastUpload)
            is Measurement.Failed -> MeasurementUi.Failed(progress.kind, title, RETRY_ADVICE.getValue(progress.kind))
        }
    }

    private fun measuring(progress: MeasurementProgress, latest: Measurement.InProgress, title: String): MeasurementUi.Measuring {
        val recorded = latest.recordedFraction ?: 0.0
        val isEcg = progress.kind == MeasurementKind.ECG
        return MeasurementUi.Measuring(
            kind = progress.kind,
            title = title,
            secondsLeft = if (isEcg) secondsLeft(recorded) else null,
            progress = if (isEcg) recorded.toFloat() else null,
            instruction = instruction(progress.kind, latest.hint),
            trace = TraceScaling.toUnitRange(latest.recentTrace, TRACE_POINTS),
        )
    }

    /** ECG: the 30 s recording only counts while a fingertip is on the button. */
    private fun secondsLeft(recordedFraction: Double): Int =
        EcgSpec.RECORDING_SECONDS - floor(EcgSpec.RECORDING_SECONDS * recordedFraction).toInt()

    private fun result(
        kind: MeasurementKind,
        title: String,
        finished: Measurement.Finished,
        lastUpload: UploadRecord?,
    ): MeasurementUi.Result {
        val (value, unit) = when (val reading = finished.reading.value) {
            is ReadingValue.Scalar -> String.format(Locale.US, "%.0f", reading.number) to finished.reading.metric.unit
            is ReadingValue.Series -> "${reading.samples.size / EcgSpec.SAMPLE_RATE_HZ}" to "s"
        }
        val sent = lastUpload?.takeIf { !it.at.isBefore(finished.reading.takenAt) }
        return MeasurementUi.Result(kind, title, value, unit, sent?.let { "Sent to server · ${UtcTime.time(it.at)}" })
    }

    private fun instruction(kind: MeasurementKind, hint: MeasurementHint): String =
        when (hint) {
            MeasurementHint.STARTING -> "Starting the sensor…"
            MeasurementHint.HOLD_STILL -> "Keep your arm still and the watch snug on your wrist."
            MeasurementHint.MOVING -> "Movement detected. Keep your arm still."
            MeasurementHint.LOW_SIGNAL -> "Weak signal. Tighten the band a little."
            MeasurementHint.TOUCH_KEY, MeasurementHint.RECORDING ->
                if (kind == MeasurementKind.ECG) "Rest your arm and keep a fingertip on the top button." else "Measuring…"
        }

    private companion object {
        const val TRACE_POINTS = 150
        /** The approved failure mockup's advice; the technical reason goes to the log, not the screen. */
        val RETRY_ADVICE = mapOf(
            MeasurementKind.SPO2 to "Rest your arm on a surface, tighten the band a little, and try again.",
            MeasurementKind.ECG to "Rest your arm on a surface, keep a fingertip on the top button, and try again.",
        )
        val TITLES = mapOf(MeasurementKind.SPO2 to "Blood oxygen", MeasurementKind.ECG to "ECG")
    }
}

/** Shrinks a trace to at most [points] samples and scales it to 0..1, top (1 = highest) to bottom, for drawing. */
object TraceScaling {
    fun toUnitRange(samples: List<Double>, points: Int): List<Float> {
        if (samples.size < 2) return emptyList()
        val step = maxOf(1, samples.size / points)
        val picked = samples.filterIndexed { index, _ -> index % step == 0 }
        val low = picked.min()
        val span = (picked.max() - low).takeIf { it > 0 } ?: return picked.map { HALF }
        return picked.map { ((it - low) / span).toFloat() }
    }

    private const val HALF = 0.5f
}
