package org.heartbeat.watch.reminders

import kotlinx.coroutines.test.runTest
import org.heartbeat.watch.domain.ConnectionFailure
import org.heartbeat.watch.domain.ScheduledTask
import org.heartbeat.watch.domain.ServerResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CachedScheduleTest {

    private class MemoryCache(var stored: List<ScheduledTask>? = null) : ScheduleCache {
        override suspend fun load() = stored

        override suspend fun save(tasks: List<ScheduledTask>) {
            stored = tasks
        }
    }

    @Test
    fun `nothing is scheduled until a schedule has been received`() = runTest {
        val schedule = CachedSchedule({ ServerResult.Failed(ConnectionFailure.Unreachable("down")) }, MemoryCache()) {}

        assertFalse(schedule.refresh("a1"))
        assertNull(schedule.tasks.value)
    }

    @Test
    fun `keeps the last good schedule when the server is out of reach`() = runTest {
        val cache = MemoryCache()
        var answer: ServerResult<List<ScheduledTask>> = ServerResult.Found(SCHEDULE)
        val schedule = CachedSchedule({ answer }, cache) {}

        assertTrue(schedule.refresh("a1"))
        answer = ServerResult.Failed(ConnectionFailure.Unreachable("down"))
        assertFalse(schedule.refresh("a1"))

        assertEquals(SCHEDULE, schedule.tasks.value)
        assertEquals(SCHEDULE, cache.stored)
    }

    @Test
    fun `starts from the cached schedule after a restart`() = runTest {
        val schedule = CachedSchedule({ ServerResult.Failed(ConnectionFailure.MissingToken) }, MemoryCache(SCHEDULE)) {}

        assertEquals(SCHEDULE, schedule.ensureLoaded())
    }

    @Test
    fun `an unchanged schedule does not re-arm the alarms`() = runTest {
        val schedule = CachedSchedule({ ServerResult.Found(SCHEDULE) }, MemoryCache()) {}

        assertTrue(schedule.refresh("a1"))
        assertFalse(schedule.refresh("a1"))
    }
}
