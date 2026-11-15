package org.heartbeat.watch.network

import org.heartbeat.watch.domain.Area
import org.heartbeat.watch.domain.DerivedHrv
import org.heartbeat.watch.domain.ExerciseToday
import org.heartbeat.watch.domain.Metric
import org.heartbeat.watch.domain.Status
import org.heartbeat.watch.ui.model.HomePresenter
import org.heartbeat.watch.ui.model.StatusSummaryUi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test
import java.time.Instant

/**
 * Fixtures follow the shared `AstronautStatus` type on main (9c5d57a, SPEC §10); `server-9c5d57a.json` is a reply
 * from the live server running that commit.
 */
class StatusJsonTest {
    private fun fixture(name: String): String =
        checkNotNull(javaClass.getResource("/status/$name")) { "missing fixture $name" }.readText()

    @Test
    fun `reads area and metric statuses, leaving unrated areas neutral`() {
        val statuses = StatusJson.decode(fixture("full.json")).statuses!!

        assertEquals(mapOf(Area.VITALS to Status.NORMAL, Area.RADIATION to Status.WATCH, Area.CABIN to Status.NORMAL), statuses.areas)
        assertEquals(mapOf(Metric.HEART_RATE to Status.NORMAL, Metric.RADIATION_DOSE_RATE to Status.WATCH), statuses.metrics)
        assertEquals(setOf(Metric.SKIN_TEMP), statuses.noRecentData)
    }

    @Test
    fun `reads the derived HRV, exercise minutes and radiation multiple`() {
        val derived = StatusJson.decode(fixture("full.json")).derived

        assertEquals(DerivedHrv(41.6, Instant.parse("2026-11-14T20:20:00Z")), derived.hrv)
        assertEquals(ExerciseToday(minutes = 45, goalMinutes = 120, ageKnown = true), derived.exercise)
        assertEquals(1.3, derived.radiationTimesNormal!!, 0.0)
    }

    @Test
    fun `nothing rated yet is neutral, with no derived values`() {
        val report = StatusJson.decode(fixture("nothing-rated.json"))

        assertEquals(StatusSummaryUi.None, HomePresenter.summary(report.statuses))
        assertNull(report.derived.hrv)
        assertNull(report.derived.radiationTimesNormal)
        assertEquals(ExerciseToday(minutes = null, goalMinutes = null, ageKnown = false), report.derived.exercise)
    }

    @Test
    fun `all rated areas normal reads as all normal, and the nutrition area is the watch's Food dot`() {
        val body = fixture("nothing-rated.json")
            .replace("\"vitals\",\n      \"status\": null", "\"vitals\",\n      \"status\": \"normal\"")
            .replace("\"nutrition\",\n      \"status\": null", "\"nutrition\",\n      \"status\": \"normal\"")

        val statuses = StatusJson.decode(body).statuses!!

        assertEquals(mapOf(Area.VITALS to Status.NORMAL, Area.FOOD to Status.NORMAL), statuses.areas)
        assertEquals(StatusSummaryUi.AllNormal, HomePresenter.summary(statuses))
    }

    @Test
    fun `reads a reply from the live server on main`() {
        val report = StatusJson.decode(fixture("server-9c5d57a.json"))
        val statuses = report.statuses!!

        assertEquals(
            mapOf(Area.VITALS to Status.NORMAL, Area.RADIATION to Status.NORMAL, Area.GRAVITY to Status.WATCH, Area.CABIN to Status.NORMAL),
            statuses.areas,
        )
        assertEquals(setOf(Metric.HEART_RATE, Metric.SKIN_TEMP, Metric.HRV, Metric.PRESSURE), statuses.noRecentData)
        assertEquals(ExerciseToday(minutes = 4, goalMinutes = 120, ageKnown = true), report.derived.exercise)
        assertEquals(1.0117, report.derived.radiationTimesNormal!!, 1e-4)
    }

    @Test
    fun `a reply that breaks the contract is refused as a whole, not half-trusted`() {
        val full = fixture("full.json")
        val broken = listOf(
            full.replace("\"status\": \"watch\"", "\"status\": \"amber\""),
            full.replace("\"heartRate\",\n      \"status\": \"normal\"", "\"heartRate\",\n      \"status\": null"),
            full.replace("\"goalMinutes\": 120", "\"goalMinutes\": \"lots\""),
            full.replace("\"at\": \"2026-11-14T20:20:00.000Z\"", "\"at\": 5"),
            full.replace(""""noRecentData"""", """"stale""""),
            "[]",
        )

        broken.forEach { body -> assertThrows(MalformedResponseException::class.java) { StatusJson.decode(body) } }
    }
}
