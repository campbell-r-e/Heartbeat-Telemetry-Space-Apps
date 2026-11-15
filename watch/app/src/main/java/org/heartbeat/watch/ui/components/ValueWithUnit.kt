package org.heartbeat.watch.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.wear.compose.material3.Text
import org.heartbeat.watch.ui.theme.LocalMockupScale
import org.heartbeat.watch.ui.theme.MockupColors
import org.heartbeat.watch.ui.theme.MockupFonts

/**
 * A value in bold JetBrains Mono followed by its unit in muted Inter, as every number in the mockups is drawn
 * ("72 bpm", "18 s left", "1.5×"). A worded value ("Not taken yet") is drawn in Inter at [textValuePx] instead.
 */
@Composable
fun ValueWithUnit(
    value: String,
    unit: String,
    valuePx: Number,
    unitPx: Number,
    modifier: Modifier = Modifier,
    unitAttached: Boolean = false,
    lineHeightPx: Number = valuePx,
    valueIsText: Boolean = false,
    textValuePx: Number = valuePx,
) {
    val scale = LocalMockupScale.current
    val unitStyle = SpanStyle(fontFamily = MockupFonts.Inter, fontSize = scale.sp(unitPx), fontWeight = FontWeight.Medium, color = MockupColors.Muted)
    Text(
        text = buildAnnotatedString {
            append(value)
            if (unit.isNotEmpty()) withStyle(unitStyle) { append((if (unitAttached) "" else " ") + unit) }
        },
        modifier = modifier,
        maxLines = 1,
        overflow = TextOverflow.Clip,
        style = TextStyle(
            color = MockupColors.Text,
            fontFamily = if (valueIsText) MockupFonts.Inter else MockupFonts.Mono,
            fontWeight = if (valueIsText) FontWeight.SemiBold else FontWeight.Bold,
            fontSize = scale.sp(if (valueIsText) textValuePx else valuePx),
            lineHeight = scale.sp(lineHeightPx),
            textAlign = TextAlign.End,
        ),
    )
}
