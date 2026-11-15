package org.heartbeat.watch.ui.model

import org.heartbeat.watch.domain.Area
import org.heartbeat.watch.domain.MeasurementKind
import org.heartbeat.watch.domain.Status
import org.heartbeat.watch.settings.SettingField

/** Everything the screens draw. Composables only render these; they never decide anything. */
data class WatchUiState(
    val header: HeaderUi,
    val home: HomeUi,
    val pages: List<ReadingsPageUi>,
    val settings: SettingsUi,
    /** The screen drawn over the pager: a measurement, a note, Food today, Connection settings, or none. */
    val overlay: OverlayUi,
)

/** Time, date and battery, shown at the top of every screen. */
data class HeaderUi(
    /** "19:43 UTC". */
    val time: String,
    /** The UTC day and the battery, as the home screen shows them: "Sat 14 · 36%". */
    val dayAndBattery: String,
)

data class HomeUi(
    val dots: List<AreaDotUi>,
    /** What the center says about statuses; [StatusSummaryUi.None] until the server reports any. */
    val summary: StatusSummaryUi,
    /** `null` until the server reports points, e.g. "1,240 pts · 9d". */
    val pointsLine: String?,
    /** "✉ 1 note" while notes from the flight surgeon wait unread; `null` once all are read. */
    val notesPill: String? = null,
)

data class AreaDotUi(val area: Area, val label: String, val status: Status?)

sealed interface StatusSummaryUi {
    /** No statuses from the server yet: the neutral state, nothing shown. */
    data object None : StatusSummaryUi

    /** The server has statuses and none is yellow or red. */
    data object AllNormal : StatusSummaryUi

    /** Counts of areas in alert and watch; a zero count is not shown. */
    data class Counts(val alerts: Int, val watches: Int) : StatusSummaryUi
}

data class ReadingsPageUi(
    val page: ReadingsPage,
    val heading: String,
    val tiles: List<TileUi>,
    /** The gear to Connection settings, on the Cabin page. */
    val showsSettingsButton: Boolean = false,
    /** "▲ Reminders may be late" with an Allow button, while exact alarms are not allowed. */
    val showsRemindersLateNotice: Boolean = false,
)

data class TileUi(
    val label: String,
    val value: String,
    val unit: String,
    val note: String,
    /** `null` means "no status yet": the tile is drawn in the neutral style. */
    val status: Status?,
    /** Tapping the tile starts this measurement, when it has one. */
    val measurement: MeasurementKind?,
    /** The value is words ("Not taken yet"), drawn smaller than a number so it fits the tile. */
    val valueIsText: Boolean = false,
    /** The unit follows the value without a space, as in "1.5×". */
    val unitAttached: Boolean = false,
    /** A long unit ("/120 min") that needs a slightly smaller number to fit the row. */
    val longUnit: Boolean = false,
)

data class SettingsUi(
    val layout: SettingsLayout,
    val rows: List<SettingRowUi>,
    val status: ConnectionStatusUi,
    /** "3 readings rejected · 0 dropped (queue full)", only when any reading was lost. */
    val lossesLine: String?,
    val buttonLabel: String,
    val testing: Boolean,
    /** A typed value that was refused; shown on its own screen (approved mockup watch-settings-input-error). */
    val inputError: InputErrorUi?,
)

/** Which approved settings mockup the screen follows. */
enum class SettingsLayout {
    /** watch-settings: header, back chevron, three rows with chevrons. */
    NORMAL,

    /** watch-settings-not-tested: header, back chevron, three plain rows. */
    NOT_TESTED,

    /** watch-settings-failed: header, no back chevron, server and token rows only. */
    FAILED,
}

data class SettingRowUi(val field: SettingField, val label: String, val value: String)

data class ConnectionStatusUi(val headline: String, val detail: String, val tone: ConnectionTone)

enum class ConnectionTone { NEUTRAL, CONNECTED, FAILED }

data class InputErrorUi(
    val field: SettingField,
    val title: String,
    val fieldLabel: String,
    /** What was typed; a token is masked. */
    val enteredValue: String,
    val message: String,
    val hint: String,
)

/** The SpO₂ / ECG measurement screens (approved mockups watch-measure-spo2, -ecg and -result). */
sealed interface MeasurementUi {
    val kind: MeasurementKind
    val title: String

    data class Measuring(
        override val kind: MeasurementKind,
        override val title: String,
        /** ECG: recording time still needed (it only runs with a fingertip on the button); `null` for SpO₂ ("Measuring…"). */
        val secondsLeft: Int?,
        /** 0..1 for the ring around the edge; `null` spins it (SpO₂ reports no progress). */
        val progress: Float?,
        val instruction: String,
        /** The latest ECG trace scaled to 0..1 (top to bottom); empty for SpO₂. */
        val trace: List<Float>,
    ) : MeasurementUi

    data class Result(
        override val kind: MeasurementKind,
        override val title: String,
        val value: String,
        val unit: String,
        /** "Sent to server · 14:06" once an upload after the measurement succeeded; `null` while waiting to send. */
        val sentLine: String?,
    ) : MeasurementUi

    /** Approved mockup watch-measure-failed: nothing was sent; Close or Try again. */
    data class Failed(
        override val kind: MeasurementKind,
        override val title: String,
        val advice: String,
    ) : MeasurementUi
}
