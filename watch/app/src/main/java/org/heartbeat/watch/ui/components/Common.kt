package org.heartbeat.watch.ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.wear.compose.material3.Text
import org.heartbeat.watch.ui.theme.LocalMockupScale
import org.heartbeat.watch.ui.theme.MockupColors
import org.heartbeat.watch.ui.theme.MockupFonts
import org.heartbeat.watch.ui.theme.MockupScale

/** Text in mockup pixels: [sizePx] is the CSS font-size from the mockup. */
@Composable
fun MockupText(
    text: String,
    sizePx: Number,
    modifier: Modifier = Modifier,
    color: Color = MockupColors.Text,
    weight: FontWeight = FontWeight.Normal,
    family: FontFamily = MockupFonts.Inter,
    maxLines: Int = Int.MAX_VALUE,
    lineHeightPx: Number? = null,
    textAlign: TextAlign = TextAlign.Unspecified,
) {
    val scale = LocalMockupScale.current
    Text(
        text = text,
        modifier = modifier,
        maxLines = maxLines,
        overflow = TextOverflow.Ellipsis,
        style = TextStyle(
            color = color,
            fontSize = scale.sp(sizePx),
            fontWeight = weight,
            fontFamily = family,
            lineHeight = lineHeightPx?.let(scale::sp) ?: TextStyle.Default.lineHeight,
            textAlign = textAlign,
        ),
    )
}

/** A round icon button, as the gear at the end of the Cabin list. */
@Composable
fun RoundIconButton(icon: ImageVector, contentDescription: String, sizePx: Number, iconPx: Number, onClick: () -> Unit) {
    val scale = LocalMockupScale.current
    Box(
        Modifier
            .size(scale.dp(sizePx))
            .background(MockupColors.Panel, CircleShape)
            .border(scale.dp(1), MockupColors.Border, CircleShape)
            .clickable(onClickLabel = contentDescription, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        MockupIcon(icon, contentDescription, iconPx, MockupColors.Muted)
    }
}

@Composable
fun MockupIcon(icon: ImageVector, contentDescription: String?, sizePx: Number, tint: Color) {
    Image(
        imageVector = icon,
        contentDescription = contentDescription,
        modifier = Modifier.size(LocalMockupScale.current.dp(sizePx)),
        colorFilter = ColorFilter.tint(tint),
    )
}

/**
 * The large mockups' row card: #10151F fill, 28 px corners, a 1 px #253045 border (2 px and a status color for
 * watch and alert readings and for input errors), and 12 × 22 px padding unless a screen says otherwise.
 */
fun Modifier.card(
    scale: MockupScale,
    verticalPx: Number = CARD_VERTICAL_PADDING_PX,
    horizontalPx: Number = CARD_SIDE_PADDING_PX,
    border: Color = MockupColors.Border,
    borderPx: Number = 1,
): Modifier {
    val shape = RoundedCornerShape(scale.dp(CARD_RADIUS_PX))
    return this
        .background(MockupColors.Panel, shape)
        .border(scale.dp(borderPx), border, shape)
        .padding(horizontal = scale.dp(horizontalPx), vertical = scale.dp(verticalPx))
}

private const val CARD_RADIUS_PX = 28
private const val CARD_VERTICAL_PADDING_PX = 12
private const val CARD_SIDE_PADDING_PX = 22
