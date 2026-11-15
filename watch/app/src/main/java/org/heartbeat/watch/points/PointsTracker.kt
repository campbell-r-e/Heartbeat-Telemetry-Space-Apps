package org.heartbeat.watch.points

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.heartbeat.watch.domain.Badge
import org.heartbeat.watch.domain.ConnectionFailure
import org.heartbeat.watch.domain.PointsRepository
import org.heartbeat.watch.domain.PointsSummary
import org.heartbeat.watch.domain.ServerResult

/** What the watch has done about earned badges, kept across restarts so a badge is never announced twice. */
interface AnnouncedBadgesStore {
    suspend fun load(): BadgeRecord

    suspend fun save(record: BadgeRecord)
}

/** Announces a newly earned badge: "Badge earned: <name>" with a short buzz, or the buzz alone. */
interface BadgeAnnouncer {
    /**
     * Posts the notification for the badge stored under [key] ("astronautId/badgeId"), with the buzz when [buzz]; false
     * when it could not be (notifications not allowed).
     */
    fun notify(key: String, badge: Badge, buzz: Boolean): Boolean

    /** The short buzz alone, for a badge earned while a measurement runs. */
    fun buzz()
}

/**
 * Points, streak and badges on the watch (SPEC §7, §9.3). Each [refresh] asks the server for the current astronaut's
 * points, keeps them for the home screen, and announces each newly earned badge once (owner decisions): a short buzz
 * and "Badge earned: <name>". While a measurement runs it only buzzes, and the notification follows, without a second
 * buzz, once the measurement is over. If notifications are not allowed, the badge is announced once they are.
 */
class PointsTracker(
    private val repository: PointsRepository,
    private val badgeStore: AnnouncedBadgesStore,
    private val announcer: BadgeAnnouncer,
    private val measurementRunning: () -> Boolean,
    private val astronautId: suspend () -> String,
    private val log: (String) -> Unit,
) {
    private val _summary = MutableStateFlow<PointsSummary?>(null)

    /** The current astronaut's points, `null` until the server has provided them. */
    val summary: StateFlow<PointsSummary?> = _summary.asStateFlow()

    suspend fun refresh() {
        val id = astronautId()
        when (val fetched = repository.points(id)) {
            is ServerResult.Found -> {
                _summary.value = fetched.value
                announceNewBadges(fetched.value)
            }
            is ServerResult.Failed -> {
                log("Could not load points for $id: ${fetched.failure}")
                if (!keepsLastPoints(id, fetched.failure)) _summary.value = null
            }
        }
    }

    /** A dropped connection keeps the last points on screen; another astronaut's, or one the server no longer knows, go. */
    private fun keepsLastPoints(astronautId: String, failure: ConnectionFailure): Boolean =
        _summary.value?.astronautId == astronautId && failure !is ConnectionFailure.UnknownAstronaut

    private suspend fun announceNewBadges(summary: PointsSummary) {
        val stored = badgeStore.load()
        val known = BadgeArrivals.afterFirstSight(summary, stored)
        val record = BadgeArrivals.toAnnounce(summary, known).fold(known) { soFar, badge ->
            announce(BadgeArrivals.key(summary.astronautId, badge), badge, soFar)
        }
        if (record != stored) badgeStore.save(record)
    }

    private fun announce(key: String, badge: Badge, record: BadgeRecord): BadgeRecord {
        val buzzedAlready = key in record.buzzed
        return when {
            measurementRunning() -> buzzOnce(key, record)
            announcer.notify(key, badge, buzz = !buzzedAlready) -> record.alsoAnnounced(key)
            else -> record
        }
    }

    /** During a measurement: the buzz alone, once per badge; the notification waits for the measurement to end. */
    private fun buzzOnce(key: String, record: BadgeRecord): BadgeRecord {
        if (key in record.buzzed) return record
        announcer.buzz()
        return record.alsoBuzzed(key)
    }
}

/**
 * What the watch has done about each earned badge. Badge keys are "astronautId/badgeId" ([BadgeArrivals.key]), so a
 * watch moved to another astronaut announces that astronaut's badges as their own.
 */
data class BadgeRecord(
    /** Astronauts whose points have reached this watch at least once. */
    val knownAstronauts: Set<String> = emptySet(),
    /** Buzzed for during a measurement; the notification is still to come. */
    val buzzed: Set<String> = emptySet(),
    /** Announced (or already earned when the watch first saw the astronaut's points): never announced again. */
    val announced: Set<String> = emptySet(),
) {
    fun alsoBuzzed(key: String) = copy(buzzed = buzzed + key)

    fun alsoAnnounced(key: String) = copy(buzzed = buzzed - key, announced = announced + key)
}

/** Which badges are new. Pure, so it is unit-tested. */
object BadgeArrivals {
    fun key(astronautId: String, badge: Badge): String = "$astronautId/${badge.id}"

    /**
     * The first time an astronaut's points reach the watch, the badges earned before that UTC day are not new: they are
     * recorded as announced without a buzz. One earned that day is still new. Later summaries change nothing here.
     */
    fun afterFirstSight(summary: PointsSummary, record: BadgeRecord): BadgeRecord {
        if (summary.astronautId in record.knownAstronauts) return record
        val earlier = summary.badges.filter { it.earnedOn?.isBefore(summary.day) == true }.map { key(summary.astronautId, it) }
        return record.copy(knownAstronauts = record.knownAstronauts + summary.astronautId, announced = record.announced + earlier)
    }

    /** Earned badges not announced yet, in the server's order. */
    fun toAnnounce(summary: PointsSummary, record: BadgeRecord): List<Badge> =
        summary.badges.filter { it.isEarned && key(summary.astronautId, it) !in record.announced }
}
