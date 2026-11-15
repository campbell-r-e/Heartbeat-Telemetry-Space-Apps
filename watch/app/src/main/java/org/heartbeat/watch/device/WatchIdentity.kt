package org.heartbeat.watch.device

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID

/**
 * This install's watch id: a random UUID made the first time it is needed and kept in [file], so it stays the same
 * across restarts and reboots and changes only if the app is reinstalled. It is never derived from the hardware
 * (serial number or MAC address).
 */
class WatchIdentity(
    private val file: File,
    private val newId: () -> String = { UUID.randomUUID().toString() },
) {
    private val mutex = Mutex()
    private var cached: String? = null

    suspend fun watchId(): String =
        mutex.withLock {
            cached ?: withContext(Dispatchers.IO) { stored() ?: newId().also(::store) }.also { cached = it }
        }

    private fun stored(): String? = file.takeIf(File::exists)?.readText()?.trim()?.takeIf(String::isNotEmpty)

    /** Written to a side file and renamed, so a crash mid-write never leaves a half-written id. */
    private fun store(id: String) {
        val partial = File(file.path + PARTIAL_SUFFIX)
        partial.writeText(id)
        check(partial.renameTo(file)) { "Could not save the watch id to $file" }
    }

    private companion object {
        const val PARTIAL_SUFFIX = ".partial"
    }
}
