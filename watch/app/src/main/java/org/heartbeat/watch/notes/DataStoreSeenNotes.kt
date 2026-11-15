package org.heartbeat.watch.notes

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringSetPreferencesKey
import kotlinx.coroutines.flow.first

/** [SeenNotesStore] in DataStore, so a note announced before a restart or reboot does not buzz again. */
class DataStoreSeenNotes(private val dataStore: DataStore<Preferences>) : SeenNotesStore {
    override suspend fun load(): Set<String> = dataStore.data.first()[SEEN].orEmpty()

    override suspend fun save(noteIds: Set<String>) {
        dataStore.edit { it[SEEN] = noteIds }
    }

    private companion object {
        val SEEN = stringSetPreferencesKey("announced_note_ids")
    }
}
