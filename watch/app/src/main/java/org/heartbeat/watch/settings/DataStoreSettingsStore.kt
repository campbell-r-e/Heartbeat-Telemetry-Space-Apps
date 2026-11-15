package org.heartbeat.watch.settings

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/** [SettingsStore] backed by Jetpack DataStore; [defaults] come from build config (watch/local.properties). */
class DataStoreSettingsStore(
    private val dataStore: DataStore<Preferences>,
    private val defaults: ConnectionSettings,
) : SettingsStore {

    override val settings: Flow<ConnectionSettings> =
        dataStore.data.map { preferences ->
            ConnectionSettings(
                serverUrl = preferences[SERVER_URL] ?: defaults.serverUrl,
                token = preferences[TOKEN] ?: defaults.token,
                astronautId = preferences[ASTRONAUT_ID] ?: defaults.astronautId,
            )
        }

    override suspend fun save(field: SettingField, value: String): ValidationError? =
        when (val checked = SettingsValidator.check(field, value)) {
            is Checked.Invalid -> checked.error
            is Checked.Valid -> {
                dataStore.edit { it[keyFor(field)] = checked.value }
                null
            }
        }

    private fun keyFor(field: SettingField): Preferences.Key<String> =
        when (field) {
            SettingField.SERVER_URL -> SERVER_URL
            SettingField.TOKEN -> TOKEN
            SettingField.ASTRONAUT_ID -> ASTRONAUT_ID
        }

    private companion object {
        val SERVER_URL = stringPreferencesKey("server_url")
        val TOKEN = stringPreferencesKey("token")
        val ASTRONAUT_ID = stringPreferencesKey("astronaut_id")
    }
}
