package org.heartbeat.watch.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import org.heartbeat.watch.domain.MeasurementKind
import org.heartbeat.watch.domain.Metric
import org.heartbeat.watch.domain.PointsSummary
import org.heartbeat.watch.domain.Reading
import org.heartbeat.watch.domain.ScheduledTask
import org.heartbeat.watch.domain.SurgeonNote
import org.heartbeat.watch.notes.NoteInbox
import org.heartbeat.watch.sensors.body.BodySensorsState
import org.heartbeat.watch.settings.ConnectionSettings
import org.heartbeat.watch.settings.SettingField
import org.heartbeat.watch.ui.model.FoodTodayUi
import org.heartbeat.watch.ui.model.HeaderPresenter
import org.heartbeat.watch.ui.model.HomePresenter
import org.heartbeat.watch.ui.model.MeasurementPresenter
import org.heartbeat.watch.ui.model.MeasurementProgress
import org.heartbeat.watch.ui.model.NewestReadings
import org.heartbeat.watch.ui.model.NotePresenter
import org.heartbeat.watch.ui.model.OpenNote
import org.heartbeat.watch.ui.model.OverlayPresenter
import org.heartbeat.watch.ui.model.ReadingsInput
import org.heartbeat.watch.ui.model.ReadingsPresenter
import org.heartbeat.watch.ui.model.RefusedInput
import org.heartbeat.watch.ui.model.SettingsPresenter
import org.heartbeat.watch.ui.model.WatchUiState
import org.heartbeat.watch.ui.state.ConnectionSettingsActions
import org.heartbeat.watch.ui.state.FoodTodayLoader
import org.heartbeat.watch.ui.state.MeasurementSession
import org.heartbeat.watch.ui.state.NoteSession
import org.heartbeat.watch.ui.state.OverlayNavigator
import org.heartbeat.watch.ui.state.SamsungSensorNotes
import org.heartbeat.watch.ui.state.ServerSnapshot
import org.heartbeat.watch.ui.state.ServerSnapshotPoller
import org.heartbeat.watch.upload.ConnectionStatus
import java.time.ZonedDateTime

/** Everything the [WatchViewModel] reads from or acts on; the app container builds it. */
class WatchDependencies(
    val minuteTicks: Flow<ZonedDateTime>,
    val batteryPercent: Flow<Int?>,
    val localReadings: StateFlow<Map<Metric, Reading>>,
    val unavailableSensors: StateFlow<Set<Metric>>,
    val bodySensors: StateFlow<BodySensorsState>,
    val settings: Flow<ConnectionSettings>,
    val connectionStatus: StateFlow<ConnectionStatus>,
    val schedule: StateFlow<List<ScheduledTask>?>,
    val crewNames: StateFlow<Map<String, String>>,
    val exactAlarmsAllowed: () -> Boolean,
    val server: ServerSnapshotPoller,
    /** The current astronaut's points, `null` until the server has provided them. */
    val points: StateFlow<PointsSummary?>,
    val measurements: MeasurementSession,
    val foodToday: FoodTodayLoader,
    val notes: NoteInbox,
    val noteSession: NoteSession,
    val navigator: OverlayNavigator,
    val settingsActions: ConnectionSettingsActions,
)

/**
 * A thin facade over the screens' state holders: it combines their flows into one [uiState] through the presenters
 * and forwards taps. The Composables only draw [uiState].
 */
class WatchViewModel(private val deps: WatchDependencies) : ViewModel() {
    private val exactAlarmsAllowed = MutableStateFlow(deps.exactAlarmsAllowed())
    private val readingsPresenter = ReadingsPresenter()
    private val settingsPresenter = SettingsPresenter()
    private val measurementPresenter = MeasurementPresenter()

    private val deviceState =
        combine(deps.minuteTicks, deps.batteryPercent, deps.schedule, exactAlarmsAllowed, ::DeviceState)
    private val sensorState = combine(deps.localReadings, deps.unavailableSensors, deps.bodySensors) { local, unavailable, body ->
        SensorState(local, unavailable, SamsungSensorNotes.noteFor(body))
    }
    private val settingsState =
        combine(deps.settings, deps.connectionStatus, deps.crewNames, deps.settingsActions.refused, ::SettingsState)
    private val noteState = combine(deps.noteSession.open, deps.notes.notes, deps.notes.alertTitles, ::NoteState)
    private val overlays =
        combine(deps.measurements.progress, deps.foodToday.state, noteState, deps.navigator.settingsOpen, ::Overlays)

