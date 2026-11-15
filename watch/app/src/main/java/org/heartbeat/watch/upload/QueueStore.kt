package org.heartbeat.watch.upload

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.heartbeat.watch.domain.Reading
import java.io.File
import java.io.IOException

/** Where the upload queue keeps its readings so they survive an app restart or a reboot. */
interface QueueStore {
    suspend fun loadAll(): List<Reading>

    /** Adds readings at the end; called for every reading recorded, so it must be cheap. */
    suspend fun append(readings: List<Reading>)

    /** Replaces everything stored, after readings were delivered or dropped. */
    suspend fun replaceAll(readings: List<Reading>)

    /** Keeps readings in memory only (tests, or when persistence is not wanted). */
    object InMemoryOnly : QueueStore {
        override suspend fun loadAll(): List<Reading> = emptyList()

        override suspend fun append(readings: List<Reading>) = Unit

        override suspend fun replaceAll(readings: List<Reading>) = Unit
    }
}

/**
 * [QueueStore] as a file of JSON lines, one reading per line. Appends are cheap; a replace writes a temporary
 * file and renames it over the old one, so a crash mid-write never loses the stored queue. A failed write is
 * reported to [onError] and the queue carries on in memory.
 */
class FileQueueStore(
    private val file: File,
    private val onError: (String, Exception) -> Unit,
) : QueueStore {

    override suspend fun loadAll(): List<Reading> =
        io("read the stored queue", emptyList()) {
            if (!file.exists()) return@io emptyList()
            file.useLines { lines -> lines.filter(String::isNotBlank).mapNotNull(::decodeLine).toList() }
        }

    override suspend fun append(readings: List<Reading>) {
        if (readings.isEmpty()) return
        io("append to the stored queue", Unit) { file.appendText(lines(readings)) }
    }

    override suspend fun replaceAll(readings: List<Reading>) {
        io("rewrite the stored queue", Unit) {
            val temporary = File(file.parentFile, "${file.name}.tmp")
            temporary.writeText(lines(readings))
            if (!temporary.renameTo(file)) throw IOException("could not replace ${file.name}")
        }
    }

    private fun lines(readings: List<Reading>): String =
        readings.joinToString(separator = "") { StoredReadingFormat.encode(it) + "\n" }

    /** A line that cannot be read (for example cut short by a crash) is skipped, not fatal. */
    private fun decodeLine(line: String): Reading? =
        try {
            StoredReadingFormat.decode(line)
        } catch (e: UnreadableStoredReadingException) {
            onError("Skipping an unreadable stored reading", e)
            null
        }

    private suspend fun <T> io(action: String, fallback: T, block: () -> T): T =
        withContext(Dispatchers.IO) {
            try {
                block()
            } catch (e: IOException) {
                onError("Could not $action", e)
                fallback
            }
        }
}
