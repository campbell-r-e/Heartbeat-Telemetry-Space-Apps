package org.heartbeat.watch.collect

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.flow.onCompletion
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.transformWhile
import kotlinx.coroutines.withTimeoutOrNull
import org.heartbeat.watch.domain.Measurement
import org.heartbeat.watch.domain.MeasurementKind
import org.heartbeat.watch.domain.MeasurementLimits
import org.heartbeat.watch.sensors.body.BodySensors
import org.heartbeat.watch.upload.ReadingRecorder
import java.util.concurrent.atomic.AtomicInteger
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds

/**
 * Runs an SpO₂ or ECG measurement the astronaut started, records the result and sends it right away. The give-up time
 * is applied here, the same for every build, whether or not Samsung's SDK is in it.
 */
class OnDemandMeasurements(
    private val bodySensors: BodySensors,
    private val recorder: ReadingRecorder,
    private val requestUpload: () -> Unit,
) {
    /** Measurements whose sensor is running; normally at most one. */
    private val running = AtomicInteger(0)

    /** True while a measurement's sensor runs, from its start until its result, failure or cancel. */
    val isRunning: Boolean get() = running.get() > 0

    fun run(kind: MeasurementKind): Flow<Measurement> =
        measurementFor(kind).givingUpAfter(timeoutFor(kind))
            .onEach { measurement ->
                if (measurement is Measurement.Finished) {
                    recorder.record(measurement.reading)
                    requestUpload()
                }
            }
            .onStart { running.incrementAndGet() }
            .onCompletion { running.decrementAndGet() }

    private fun measurementFor(kind: MeasurementKind): Flow<Measurement> =
        when (kind) {
            MeasurementKind.SPO2 -> bodySensors.measureSpo2()
            MeasurementKind.ECG -> bodySensors.recordEcg()
        }

    private fun timeoutFor(kind: MeasurementKind): Duration =
        when (kind) {
            MeasurementKind.SPO2 -> MeasurementLimits.SPO2_TIMEOUT_SECONDS.seconds
            MeasurementKind.ECG -> MeasurementLimits.ECG_TIMEOUT_SECONDS.seconds
        }
}

/**
 * Passes progress on and ends after the first [Measurement.Finished] or [Measurement.Failed]; if neither comes within
 * [timeout], the sensor is stopped and the flow ends with [Measurement.Failed].
 */
internal fun Flow<Measurement>.givingUpAfter(timeout: Duration): Flow<Measurement> = channelFlow {
    val untilFinal = transformWhile { measurement ->
        emit(measurement)
        measurement is Measurement.InProgress
    }
    val ended = withTimeoutOrNull(timeout) { untilFinal.collect { send(it) } }
    if (ended == null) send(Measurement.Failed("No result after ${timeout.inWholeSeconds} s"))
}
