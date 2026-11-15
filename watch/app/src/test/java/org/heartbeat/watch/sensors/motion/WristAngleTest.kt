package org.heartbeat.watch.sensors.motion

import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import org.heartbeat.watch.T0
import org.heartbeat.watch.collect.TelemetryCollector
import org.heartbeat.watch.domain.Metric
import org.heartbeat.watch.domain.ReadingSource
import org.heartbeat.watch.domain.ReadingValue
import org.heartbeat.watch.sensors.WearState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Duration
import java.time.Instant
import kotlin.math.sqrt

/** Synthetic accelerometer samples at 10 Hz from [start]; [axes] gives (x, y, z) for each sample index. */
private fun samples(start: Instant, seconds: Int, axes: (Int) -> Triple<Double, Double, Double>): List<AccelerationSample> =
    List(seconds * 10) { i ->
        val (x, y, z) = axes(i)
        AccelerationSample(start.plusMillis(i * 100L), x, y, z)
    }

/** The Galaxy Watch5 Pro accelerometer's hub buffer (fifoMaxEventCount), in samples. */
private const val GALAXY_WATCH5_HUB_BUFFER = 300

/** A wrist held still with its face tilted 30° up (z-angle 30°), in m/s². */
private val tilted30 = Triple(0.0, 9.81 * sqrt(3.0) / 2, 9.81 / 2)

private fun WristAngleMinutes.addAll(samples: List<AccelerationSample>): List<WristAngleMinute> = samples.flatMap(::add)

/** Minutes from samples already in time order, so each minute comes out as soon as the next one starts. */
private fun minutesInOrder() = WristAngleMinutes(reorderWindow = Duration.ZERO)

class ZAngleTest {
    @Test
    fun `is the angle between the watch face's z axis and the horizontal plane`() {
        assertEquals(90.0, WristAngle.zAngleDegrees(0.0, 0.0, 9.81), 1e-9)
        assertEquals(-90.0, WristAngle.zAngleDegrees(0.0, 0.0, -9.81), 1e-9)
        assertEquals(0.0, WristAngle.zAngleDegrees(9.81, 0.0, 0.0), 1e-9)
        assertEquals(-45.0, WristAngle.zAngleDegrees(0.0, 1.0, -1.0), 1e-9)
        assertEquals(30.0, WristAngle.zAngleDegrees(tilted30.first, tilted30.second, tilted30.third), 1e-9)
    }

    @Test
    fun `uses the root of x squared plus y squared, so it does not depend on the units or the rotation about z`() {
        assertEquals(WristAngle.zAngleDegrees(3.0, 4.0, 5.0), WristAngle.zAngleDegrees(0.0, 5.0, 5.0), 1e-9)
        assertEquals(WristAngle.zAngleDegrees(0.3, 0.4, 0.5), WristAngle.zAngleDegrees(3.0, 4.0, 5.0), 1e-9)
    }
}

class MedianTest {
    @Test
    fun `is the middle value, or the mean of the two middle values`() {
        assertEquals(2.0, median(listOf(3.0, 1.0, 2.0)), 0.0)
        assertEquals(2.5, median(listOf(4.0, 1.0, 3.0, 2.0)), 0.0)
    }
}

class WristAngleMinutesTest {
    @Test
    fun `a still minute becomes 12 epoch angles stamped at the minute's start, once the next minute begins`() {
        val minutes = minutesInOrder().addAll(samples(T0, 65) { tilted30 })

        assertEquals(1, minutes.size)
        assertEquals(T0, minutes[0].minuteStart)
        assertEquals(12, minutes[0].epochAnglesDeg.size)
        minutes[0].epochAnglesDeg.forEach { assertEquals(30.0, it, 1e-9) }
    }

    @Test
    fun `the 5-second median removes a single jolt`() {
        val jolted = samples(T0, 65) { i -> if (i == 23) Triple(0.0, 0.0, 30.0) else tilted30 }

        minutesInOrder().addAll(jolted)[0].epochAnglesDeg.forEach { assertEquals(30.0, it, 1e-9) }
    }

