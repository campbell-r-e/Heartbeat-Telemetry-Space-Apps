package org.heartbeat.watch.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import org.heartbeat.watch.ui.theme.LocalMockupScale
import org.heartbeat.watch.ui.theme.MockupColors
import org.heartbeat.watch.ui.theme.MockupTouch
import org.heartbeat.watch.ui.theme.MockupType

/** The two pill looks in the mockups: accent (Test connection, Cancel, Done) and secondary (Edit, Save). */
enum class PillStyle { ACCENT, SECONDARY }

private data class PillColors(val fill: Color, val border: Color, val text: Color)

/** A 64 px tall (large-layout touch target), fully rounded pill button, styled as in the approved mockups. */
@Composable
fun PillButton(
    label: String,
    enabled: Boolean = true,
    style: PillStyle = PillStyle.ACCENT,
    horizontalPaddingPx: Int = if (style == PillStyle.ACCENT) ACCENT_PADDING_PX else SECONDARY_PADDING_PX,
    onClick: () -> Unit,
) {
    val scale = LocalMockupScale.current
    val shape = RoundedCornerShape(scale.dp(PILL_HEIGHT_PX / 2))
    val colors = colorsFor(style, enabled)
    Box(
        modifier = Modifier
            .height(scale.dp(PILL_HEIGHT_PX))
            .background(colors.fill, shape)
            .border(scale.dp(1), colors.border, shape)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = scale.dp(horizontalPaddingPx)),
        contentAlignment = Alignment.Center,
    ) {
        MockupText(
            label, MockupType.BUTTON, color = colors.text,
            weight = if (style == PillStyle.ACCENT) FontWeight.Bold else FontWeight.SemiBold,
        )
    }
}

private fun colorsFor(style: PillStyle, enabled: Boolean): PillColors =
    when {
        style == PillStyle.ACCENT -> PillColors(MockupColors.Accent.copy(alpha = ACCENT_FILL_ALPHA), MockupColors.Accent, MockupColors.Accent)
        enabled -> PillColors(MockupColors.Panel, MockupColors.Border, MockupColors.Text)
        else -> PillColors(Color.Transparent, MockupColors.PageDotOff, MockupColors.Disabled)
    }

private const val PILL_HEIGHT_PX = MockupTouch.BUTTON_HEIGHT
private const val ACCENT_PADDING_PX = 30
private const val SECONDARY_PADDING_PX = 28
private const val ACCENT_FILL_ALPHA = 0.16f
