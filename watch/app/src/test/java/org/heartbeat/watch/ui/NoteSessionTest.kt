package org.heartbeat.watch.ui

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.heartbeat.watch.T0
import org.heartbeat.watch.domain.ConnectionFailure
import org.heartbeat.watch.domain.FoodRepository
import org.heartbeat.watch.domain.MealLog
import org.heartbeat.watch.domain.MenuFood
import org.heartbeat.watch.domain.ReceiptResult
import org.heartbeat.watch.domain.ServerResult
import org.heartbeat.watch.note
import org.heartbeat.watch.notes.FakeNotesServer
import org.heartbeat.watch.notes.MemorySeenStore
import org.heartbeat.watch.notes.NoteInbox
import org.heartbeat.watch.notes.RecordingAnnouncer
import org.heartbeat.watch.ui.model.ReceiptFailure
import org.heartbeat.watch.ui.state.FoodTodayLoader
import org.heartbeat.watch.ui.state.NoteSession
import org.heartbeat.watch.ui.state.OverlayNavigator
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

/** A food server with no meals and an empty menu. */
private object EmptyFood : FoodRepository {
    override suspend fun mealsBetween(astronautId: String, from: Instant, to: Instant): ServerResult<List<MealLog>> =
        ServerResult.Found(emptyList())

    override suspend fun menu(): ServerResult<List<MenuFood>> = ServerResult.Found(emptyList())
}

@OptIn(ExperimentalCoroutinesApi::class)
class NoteSessionTest {
    private val server = FakeNotesServer()
    private val inbox = NoteInbox(server, MemorySeenStore(), RecordingAnnouncer(), { "a1" }, log = {})

    @Test
    fun `the home pill opens the oldest unread note`() = runTest {
        server.notes = ServerResult.Found(listOf(note("newer", 5), note("older", 1), note("read", 0, readAt = T0)))
        inbox.refresh()
        val session = NoteSession(inbox)

        session.openOldestUnread()

        assertEquals("older", session.open.value?.noteId)
    }

    @Test
    fun `opening a note from its notification fetches it when it has not reached the watch yet`() = runTest {
        val session = NoteSession(inbox)
        server.notes = ServerResult.Found(listOf(note("n1", 1)))

        session.open("n1", this)
        runCurrent()

        assertEquals(listOf("n1"), inbox.notes.value.map { it.noteId })
    }

    @Test
    fun `if the note cannot be fetched after Open, the open is dropped and nothing pops up later`() = runTest {
        val session = NoteSession(inbox)
        server.notes = ServerResult.Failed(ConnectionFailure.Unreachable("no Wi-Fi"))

        session.open("n1", this)
        runCurrent()
        assertNull(session.open.value)

        server.notes = ServerResult.Found(listOf(note("n1", 1)))
        inbox.refresh()

        assertNull(session.open.value)
    }

    @Test
    fun `back from a note goes home, closing Food today and settings underneath`() = runTest {
        server.notes = ServerResult.Found(listOf(note("n1", 1)))
        inbox.refresh()
        val session = NoteSession(inbox)
        val food = FoodTodayLoader(EmptyFood, { Clock.fixed(T0, ZoneOffset.UTC) }, { "a1" }, log = {})
        val navigator = OverlayNavigator(session, food)
        food.open(this)
        navigator.openSettings()
        session.openOldestUnread()

        navigator.closeNote()

        assertNull(session.open.value)
        assertNull(food.state.value)
        assertFalse(navigator.settingsOpen.value)
    }

    @Test
    fun `Mark read shows sending, then the result`() = runTest {
        server.notes = ServerResult.Found(listOf(note("n1", 1)))
        inbox.refresh()
        val session = NoteSession(inbox)
        session.openOldestUnread()

        session.markRead(this)
        assertTrue(session.open.value!!.sending)
        runCurrent()

        assertEquals(false, session.open.value!!.sending)
        assertNull(session.open.value!!.receiptFailure)
    }

    @Test
    fun `a receipt that does not reach the server asks to try again`() = runTest {
        server.notes = ServerResult.Found(listOf(note("n1", 1)))
        inbox.refresh()
        server.receipt = ReceiptResult.Failed(ConnectionFailure.ServerError(503))
        val session = NoteSession(inbox)
        session.openOldestUnread()

        session.markRead(this)
        runCurrent()

        assertEquals(ReceiptFailure.NotSent, session.open.value!!.receiptFailure)
        assertEquals(listOf("n1"), inbox.notes.value.map { it.noteId })
    }

    @Test
    fun `a note the server no longer has leaves the watch but stays open with why`() = runTest {
        server.notes = ServerResult.Found(listOf(note("n1", 1)))
        inbox.refresh()
        server.receipt = ReceiptResult.UnknownNote
        val session = NoteSession(inbox)
        session.openOldestUnread()

        session.markRead(this)
        runCurrent()

        assertEquals(ReceiptFailure.NoteGone(note("n1", 1)), session.open.value!!.receiptFailure)
        assertTrue(inbox.notes.value.isEmpty())
    }

    @Test
    fun `a missing or refused token points to Connection settings`() = runTest {
        server.notes = ServerResult.Found(listOf(note("n1", 1)))
        inbox.refresh()
        val session = NoteSession(inbox)

        listOf(ConnectionFailure.MissingToken, ConnectionFailure.TokenRefused).forEach { failure ->
            server.receipt = ReceiptResult.Failed(failure)
            session.openOldestUnread()

            session.markRead(this)
            runCurrent()

            assertEquals(ReceiptFailure.TokenRefused, session.open.value!!.receiptFailure)
        }
        assertEquals(listOf("n1"), inbox.notes.value.map { it.noteId })
    }
}
