package org.heartbeat.watch.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.wear.compose.foundation.lazy.ScalingLazyListScope
import org.heartbeat.watch.domain.MeasurementKind
import org.heartbeat.watch.ui.components.ListScreen
import org.heartbeat.watch.ui.components.MockupIcons
import org.heartbeat.watch.ui.components.MockupText
import org.heartbeat.watch.ui.components.PillButton
import org.heartbeat.watch.ui.components.ReadingRow
import org.heartbeat.watch.ui.components.RoundIconButton
import org.heartbeat.watch.ui.components.RowContent
import org.heartbeat.watch.ui.model.HeaderUi
import org.heartbeat.watch.ui.model.ReadingsPage
import org.heartbeat.watch.ui.model.ReadingsPageUi
import org.heartbeat.watch.ui.model.TileUi
import org.heartbeat.watch.ui.theme.LocalMockupScale
import org.heartbeat.watch.ui.theme.MockupColors
import org.heartbeat.watch.ui.theme.MockupType
import org.heartbeat.watch.ui.theme.StatusStyle

/**
 * A readings page as a scrolling list, approved mockups watch-vitals-large and watch-list-large (recovery, cabin):
 * one reading per row, the Cabin list ending with the gear to Connection settings.
 */
@Composable
fun ReadingsScreen(
    header: HeaderUi,
    page: ReadingsPageUi,
    onMeasure: (MeasurementKind) -> Unit,
    onOpenSettings: () -> Unit,
    onAllowExactAlarms: () -> Unit,
) {
    ListScreen(time = header.time, title = page.heading) {
        if (page.showsRemindersLateNotice) item { RemindersLateNotice(onAllowExactAlarms) }
        readingRows(page, onMeasure)
        if (page.showsSettingsButton) {
            item { RoundIconButton(MockupIcons.Gear, "Connection settings", sizePx = GEAR_PX, iconPx = GEAR_ICON_PX, onClick = onOpenSettings) }
        }
    }
}

private fun ScalingLazyListScope.readingRows(page: ReadingsPageUi, onMeasure: (MeasurementKind) -> Unit) {
    page.tiles.forEach { tile ->
        item(key = tile.label) {
            ReadingRow(rowContent(tile, page.page), onClick = tile.measurement?.let { kind -> { onMeasure(kind) } })
        }
    }
}

private fun rowContent(tile: TileUi, page: ReadingsPage) =
    RowContent(
        label = tile.label,
        note = tile.note,
        value = tile.value,
        unit = tile.unit,
        valuePx = valuePx(tile, page),
        status = tile.status,
        unitAttached = tile.unitAttached,
        valueIsText = tile.valueIsText,
    )

/** Vitals numbers are 60 px, the other lists 56 px, and a number with a long unit ("/120 min") 52 px. */
private fun valuePx(tile: TileUi, page: ReadingsPage): Int =
    when {
        tile.longUnit -> MockupType.EXERCISE_VALUE
        page == ReadingsPage.VITALS -> MockupType.VITALS_VALUE
        else -> MockupType.ROW_VALUE
    }

/**
 * "▲ Reminders may be late" with an Allow button (approved mockup watch-vitals-reminders-late), in the large type
 * scale: a yellow-tinted card at the top of the Vitals list.
 */
@Composable
private fun RemindersLateNotice(onAllow: () -> Unit) {
    val scale = LocalMockupScale.current
    val shape = RoundedCornerShape(scale.dp(NOTICE_RADIUS_PX))
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(MockupColors.Watch.copy(alpha = NOTICE_FILL_ALPHA), shape)
            .border(scale.dp(1), MockupColors.Watch, shape)
            .padding(horizontal = scale.dp(22), vertical = scale.dp(12)),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(scale.dp(6)),
    ) {
        MockupText("${StatusStyle.WATCH.symbol} Reminders may be late", MockupType.ROW_LABEL, color = MockupColors.Watch, weight = FontWeight.Bold)
        MockupText("Allow \"Alarms & reminders\" for exact times.", MockupType.NOTE, color = MockupColors.Instruction)
        Box(Modifier.padding(top = scale.dp(2))) { PillButton("Allow", onClick = onAllow) }
    }
}

private const val GEAR_PX = 64
private const val GEAR_ICON_PX = 32
private const val NOTICE_RADIUS_PX = 28
private const val NOTICE_FILL_ALPHA = 0.13f
