package org.heartbeat.watch.domain

import java.time.Instant

/**
 * Status levels decided by the server's rules engine (SPEC §6). The watch never computes these;
 * it only displays what the server says, so the watch and the dashboard always agree.
 */
enum class Status { NORMAL, WATCH, ALERT }

/** The six areas on the home screen, in clockwise order from the top. */
enum class Area { VITALS, RADIATION, GRAVITY, CABIN, FOOD, MIND }

/** What the server's rules engine currently says, per area and per metric. Areas it could not rate are absent. */
data class StatusSnapshot(
    val areas: Map<Area, Status>,
    val metrics: Map<Metric, Status>,
    /** Metrics whose newest reading has expired; they get no status and say "no recent data". */
    val noRecentData: Set<Metric> = emptySet(),
) {
    val alertCount: Int get() = areas.values.count { it == Status.ALERT }
    val watchCount: Int get() = areas.values.count { it == Status.WATCH }
}

/** The newest HRV the server derived from the watch's beat intervals (SPEC §5.7). */
data class DerivedHrv(val rmssdMs: Double, val windowStart: Instant)

/** Today's exercise minutes against the daily goal (SPEC §5.4); [minutes] is `null` while the age is unknown. */
data class ExerciseToday(val minutes: Int?, val goalMinutes: Int?, val ageKnown: Boolean)

/** Values the server derives with its rules (Phase 2) that the watch only displays, never computes. */
data class DerivedValues(
    val hrv: DerivedHrv?,
    val exercise: ExerciseToday?,
    /** The last 24 hours' radiation dose as a multiple of the previous 7-day average, as the alert rule uses it. */
    val radiationTimesNormal: Double?,
) {
    companion object {
        val NONE_YET = DerivedValues(hrv = null, exercise = null, radiationTimesNormal = null)
    }
}

/** `GET /api/astronauts/:id/status`: the rules engine's verdict and the values it derived. */
data class StatusReport(val statuses: StatusSnapshot?, val derived: DerivedValues) {
    companion object {
        /** What the watch shows while the server has no status endpoint (404): everything neutral. */
        val NOT_AVAILABLE = StatusReport(statuses = null, derived = DerivedValues.NONE_YET)
    }
}
