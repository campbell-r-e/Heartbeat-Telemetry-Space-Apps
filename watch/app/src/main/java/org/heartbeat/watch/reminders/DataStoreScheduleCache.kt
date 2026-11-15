package org.heartbeat.watch.reminders

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.first
import org.heartbeat.watch.domain.ScheduledTask
import org.heartbeat.watch.network.MalformedResponseException
import org.heartbeat.watch.network.ScheduleJson

/**
 * [ScheduleCache] in DataStore, stored in the same JSON shape the server sends. This deliberately reuses the server
 * contract (unlike the upload queue's own format): if the shape changes, the cached copy is ignored as unreadable and
 * the next refresh, at most 15 minutes later, replaces it.
 */
class DataStoreScheduleCache(
    private val dataStore: DataStore<Preferences>,
    private val log: (String) -> Unit,
) : ScheduleCache {

    override suspend fun load(): List<ScheduledTask>? {
        val json = dataStore.data.first()[SCHEDULE] ?: return null
        return try {
            ScheduleJson.decode(json)
        } catch (e: MalformedResponseException) {
            log("Ignoring an unreadable cached schedule: ${e.message}")
            null
        }
    }

    override suspend fun save(tasks: List<ScheduledTask>) {
        dataStore.edit { it[SCHEDULE] = ScheduleJson.encode(tasks) }
    }

    private companion object {
        val SCHEDULE = stringPreferencesKey("schedule_json")
    }
}
