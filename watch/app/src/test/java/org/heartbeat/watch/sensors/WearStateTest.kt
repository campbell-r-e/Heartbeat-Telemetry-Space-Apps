package org.heartbeat.watch.sensors

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.heartbeat.watch.domain.Metric
import org.heartbeat.watch.domain.Reading
import org.heartbeat.watch.domain.ReadingValue
import org.heartbeat.watch.T0
import org.heartbeat.watch.reading
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class WearStateTest {

    @Test
    fun `skin temperature is only kept while heart-rate contact confirms the watch is worn`() = runTest {
        val wear = WearState { T0 }
        val readings = MutableSharedFlow<Reading>()
        val kept = mutableListOf<Double>()
        val job = launch { readings.onlyWhileWorn(wear).collect { kept += (it.value as ReadingValue.Scalar).number } }
        runCurrent()

        readings.emit(reading(Metric.SKIN_TEMP, 22.9))
        wear.onHeartRateContact(true)
        readings.emit(reading(Metric.SKIN_TEMP, 33.8))
        wear.onHeartRateContact(false)
        readings.emit(reading(Metric.SKIN_TEMP, 23.1))
        runCurrent()
        job.cancel()

        assertEquals(listOf(33.8), kept)
    }

    @Test
    fun `the watch counts as not worn until contact is confirmed`() {
        assertEquals(false, WearState { T0 }.worn.value)
    }
}