    @Test
    fun `angles are averaged per 5-second epoch aligned to the clock`() {
        // Flat (0°) for the first 30 s, face up (90°) after: epochs well inside each half have those angles.
        val turned = samples(T0, 65) { i -> if (i < 300) Triple(9.81, 0.0, 0.0) else Triple(0.0, 0.0, 9.81) }

        val angles = minutesInOrder().addAll(turned)[0].epochAnglesDeg

        angles.take(5).forEach { assertEquals(0.0, it, 1e-9) }
        angles.drop(7).forEach { assertEquals(90.0, it, 1e-9) }
        // The epoch starting at 30 s: the median flips with the window's majority, 2.5 s before and after the turn.
        assertEquals(90.0, angles[6], 1e-9)
    }

    @Test
    fun `a minute with an epoch that has no samples is left out, never filled in`() {
        val withGap = samples(T0, 125) { tilted30 }.filterNot { it.at >= T0.plusSeconds(20) && it.at < T0.plusSeconds(28) }

        val minutes = minutesInOrder().addAll(withGap)

        assertEquals(listOf(T0.plusSeconds(60)), minutes.map { it.minuteStart })
    }

    @Test
    fun `an epoch needs 80 percent of its 10 Hz samples, 40 of 50, or its minute is left out`() {
        // Epoch 2 (10-15 s) keeps only its first `kept` samples; the 5-second median still finds them.
        fun minutesKeepingInEpochTwo(kept: Int) = minutesInOrder().addAll(
            samples(T0, 65) { tilted30 }.filterNot { it.at >= T0.plusMillis(10_000L + kept * 100L) && it.at < T0.plusSeconds(15) },
        )

        assertEquals(WristAngle.MIN_SAMPLES_PER_EPOCH, 40)
        assertTrue(minutesKeepingInEpochTwo(WristAngle.MIN_SAMPLES_PER_EPOCH - 1).isEmpty())
        assertEquals(listOf(T0), minutesKeepingInEpochTwo(WristAngle.MIN_SAMPLES_PER_EPOCH).map { it.minuteStart })
    }

    @Test
    fun `coming off at a minute boundary and back on hours later sends the last minute once and the next whole minute with its own start`() {
        val back = T0.plus(Duration.ofHours(2))
        val minutes = minutesInOrder()

        val beforeGap = minutes.addAll(samples(T0, 60) { tilted30 })
        val afterGap = minutes.addAll(samples(back, 65) { i -> if (i % 2 == 0) tilted30 else Triple(0.0, 0.0, 9.81) })

        assertTrue(beforeGap.isEmpty())
        assertEquals(listOf(T0, back), afterGap.map { it.minuteStart })
        afterGap[0].epochAnglesDeg.forEach { assertEquals(30.0, it, 1e-9) }
        // After the gap only the new samples count: their median is no longer the old posture's.
        assertEquals(12, afterGap[1].epochAnglesDeg.size)
        afterGap[1].epochAnglesDeg.forEach { assertTrue(it > 30.0) }
    }

    @Test
    fun `a stream starting mid-minute leaves that minute out and sends the next whole one`() {
        val minutes = minutesInOrder().addAll(samples(T0.plusSeconds(30), 95) { tilted30 })

        assertEquals(listOf(T0.plusSeconds(60)), minutes.map { it.minuteStart })
    }

    @Test
    fun `a batch delivered after a newer one is put back in time order`() {
        // The hub delivered 10-30 s only after 30-50 s; with the default window both still count.
        val ordered = samples(T0, 125) { tilted30 }
        val (late, rest) = ordered.partition { it.at >= T0.plusSeconds(10) && it.at < T0.plusSeconds(30) }
        val delivered = rest.filter { it.at < T0.plusSeconds(50) } + late + rest.filter { it.at >= T0.plusSeconds(50) }

        val minutes = WristAngleMinutes().addAll(delivered)

        assertEquals(listOf(T0), minutes.map { it.minuteStart })
        minutes[0].epochAnglesDeg.forEach { assertEquals(30.0, it, 1e-9) }
    }

