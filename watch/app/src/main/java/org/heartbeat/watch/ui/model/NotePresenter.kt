package org.heartbeat.watch.ui.model

import org.heartbeat.watch.domain.SurgeonNote
import org.heartbeat.watch.notes.NoteArrivals
import org.heartbeat.watch.notes.sentLine
import org.heartbeat.watch.time.UtcTime

/** The note open on screen and how its read receipt is going. */
data class OpenNote(val noteId: String, val sending: Boolean = false, val receiptFailure: ReceiptFailure? = null) {
    /** The note the server no longer has, kept on screen until the astronaut goes back; `null` otherwise. */
    val goneNote: SurgeonNote? get() = (receiptFailure as? ReceiptFailure.NoteGone)?.note
}

/** Why the last Mark read did not go through. */
sealed interface ReceiptFailure {
    /**
     * Any failure but the two below: the server could not be reached (no answer, a timeout, a 5xx) or gave an answer
     * the watch cannot use; trying again can work.
     */
    data object NotSent : ReceiptFailure

    /** The token is missing or the server refused it (401/403); it is fixed in Connection settings (pending owner review). */
    data object TokenRefused : ReceiptFailure

    /** The server no longer has the note (404 `unknown_note`), so it is gone from the watch (owner decision). */
    data class NoteGone(val note: SurgeonNote) : ReceiptFailure
}

/** The note screen (approved mockup watch-notes-large, screens 2 and 3). */
data class NoteUi(
    val noteId: String,
    val title: String,
    /** "Sent 14:06 UTC · about Radiation dose spike", or just "Sent 14:06 UTC". */
    val sentLine: String,
    val text: String,
    /** "✓ Read · 14:10 UTC" once read; `null` until the note is read. */
    val readLine: String?,
    /** False once the server no longer has the note: there is nothing left to mark read (owner decision). */
    val buttonShown: Boolean,
    val buttonLabel: String,
    val buttonEnabled: Boolean,
    /** Why the last Mark read did not go through; `null` otherwise. */
    val error: String?,
)

/** Notes from the flight surgeon as the watch shows them. Every time is UTC. Pure, so it is unit-tested. */
object NotePresenter {
    private const val TITLE = "Flight Surgeon"
    private const val MARK_READ = "Mark read"
    private const val SENDING = "Sending…"
    private const val SEND_FAILED = "Couldn't reach the server. Try again."
    private const val TOKEN_REFUSED = "Token refused. Check Connection settings."
    private const val NOTE_GONE = "The server no longer has this note."

    /**
     * `null` while no note is open, or the open note has not reached the watch yet. A note the server no longer has
     * stays on screen, with why and without Mark read, until the astronaut goes back.
     */
    fun note(open: OpenNote?, notes: List<SurgeonNote>, alertTitles: Map<String, String>): NoteUi? {
        open ?: return null
        val note = notes.firstOrNull { it.noteId == open.noteId } ?: open.goneNote ?: return null
        val about = note.alertId?.let(alertTitles::get)?.let { " · about $it" }.orEmpty()
        return NoteUi(
            noteId = note.noteId,
            title = TITLE,
            sentLine = note.sentLine() + about,
            text = note.text,
            readLine = note.readAt?.let { "✓ Read · ${UtcTime.time(it)}" },
            buttonShown = open.goneNote == null,
            buttonLabel = if (open.sending) SENDING else MARK_READ,
            buttonEnabled = !open.sending,
            error = errorLine(open.receiptFailure),
        )
    }

    private fun errorLine(failure: ReceiptFailure?): String? =
        when (failure) {
            null -> null
            ReceiptFailure.NotSent -> SEND_FAILED
            ReceiptFailure.TokenRefused -> TOKEN_REFUSED
            is ReceiptFailure.NoteGone -> NOTE_GONE
        }

    /** The home pill while notes wait unread: "✉ 1 note", "✉ 2 notes"; `null` once every note is read. */
    fun unreadPill(notes: List<SurgeonNote>): String? {
        val count = NoteArrivals.unread(notes).size
        return when (count) {
            0 -> null
            1 -> "✉ 1 note"
            else -> "✉ $count notes"
        }
    }
}
