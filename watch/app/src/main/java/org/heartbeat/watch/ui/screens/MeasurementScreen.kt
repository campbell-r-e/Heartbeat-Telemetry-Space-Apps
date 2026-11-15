package org.heartbeat.watch.ui.screens

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import org.heartbeat.watch.domain.MeasurementKind
import org.heartbeat.watch.ui.components.MockupIcon
import org.heartbeat.watch.ui.components.MockupIcons
import org.heartbeat.watch.ui.components.MockupText
import org.heartbeat.watch.ui.components.PillButton
import org.heartbeat.watch.ui.components.PillStyle
import org.heartbeat.watch.ui.components.ValueWithUnit
import org.heartbeat.watch.ui.components.card
import org.heartbeat.watch.ui.model.HeaderUi
import org.heartbeat.watch.ui.model.MeasurementUi
import org.heartbeat.watch.ui.theme.LocalMockupScale
import org.heartbeat.watch.ui.theme.MockupColors
import org.heartbeat.watch.ui.theme.MockupFonts
import org.heartbeat.watch.ui.theme.MockupScale
import org.heartbeat.watch.ui.theme.MockupType
import org.heartbeat.watch.ui.theme.StatusStyle

/**
 * The SpO₂ / ECG screens: approved mockups watch-measure-spo2 (an indeterminate ring and "Measuring…"),
 * watch-measure-ecg (the 30 s countdown), watch-measure-result and watch-measure-failed, in the large type scale.
 */
@Composable
fun MeasurementScreen(header: HeaderUi, measurement: MeasurementUi, onClose: () -> Unit, onRetry: (MeasurementKind) -> Unit) {
    when (measurement) {
        is MeasurementUi.Measuring -> Measuring(measurement, onClose)
        is MeasurementUi.Result -> Result(header, measurement, onClose)
        is MeasurementUi.Failed -> Failed(measurement, onClose, onRetry = { onRetry(measurement.kind) })
    }
}

@Composable
private fun Measuring(measuring: MeasurementUi.Measuring, onCancel: () -> Unit) {
    val scale = LocalMockupScale.current
    val isEcg = measuring.kind == MeasurementKind.ECG
    Box(Modifier.size(scale.dp(MockupScale.MOCKUP_SCREEN_PX))) {
        val progress = measuring.progress
        if (progress == null) SpinningRing() else ProgressRing(progress)
        if (isEcg) TopButtonPointer()
        Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(scale.dp(8), Alignment.CenterVertically),
        ) {
            MockupText(measuring.title, MockupType.TITLE, Modifier.padding(top = scale.dp(if (isEcg) 30 else 0)), weight = FontWeight.Bold)
            if (isEcg) EcgTrace(measuring.trace)
            val secondsLeft = measuring.secondsLeft
            if (secondsLeft == null) {
                MockupText("Measuring…", MEASURING_PX, weight = FontWeight.Bold)
            } else {
                ValueWithUnit(secondsLeft.toString(), "s left", valuePx = MockupType.ROW_VALUE, unitPx = MockupType.UNIT)
            }
            InstructionTile(measuring.instruction)
            PillButton("Cancel", onClick = onCancel)
        }
    }
}

@Composable
private fun Result(header: HeaderUi, result: MeasurementUi.Result, onDone: () -> Unit) {
    val scale = LocalMockupScale.current
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(scale.dp(8), Alignment.CenterVertically),
    ) {
        MockupText(header.time, MockupType.CLOCK, family = MockupFonts.Mono)
        MockupText(result.title, MockupType.TITLE, weight = FontWeight.Bold)
        ValueWithUnit(result.value, result.unit, valuePx = RESULT_VALUE_PX, unitPx = MockupType.ROW_LABEL)
        SentLine(result.sentLine)
        MockupText(
            "Status appears once the server's rules check it.", MockupType.NOTE, Modifier.width(scale.dp(NOTE_WIDTH_PX)),
            color = MockupColors.Muted, textAlign = TextAlign.Center,
        )
        PillButton("Done", horizontalPaddingPx = DONE_PADDING_PX, onClick = onDone)
    }
}

/** Approved mockup watch-measure-failed: what went wrong, advice, "Nothing was sent", Close and Try again. */
@Composable
private fun Failed(failed: MeasurementUi.Failed, onClose: () -> Unit, onRetry: () -> Unit) {
    val scale = LocalMockupScale.current
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(scale.dp(8), Alignment.CenterVertically),
    ) {
        MockupText(failed.title, MockupType.TITLE, weight = FontWeight.Bold)
        MockupText("${StatusStyle.WATCH.symbol} Couldn't get a reading", MockupType.BODY, color = MockupColors.Watch, weight = FontWeight.Bold)
        InstructionTile(failed.advice)
        MockupText("Nothing was sent to the server.", MockupType.NOTE, color = MockupColors.Muted)
        Row(Modifier.padding(top = scale.dp(4)), horizontalArrangement = Arrangement.spacedBy(scale.dp(10))) {
            PillButton("Close", style = PillStyle.SECONDARY, onClick = onClose)
            PillButton("Try again", onClick = onRetry)
        }
    }
}

