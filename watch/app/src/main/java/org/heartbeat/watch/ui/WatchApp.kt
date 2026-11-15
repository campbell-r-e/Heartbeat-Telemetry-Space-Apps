package org.heartbeat.watch.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.PagerState
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import kotlinx.coroutines.launch
import org.heartbeat.watch.domain.Area
import org.heartbeat.watch.domain.MeasurementKind
import org.heartbeat.watch.settings.SettingField
import org.heartbeat.watch.ui.model.AreaNavigation
import org.heartbeat.watch.ui.model.Destination
import org.heartbeat.watch.ui.model.OverlayPresenter
import org.heartbeat.watch.ui.model.OverlayUi
import org.heartbeat.watch.ui.model.PagerPages
import org.heartbeat.watch.ui.model.WatchUiState
import org.heartbeat.watch.ui.screens.FoodTodayScreen
import org.heartbeat.watch.ui.screens.HomeScreen
import org.heartbeat.watch.ui.screens.InputErrorScreen
import org.heartbeat.watch.ui.screens.MeasurementScreen
import org.heartbeat.watch.ui.screens.NoteScreen
import org.heartbeat.watch.ui.screens.ReadingsScreen
import org.heartbeat.watch.ui.screens.SettingsScreen
import org.heartbeat.watch.ui.theme.MockupColors
import org.heartbeat.watch.ui.theme.ProvideMockupScale

/** What the screens can ask for; the activity wires these to the ViewModel and to text input. */
class WatchActions(
    val onMeasure: (MeasurementKind) -> Unit,
    val onCloseMeasurement: () -> Unit,
    val onOpenFoodToday: () -> Unit,
    val onCloseFoodToday: () -> Unit,
    val onOpenNotes: () -> Unit,
    val onMarkNoteRead: () -> Unit,
    val onCloseNote: () -> Unit,
    val onOpenSettings: () -> Unit,
    val onCloseSettings: () -> Unit,
    val onEditSetting: (SettingField) -> Unit,
    val onDismissInputError: () -> Unit,
    val onTestConnection: () -> Unit,
    val onAllowExactAlarms: () -> Unit,
)

/**
 * Navigation: home and the readings pages in a horizontal pager; tapping a home dot jumps to its page or opens
 * "Food today". Back on a readings page returns home. Settings, food, notes and measurements are drawn on top; back
 * returns to the pager, and from a note to home.
 */
@Composable
fun WatchApp(state: WatchUiState, actions: WatchActions) {
    val pagerState = rememberPagerState(pageCount = { state.pages.size + HOME_PAGES })
    Box(Modifier.fillMaxSize().background(MockupColors.Background), contentAlignment = Alignment.Center) {
        ProvideMockupScale {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                val overlay = state.overlay
                OverlayPresenter.pageUnderneath(overlay)?.let { page ->
                    LaunchedEffect(overlay, page) { pagerState.scrollToPage(page) }
                }
                when (overlay) {
                    is OverlayUi.Measurement -> {
                        BackHandler(onBack = actions.onCloseMeasurement)
                        MeasurementScreen(state.header, overlay.measurement, actions.onCloseMeasurement, actions.onMeasure)
                    }
                    is OverlayUi.Note -> {
                        BackHandler(onBack = actions.onCloseNote)
                        NoteScreen(state.header, overlay.note, actions.onMarkNoteRead)
                    }
                    is OverlayUi.Food -> {
                        BackHandler(onBack = actions.onCloseFoodToday)
                        FoodTodayScreen(state.header, overlay.food, actions.onCloseFoodToday)
                    }
                    OverlayUi.Settings -> Settings(state, actions, onClose = actions.onCloseSettings)
                    OverlayUi.None -> Pages(state, actions, pagerState, onOpenSettings = actions.onOpenSettings)
                }
            }
        }
    }
}

@Composable
private fun Settings(state: WatchUiState, actions: WatchActions, onClose: () -> Unit) {
    val inputError = state.settings.inputError
    if (inputError != null) {
        BackHandler(onBack = actions.onDismissInputError)
        InputErrorScreen(state.header, inputError, onBack = actions.onDismissInputError, onEdit = { actions.onEditSetting(inputError.field) })
    } else {
        BackHandler(onBack = onClose)
        SettingsScreen(state.header, state.settings, onClose, actions.onEditSetting, actions.onTestConnection)
    }
}

@Composable
private fun Pages(state: WatchUiState, actions: WatchActions, pagerState: PagerState, onOpenSettings: () -> Unit) {
    val scope = rememberCoroutineScope()
    val onAreaSelected = { area: Area ->
        when (val destination = AreaNavigation.destinationFor(area)) {
            is Destination.Page -> {
                val index = state.pages.indexOfFirst { it.page == destination.page }
                scope.launch { pagerState.animateScrollToPage(HOME_PAGES + index) }
            }
            Destination.FoodToday -> actions.onOpenFoodToday()
        }
        Unit
    }
    val backPage = PagerPages.pageOnBack(pagerState.currentPage)
    BackHandler(enabled = backPage != null) {
        backPage?.let { scope.launch { pagerState.animateScrollToPage(it) } }
    }
    HorizontalPager(pagerState, Modifier.fillMaxSize()) { page ->
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            if (page == PagerPages.HOME) {
                HomeScreen(state.header, state.home, onAreaSelected, actions.onOpenNotes)
            } else {
                ReadingsScreen(state.header, state.pages[page - HOME_PAGES], actions.onMeasure, onOpenSettings, actions.onAllowExactAlarms)
            }
        }
    }
}

private const val HOME_PAGES = 1