    @Test
    fun `a minute comes out one reorder window after the samples that complete it`() {
        val window = WristAngle.REORDER_WINDOW.seconds.toInt()

        assertTrue(WristAngleMinutes().addAll(samples(T0, 60 + window) { tilted30 }).isEmpty())
        assertEquals(listOf(T0), WristAngleMinutes().addAll(samples(T0, 65 + window) { tilted30 }).map { it.minuteStart })
    }

    @Test
    fun `a sample older than one already released, or a repeated time, is dropped`() {
        val ordered = samples(T0, 65) { tilted30 }
        val stray = ordered.flatMap { listOf(it, it.copy(at = it.at.minusSeconds(1), z = -9.81), it.copy(z = -9.81)) }

        minutesInOrder().addAll(stray)[0].epochAnglesDeg.forEach { assertEquals(30.0, it, 1e-9) }
    }

    @Test
    fun `the hub never holds more samples than its 300-sample buffer keeps`() {
        val heldAtMost = WristAngle.MAX_BATCH_DELAY.seconds * WristAngle.SAMPLE_RATE_HZ

        assertTrue(heldAtMost <= GALAXY_WATCH5_HUB_BUFFER * 2 / 3)
    }

    @Test
    fun `each minute becomes one watch wristAngle reading in degrees`() = runTest {
        val untilEmitted = 65 + WristAngle.REORDER_WINDOW.seconds.toInt()
        val readings = TelemetryCollector.wristAngleReadings(samples(T0, untilEmitted) { tilted30 }.asFlow()).toList()

        assertEquals(1, readings.size)
        val reading = readings[0]
        assertEquals(Metric.WRIST_ANGLE, reading.metric)
        assertEquals("deg", reading.metric.unit)
        assertEquals("wristAngle", reading.metric.wireName)
        assertEquals(ReadingSource.WATCH, reading.source)
        assertEquals(T0, reading.takenAt)
        assertEquals(12, (reading.value as ReadingValue.Series).samples.size)
    }
}

class WornSamplesTest {
    private var now: Instant = T0
    private val wear = WearState { now }

    private fun keptOf(vararg times: Instant): List<Instant> = runBlocking {
        times.map { AccelerationSample(it, 0.0, 0.0, 9.81) }.asFlow().onlyWornSamples(wear).toList().map { it.at }
    }

    @Test
    fun `samples are judged by their own time, so a batch delivered after the watch goes on keeps only the samples since`() {
        now = T0.plusSeconds(30)
        wear.onHeartRateContact(true)

        assertEquals(listOf(T0.plusSeconds(30), T0.plusSeconds(45)), keptOf(T0.plusSeconds(10), T0.plusSeconds(30), T0.plusSeconds(45)))
    }

    @Test
    fun `no off-wrist sample counts - nothing is kept while off, and after going back on only samples since then`() {
        now = T0
        wear.onHeartRateContact(true)
        now = T0.plusSeconds(60)
        wear.onHeartRateContact(false)
        assertTrue(keptOf(T0.plusSeconds(10), T0.plusSeconds(70)).isEmpty())

        now = T0.plusSeconds(120)
        wear.onHeartRateContact(true)
        assertEquals(listOf(T0.plusSeconds(125)), keptOf(T0.plusSeconds(10), T0.plusSeconds(90), T0.plusSeconds(125)))
    }

    @Test
    fun `contact confirmed again while already worn does not move the start of the worn period`() {
        now = T0
        wear.onHeartRateContact(true)
        now = T0.plusSeconds(60)
        wear.onHeartRateContact(true)

        assertEquals(listOf(T0.plusSeconds(10)), keptOf(T0.plusSeconds(10)))
    }
}
