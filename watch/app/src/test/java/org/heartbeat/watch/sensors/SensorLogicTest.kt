package org.heartbeat.watch.sensors

import org.heartbeat.watch.T0
import org.heartbeat.watch.domain.Measurement
import org.heartbeat.watch.domain.MeasurementHint
import org.heartbeat.watch.domain.Metric
import org.heartbeat.watch.domain.ReadingValue
import org.heartbeat.watch.sensors.body.BeatIntervals
import org.heartbeat.watch.sensors.body.EcgRecording
import org.heartbeat.watch.sensors.body.HeartRateCodes
import org.heartbeat.watch.sensors.body.Spo2Codes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Duration

class BeatIntervalsTest {
    @Test
    fun `a batch becomes one raw ibi reading stamped at its first beat`() {
        val lastBeatAt = T0.plusSeconds(10)

        val reading = BeatIntervals(listOf(800, 810, 790), lastBeatAt).toReading()!!

        assertEquals(Metric.IBI, reading.metric)
        assertEquals("ms", reading.metric.unit)
        assertEquals(ReadingValue.Series(listOf(800.0, 810.0, 790.0)), reading.value)
        assertEquals(lastBeatAt.minusMillis(800 + 810 + 790), reading.takenAt)
    }

    @Test
    fun `intervals are sent as delivered, with no artifact filtering on the watch`() {
        val reading = BeatIntervals(listOf(100, 5000), T0).toReading()!!

        assertEquals(ReadingValue.Series(listOf(100.0, 5000.0)), reading.value)
    }

    @Test
    fun `a batch without valid intervals sends nothing`() {
        assertNull(BeatIntervals(emptyList(), T0).toReading())
    }
}

class SampleThrottleTest {
    @Test
    fun `lets through one sample per interval`() {
        val throttle = SampleThrottle(Duration.ofMinutes(1))

        assertTrue(throttle.accept(T0))
        assertFalse(throttle.accept(T0.plusSeconds(30)))
        assertTrue(throttle.accept(T0.plusSeconds(60)))
    }
}

class SamsungCodesTest {
    @Test
    fun `keeps only intervals with a valid status`() {
        assertEquals(listOf(800, 820), HeartRateCodes.validIntervals(listOf(800, 400, 820), listOf(0, -1, 0)))
    }

    @Test
    fun `turns SpO2 statuses into hints`() {
        assertEquals(MeasurementHint.MOVING, Spo2Codes.hintFor(Spo2Codes.DEVICE_MOVING))
        assertEquals(MeasurementHint.LOW_SIGNAL, Spo2Codes.hintFor(Spo2Codes.LOW_SIGNAL))
        assertEquals(MeasurementHint.HOLD_STILL, Spo2Codes.hintFor(Spo2Codes.CALCULATING))
    }
}

class EcgRecordingTest {
    @Test
    fun `asks for a finger on the key and keeps no samples while it is off`() {
        val recording = EcgRecording(targetSamples = 4)

        assertEquals(MeasurementHint.TOUCH_KEY, (recording.add(listOf(1f, 2f), leadOff = 5, at = T0) as Measurement.InProgress).hint)
        assertFalse(recording.isComplete)
    }

    @Test
    fun `finishes with exactly the target number of samples from the first touch`() {
        val recording = EcgRecording(targetSamples = 3)
        val touchedAt = T0.plusSeconds(2)

        val firstBatch = recording.add(listOf(0.5f, 0.25f), EcgRecording.LEAD_ON, touchedAt) as Measurement.InProgress
        assertEquals(MeasurementHint.RECORDING, firstBatch.hint)
        assertEquals(2.0 / 3, firstBatch.recordedFraction!!, 1e-9)
        val done = recording.add(listOf(0.75f, 1f), EcgRecording.LEAD_ON, touchedAt.plusSeconds(1)) as Measurement.Finished

        assertEquals(Metric.ECG, done.reading.metric)
        assertEquals(ReadingValue.Series(listOf(0.5, 0.25, 0.75)), done.reading.value)
        assertEquals(touchedAt, done.reading.takenAt)
    }
}
