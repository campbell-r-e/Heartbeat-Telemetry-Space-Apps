package org.heartbeat.watch.ui.model

import org.heartbeat.watch.domain.Area
import org.heartbeat.watch.domain.PointsSummary
import org.heartbeat.watch.domain.StatusSnapshot
import org.heartbeat.watch.time.UtcTime
import java.time.ZonedDateTime
import java.util.Locale

/** The home screen: six area dots, plus counts and points only once the server provides them. */
object HomePresenter {
    private val LABELS = mapOf(
        Area.VITALS to "Vitals",
        Area.RADIATION to "Radiation",
        Area.GRAVITY to "Gravity",
        Area.CABIN to "Cabin",
        Area.FOOD to "Food",
        Area.MIND to "Mind",
    )

    /**
     * [points] show only when they are [astronautId]'s, so after the id changes on the Connection screen the line is
     * gone at once rather than showing the previous astronaut's points until the next poll (pending owner review).
     */
    fun home(statuses: StatusSnapshot?, points: PointsSummary?, astronautId: String, notesPill: String? = null): HomeUi =
        HomeUi(
            dots = Area.entries.map { AreaDotUi(it, LABELS.getValue(it), statuses?.areas?.get(it)) },
            summary = summary(statuses),
            pointsLine = points?.takeIf { it.astronautId == astronautId }?.let(::pointsLine),
            notesPill = notesPill,
        )

    /** Neutral before any statuses exist; "All normal" only when the server has statuses and none is yellow or red. */
    fun summary(statuses: StatusSnapshot?): StatusSummaryUi =
        when {
            statuses == null || statuses.areas.isEmpty() -> StatusSummaryUi.None
            statuses.alertCount == 0 && statuses.watchCount == 0 -> StatusSummaryUi.AllNormal
            else -> StatusSummaryUi.Counts(alerts = statuses.alertCount, watches = statuses.watchCount)
        }

    /**
     * "1,240 pts · 9d": the points since mission day 1 and `streak.days` as the server gives them; whether today is in
     * the streak yet (`includesToday`) is not shown (pending owner review).
     */
    private fun pointsLine(points: PointsSummary): String =
        String.format(Locale.US, "%,d pts · %dd", points.totalPoints, points.streakDays)
}

object HeaderPresenter {
    private const val PERCENT_UNKNOWN = "--%"

    fun header(now: ZonedDateTime, batteryPercent: Int?): HeaderUi {
        val battery = batteryPercent?.let { "$it%" } ?: PERCENT_UNKNOWN
        return HeaderUi(time = UtcTime.time(now.toInstant()), dayAndBattery = "${UtcTime.day(now.toInstant())} · $battery")
    }
}
