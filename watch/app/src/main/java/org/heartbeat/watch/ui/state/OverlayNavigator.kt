package org.heartbeat.watch.ui.state

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Opens and closes the screens drawn over the pager where one choice affects another: back from a note always goes
 * home (owner decision), so it also closes Food today and Connection settings if they were open underneath.
 */
class OverlayNavigator(private val notes: NoteSession, private val food: FoodTodayLoader) {
    private val _settingsOpen = MutableStateFlow(false)

    val settingsOpen: StateFlow<Boolean> = _settingsOpen.asStateFlow()

    fun openSettings() {
        _settingsOpen.value = true
    }

    fun closeSettings() {
        _settingsOpen.value = false
    }

    fun closeNote() {
        notes.close()
        food.close()
        _settingsOpen.value = false
    }
}
