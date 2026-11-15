package org.heartbeat.watch.domain

import java.time.LocalDate

/**
 * Points, the measurement streak and badges, all worked out by the server from the tasks done since mission day 1
 * (SPEC §7, `GET /api/astronauts/:id/points`). The watch only shows them; it never counts points itself.
 */
data class PointsSummary(
    val astronautId: String,
    /** Today's UTC day, as the server saw it when it worked the summary out. */
    val day: LocalDate,
    /** Points from every task done since mission day 1, today included. */
    val totalPoints: Int,
    /** Consecutive UTC days with every measurement task done. */
    val streakDays: Int,
    /** Every badge, earned or not, in the server's order. */
    val badges: List<Badge>,
)

/** A badge (e.g. "Bone Guardian"); once earned it stays earned, on the UTC day [earnedOn]. */
data class Badge(
    val id: String,
    val name: String,
    /** What earns it, in plain language, e.g. "Exercise goal met 7 days in a row". */
    val description: String,
    val earnedOn: LocalDate?,
) {
    val isEarned: Boolean get() = earnedOn != null
}

/** The server's points for one astronaut; an unknown astronaut is a [ServerResult.Failed]. */
fun interface PointsRepository {
    suspend fun points(astronautId: String): ServerResult<PointsSummary>
}
