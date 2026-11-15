package org.heartbeat.watch.points

import kotlinx.coroutines.test.runTest
import org.heartbeat.watch.DAY0
import org.heartbeat.watch.badge
import org.heartbeat.watch.domain.Badge
import org.heartbeat.watch.domain.ConnectionFailure
import org.heartbeat.watch.domain.PointsSummary
import org.heartbeat.watch.domain.ServerResult
import org.heartbeat.watch.pointsSummary
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BadgeArrivalsTest {
    @Test
    fun `only earned badges not announced before are announced, in the server's order`() {
        val summary = pointsSummary(badges = listOf(badge("b", earnedOn = DAY0), badge("never"), badge("a", earnedOn = DAY0), badge("seen", DAY0)))

        val record = BadgeRecord(knownAstronauts = setOf("a1"), announced = setOf("a1/seen"))

        assertEquals(listOf("b", "a"), BadgeArrivals.toAnnounce(summary, record).map(Badge::id))
    }

    @Test
    fun `on the first points for an astronaut, badges earned before that day are not new, one earned that day is`() {
        val summary = pointsSummary(badges = listOf(badge("old", earnedOn = DAY0.minusDays(3)), badge("today", earnedOn = DAY0)))

        val record = BadgeArrivals.afterFirstSight(summary, BadgeRecord())

        assertEquals(setOf("a1"), record.knownAstronauts)
        assertEquals(setOf("a1/old"), record.announced)
        assertEquals(listOf("today"), BadgeArrivals.toAnnounce(summary, record).map(Badge::id))
    }

    @Test
    fun `later points change nothing about what is already known`() {
        val summary = pointsSummary(badges = listOf(badge("old", earnedOn = DAY0.minusDays(3))))
        val known = BadgeRecord(knownAstronauts = setOf("a1"))

        assertEquals(known, BadgeArrivals.afterFirstSight(summary, known))
        assertEquals(listOf("old"), BadgeArrivals.toAnnounce(summary, known).map(Badge::id))
    }

    @Test
    fun `badges are kept per astronaut`() {
        val record = BadgeRecord(knownAstronauts = setOf("a1", "a2"), announced = setOf("a1/boneGuardian"))
        val forA2 = pointsSummary(astronautId = "a2", badges = listOf(badge("boneGuardian", earnedOn = DAY0)))

        assertEquals(listOf("boneGuardian"), BadgeArrivals.toAnnounce(forA2, record).map(Badge::id))
    }
}

class PointsTrackerTest {
    private var answer: ServerResult<PointsSummary> = ServerResult.Found(pointsSummary(totalPoints = 1240, streakDays = 9))
    private var astronaut = "a1"
    private var measuring = false
    private val store = MemoryBadgeStore()
    private val announcer = RecordingBadgeAnnouncer()
    private val logs = mutableListOf<String>()

    private fun tracker() = PointsTracker({ answer }, store, announcer, { measuring }, { astronaut }, logs::add)

    /** Points whose first sight was earlier, so every earned badge in them counts as new. */
    private fun alreadySeen() {
        store.record = BadgeRecord(knownAstronauts = setOf("a1"))
    }

    private fun earned(vararg ids: String) = ServerResult.Found(pointsSummary(badges = ids.map { badge(it, earnedOn = DAY0) }))

    @Test
    fun `shows nothing until the server has provided points, then what it sent`() = runTest {
        val tracker = tracker()
        assertNull(tracker.summary.value)

        tracker.refresh()

        assertEquals(1240, tracker.summary.value!!.totalPoints)
    }

    @Test
    fun `a dropped connection keeps the last points`() = runTest {
        val tracker = tracker()
        tracker.refresh()

        answer = ServerResult.Failed(ConnectionFailure.Unreachable("Wi-Fi lost"))
        tracker.refresh()

        assertEquals(1240, tracker.summary.value!!.totalPoints)
        assertTrue(logs.isNotEmpty())
    }

