package org.heartbeat.watch.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import org.heartbeat.watch.domain.Status
import org.heartbeat.watch.ui.theme.LocalMockupScale
import org.heartbeat.watch.ui.theme.MockupColors
import org.heartbeat.watch.ui.theme.MockupType
import org.heartbeat.watch.ui.theme.StatusStyle

/** What one list row shows (approved mockup watch-list-large). */
data class RowContent(
    val label: String,
    val note: String,
    val value: String,
    val unit: String,
    val valuePx: Int,
    val status: Status? = null,
    val unitAttached: Boolean = false,
    val valueIsText: Boolean = false,
)

/**
 * A reading row: label (24 px) and note (20 px) on the left in muted gray, the value in bold mono with its unit on the
 * right. A watch or alert reading gets a 2 px border in its status color and its symbol after the label; a reading
 * without a status from the server keeps the neutral border.
 */
@Composable
fun ReadingRow(content: RowContent, onClick: (() -> Unit)? = null) {
    val scale = LocalMockupScale.current
    val style = content.status?.let(StatusStyle::of)
    val flagged = style != null && style != StatusStyle.NORMAL
    ListRow(
        border = if (flagged) style.color else MockupColors.Border,
        borderPx = if (flagged) STATUS_BORDER_PX else BORDER_PX,
        onClick = onClick,
    ) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(scale.dp(GAP_PX)),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Row(horizontalArrangement = Arrangement.spacedBy(scale.dp(6))) {
                    MockupText(content.label, MockupType.ROW_LABEL, color = MockupColors.Muted, maxLines = 1)
                    style?.let { MockupText(it.symbol, MockupType.ROW_LABEL, color = it.color, weight = FontWeight.Bold) }
                }
                MockupText(content.note, MockupType.NOTE, color = MockupColors.Muted, maxLines = NOTE_LINES)
            }
            ValueWithUnit(
                value = content.value,
                unit = content.unit,
                valuePx = content.valuePx,
                unitPx = MockupType.UNIT,
                unitAttached = content.unitAttached,
                valueIsText = content.valueIsText,
                textValuePx = MockupType.TEXT_VALUE,
            )
        }
    }
}

private const val GAP_PX = 10

/** A note may wrap once: times carry "UTC", which a single line next to a large number cannot always fit. */
private const val NOTE_LINES = 2
private const val BORDER_PX = 1
private const val STATUS_BORDER_PX = 2
