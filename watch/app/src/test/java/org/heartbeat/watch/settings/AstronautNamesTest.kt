package org.heartbeat.watch.settings

import kotlinx.coroutines.test.runTest
import org.heartbeat.watch.domain.Astronaut
import org.heartbeat.watch.domain.ConnectionFailure
import org.heartbeat.watch.domain.ServerResult
import org.junit.Assert.assertEquals
import org.junit.Test

class AstronautNamesTest {

    private class MemoryCache(var stored: Map<String, String> = emptyMap()) : AstronautNameCache {
        override suspend fun load() = stored

        override suspend fun save(names: Map<String, String>) {
            stored = names
        }
    }

    @Test
    fun `shows the name next to the id when known, else just the id`() {
        assertEquals("a1 · Astronaut 1", AstronautNames.label("a1", mapOf("a1" to "Astronaut 1")))
        assertEquals("a1", AstronautNames.label("a1", emptyMap()))
    }

    @Test
    fun `caches the server's names and keeps them when the server is out of reach`() = runTest {
        val cache = MemoryCache()
        var answer: ServerResult<List<Astronaut>> = ServerResult.Found(listOf(Astronaut("a1", "Astronaut 1")))
        val names = AstronautNames({ answer }, cache) {}

        names.refresh()
        answer = ServerResult.Failed(ConnectionFailure.Unreachable("down"))
        names.refresh()

        assertEquals(mapOf("a1" to "Astronaut 1"), names.names.value)
        assertEquals(mapOf("a1" to "Astronaut 1"), cache.stored)
    }

    @Test
    fun `starts from the cached names`() = runTest {
        val names = AstronautNames({ ServerResult.Failed(ConnectionFailure.MissingToken) }, MemoryCache(mapOf("a1" to "Ana"))) {}

        names.loadCached()

        assertEquals("a1 · Ana", AstronautNames.label("a1", names.names.value))
    }
}
