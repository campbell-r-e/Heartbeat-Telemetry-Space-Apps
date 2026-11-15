package org.heartbeat.watch.network

import org.heartbeat.watch.T0
import org.heartbeat.watch.domain.DeviceInfo
import org.heartbeat.watch.domain.Metric
import org.heartbeat.watch.domain.Reading
import org.heartbeat.watch.domain.ReadingSource
import org.heartbeat.watch.domain.ReadingValue
import org.heartbeat.watch.domain.UploadResult
import org.heartbeat.watch.reading
import org.junit.Assert.assertEquals
import org.junit.Test

private val DEVICE = DeviceInfo("6f1c2b0e-4d8a-4c3e-9b1f-2a7d5e8c0f13", batteryPct = 36)

class ReadingsJsonTest {

    @Test
    fun `encodes a reading in the server contract`() {
        val json = ReadingsJson.encodeUpload("a1", listOf(reading(Metric.HEART_RATE, 72.0, T0)), DEVICE)

        assertEquals(
            """{"readings":[{"astronautId":"a1","metric":"heartRate","value":72.0,"unit":"bpm",""" +
                """"takenAt":"2026-11-14T14:00:00Z","source":"watch"}],""" +
                """"device":{"watchId":"6f1c2b0e-4d8a-4c3e-9b1f-2a7d5e8c0f13","batteryPct":36}}""",
            json,
        )
    }

    @Test
    fun `an unknown battery level is sent as null`() {
        val json = ReadingsJson.encodeUpload("a1", emptyList(), DEVICE.copy(batteryPct = null))

        assertEquals("""{"readings":[],"device":{"watchId":"6f1c2b0e-4d8a-4c3e-9b1f-2a7d5e8c0f13","batteryPct":null}}""", json)
    }

    @Test
    fun `encodes an ECG waveform as an array of numbers`() {
        val ecg = Reading(Metric.ECG, ReadingValue.Series(listOf(0.1, -0.2)), T0, ReadingSource.WATCH)

        val json = ReadingsJson.encodeUpload("a1", listOf(ecg), DEVICE)

        assert(json.contains(""""metric":"ecg","value":[0.1,-0.2],"unit":"mV"""")) { json }
    }

    @Test
    fun `decodes latest readings and skips metrics the watch does not know`() {
        val body = """[
            {"metric":"co2","value":2.443,"unit":"mmHg","takenAt":"2026-11-14T18:02:39.261Z","source":"osdr"},
            {"metric":"steps","value":6,"unit":"steps/h","takenAt":"2026-11-14T06:00:00Z","source":"seed"}
        ]"""

        val readings = ReadingsJson.decodeLatest(body)

        assertEquals(
            listOf(Reading(Metric.CO2, ReadingValue.Scalar(2.443), java.time.Instant.parse("2026-11-14T18:02:39.261Z"), ReadingSource("osdr"))),
            readings,
        )
    }

    @Test
    fun `decodes upload counts`() {
        assertEquals(UploadResult.Accepted(3, 1), ReadingsJson.decodeUploadCounts("""{"accepted":3,"duplicates":1}"""))
    }

    @Test(expected = MalformedResponseException::class)
    fun `invalid JSON is reported as a malformed response`() {
        ReadingsJson.decodeLatest("<html>")
    }
}
