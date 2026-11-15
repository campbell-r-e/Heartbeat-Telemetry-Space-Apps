package org.heartbeat.watch.collect

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.heartbeat.watch.domain.Measurement
import org.heartbeat.watch.domain.MeasurementHint
import org.heartbeat.watch.domain.MeasurementKind
import org.heartbeat.watch.domain.Metric
import org.heartbeat.watch.domain.Reading
import org.heartbeat.watch.domain.UploadResult
import org.heartbeat.watch.reading
import org.heartbeat.watch.sensors.body.BeatIntervals
import org.heartbeat.watch.sensors.body.BodySensors
import org.heartbeat.watch.sensors.body.BodySensorsState
import org.heartbeat.watch.upload.ReadingRecorder
import org.heartbeat.watch.upload.UploadQueue
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Duration.Companion.seconds

@OptIn(ExperimentalCoroutinesApi::class)
class OnDemandMeasurementsTest {
    private val recorder = ReadingRecorder(UploadQueue({ UploadResult.Accepted(it.size, 0) }))
    private var uploadsRequested = 0

    private class FakeSensors(private val spo2: Flow<Measurement>) : BodySensors {
        override val state: StateFlow<BodySensorsState> = MutableStateFlow(BodySensorsState.Connected(emptySet()))

        override fun interBeatIntervals(): Flow<BeatIntervals> = emptyFlow()

        override fun skinTemperature(): Flow<Reading> = emptyFlow()

        override fun measureSpo2(): Flow<Measurement> = spo2

        override fun recordEcg(): Flow<Measurement> = emptyFlow()
    }

    private fun measurements(spo2: Flow<Measurement>) = OnDemandMeasurements(FakeSensors(spo2), recorder) { uploadsRequested++ }

    @Test
    fun `SpO2 gives up after 60 s without a result, in every build`() = runTest {
        val neverFinishes = flow {
            emit(Measurement.InProgress(MeasurementHint.HOLD_STILL))
            awaitCancellation()
        }
        val seen = mutableListOf<Measurement>()
        backgroundScope.launch { measurements(neverFinishes).run(MeasurementKind.SPO2).collect { seen += it } }

        advanceTimeBy(59.seconds)
        runCurrent()
        assertTrue("still measuring at 59 s", seen.last() is Measurement.InProgress)

        advanceTimeBy(1.seconds)
        runCurrent()

        assertEquals(Measurement.Failed("No result after 60 s"), seen.last())
        assertEquals("nothing was sent", 0, uploadsRequested)
    }

    @Test
    fun `a result before the limit is recorded and sent at once, and ends the measurement`() = runTest {
        val result = reading(Metric.SPO2, 97.0)
        val spo2 = flowOf(Measurement.InProgress(MeasurementHint.HOLD_STILL), Measurement.Finished(result), Measurement.InProgress(MeasurementHint.MOVING))
        val seen = mutableListOf<Measurement>()

        measurements(spo2).run(MeasurementKind.SPO2).collect { seen += it }

        assertEquals(Measurement.Finished(result), seen.last())
        assertEquals(result, recorder.newestByMetric.value.getValue(Metric.SPO2))
        assertEquals(1, uploadsRequested)
    }

    @Test
    fun `is running from the start of a measurement until it ends, however it ends`() = runTest {
        val neverFinishes = flow {
            emit(Measurement.InProgress(MeasurementHint.HOLD_STILL))
            awaitCancellation()
        }
        val measurements = measurements(neverFinishes)
        assertFalse(measurements.isRunning)

        val job = backgroundScope.launch { measurements.run(MeasurementKind.SPO2).collect {} }
        runCurrent()
        assertTrue(measurements.isRunning)

        job.cancel()
        runCurrent()
        assertFalse("canceled", measurements.isRunning)

        measurements.run(MeasurementKind.SPO2).collect {}
        assertFalse("gave up", measurements.isRunning)
    }
}