/** A check and "Sent to server · 14:06" once the reading is on the server; "Waiting to send" until then. */
@Composable
private fun SentLine(sentLine: String?) {
    val scale = LocalMockupScale.current
    Row(horizontalArrangement = Arrangement.spacedBy(scale.dp(6)), verticalAlignment = Alignment.CenterVertically) {
        if (sentLine != null) MockupIcon(MockupIcons.Check, null, MockupType.NOTE, MockupColors.Normal)
        MockupText(sentLine ?: "Waiting to send…", MockupType.NOTE, color = MockupColors.Muted)
    }
}

@Composable
private fun InstructionTile(text: String) {
    val scale = LocalMockupScale.current
    MockupText(
        text = text,
        sizePx = MockupType.BODY,
        modifier = Modifier
            .width(scale.dp(INSTRUCTION_WIDTH_PX))
            .card(scale, verticalPx = 10, horizontalPx = 18),
        color = MockupColors.Instruction,
        textAlign = TextAlign.Center,
    )
}

/** A 10 px ring of radius 208 around the edge: a #10151F track with the accent progress from 12 o'clock. */
@Composable
private fun ProgressRing(progress: Float) {
    val scale = LocalMockupScale.current
    Canvas(Modifier.size(scale.dp(MockupScale.MOCKUP_SCREEN_PX))) {
        val unit = size.width / MockupScale.MOCKUP_SCREEN_PX
        val stroke = RING_STROKE_PX * unit
        val radius = RING_RADIUS_PX * unit
        val topLeft = Offset(center.x - radius, center.y - radius)
        val arcSize = Size(radius * 2, radius * 2)
        drawArc(MockupColors.Panel, 0f, FULL_CIRCLE, false, topLeft, arcSize, style = Stroke(stroke))
        drawArc(MockupColors.Accent, START_AT_TOP, FULL_CIRCLE * progress.coerceIn(0f, 1f), false, topLeft, arcSize,
            style = Stroke(stroke, cap = StrokeCap.Round))
    }
}

/**
 * The SpO₂ sensor reports no progress, so the ring spins (indeterminate) until the result or the 60 s give-up
 * (approved mockup watch-measure-spo2, owner decision).
 */
@Composable
private fun SpinningRing() {
    val scale = LocalMockupScale.current
    val turn by rememberInfiniteTransition(label = "spo2 ring").animateFloat(
        initialValue = 0f,
        targetValue = FULL_CIRCLE,
        animationSpec = infiniteRepeatable(tween(SPIN_MILLIS, easing = LinearEasing)),
        label = "spo2 ring angle",
    )
    Canvas(Modifier.size(scale.dp(MockupScale.MOCKUP_SCREEN_PX))) {
        val unit = size.width / MockupScale.MOCKUP_SCREEN_PX
        val radius = RING_RADIUS_PX * unit
        val topLeft = Offset(center.x - radius, center.y - radius)
        val arcSize = Size(radius * 2, radius * 2)
        drawArc(MockupColors.Panel, 0f, FULL_CIRCLE, false, topLeft, arcSize, style = Stroke(RING_STROKE_PX * unit))
        drawArc(MockupColors.Accent, START_AT_TOP + turn, SPINNER_SWEEP, false, topLeft, arcSize,
            style = Stroke(RING_STROKE_PX * unit, cap = StrokeCap.Round))
    }
}

/** "Top button ↗", pointing at the key the ECG needs a fingertip on. */
@Composable
private fun TopButtonPointer() {
    val scale = LocalMockupScale.current
    Row(
        modifier = Modifier.offset(scale.dp(POINTER_LEFT_PX), scale.dp(POINTER_TOP_PX)),
        horizontalArrangement = Arrangement.spacedBy(scale.dp(6)),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        MockupText("Top button", MockupType.NOTE, color = MockupColors.Accent, weight = FontWeight.SemiBold)
        MockupIcon(MockupIcons.ArrowUpRight, null, POINTER_ICON_PX, MockupColors.Accent)
    }
}

/** The live ECG line, 300×60 px, drawn from the last two seconds of samples. */
@Composable
private fun EcgTrace(trace: List<Float>) {
    val scale = LocalMockupScale.current
    Canvas(Modifier.size(scale.dp(TRACE_WIDTH_PX), scale.dp(TRACE_HEIGHT_PX))) {
        if (trace.size < 2) return@Canvas
        val path = Path()
        trace.forEachIndexed { index, level ->
            val x = size.width * index / (trace.size - 1)
            val y = size.height * (1f - level)
            if (index == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }
        drawPath(path, MockupColors.Accent, style = Stroke(TRACE_STROKE_PX * size.width / TRACE_WIDTH_PX, join = StrokeJoin.Round))
    }
}

private const val RING_RADIUS_PX = 208f
private const val RING_STROKE_PX = 10f
private const val FULL_CIRCLE = 360f
private const val START_AT_TOP = -90f
private const val INSTRUCTION_WIDTH_PX = 340
private const val NOTE_WIDTH_PX = 330
private const val DONE_PADDING_PX = 36
private const val MEASURING_PX = 40
private const val RESULT_VALUE_PX = 72
private const val SPINNER_SWEEP = 90f
private const val SPIN_MILLIS = 1400
private const val POINTER_ICON_PX = 28

/** Near the top-right, toward the top button, as in the mockup (wider for the larger text). */
private const val POINTER_LEFT_PX = 262
private const val POINTER_TOP_PX = 40
private const val TRACE_WIDTH_PX = 300f
private const val TRACE_HEIGHT_PX = 60f
private const val TRACE_STROKE_PX = 2.5f
