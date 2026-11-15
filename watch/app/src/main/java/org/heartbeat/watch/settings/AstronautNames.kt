package org.heartbeat.watch.settings

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.heartbeat.watch.domain.AstronautDirectory
import org.heartbeat.watch.domain.ServerResult

/** Keeps the last crew names the server sent. */
interface AstronautNameCache {
    suspend fun load(): Map<String, String>

    suspend fun save(names: Map<String, String>)
}

/** Crew names by astronaut id: the server's latest list, or the last good copy when the server is out of reach. */
class AstronautNames(
    private val directory: AstronautDirectory,
    private val cache: AstronautNameCache,
    private val log: (String) -> Unit,
) {
    private val _names = MutableStateFlow<Map<String, String>>(emptyMap())

    val names: StateFlow<Map<String, String>> = _names.asStateFlow()

    suspend fun loadCached() {
        if (_names.value.isEmpty()) _names.value = cache.load()
    }

    suspend fun refresh() {
        when (val result = directory.astronauts()) {
            is ServerResult.Found -> {
                val names = result.value.associate { it.id to it.name }
                if (names != _names.value) {
                    cache.save(names)
                    _names.value = names
                }
            }
            is ServerResult.Failed -> log("Could not load crew names, keeping the last good ones: ${result.failure}")
        }
    }

    companion object {
        /** "a1 · Astronaut 1" when the name is known, otherwise just the id. */
        fun label(astronautId: String, names: Map<String, String>): String =
            names[astronautId]?.let { "$astronautId · $it" } ?: astronautId
    }
}
