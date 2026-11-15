package org.heartbeat.watch.notes

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.heartbeat.watch.domain.ReceiptResult
import org.heartbeat.watch.domain.ServerResult
import org.heartbeat.watch.domain.SurgeonNote
import org.heartbeat.watch.domain.SurgeonNotesRepository
import java.time.Instant

/**
 * The ids of unread notes the watch has already announced, kept across restarts so a note never buzzes twice. A note
 * read elsewhere leaves the set once its notification is taken away.
 */
interface SeenNotesStore {
    suspend fun load(): Set<String>

    suspend fun save(noteIds: Set<String>)
}

/** Announces a note: the buzz and the "Note from Flight Surgeon" notification; [dismiss] takes it away once read. */
interface NoteAnnouncer {
    /** True once the notification is posted; false when it could not be (notifications not allowed). */
    fun announce(note: SurgeonNote): Boolean

    fun dismiss(noteId: String)
}

/**
 * The flight surgeon's notes on the watch (SPEC §9.3). Each [refresh] (a step of the app's 15 s onboard poll) reads
 * them from the onboard server and announces each unread note once (the ids of notes whose notification was posted are
 * persisted; one that could not be posted is announced at a later poll, once notifications are allowed), takes the
 * notification away once the note was read elsewhere (the dashboard), and keeps the notes and the titles of the alerts
 * they are about for the screens.
 * A poll and a read receipt share one lock, so a poll that left before Mark read cannot write the note back as unread.
 */
class NoteInbox(
    private val repository: SurgeonNotesRepository,
    private val seenStore: SeenNotesStore,
    private val announcer: NoteAnnouncer,
    private val astronautId: suspend () -> String,
    private val log: (String) -> Unit,
) {
    private val _notes = MutableStateFlow<List<SurgeonNote>>(emptyList())
    private val _alertTitles = MutableStateFlow<Map<String, String>>(emptyMap())
    private val notesLock = Mutex()

    /** Every note that has reached the watch, oldest first. */
    val notes: StateFlow<List<SurgeonNote>> = _notes.asStateFlow()

    /** The title of each alert a note can be about, by alert id; an alert not found has no entry. */
    val alertTitles: StateFlow<Map<String, String>> = _alertTitles.asStateFlow()

    suspend fun refresh() = notesLock.withLock {
        val id = astronautId()
        when (val fetched = repository.notes(id)) {
            is ServerResult.Failed -> log("Could not load notes from the flight surgeon: ${fetched.failure}")
            is ServerResult.Found -> {
                val notes = fetched.value.sortedBy(SurgeonNote::sentAt)
                _notes.value = notes
                updateNotifications(notes)
                loadMissingAlertTitles(id, notes)
            }
        }
    }

    /**
     * Sends the read receipt; on success the note is read here at once, without waiting for the next poll. A note the
     * server no longer has ([ReceiptResult.UnknownNote]) is dropped from the watch with its notification.
     */
    suspend fun markRead(noteId: String): ReceiptResult = notesLock.withLock {
        val result = repository.markRead(astronautId(), noteId)
        when (result) {
            is ReceiptResult.Sent -> markReadHere(noteId, result.readAt)
            ReceiptResult.UnknownNote -> forget(noteId)
            is ReceiptResult.Failed -> Unit
        }
        result
    }

    private fun markReadHere(noteId: String, readAt: Instant) {
        _notes.update { notes -> notes.map { if (it.noteId == noteId) it.copy(readAt = readAt) else it } }
        announcer.dismiss(noteId)
    }

    private fun forget(noteId: String) {
        _notes.update { notes -> notes.filterNot { it.noteId == noteId } }
        announcer.dismiss(noteId)
    }

    /** Takes away the notifications of announced notes now read (here or elsewhere), then announces the new ones. */
    private suspend fun updateNotifications(notes: List<SurgeonNote>) {
        val seen = seenStore.load()
        NoteArrivals.announcedNowRead(notes, seen).forEach { announcer.dismiss(it.noteId) }
        val posted = NoteArrivals.toAnnounce(notes, seen).filter(announcer::announce)
        val stillKnown = NoteArrivals.seenAfter(notes, seen, posted)
        if (stillKnown != seen) seenStore.save(stillKnown)
    }

    private suspend fun loadMissingAlertTitles(astronautId: String, notes: List<SurgeonNote>) {
        val wanted = notes.mapNotNull(SurgeonNote::alertId).toSet()
        if ((wanted - _alertTitles.value.keys).isEmpty()) return
        when (val titles = repository.alertTitles(astronautId)) {
            is ServerResult.Found -> _alertTitles.value = titles.value
            is ServerResult.Failed -> log("Could not load the alerts notes are about: ${titles.failure}")
        }
    }
}

/** Which notes to announce, and which ids to remember. Pure, so it is unit-tested. */
object NoteArrivals {
    /** Unread notes not announced before, oldest first. */
    fun toAnnounce(notes: List<SurgeonNote>, seen: Set<String>): List<SurgeonNote> = unread(notes).filter { it.noteId !in seen }

    /**
     * The seen ids plus those just announced, limited to notes the server still lists as unread, so the set stays small
     * and a note read elsewhere has its notification taken away only once.
     */
    fun seenAfter(notes: List<SurgeonNote>, seen: Set<String>, announced: List<SurgeonNote>): Set<String> {
        val stillUnread = unread(notes).map(SurgeonNote::noteId).toSet()
        return (seen + announced.map(SurgeonNote::noteId)) intersect stillUnread
    }

    /**
     * Announced notes the server now lists as read, wherever they were read: elsewhere (the dashboard), or on this watch,
     * whose notification is already gone (taking it away again is harmless).
     */
    fun announcedNowRead(notes: List<SurgeonNote>, seen: Set<String>): List<SurgeonNote> =
        notes.filter { it.readAt != null && it.noteId in seen }

    /** Unread notes, oldest first: the order they are opened in. */
    fun unread(notes: List<SurgeonNote>): List<SurgeonNote> = notes.filter { it.readAt == null }.sortedBy(SurgeonNote::sentAt)
}
