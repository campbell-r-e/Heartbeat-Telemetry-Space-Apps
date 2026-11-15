package org.heartbeat.watch.reminders

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.heartbeat.watch.domain.ScheduleRepository
import org.heartbeat.watch.domain.ScheduledTask
import org.heartbeat.watch.domain.ServerResult

/** Keeps the last schedule the server sent, so reminders still fire while the server is out of reach. */
interface ScheduleCache {
    suspend fun load(): List<ScheduledTask>?

    suspend fun save(tasks: List<ScheduledTask>)
}

/**
 * The schedule the watch reminds from: the server's latest, falling back to the last good copy.
 * `null` means no schedule was ever received, and then nothing is reminded; no times are hard-coded.
 */
class CachedSchedule(
    private val remote: ScheduleRepository,
    private val cache: ScheduleCache,
    private val log: (String) -> Unit,
) {
    private val _tasks = MutableStateFlow<List<ScheduledTask>?>(null)
    private val loadLock = Mutex()
    private var loaded = false

    val tasks: StateFlow<List<ScheduledTask>?> = _tasks.asStateFlow()

    /** Reads the cached copy once per process. */
    suspend fun ensureLoaded(): List<ScheduledTask>? =
        loadLock.withLock {
            if (!loaded) {
                _tasks.value = _tasks.value ?: cache.load()
                loaded = true
            }
            _tasks.value
        }

    /** Fetches the schedule; returns true when it changed (so the reminders need re-arming). */
    suspend fun refresh(astronautId: String): Boolean {
        ensureLoaded()
        return when (val result = remote.schedule(astronautId)) {
            is ServerResult.Found -> replaceWith(result.value)
            is ServerResult.Failed -> {
                log("Could not load the schedule, keeping the last good one: ${result.failure}")
                false
            }
        }
    }

    private suspend fun replaceWith(tasks: List<ScheduledTask>): Boolean {
        if (tasks == _tasks.value) return false
        cache.save(tasks)
        _tasks.value = tasks
        return true
    }
}
