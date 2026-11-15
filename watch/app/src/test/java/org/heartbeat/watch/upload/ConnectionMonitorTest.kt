package org.heartbeat.watch.upload

import org.heartbeat.watch.T0
import org.heartbeat.watch.domain.ConnectionFailure
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class ConnectionMonitorTest {
    private val monitor = ConnectionMonitor()

    @Test
    fun `a delivered flush records the upload and marks the server reached`() {
        monitor.recordFlush(T0, FlushReport(deliveredReadings = 12, discardedReadings = 0, failure = null))

        assertEquals(UploadRecord(T0, 12), monitor.status.value.lastUpload)
        assertEquals(ConnectionOutcome.Reached(T0), monitor.status.value.lastOutcome)
    }

    @Test
    fun `an empty flush changes nothing`() {
        monitor.recordFlush(T0, FlushReport.NOTHING_TO_SEND)

        assertNull(monitor.status.value.lastOutcome)
    }

    @Test
    fun `a failed test is recorded and ends testing`() {
        monitor.recordTestStarted()
        monitor.recordTestResult(T0, ConnectionFailure.TokenRefused)

        assertEquals(ConnectionOutcome.Failed(T0, ConnectionFailure.TokenRefused), monitor.status.value.lastOutcome)
        assertFalse(monitor.status.value.testing)
    }
}
