package org.heartbeat.watch.collect

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.mapNotNull
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.retryWhen
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.heartbeat.watch.domain.Metric
import org.heartbeat.watch.domain.Reading
import org.heartbeat.watch.sensors.body.BeatIntervals
import org.heartbeat.watch.sensors.motion.AccelerationSample
import org.heartbeat.watch.sensors.motion.WristAngleMinutes
import org.heartbeat.watch.upload.Backoff
import org.heartbeat.watch.upload.ReadingRecorder
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds

/** The continuous sensor streams the watch collects for as long as it runs. */
data class ContinuousStreams(
    val heartRate: Flow<Reading>,
    val beatIntervals: Flow<BeatIntervals>,
    val skinTemperature: Flow<Reading>,
    val cabinPressure: Flow<Reading>,
    /** Accelerometer samples taken while the watch is on the wrist, for the server's sleep detection. */
    val wristMotion: Flow<AccelerationSample>,
)

/** Which watch sensor streams are failing right now, so the tiles can say "sensor unavailable" instead of going stale. */
class SensorHealth {
    private val _unavailable = MutableStateFlow<Set<Metric>>(emptySet())

    val unavailable: StateFlow<Set<Metric>> = _unavailable.asStateFlow()

    fun failed(sensor: Metric) = _unavailable.update { it + sensor }

    fun working(sensor: Metric) = _unavailable.update { it - sensor }
}

/**
 * Feeds every continuous sensor stream into the [ReadingRecorder]. A stream that fails is reported to [onStreamFailed],
 * marked unavailable in [health], and restarted after a backoff (for example while Samsung's health service is still
 * starting after a reboot); the other streams keep going. The backoff starts again from the first wait once a
 * restarted stream delivers a reading, so each outage is waited out on its own.
 */
class TelemetryCollector(
    private val streams: ContinuousStreams,
    private val recorder: ReadingRecorder,
    private val health: SensorHealth,
    private val onStreamFailed: (sensor: Metric, failure: Throwable) -> Unit,
    private val backoff: Backoff = Backoff(FIRST_RESTART, MAX_RESTART),
) {
    fun start(scope: CoroutineScope) {
        scope.collectWithRestart(Metric.HEART_RATE, streams.heartRate)
        scope.collectWithRestart(Metric.IBI, ibiReadings(streams.beatIntervals))
        scope.collectWithRestart(Metric.SKIN_TEMP, streams.skinTemperature)
        scope.collectWithRestart(Metric.PRESSURE, streams.cabinPressure)
        scope.collectWithRestart(Metric.WRIST_ANGLE, wristAngleReadings(streams.wristMotion))
    }

    private fun CoroutineScope.collectWithRestart(sensor: Metric, readings: Flow<Reading>) {
        launch {
            var consecutiveFailures = 0
            readings
                .onEach {
                    consecutiveFailures = 0
                    health.working(sensor)
                }
                .retryWhen { failure, _ ->
                    onStreamFailed(sensor, failure)
                    health.failed(sensor)
                    delay(backoff.delayAfter(++consecutiveFailures))
                    true
                }
                .collect(recorder::record)
        }
    }

    companion object {
        private val FIRST_RESTART = 5.seconds
        private val MAX_RESTART = 5.minutes

        /** HRV is derived on the server; the watch sends each batch of intervals as one raw `ibi` reading. */
        fun ibiReadings(beatIntervals: Flow<BeatIntervals>): Flow<Reading> = beatIntervals.mapNotNull(BeatIntervals::toReading)

        /** Sleep is detected on the server; the watch sends one `wristAngle` reading of 12 epoch angles per complete minute. */
        fun wristAngleReadings(samples: Flow<AccelerationSample>): Flow<Reading> = flow {
            val minutes = WristAngleMinutes()
            samples.collect { sample -> minutes.add(sample).forEach { emit(it.toReading()) } }
        }
    }
}
