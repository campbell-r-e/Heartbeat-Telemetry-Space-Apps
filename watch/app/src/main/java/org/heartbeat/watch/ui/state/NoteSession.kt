package org.heartbeat.watch.ui.state

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.heartbeat.watch.domain.ConnectionFailure
import org.heartbeat.watch.domain.ReceiptResult
import org.heartbeat.watch.domain.SurgeonNote
import org.heartbeat.watch.notes.NoteArrivals
import org.heartbeat.watch.notes.NoteInbox
import org.heartbeat.watch.ui.model.OpenNote
import org.heartbeat.watch.ui.model.ReceiptFailure

/** Which note is open on screen, and its read receipt. Notes open oldest unread first, one screen each. */
class NoteSession(private val inbox: NoteInbox) {
    private val _open = MutableStateFlow<OpenNote?>(null)

    /** `null` while no note is open. */
    val open: StateFlow<OpenNote?> = _open.asStateFlow()

    /**
     * From the notification's Open: a note not on the watch yet is fetched first. If it still is not there (the fetch
     * failed), the open is dropped, so the note never pops up later by itself; it stays unread behind the home pill.
     */
    fun open(noteId: String, scope: CoroutineScope) {
        _open.value = OpenNote(noteId)
        if (isOnWatch(noteId)) return
        scope.launch {
            inbox.refresh()
            if (!isOnWatch(noteId)) _open.update { current -> current?.takeUnless { it.noteId == noteId } }
        }
    }

    private fun isOnWatch(noteId: String): Boolean = inbox.notes.value.any { it.noteId == noteId }

    /** From the home pill: the oldest unread note. */
    fun openOldestUnread() {
        NoteArrivals.unread(inbox.notes.value).firstOrNull()?.let { _open.value = OpenNote(it.noteId) }
    }

    fun close() {
        _open.value = null
    }

    /** A note the server no longer has is gone from the watch, but stays on screen with why until the astronaut goes back. */
    fun markRead(scope: CoroutineScope) {
        val open = _open.value ?: return
        val shown = inbox.notes.value.firstOrNull { it.noteId == open.noteId } ?: return
        _open.value = OpenNote(shown.noteId, sending = true)
        scope.launch {
            val failure = receiptFailure(inbox.markRead(shown.noteId), shown)
            _open.update { current ->
                if (current?.noteId == shown.noteId) OpenNote(shown.noteId, receiptFailure = failure) else current
            }
        }
    }

    private fun receiptFailure(result: ReceiptResult, note: SurgeonNote): ReceiptFailure? =
        when (result) {
            is ReceiptResult.Sent -> null
            ReceiptResult.UnknownNote -> ReceiptFailure.NoteGone(note)
            is ReceiptResult.Failed -> when (result.failure) {
                ConnectionFailure.MissingToken, ConnectionFailure.TokenRefused -> ReceiptFailure.TokenRefused
                else -> ReceiptFailure.NotSent
            }
        }
}
