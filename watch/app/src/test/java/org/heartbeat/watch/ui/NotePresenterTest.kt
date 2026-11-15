package org.heartbeat.watch.ui

import org.heartbeat.watch.T0
import org.heartbeat.watch.note
import org.heartbeat.watch.ui.model.NotePresenter
import org.heartbeat.watch.ui.model.OpenNote
import org.heartbeat.watch.ui.model.ReceiptFailure
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NotePresenterTest {
    private val titles = mapOf("al1" to "Radiation dose spike")

    @Test
    fun `an unread note shows when it was sent, in UTC, what it is about, the text and Mark read`() {
        val ui = NotePresenter.note(OpenNote("n1"), listOf(note("n1", 6, alertId = "al1")), titles)!!

        assertEquals("Flight Surgeon", ui.title)
        assertEquals("Sent 14:06 UTC · about Radiation dose spike", ui.sentLine)
        assertEquals("Text of n1", ui.text)
        assertNull(ui.readLine)
        assertEquals("Mark read", ui.buttonLabel)
        assertNull(ui.error)
    }

    @Test
    fun `the about part is dropped when there is no alert or its title is not found`() {
        assertEquals("Sent 14:06 UTC", NotePresenter.note(OpenNote("n1"), listOf(note("n1", 6)), titles)!!.sentLine)
        assertEquals("Sent 14:06 UTC", NotePresenter.note(OpenNote("n1"), listOf(note("n1", 6, alertId = "gone")), titles)!!.sentLine)
    }

    @Test
    fun `a read note confirms it in UTC`() {
        val ui = NotePresenter.note(OpenNote("n1"), listOf(note("n1", 6, readAt = T0.plusSeconds(600))), titles)!!

        assertEquals("✓ Read · 14:10 UTC", ui.readLine)
    }

    @Test
    fun `while the receipt is on its way the button waits, and a failure says so`() {
        val notes = listOf(note("n1", 6))

        val sending = NotePresenter.note(OpenNote("n1", sending = true), notes, titles)!!
        val failed = NotePresenter.note(OpenNote("n1", receiptFailure = ReceiptFailure.NotSent), notes, titles)!!

        assertEquals("Sending…", sending.buttonLabel)
        assertEquals(false, sending.buttonEnabled)
        assertEquals("Couldn't reach the server. Try again.", failed.error)
        assertEquals(
            "Token refused. Check Connection settings.",
            NotePresenter.note(OpenNote("n1", receiptFailure = ReceiptFailure.TokenRefused), notes, titles)!!.error,
        )
        assertEquals("Mark read", failed.buttonLabel)
        assertTrue(failed.buttonShown)
    }

    @Test
    fun `a note the server no longer has stays on screen without Mark read, and says why`() {
        val gone = note("n1", 6)

        val ui = NotePresenter.note(OpenNote("n1", receiptFailure = ReceiptFailure.NoteGone(gone)), emptyList(), titles)!!

        assertEquals("Text of n1", ui.text)
        assertEquals("The server no longer has this note.", ui.error)
        assertFalse(ui.buttonShown)
    }

    @Test
    fun `nothing is shown while no note is open or it has not reached the watch`() {
        assertNull(NotePresenter.note(null, listOf(note("n1", 6)), titles))
        assertNull(NotePresenter.note(OpenNote("n2"), listOf(note("n1", 6)), titles))
    }

    @Test
    fun `the home pill counts unread notes and goes once all are read`() {
        assertEquals("✉ 1 note", NotePresenter.unreadPill(listOf(note("a", 1), note("b", 2, readAt = T0))))
        assertEquals("✉ 2 notes", NotePresenter.unreadPill(listOf(note("a", 1), note("b", 2))))
        assertNull(NotePresenter.unreadPill(listOf(note("b", 2, readAt = T0))))
    }
}
