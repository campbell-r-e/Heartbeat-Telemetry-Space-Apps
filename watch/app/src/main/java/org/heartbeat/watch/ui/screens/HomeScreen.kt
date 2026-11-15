package org.heartbeat.watch.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import org.heartbeat.watch.domain.Area
import org.heartbeat.watch.ui.components.MockupText
import org.heartbeat.watch.ui.model.AreaDotUi
import org.heartbeat.watch.ui.model.HeaderUi
import org.heartbeat.watch.ui.model.HomeUi
import org.heartbeat.watch.ui.model.StatusSummaryUi
import org.heartbeat.watch.ui.theme.LocalMockupScale
import org.heartbeat.watch.ui.theme.MockupColors
import org.heartbeat.watch.ui.theme.MockupFonts
import org.heartbeat.watch.ui.theme.MockupScale
import org.heartbeat.watch.ui.theme.MockupType
import org.heartbeat.watch.ui.theme.StatusStyle

/**
 * Home, approved mockup watch-home-large: six 106 px area dots around the clock, the day and battery, then, once the
 * server has provided them, the points and streak in one small line ("1,240 pts · 9d", owner decision, in the blue mono
 * of watch-home-B), and the summary; below it the blue "✉ 1 note" pill while notes wait unread (watch-notes-large,
 * screen 4).
 */
@Composable
fun HomeScreen(header: HeaderUi, home: HomeUi, onAreaSelected: (Area) -> Unit, onOpenNotes: () -> Unit) {
    val scale = LocalMockupScale.current
    Box(Modifier.size(scale.dp(MockupScale.MOCKUP_SCREEN_PX))) {
        home.dots.forEach { AreaDot(it, onAreaSelected) }
        Column(
            modifier = Modifier
                .offset(scale.dp(CENTER_LEFT_PX), scale.dp(CENTER_TOP_PX))
                .size(scale.dp(CENTER_WIDTH_PX), scale.dp(CENTER_HEIGHT_PX)),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(scale.dp(2), Alignment.CenterVertically),
        ) {
            MockupText(header.time, MockupType.HOME_CLOCK, weight = FontWeight.Bold, family = MockupFonts.Mono, maxLines = 1)
            MockupText(header.dayAndBattery, MockupType.HOME_LABEL, color = MockupColors.Muted)
            home.pointsLine?.let {
                MockupText(it, MockupType.HOME_LABEL, color = MockupColors.Accent, family = MockupFonts.Mono, maxLines = 1)
            }
            StatusSummary(home.summary)
            home.notesPill?.let { NotesPill(it, onOpenNotes) }
        }
    }
}

/** "● All normal", or "■ 1 Alert" and "▲ 2 Watch"; nothing before the server has rated any area. */
@Composable
private fun StatusSummary(summary: StatusSummaryUi) {
    val scale = LocalMockupScale.current
    val top = Modifier.padding(top = scale.dp(4))
    when (summary) {
        StatusSummaryUi.None -> Unit
        StatusSummaryUi.AllNormal -> SummaryLine("${StatusStyle.NORMAL.symbol} All normal", StatusStyle.NORMAL, top)
        is StatusSummaryUi.Counts -> {
            if (summary.alerts > 0) SummaryLine("${StatusStyle.ALERT.symbol} ${summary.alerts} Alert", StatusStyle.ALERT, top)
            if (summary.watches > 0) SummaryLine("${StatusStyle.WATCH.symbol} ${summary.watches} Watch", StatusStyle.WATCH, top)
        }
    }
}

/** Opens the oldest unread note. */
@Composable
private fun NotesPill(label: String, onOpen: () -> Unit) {
    val scale = LocalMockupScale.current
    val shape = RoundedCornerShape(scale.dp(NOTES_PILL_RADIUS_PX))
    MockupText(
        label, MockupType.HOME_SUMMARY,
        Modifier
            .padding(top = scale.dp(4))
            .clip(shape)
            .clickable(onClickLabel = "Open the note", role = Role.Button, onClick = onOpen)
            .border(scale.dp(RING_PX), MockupColors.Accent, shape)
            .padding(horizontal = scale.dp(NOTES_PILL_PADDING_PX), vertical = scale.dp(2)),
        color = MockupColors.Accent, weight = FontWeight.Bold, maxLines = 1,
    )
}

@Composable
private fun SummaryLine(text: String, style: StatusStyle, modifier: Modifier) {
    MockupText(text, MockupType.HOME_SUMMARY, modifier, color = style.color, weight = FontWeight.Bold)
}

/**
 * One 106 px area dot, the whole dot a tap target. With a server status it uses that status's color, tint and symbol
 * (alerts get a thicker ring); until then it is neutral: a "○" and ring in #3A4250 on the panel color.
 */
@Composable
private fun AreaDot(dot: AreaDotUi, onSelected: (Area) -> Unit) {
    val scale = LocalMockupScale.current
    val style = dot.status?.let(StatusStyle::of)
    val color = style?.color ?: MockupColors.PageDotOff
    val position = DOT_POSITIONS_PX.getValue(dot.area)
    Column(
        modifier = Modifier
            .offset(scale.dp(position.first), scale.dp(position.second))
            .size(scale.dp(DOT_PX))
            .clip(CircleShape)
            .clickable(onClickLabel = "Open ${dot.label}", role = Role.Button) { onSelected(dot.area) }
            .semantics { contentDescription = dot.label }
            .background(style?.color?.copy(alpha = style.dotFillAlpha) ?: MockupColors.Panel, CircleShape)
            .border(scale.dp(if (style?.isAlert == true) ALERT_RING_PX else RING_PX), color, CircleShape),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(scale.dp(4), Alignment.CenterVertically),
    ) {
        MockupText(style?.symbol ?: NEUTRAL_SYMBOL, MockupType.HOME_SYMBOL, color = color, lineHeightPx = MockupType.HOME_SYMBOL)
        MockupText(dot.label, MockupType.HOME_LABEL, weight = FontWeight.Bold)
    }
}

private const val NEUTRAL_SYMBOL = "○"
private const val DOT_PX = 106
private const val RING_PX = 2
private const val ALERT_RING_PX = 4
private const val CENTER_LEFT_PX = 120
private const val CENTER_TOP_PX = 140
private const val CENTER_WIDTH_PX = 210
private const val CENTER_HEIGHT_PX = 170
private const val NOTES_PILL_RADIUS_PX = 20
private const val NOTES_PILL_PADDING_PX = 14

/** Left/top of each dot inside the 450 px circle, from the mockup. */
private val DOT_POSITIONS_PX = mapOf(
    Area.VITALS to (172 to 8),
    Area.RADIATION to (322 to 92),
    Area.GRAVITY to (322 to 254),
    Area.CABIN to (172 to 338),
    Area.FOOD to (22 to 254),
    Area.MIND to (22 to 92),
)
