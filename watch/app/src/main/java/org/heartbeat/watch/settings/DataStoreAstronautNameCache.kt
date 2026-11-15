package org.heartbeat.watch.settings

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** [AstronautNameCache] in DataStore as a small JSON object of id → name. */
class DataStoreAstronautNameCache(
    private val dataStore: DataStore<Preferences>,
    private val log: (String) -> Unit,
) : AstronautNameCache {

    override suspend fun load(): Map<String, String> {
        val json = dataStore.data.first()[NAMES] ?: return emptyMap()
        return try {
            Json.parseToJsonElement(json).jsonObject.mapValues { (_, name) -> name.jsonPrimitive.content }
        } catch (e: IllegalArgumentException) {
            log("Ignoring unreadable cached crew names: ${e.message}")
            emptyMap()
        }
    }

    override suspend fun save(names: Map<String, String>) {
        val json = JsonObject(names.mapValues { (_, name) -> JsonPrimitive(name) }).toString()
        dataStore.edit { it[NAMES] = json }
    }

    private companion object {
        val NAMES = stringPreferencesKey("astronaut_names_json")
    }
}
