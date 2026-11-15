package org.heartbeat.watch.ui

import org.heartbeat.watch.time.UtcTime
import org.heartbeat.watch.ui.model.HeaderPresenter
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant
import java.time.ZonedDateTime

class UtcTimeTest {
    @Test
    fun `every time is shown in UTC and labeled`() {
        assertEquals("19:43 UTC", UtcTime.time(Instant.parse("2026-11-14T19:43:59Z")))
    }

    @Test
    fun `the day is the UTC day`() {
        assertEquals("Sun 15", UtcTime.day(Instant.parse("2026-11-15T01:00:00Z")))
    }

    @Test
    fun `the header clock and day are UTC whatever zone the watch is in`() {
        val newYorkEvening = ZonedDateTime.parse("2026-11-14T20:43-05:00[America/New_York]")

        val header = HeaderPresenter.header(newYorkEvening, batteryPercent = 36)

        assertEquals("01:43 UTC", header.time)
        assertEquals("Sun 15 · 36%", header.dayAndBattery)
        assertEquals("Sun 15 · --%", HeaderPresenter.header(newYorkEvening, batteryPercent = null).dayAndBattery)
    }
}
