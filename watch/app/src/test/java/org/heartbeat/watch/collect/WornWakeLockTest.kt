package org.heartbeat.watch.collect

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class WornWakeLockTest {

    /** Stands in for PowerManager: records whether the lock is held and how often it was taken. */
    private class FakeWakeLock : ProcessorWakeLock {
        var held = false
        var acquisitions = 0

        override fun acquire() {
            if (!held) acquisitions++
            held = true
        }

        override fun release() {
            held = false
        }
    }

    private val worn = MutableStateFlow(false)
    private val lock = FakeWakeLock()
    private val wornWakeLock = WornWakeLock(worn, lock)

    @Test
    fun `never held while the watch is off the wrist`() = runTest {
        val holding = launch { wornWakeLock.holdWhileWorn() }
        runCurrent()

        assertFalse(lock.held)
        assertEquals(0, lock.acquisitions)
        holding.cancel()
    }

    @Test
    fun `held while worn, released the moment the watch comes off`() = runTest {
        val holding = launch { wornWakeLock.holdWhileWorn() }
        runCurrent()

        worn.value = true
        runCurrent()
        assertTrue(lock.held)

        worn.value = false
        runCurrent()
        assertFalse(lock.held)

        worn.value = true
        runCurrent()
        assertTrue(lock.held)
        assertEquals(2, lock.acquisitions)
        holding.cancel()
    }

    @Test
    fun `released when collection stops while still worn`() = runTest {
        worn.value = true
        val holding = launch { wornWakeLock.holdWhileWorn() }
        runCurrent()
        assertTrue(lock.held)

        holding.cancel()
        runCurrent()

        assertFalse(lock.held)
    }
}
