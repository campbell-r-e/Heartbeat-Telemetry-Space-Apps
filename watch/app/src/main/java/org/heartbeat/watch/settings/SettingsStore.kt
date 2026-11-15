package org.heartbeat.watch.settings

import kotlinx.coroutines.flow.Flow

/** Persists the connection settings entered on the watch. */
interface SettingsStore {
    /** The saved settings, falling back to the build-time defaults for anything never entered. */
    val settings: Flow<ConnectionSettings>

    /** Validates and saves one field; returns the validation error instead of saving when the value is refused. */
    suspend fun save(field: SettingField, value: String): ValidationError?
}
