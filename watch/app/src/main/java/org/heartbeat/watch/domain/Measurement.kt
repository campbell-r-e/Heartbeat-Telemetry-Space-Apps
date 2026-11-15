package org.heartbeat.watch.domain

/** The two on-demand measurements the astronaut starts on the watch. */
enum class MeasurementKind { SPO2, ECG }

/** How an on-demand measurement is going: progress hints, then exactly one [Finished] or [Failed]. */
sealed interface Measurement {
    data class InProgress(
        val hint: MeasurementHint,
        /** How much of a fixed-length recording is done (ECG), or `null` when the sensor gives no progress (SpO₂). */
        val recordedFraction: Double? = null,
        /** The most recent samples, for a live trace (ECG). */
        val recentTrace: List<Double> = emptyList(),
    ) : Measurement

    data class Finished(val reading: Reading) : Measurement

    /** [reason] is technical, for the log; the screen shows its own advice. */
    data class Failed(val reason: String) : Measurement
}

enum class MeasurementHint { STARTING, HOLD_STILL, MOVING, LOW_SIGNAL, TOUCH_KEY, RECORDING }

/** How long the watch waits for an on-demand result before giving up and showing the failed screen. */
object MeasurementLimits {
    /** Owner decision: SpO₂ gives up after 60 s. */
    const val SPO2_TIMEOUT_SECONDS = 60
    const val ECG_TIMEOUT_SECONDS = 90
}

/** The ECG recording: 30 s of samples at the tracker's 500 Hz, counted only while a fingertip is on the button. */
object EcgSpec {
    const val SAMPLE_RATE_HZ = 500
    const val RECORDING_SECONDS = 30
    const val TARGET_SAMPLES = SAMPLE_RATE_HZ * RECORDING_SECONDS
}
