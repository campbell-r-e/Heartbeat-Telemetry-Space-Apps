package org.heartbeat.watch.notes

import org.heartbeat.watch.T0
import org.heartbeat.watch.domain.ReceiptResult
import org.heartbeat.watch.domain.ServerResult
import org.heartbeat.watch.domain.SurgeonNote
import org.heartbeat.watch.domain.SurgeonNotesRepository

/** Stands in for the onboard server's notes endpoints. */
internal class FakeNotesServer : SurgeonNotesRepository {
    var notes: ServerResult<List<SurgeonNote>> = ServerResult.Found(emptyList())
    var titles: ServerResult<Map<String, String>> = ServerResult.Found(emptyMap())
    var receipt: ReceiptResult = ReceiptResult.Sent(T0.plusSeconds(600))
    val receipts = mutableListOf<String>()
    var titleRequests = 0

    /** Runs inside a notes request before it answers, e.g. to suspend it while a test does something else. */
    var whileFetchingNotes: suspend () -> Unit = {}

    override suspend fun notes(astronautId: String): ServerResult<List<SurgeonNote>> {
        val answer = notes
        whileFetchingNotes()
        return answer
    }

    override suspend fun markRead(astronautId: String, noteId: String): ReceiptResult {
        receipts += "$astronautId/$noteId"
        return receipt
    }

    override suspend fun alertTitles(astronautId: String): ServerResult<Map<String, String>> {
        titleRequests++
        return titles
    }
}

internal class MemorySeenStore(var ids: Set<String> = emptySet()) : SeenNotesStore {
    override suspend fun load() = ids

    override suspend fun save(noteIds: Set<String>) {
        ids = noteIds
    }
}

/** Records announcements; [canPost] false stands for a watch where notifications are not allowed. */
internal class RecordingAnnouncer(var canPost: Boolean = true) : NoteAnnouncer {
    val announced = mutableListOf<String>()
    val dismissed = mutableListOf<String>()

    override fun announce(note: SurgeonNote): Boolean {
        if (canPost) announced += note.noteId
        return canPost
    }

    override fun dismiss(noteId: String) {
        dismissed += noteId
    }
}