    @Test
    fun `another astronaut's points, or an astronaut the server no longer knows, are not shown`() = runTest {
        val tracker = tracker()
        tracker.refresh()

        astronaut = "a2"
        answer = ServerResult.Failed(ConnectionFailure.Unreachable("Wi-Fi lost"))
        tracker.refresh()
        assertNull(tracker.summary.value)

        astronaut = "a1"
        answer = ServerResult.Found(pointsSummary(totalPoints = 10))
        tracker.refresh()
        answer = ServerResult.Failed(ConnectionFailure.UnknownAstronaut("a1"))
        tracker.refresh()
        assertNull(tracker.summary.value)
    }

    @Test
    fun `a new badge buzzes and is announced once, even after a restart`() = runTest {
        alreadySeen()
        answer = earned("boneGuardian")

        tracker().refresh()
        tracker().refresh()

        assertEquals(listOf("boneGuardian" to true), announcer.notified)
        assertEquals(listOf("a1/boneGuardian"), announcer.keys)
        assertEquals(0, announcer.buzzes)
        assertEquals(setOf("a1/boneGuardian"), store.record.announced)
    }

    @Test
    fun `with notifications off nothing happens, and the badge is announced once they are allowed`() = runTest {
        alreadySeen()
        answer = earned("checkInStreak")
        announcer.canPost = false
        val tracker = tracker()

        tracker.refresh()
        assertTrue(announcer.notified.isEmpty())

        announcer.canPost = true
        tracker.refresh()
        tracker.refresh()

        assertEquals(listOf("checkInStreak" to true), announcer.notified)
    }

    @Test
    fun `during a measurement it only buzzes, once, and the notification follows silently afterwards`() = runTest {
        alreadySeen()
        answer = earned("boneGuardian")
        measuring = true
        val tracker = tracker()

        tracker.refresh()
        tracker().refresh()
        assertEquals(1, announcer.buzzes)
        assertTrue(announcer.notified.isEmpty())

        measuring = false
        tracker.refresh()
        tracker.refresh()

        assertEquals(1, announcer.buzzes)
        assertEquals(listOf("boneGuardian" to false), announcer.notified)
        assertTrue(store.record.buzzed.isEmpty())
    }

    @Test
    fun `badges earned before the watch first saw the points are not announced`() = runTest {
        answer = ServerResult.Found(pointsSummary(badges = listOf(badge("boneGuardian", earnedOn = DAY0.minusDays(1)))))

        tracker().refresh()

        assertTrue(announcer.notified.isEmpty())
        assertEquals(setOf("a1/boneGuardian"), store.record.announced)
    }

    @Test
    fun `badges not earned yet are never announced`() = runTest {
        alreadySeen()
        answer = ServerResult.Found(pointsSummary(badges = listOf(badge("checkInStreak"), badge("boneGuardian"))))

        tracker().refresh()

        assertTrue(announcer.notified.isEmpty())
        assertEquals(0, announcer.buzzes)
    }
}

internal class MemoryBadgeStore(var record: BadgeRecord = BadgeRecord()) : AnnouncedBadgesStore {
    override suspend fun load() = record

    override suspend fun save(record: BadgeRecord) {
        this.record = record
    }
}

/** Records announcements; [canPost] false stands for a watch where notifications are not allowed. */
internal class RecordingBadgeAnnouncer(var canPost: Boolean = true) : BadgeAnnouncer {
    /** Each posted notification's badge id and whether it buzzed. */
    val notified = mutableListOf<Pair<String, Boolean>>()
    var buzzes = 0

    /** Each posted notification's key, as the notification id is made from it. */
    val keys = mutableListOf<String>()

    override fun notify(key: String, badge: Badge, buzz: Boolean): Boolean {
        if (canPost) {
            notified += badge.id to buzz
            keys += key
        }
        return canPost
    }

    override fun buzz() {
        buzzes++
    }
}
