package org.heartbeat.watch.notes

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.heartbeat.watch.T0
import org.heartbeat.watch.domain.ConnectionFailure
import org.heartbeat.watch.domain.ReceiptResult
import org.heartbeat.watch.domain.ServerResult
import org.heartbeat.watch.note
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NoteArrivalsTest {
    @Test
    fun `only unread notes not announced before are announced, oldest first`() {
        val notes = listOf(note("b", 5), note("a", 1), note("read", 0, readAt = T0), note("seen", 2))

        assertEquals(listOf("a", "b"), NoteArrivals.toAnnounce(notes, seen = setOf("seen")).map { it.noteId })
    }

    @Test
    fun `remembers announced ids, and forgets ids the server no longer lists`() {
        val notes = listOf(note("a", 1), note("b", 2))

        assertEquals(setOf("a", "b"), NoteArrivals.seenAfter(notes, seen = setOf("a", "gone"), announced = listOf(note("b", 2))))
    }

    @Test
    fun `an announced note the server lists as read, here or elsewhere, has its notification taken away and is forgotten`() {
        val notes = listOf(note("readHere", 1, readAt = T0), note("unread", 2), note("neverAnnounced", 3, readAt = T0))
        val seen = setOf("readHere", "unread")

        assertEquals(listOf("readHere"), NoteArrivals.announcedNowRead(notes, seen).map { it.noteId })
        assertEquals(setOf("unread"), NoteArrivals.seenAfter(notes, seen, announced = emptyList()))
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class NoteInboxTest {
    private val server = FakeNotesServer()
    private val seen = MemorySeenStore()
    private val announcer = RecordingAnnouncer()
    private val inbox = NoteInbox(server, seen, announcer, { "a1" }, log = {})

    @Test
    fun `a new note is announced once, even after a restart`() = runTest {
        server.notes = ServerResult.Found(listOf(note("n1", 1)))

        inbox.refresh()
        inbox.refresh()
        NoteInbox(server, seen, announcer, { "a1" }, log = {}).refresh()

        assertEquals(listOf("n1"), announcer.announced)
        assertEquals(setOf("n1"), seen.ids)
    }

    @Test
    fun `a note whose notification could not be posted is announced once notifications are allowed`() = runTest {
        server.notes = ServerResult.Found(listOf(note("n1", 1)))
        announcer.canPost = false
        inbox.refresh()
        assertTrue(announcer.announced.isEmpty())
        assertTrue(seen.ids.isEmpty())

        announcer.canPost = true
        inbox.refresh()
        inbox.refresh()

        assertEquals(listOf("n1"), announcer.announced)
        assertEquals(setOf("n1"), seen.ids)
    }

    @Test
    fun `a poll that left before Mark read cannot write the note back as unread`() = runTest {
        server.notes = ServerResult.Found(listOf(note("n1", 1)))
        inbox.refresh()
        val pollMayAnswer = CompletableDeferred<Unit>()
        server.whileFetchingNotes = { pollMayAnswer.await() }

        val poll = launch { inbox.refresh() }
        runCurrent()
        val receipt = async { inbox.markRead("n1") }
        runCurrent()
        pollMayAnswer.complete(Unit)
        poll.join()
        receipt.await()

        assertEquals(T0.plusSeconds(600), inbox.notes.value.single().readAt)
    }

    @Test
    fun `a note already read is never announced`() = runTest {
        server.notes = ServerResult.Found(listOf(note("n1", 1, readAt = T0)))

        inbox.refresh()

        assertTrue(announcer.announced.isEmpty())
    }

    @Test
    fun `an unreachable server changes nothing`() = runTest {
        server.notes = ServerResult.Found(listOf(note("n1", 1)))
        inbox.refresh()
        server.notes = ServerResult.Failed(ConnectionFailure.Unreachable("no Wi-Fi"))

        inbox.refresh()

        assertEquals(listOf("n1"), inbox.notes.value.map { it.noteId })
        assertEquals(setOf("n1"), seen.ids)
    }

    @Test
    fun `marking read sends the receipt, reads the note here at once and takes the notification away`() = runTest {
        server.notes = ServerResult.Found(listOf(note("n1", 1)))
        inbox.refresh()

        val result = inbox.markRead("n1")

        assertEquals(ReceiptResult.Sent(T0.plusSeconds(600)), result)
        assertEquals(listOf("a1/n1"), server.receipts)
        assertEquals(T0.plusSeconds(600), inbox.notes.value.single().readAt)
        assertEquals(listOf("n1"), announcer.dismissed)
    }

    @Test
    fun `a receipt that does not reach the server leaves the note unread`() = runTest {
        server.notes = ServerResult.Found(listOf(note("n1", 1)))
        inbox.refresh()
        server.receipt = ReceiptResult.Failed(ConnectionFailure.Unreachable("no Wi-Fi"))

        inbox.markRead("n1")

        assertNull(inbox.notes.value.single().readAt)
        assertTrue(announcer.dismissed.isEmpty())
    }

    @Test
    fun `a note read elsewhere has its notification taken away at the next poll, once`() = runTest {
        server.notes = ServerResult.Found(listOf(note("n1", 1), note("n2", 2)))
        inbox.refresh()

        server.notes = ServerResult.Found(listOf(note("n1", 1, readAt = T0.plusSeconds(600)), note("n2", 2)))
        inbox.refresh()
        inbox.refresh()

        assertEquals(listOf("n1"), announcer.dismissed)
        assertEquals(setOf("n2"), seen.ids)
        assertEquals(listOf("n1", "n2"), announcer.announced)
    }

    @Test
    fun `a note the server no longer has is dropped from the watch with its notification`() = runTest {
        server.notes = ServerResult.Found(listOf(note("n1", 1), note("n2", 2)))
        inbox.refresh()
        server.receipt = ReceiptResult.UnknownNote

        val result = inbox.markRead("n1")

        assertEquals(ReceiptResult.UnknownNote, result)
        assertEquals(listOf("n2"), inbox.notes.value.map { it.noteId })
        assertEquals(listOf("n1"), announcer.dismissed)
    }

    @Test
    fun `alert titles are loaded only when a note is about an alert not yet known`() = runTest {
        server.titles = ServerResult.Found(mapOf("al1" to "Radiation dose spike"))
        server.notes = ServerResult.Found(listOf(note("plain", 1)))
        inbox.refresh()
        assertEquals(0, server.titleRequests)

        server.notes = ServerResult.Found(listOf(note("plain", 1), note("about", 2, alertId = "al1")))
        inbox.refresh()
        inbox.refresh()

        assertEquals(1, server.titleRequests)
        assertEquals(mapOf("al1" to "Radiation dose spike"), inbox.alertTitles.value)
    }
}
