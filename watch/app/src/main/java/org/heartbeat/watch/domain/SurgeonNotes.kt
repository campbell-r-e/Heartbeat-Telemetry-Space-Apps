package org.heartbeat.watch.domain

import java.time.Instant

/** A note from the flight surgeon that has reached the spacecraft through the relay (SPEC §9.3). */
data class SurgeonNote(
    val noteId: String,
    val text: String,
    /** The alert the note is about, when the surgeon wrote it from one. */
    val alertId: String?,
    val sentAt: Instant,
    /** When the astronaut marked it read; `null` while unread. */
    val readAt: Instant?,
)

/**
 * The onboard side of the relay: `GET /api/astronauts/:id/notes`, the read receipt
 * (`POST /api/astronauts/:id/notes/:noteId/read`), and the alerts sent to the ground, for a note's "about" line.
 */
interface SurgeonNotesRepository {
    suspend fun notes(astronautId: String): ServerResult<List<SurgeonNote>>

    /** Sends the read receipt to the ground; answers when the note was marked read. */
    suspend fun markRead(astronautId: String, noteId: String): ReceiptResult

    /** The title of each alert sent to the ground, by alert id (`GET /api/astronauts/:id/relayed-alerts`). */
    suspend fun alertTitles(astronautId: String): ServerResult<Map<String, String>>
}

/** The answer to a read receipt (`POST /api/astronauts/:id/notes/:noteId/read`). */
sealed interface ReceiptResult {
    /** The server marked the note read at [readAt]. */
    data class Sent(val readAt: Instant) : ReceiptResult

    /** The server does not have the note (404 `unknown_note`); sending the receipt again would fail the same way. */
    data object UnknownNote : ReceiptResult

    /** The receipt did not go through; sending it again can work. */
    data class Failed(val failure: ConnectionFailure) : ReceiptResult
}
