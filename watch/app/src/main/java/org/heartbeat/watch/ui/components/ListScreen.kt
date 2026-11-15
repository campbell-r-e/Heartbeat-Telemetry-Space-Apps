package org.heartbeat.watch.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.ScalingLazyColumnDefaults
import androidx.wear.compose.foundation.lazy.ScalingLazyListAnchorType
import androidx.wear.compose.foundation.lazy.ScalingLazyListScope
import androidx.wear.compose.foundation.lazy.ScalingLazyListState
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material3.ScrollIndicator
import androidx.wear.compose.material3.ScrollIndicatorDefaults
import org.heartbeat.watch.ui.theme.LocalMockupScale
import org.heartbeat.watch.ui.theme.MockupColors
import org.heartbeat.watch.ui.theme.MockupFonts
import org.heartbeat.watch.ui.theme.MockupScale
import org.heartbeat.watch.ui.theme.MockupType

/**
 * The shared list page of the approved large mockups (watch-list-large): the clock and title fixed at the top,
 * full-width rows below that scroll (touch or rotary), the row at the bottom edge fading out, and a scroll bar on
 * the right.
 */
@Composable
fun ListScreen(
    time: String,
    title: String,
    onBack: (() -> Unit)? = null,
    content: ScalingLazyListScope.() -> Unit,
) {
    val scale = LocalMockupScale.current
    val state = rememberScalingLazyListState(initialCenterItemIndex = 0)
    Box(Modifier.fillMaxSize()) {
        Box(
            Modifier
                .fillMaxSize()
                .padding(top = scale.dp(LIST_TOP_PX)),
        ) {
            ScalingLazyColumn(
                modifier = Modifier.fillMaxSize(),
                state = state,
                contentPadding = PaddingValues(start = scale.dp(SIDE_PX), end = scale.dp(SIDE_PX), bottom = scale.dp(BOTTOM_PX)),
                verticalArrangement = Arrangement.spacedBy(scale.dp(ROW_GAP_PX)),
                autoCentering = null,
                anchorType = ScalingLazyListAnchorType.ItemStart,
                scalingParams = ScalingLazyColumnDefaults.scalingParams(edgeScale = 1f, edgeAlpha = EDGE_ALPHA),
                content = content,
            )
        }
        ClockAndTitle(time, title, onBack, Modifier.offset(y = scale.dp(HEADER_TOP_PX)))
        ScrollBar(state)
    }
}

/** The fixed header: the clock in mono and the page title, with a back chevron on sub-screens. */
@Composable
fun ClockAndTitle(time: String, title: String, onBack: (() -> Unit)?, modifier: Modifier = Modifier) {
    val scale = LocalMockupScale.current
    Column(
        modifier = modifier
            .width(scale.dp(MockupScale.MOCKUP_SCREEN_PX))
            .background(MockupColors.Background),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(scale.dp(2)),
    ) {
        MockupText(time, MockupType.CLOCK, family = MockupFonts.Mono)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(scale.dp(8))) {
            onBack?.let { back ->
                Box(
                    Modifier
                        .clip(CircleShape)
                        .clickable(onClickLabel = "Back", onClick = back),
                ) { MockupIcon(MockupIcons.ChevronBack, "Back", BACK_ICON_PX, MockupColors.Muted) }
            }
            MockupText(title, MockupType.TITLE, weight = FontWeight.Bold, maxLines = 1)
        }
    }
}

/**
 * The standard curved Wear OS scroll indicator (approved in place of the mockup's straight bar), in the mockup's colors:
 * muted thumb on a #253045 track. Shown only when the list is longer than the screen.
 */
@Composable
private fun ScrollBar(state: ScalingLazyListState) {
    if (!state.canScrollForward && !state.canScrollBackward) return
    ScrollIndicator(
        state = state,
        modifier = Modifier.fillMaxSize(),
        colors = ScrollIndicatorDefaults.colors(indicatorColor = MockupColors.Muted, trackColor = MockupColors.Border),
    )
}

/** One full-width list row, tappable when [onClick] is set. */
@Composable
fun ListRow(
    modifier: Modifier = Modifier,
    border: Color = MockupColors.Border,
    borderPx: Int = 1,
    onClick: (() -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    val scale = LocalMockupScale.current
    val tap = onClick?.let { Modifier.clip(RoundedCornerShape(scale.dp(ROW_RADIUS_PX))).clickable(onClick = it) } ?: Modifier
    Box(
        modifier
            .then(tap)
            .card(scale, border = border, borderPx = borderPx),
    ) { content() }
}

private const val HEADER_TOP_PX = 18
private const val LIST_TOP_PX = 104
private const val SIDE_PX = 34
private const val BOTTOM_PX = 40
private const val ROW_GAP_PX = 10
private const val ROW_RADIUS_PX = 28
private const val EDGE_ALPHA = 0.45f
private const val BACK_ICON_PX = 26
