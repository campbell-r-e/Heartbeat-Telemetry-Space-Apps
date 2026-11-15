package org.heartbeat.watch.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import org.heartbeat.watch.settings.SettingField
import org.heartbeat.watch.ui.components.ClockAndTitle
import org.heartbeat.watch.ui.components.ListRow
import org.heartbeat.watch.ui.components.ListScreen
import org.heartbeat.watch.ui.components.MockupText
import org.heartbeat.watch.ui.components.PillButton
import org.heartbeat.watch.ui.components.PillStyle
import org.heartbeat.watch.ui.components.card
import org.heartbeat.watch.ui.model.ConnectionStatusUi
import org.heartbeat.watch.ui.model.ConnectionTone
import org.heartbeat.watch.ui.model.HeaderUi
import org.heartbeat.watch.ui.model.InputErrorUi
import org.heartbeat.watch.ui.model.SettingRowUi
import org.heartbeat.watch.ui.model.SettingsUi
import org.heartbeat.watch.ui.theme.LocalMockupScale
import org.heartbeat.watch.ui.theme.MockupColors
import org.heartbeat.watch.ui.theme.MockupFonts
import org.heartbeat.watch.ui.theme.MockupType

/**
 * Connection settings as a scrolling list, approved mockup watch-settings-large: the status first (connected, not
 * tested yet, or why it failed), then the server, token and astronaut rows, then the test button.
 */
@Composable
fun SettingsScreen(
    header: HeaderUi,
    settings: SettingsUi,
    onBack: () -> Unit,
    onEdit: (SettingField) -> Unit,
    onTest: () -> Unit,
) {
    ListScreen(time = header.time, title = "Connection", onBack = onBack) {
        item { StatusLine(settings.status) }
        settings.lossesLine?.let { line -> item { Caption(line) } }
        settings.rows.forEach { row -> item(key = row.field) { SettingRow(row, onEdit) } }
        item { Box(Modifier.padding(top = LocalMockupScale.current.dp(4))) { PillButton(settings.buttonLabel, enabled = !settings.testing, onClick = onTest) } }
    }
}

/** A refused value, approved mockup watch-settings-input-error in the large scale: red-bordered field, message, example, Edit / Save. */
@Composable
fun InputErrorScreen(header: HeaderUi, error: InputErrorUi, onBack: () -> Unit, onEdit: () -> Unit) {
    val scale = LocalMockupScale.current
    Column(
        modifier = Modifier.fillMaxSize().padding(top = scale.dp(HEADER_TOP_PX)),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(scale.dp(10)),
    ) {
        ClockAndTitle(header.time, error.title, onBack)
        Column(
            modifier = Modifier
                .width(scale.dp(FIELD_WIDTH_PX))
                .card(scale, border = MockupColors.Alert, borderPx = 2),
        ) {
            MockupText(error.fieldLabel, MockupType.FIELD_LABEL, color = MockupColors.Muted)
            MockupText(error.enteredValue, MockupType.FIELD_VALUE, family = MockupFonts.Mono, maxLines = 1)
        }
        MockupText(error.message, MockupType.BODY, Modifier.width(scale.dp(FIELD_WIDTH_PX)), color = MockupColors.Alert, weight = FontWeight.SemiBold, textAlign = TextAlign.Center)
        MockupText(error.hint, MockupType.NOTE, Modifier.width(scale.dp(HINT_WIDTH_PX)), color = MockupColors.Muted, textAlign = TextAlign.Center)
        Row(horizontalArrangement = Arrangement.spacedBy(scale.dp(10))) {
            PillButton("Edit", style = PillStyle.SECONDARY, onClick = onEdit)
            PillButton("Save", enabled = false, style = PillStyle.SECONDARY, onClick = {})
        }
    }
}

/** "● Connected" in green, "○ Not tested yet" in gray, or "■ Can't reach server" in red, with what it means below. */
@Composable
private fun StatusLine(status: ConnectionStatusUi) {
    val color = when (status.tone) {
        ConnectionTone.NEUTRAL -> MockupColors.Muted
        ConnectionTone.CONNECTED -> MockupColors.Normal
        ConnectionTone.FAILED -> MockupColors.Alert
    }
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        MockupText(status.headline, MockupType.STATUS, color = color, weight = FontWeight.Bold, textAlign = TextAlign.Center)
        Caption(status.detail)
    }
}

@Composable
private fun Caption(text: String) {
    MockupText(text, MockupType.NOTE, Modifier.fillMaxWidth(), color = MockupColors.Muted, textAlign = TextAlign.Center)
}

/** A tappable field row: 22 px label over a 30 px mono value. */
@Composable
private fun SettingRow(row: SettingRowUi, onEdit: (SettingField) -> Unit) {
    ListRow(modifier = Modifier.fillMaxWidth(), onClick = { onEdit(row.field) }) {
        Column {
            MockupText(row.label, MockupType.FIELD_LABEL, color = MockupColors.Muted)
            MockupText(row.value, MockupType.FIELD_VALUE, family = MockupFonts.Mono, maxLines = 1)
        }
    }
}

private const val HEADER_TOP_PX = 18
private const val FIELD_WIDTH_PX = 382
private const val HINT_WIDTH_PX = 340
