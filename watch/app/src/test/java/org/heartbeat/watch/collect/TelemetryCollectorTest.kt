package org.heartbeat.watch.collect

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.heartbeat.watch.T0
import org.heartbeat.watch.domain.Metric
import org.heartbeat.watch.domain.ReadingValue
import org.heartbeat.watch.domain.UploadResult
import org.heartbeat.watch.reading
import org.heartbeat.watch.sensors.body.BeatIntervals
import org.heartbeat.watch.upload.Backoff
import org.heartbeat.watch.upload.ReadingRecorder
import org.heartbeat.watch.upload.UploadQueue
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Duration
import kotlin.time.Duration.Companion.seconds

@OptIn(ExperimentalCoroutinesApi::class)
class TelemetryCollectorTest {
    private val recorder = ReadingRecorder(UploadQueue({ UploadResult.Accepted(it.size, 0) }))
    private val health = SensorHealth()
    private val failures = mutableListOf<Metric>()

    private fun collector(streams: ContinuousStreams) =
        TelemetryCollector(streams, recorder, health, { sensor, _ -> failures += sensor }, Backoff(5.seconds, 60.seconds))

    private fun streams(
        heartRate: kotlinx.coroutines.flow.Flow<org.heartbeat.watch.domain.Reading> = emptyFlow(),
        skinTemperature: kotlinx.coroutines.flow.Flow<org.heartbeat.watch.domain.Reading> = emptyFlow(),
        cabinPressure: kotlinx.coroutines.flow.Flow<org.heartbeat.watch.domain.Reading> = emptyFlow(),
    ) = ContinuousStreams(heartRate, emptyFlow(), skinTemperature, cabinPressure, emptyFlow())

    @Test
    fun `sends one ibi reading per batch of beat intervals and never an hrv reading`() = runTest {
        val beats = flowOf(
            BeatIntervals(listOf(800, 810), T0),
            BeatIntervals(emptyList(), T0.plus(Duration.ofSeconds(5))),
            BeatIntervals(listOf(790), T0.plus(Duration.ofSeconds(10))),
        )

        val readings = TelemetryCollector.ibiReadings(beats).toList()

        assertEquals(listOf(Metric.IBI, Metric.IBI), readings.map { it.metric })
        assertEquals(ReadingValue.Series(listOf(790.0)), readings.last().value)
    }

    @Test
    fun `a failing stream is reported and the others keep recording`() = runTest {
        val streams = streams(
            heartRate = flowOf(reading(Metric.HEART_RATE, 1.0)),
            skinTemperature = flow { throw IllegalStateException("tracker refused") },
            cabinPressure = flowOf(reading(Metric.PRESSURE, 2.0)),
        )

        collector(streams).start(backgroundScope)
        runCurrent()

        assertEquals(listOf(Metric.SKIN_TEMP), failures)
        assertEquals(setOf(Metric.SKIN_TEMP), health.unavailable.value)
        assertEquals(setOf(Metric.HEART_RATE, Metric.PRESSURE), recorder.newestByMetric.value.keys)
    }

    @Test
    fun `a stream that fails once is restarted after the backoff and recovers`() = runTest {
        var attempts = 0
        val flaky = flow {
            attempts++
            if (attempts == 1) throw IllegalStateException("service not ready after reboot")
            emit(reading(Metric.SKIN_TEMP, 33.5))
        }

        collector(streams(skinTemperature = flaky)).start(backgroundScope)
        runCurrent()
        assertTrue(Metric.SKIN_TEMP in health.unavailable.value)

        advanceTimeBy(6.seconds)
        runCurrent()

        assertEquals(2, attempts)
        assertTrue(health.unavailable.value.isEmpty())
        assertEquals(33.5, (recorder.newestByMetric.value.getValue(Metric.SKIN_TEMP).value as ReadingValue.Scalar).number, 0.0)
    }

    @Test
    fun `after a stream recovers, its next outage waits the first backoff again, not a longer one`() = runTest {
        var attempts = 0
        val flaky = flow {
            attempts++
            if (attempts == 2) emit(reading(Metric.SKIN_TEMP, 33.5))
            if (attempts <= 2) throw IllegalStateException("outage $attempts")
            emit(reading(Metric.SKIN_TEMP, 33.6))
        }

        collector(streams(skinTemperature = flaky)).start(backgroundScope)
        runCurrent()
        advanceTimeBy(6.seconds)
        runCurrent()
        assertEquals("restarted once, delivered a reading, then failed again", 2, attempts)

        advanceTimeBy(6.seconds)
        runCurrent()

        assertEquals("the second outage waits 5 s again, not the doubled 10 s", 3, attempts)
        assertTrue(health.unavailable.value.isEmpty())
    }
}