    private val serverState = combine(deps.server.snapshot, deps.points, ::ServerState)

    val uiState: StateFlow<WatchUiState?> =
        combine(deviceState, sensorState, serverState, settingsState, overlays, ::present)
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), null)

    init {
        viewModelScope.launch { deps.server.run() }
    }

    fun startMeasurement(kind: MeasurementKind) = deps.measurements.start(kind, viewModelScope)

    fun closeMeasurement() = deps.measurements.close()

    fun openFoodToday() = deps.foodToday.open(viewModelScope)

    fun closeFoodToday() = deps.foodToday.close()

    /** From the notification's Open; shown once any running measurement is closed. */
    fun openNote(noteId: String) = deps.noteSession.open(noteId, viewModelScope)

    fun openOldestUnreadNote() = deps.noteSession.openOldestUnread()

    fun markNoteRead() = deps.noteSession.markRead(viewModelScope)

    /** Back from a note always goes home. */
    fun closeNote() = deps.navigator.closeNote()

    fun openSettings() = deps.navigator.openSettings()

    fun closeSettings() = deps.navigator.closeSettings()

    fun saveSetting(field: SettingField, value: String) {
        viewModelScope.launch { deps.settingsActions.save(field, value) }
    }

    fun dismissInputError() = deps.settingsActions.dismissRefused()

    fun testConnection() {
        viewModelScope.launch { deps.settingsActions.testConnection() }
    }

    /** Called when the app comes back to the front, e.g. after the user visited the exact-alarm setting. */
    fun refreshExactAlarmPermission() {
        exactAlarmsAllowed.value = deps.exactAlarmsAllowed()
    }

    private fun present(
        device: DeviceState,
        sensors: SensorState,
        serverState: ServerState,
        settings: SettingsState,
        overlays: Overlays,
    ): WatchUiState {
        val server = serverState.snapshot
        return WatchUiState(
            header = HeaderPresenter.header(device.now, device.batteryPercent),
            home = HomePresenter.home(
                server.statuses, serverState.points, settings.settings.astronautId, NotePresenter.unreadPill(overlays.note.notes),
            ),
            pages = readingsPresenter.pages(
                ReadingsInput(
                    newest = NewestReadings.merge(sensors.local.values, server.readings),
                    statuses = server.statuses,
                    schedule = device.schedule,
                    derived = server.derived,
                    exactAlarmsAllowed = device.exactAlarmsAllowed,
                    unavailableSensors = sensors.unavailable,
                    samsungSensorsNote = sensors.samsungNote,
                    now = device.now,
                ),
            ),
            settings = settingsPresenter.settings(settings.settings, settings.status, settings.crewNames, settings.refused),
            overlay = OverlayPresenter.overlay(
                measurement = overlays.measurement?.let { measurementPresenter.measurement(it, settings.status.lastUpload) },
                note = NotePresenter.note(overlays.note.open, overlays.note.notes, overlays.note.alertTitles),
                food = overlays.food,
                settingsOpen = overlays.settingsOpen,
            ),
        )
    }

    private data class DeviceState(
        val now: ZonedDateTime,
        val batteryPercent: Int?,
        val schedule: List<ScheduledTask>?,
        val exactAlarmsAllowed: Boolean,
    )

    private data class ServerState(val snapshot: ServerSnapshot, val points: PointsSummary?)

    private data class SensorState(val local: Map<Metric, Reading>, val unavailable: Set<Metric>, val samsungNote: String?)

    private data class SettingsState(
        val settings: ConnectionSettings,
        val status: ConnectionStatus,
        val crewNames: Map<String, String>,
        val refused: RefusedInput?,
    )

    private data class NoteState(val open: OpenNote?, val notes: List<SurgeonNote>, val alertTitles: Map<String, String>)

    private data class Overlays(
        val measurement: MeasurementProgress?,
        val food: FoodTodayUi?,
        val note: NoteState,
        val settingsOpen: Boolean,
    )

    private companion object {
        const val STOP_TIMEOUT_MS = 5_000L
    }
}
