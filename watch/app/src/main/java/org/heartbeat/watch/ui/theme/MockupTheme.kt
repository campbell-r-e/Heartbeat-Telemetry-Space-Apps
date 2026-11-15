package org.heartbeat.watch.ui.theme

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.heartbeat.watch.R
import org.heartbeat.watch.domain.Status

/** Colors from the approved watch mockups (mockups/watch-*.dc.html). */
object MockupColors {
    val Background = Color(0xFF000000)
    val Panel = Color(0xFF10151F)
    val Border = Color(0xFF253045)
    val Text = Color(0xFFE8EDF6)
    val Muted = Color(0xFF9AA6BA)
    val Accent = Color(0xFF7FB4FF)
    val PageDotOff = Color(0xFF3A4250)
    val Disabled = Color(0xFF6B7689)
    val Instruction = Color(0xFFC9D2E0)
    val Normal = Color(0xFF3DDC97)
    val Watch = Color(0xFFFFC24B)
    val Alert = Color(0xFFFF6B7A)
}

/**
 * The large-text type scale of the approved watch-*-large mockups, in physical pixels of the 450 px, 340 dpi screen.
 * Labels are at least 20 px, body text at least 24 px, numbers at least 44 px (owner decision after the 1.4" test).
 */
object MockupType {
    const val CLOCK = 26
    const val TITLE = 28
    const val STATUS = 26
    const val ROW_LABEL = 24
    const val BODY = 24
    const val BUTTON = 24
    const val UNIT = 22
    const val FIELD_LABEL = 22
    const val NOTE = 20
    /** A note from the flight surgeon (watch-notes-large). */
    const val NOTE_TEXT = 28
    const val FIELD_VALUE = 30
    const val TEXT_VALUE = 34
    const val SMALL_NUMBER = 44
    const val EXERCISE_VALUE = 52
    const val ROW_VALUE = 56
    const val VITALS_VALUE = 60
    const val HOME_CLOCK = 34
    const val HOME_SUMMARY = 24
    const val HOME_LABEL = 20
    const val HOME_SYMBOL = 26
}

/** Touch targets of the large layout: buttons are at least 64 px tall. */
object MockupTouch {
    const val BUTTON_HEIGHT = 64
}

/** How each status looks, exactly as in the mockups: a color and a symbol, so it never relies on color alone. */
enum class StatusStyle(val color: Color, val symbol: String, val dotFillAlpha: Float) {
    NORMAL(MockupColors.Normal, "●", 0.16f),
    WATCH(MockupColors.Watch, "▲", 0.18f),
    ALERT(MockupColors.Alert, "■", 0.22f);

    val isAlert: Boolean get() = this == ALERT

    companion object {
        fun of(status: Status): StatusStyle =
            when (status) {
                Status.NORMAL -> NORMAL
                Status.WATCH -> WATCH
                Status.ALERT -> ALERT
            }
    }
}

/** Inter for text, JetBrains Mono for numbers (both bundled under the SIL Open Font License; see watch/licenses). */
object MockupFonts {
    val Inter = FontFamily(
        interFont(FontWeight.Normal),
        interFont(FontWeight.Medium),
        interFont(FontWeight.SemiBold),
        interFont(FontWeight.Bold),
    )
    val Mono = FontFamily(monoFont(FontWeight.Medium), monoFont(FontWeight.Bold))

    @OptIn(ExperimentalTextApi::class)
    private fun interFont(weight: FontWeight) =
        Font(R.font.inter, weight, variationSettings = FontVariation.Settings(FontVariation.weight(weight.weight)))

    @OptIn(ExperimentalTextApi::class)
    private fun monoFont(weight: FontWeight) =
        Font(R.font.jetbrains_mono, weight, variationSettings = FontVariation.Settings(FontVariation.weight(weight.weight)))
}

/**
 * The mockups are drawn for a 450 px round screen. This converts mockup pixels to the real screen,
 * so the layout keeps the mockup's proportions on any watch size.
 */
class MockupScale(private val dpPerMockupPx: Float, private val fontScale: Float) {
    fun dp(mockupPx: Number): Dp = (mockupPx.toFloat() * dpPerMockupPx).dp

    /** Text sizes follow the mockup exactly, so the layout does not break with a larger system font. */
    fun sp(mockupPx: Number): TextUnit = (mockupPx.toFloat() * dpPerMockupPx / fontScale).sp

    companion object {
        const val MOCKUP_SCREEN_PX = 450f
    }
}

val LocalMockupScale = staticCompositionLocalOf { MockupScale(dpPerMockupPx = 1f, fontScale = 1f) }

@Composable
fun ProvideMockupScale(content: @Composable () -> Unit) {
    BoxWithConstraints {
        val scale = MockupScale(maxWidth.value / MockupScale.MOCKUP_SCREEN_PX, LocalDensity.current.fontScale)
        CompositionLocalProvider(LocalMockupScale provides scale, content = content)
    }
}
