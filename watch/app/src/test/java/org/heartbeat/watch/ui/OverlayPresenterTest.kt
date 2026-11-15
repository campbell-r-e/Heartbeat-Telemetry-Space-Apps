package org.heartbeat.watch.ui

import org.heartbeat.watch.domain.MeasurementKind
import org.heartbeat.watch.ui.model.FoodTodayUi
import org.heartbeat.watch.ui.model.MeasurementUi
import org.heartbeat.watch.ui.model.NoteUi
import org.heartbeat.watch.ui.model.OverlayPresenter
import org.heartbeat.watch.ui.model.OverlayUi
import org.heartbeat.watch.ui.model.PagerPages
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class OverlayPresenterTest {
    private val measuring = MeasurementUi.Measuring(MeasurementKind.SPO2, "Blood oxygen", null, null, "Keep still", emptyList())
    private val note = NoteUi(
        noteId = "n1",
        title = "Flight Surgeon",
        sentLine = "Sent 14:06 UTC",
        text = "Text",
        readLine = null,
        buttonShown = true,
        buttonLabel = "Mark read",
        buttonEnabled = true,
        error = null,
    )

    @Test
    fun `a note opened during a measurement waits until the measurement is closed`() {
        assertEquals(OverlayUi.Measurement(measuring), OverlayPresenter.overlay(measuring, note, null, settingsOpen = false))
        assertEquals(OverlayUi.Note(note), OverlayPresenter.overlay(null, note, null, settingsOpen = false))
    }

    @Test
    fun `a note shows over Food today and settings, then food, then settings`() {
        assertEquals(OverlayUi.Note(note), OverlayPresenter.overlay(null, note, FoodTodayUi.Loading, settingsOpen = true))
        assertEquals(OverlayUi.Food(FoodTodayUi.Loading), OverlayPresenter.overlay(null, null, FoodTodayUi.Loading, settingsOpen = true))
        assertEquals(OverlayUi.Settings, OverlayPresenter.overlay(null, null, null, settingsOpen = true))
        assertEquals(OverlayUi.None, OverlayPresenter.overlay(null, null, null, settingsOpen = false))
    }

    @Test
    fun `under a note the pager is home, so back from a note goes home`() {
        assertEquals(PagerPages.HOME, OverlayPresenter.pageUnderneath(OverlayUi.Note(note)))
        assertNull(OverlayPresenter.pageUnderneath(OverlayUi.Measurement(measuring)))
        assertNull(OverlayPresenter.pageUnderneath(OverlayUi.None))
    }
}
