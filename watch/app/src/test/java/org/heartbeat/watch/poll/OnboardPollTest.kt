package org.heartbeat.watch.poll

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.heartbeat.watch.domain.Badge
import org.heartbeat.watch.domain.ConnectionFailure
import org.heartbeat.watch.domain.ServerResult
import org.heartbeat.watch.points.AnnouncedBadgesStore
import org.heartbeat.watch.points.BadgeAnnouncer
import org.heartbeat.watch.points.BadgeRecord
import org.heartbeat.watch.points.PointsTracker
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import kotlin.time.Duration.Companion.seconds

@OptIn(ExperimentalCoroutinesApi::class)
class OnboardPollTest {
    /** "notes@0s", "points@0s", ... : which step ran, at what virtual time. */
    private val calls = mutableListOf<String>()
    private val logs = mutableListOf<String>()

    private fun TestScope.step(name: String, action: suspend () -> Unit = {}) =
        PollStep(name) {
            calls += "$name@${currentTime / 1000}s"
            action()
        }

    @Test
    fun `each round checks the notes, then the points, then waits 15 s`() = runTest {
        val poll = OnboardPoll(listOf(step("notes"), step("points")), { message, _ -> logs += message })
        backgroundScope.launch { poll.run() }

        runCurrent()
        assertEquals(listOf("notes@0s", "points@0s"), calls)

        advanceTimeBy(14.seconds)
        runCurrent()
        assertEquals("no second round before 15 s", 2, calls.size)

        advanceTimeBy(1.seconds)
        runCurrent()
        assertEquals(listOf("notes@0s", "points@0s", "notes@15s", "points@15s"), calls)
    }

    @Test
    fun `the pause starts once the round's requests are done`() = runTest {
        val slowPoints = step("points") { delay(10.seconds) }
        backgroundScope.launch { OnboardPoll(listOf(step("notes"), slowPoints), { _, _ -> }).run() }

        advanceTimeBy(25.seconds)
        runCurrent()

        assertEquals(listOf("notes@0s", "points@0s", "notes@25s", "points@25s"), calls)
    }

    @Test
    fun `a step that throws is logged, and the notes are still checked every round`() = runTest {
        val brokenPoints = step("points") { throw IOException("badge store unreadable") }
        backgroundScope.launch { OnboardPoll(listOf(step("notes"), brokenPoints), { message, _ -> logs += message }).run() }

        advanceTimeBy(30.seconds)
        runCurrent()

        assertEquals(listOf("notes@0s", "notes@15s", "notes@30s"), calls.filter { it.startsWith("notes") })
        assertEquals(3, logs.size)
        assertTrue(logs.first().contains("points"))
    }

    @Test
    fun `a points request that fails never skips the note check`() = runTest {
        val tracker = PointsTracker(
            { ServerResult.Failed(ConnectionFailure.Unreachable("Wi-Fi lost")) },
            NoBadges, NoAnnouncer, { false }, { "a1" }, logs::add,
        )
        val points = step("points") { tracker.refresh() }
        backgroundScope.launch { OnboardPoll(listOf(step("notes"), points), { message, _ -> logs += message }).run() }

        advanceTimeBy(15.seconds)
        runCurrent()

        assertEquals(listOf("notes@0s", "points@0s", "notes@15s", "points@15s"), calls)
    }

    @Test(expected = CancellationException::class)
    fun `cancellation is not swallowed`() = runTest {
        OnboardPoll(listOf(PollStep("notes") { throw CancellationException("stopped") }), { _, _ -> }).runRound()
    }

    private object NoBadges : AnnouncedBadgesStore {
        override suspend fun load() = BadgeRecord()

        override suspend fun save(record: BadgeRecord) = Unit
    }

    private object NoAnnouncer : BadgeAnnouncer {
        override fun notify(key: String, badge: Badge, buzz: Boolean) = true

        override fun buzz() = Unit
    }
}
