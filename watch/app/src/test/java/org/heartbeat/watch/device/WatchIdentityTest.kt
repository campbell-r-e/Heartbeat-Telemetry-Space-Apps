package org.heartbeat.watch.device

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.util.UUID

class WatchIdentityTest {
    @get:Rule
    val folder = TemporaryFolder()

    private fun idFile() = File(folder.root, "watch-id")

    @Test
    fun `makes a random id once and keeps it across restarts`() = runTest {
        var made = 0
        val first = WatchIdentity(idFile()) { made++; "id-$made" }

        val id = first.watchId()
        assertEquals(id, first.watchId())
        assertEquals("a new process reads the same id back", id, WatchIdentity(idFile()) { error("must not make a new id") }.watchId())
        assertEquals(1, made)
    }

    @Test
    fun `the default id is a random UUID, different per install`() = runTest {
        val one = WatchIdentity(idFile()).watchId()
        val other = WatchIdentity(File(folder.root, "other-install")).watchId()

        assertEquals(one, UUID.fromString(one).toString())
        assertNotEquals(one, other)
    }
}
