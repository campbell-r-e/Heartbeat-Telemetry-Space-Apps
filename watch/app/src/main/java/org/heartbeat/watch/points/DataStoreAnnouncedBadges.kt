package org.heartbeat.watch.points

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringSetPreferencesKey
import kotlinx.coroutines.flow.first

/** [AnnouncedBadgesStore] in DataStore, so a badge announced before a restart or reboot does not buzz again. */
class DataStoreAnnouncedBadges(private val dataStore: DataStore<Preferences>) : AnnouncedBadgesStore {
    override suspend fun load(): BadgeRecord {
        val stored = dataStore.data.first()
        return BadgeRecord(
            knownAstronauts = stored[KNOWN_ASTRONAUTS].orEmpty(),
            buzzed = stored[BUZZED].orEmpty(),
            announced = stored[ANNOUNCED].orEmpty(),
        )
    }

    override suspend fun save(record: BadgeRecord) {
        dataStore.edit {
            it[KNOWN_ASTRONAUTS] = record.knownAstronauts
            it[BUZZED] = record.buzzed
            it[ANNOUNCED] = record.announced
        }
    }

    private companion object {
        val KNOWN_ASTRONAUTS = stringSetPreferencesKey("badge_known_astronauts")
        val BUZZED = stringSetPreferencesKey("badge_buzzed")
        val ANNOUNCED = stringSetPreferencesKey("badge_announced")
    }
}
