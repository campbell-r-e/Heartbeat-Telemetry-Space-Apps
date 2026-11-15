package org.heartbeat.watch.ui.model

/** The one screen drawn over the pager, if any. */
sealed interface OverlayUi {
    data class Measurement(val measurement: MeasurementUi) : OverlayUi

    data class Note(val note: NoteUi) : OverlayUi

    data class Food(val food: FoodTodayUi) : OverlayUi

    data object Settings : OverlayUi

    data object None : OverlayUi
}

/** Which screen is on top, and what lies under it. Pure, so the owner's rules are unit-tested. */
object OverlayPresenter {
    /**
     * A measurement comes first: a note opened during an ECG or SpO₂ measurement waits until it is closed and never
     * interrupts it (owner decision). Then a note, then Food today, then Connection settings.
     */
    fun overlay(measurement: MeasurementUi?, note: NoteUi?, food: FoodTodayUi?, settingsOpen: Boolean): OverlayUi =
        when {
            measurement != null -> OverlayUi.Measurement(measurement)
            note != null -> OverlayUi.Note(note)
            food != null -> OverlayUi.Food(food)
            settingsOpen -> OverlayUi.Settings
            else -> OverlayUi.None
        }

    /** The pager page under the overlay: home under a note, so back from a note goes home; `null` leaves it as is. */
    fun pageUnderneath(overlay: OverlayUi): Int? = if (overlay is OverlayUi.Note) PagerPages.HOME else null
}
