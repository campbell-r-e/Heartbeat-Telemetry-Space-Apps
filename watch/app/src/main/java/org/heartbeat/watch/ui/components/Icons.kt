package org.heartbeat.watch.ui.components

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

/** Stroke icons copied path-for-path from the approved mockups' inline SVGs (24×24 viewBox). */
object MockupIcons {
    private const val VIEWPORT = 24f

    val Gear: ImageVector = strokeIcon(
        "Gear",
        strokeWidth = 2f,
        "M15 12a3 3 0 1 1-6 0a3 3 0 1 1 6 0z",
        "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21" +
            "a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8" +
            " 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8" +
            "l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3" +
            "l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
    )

    val ChevronBack: ImageVector = strokeIcon("Back", strokeWidth = 2.2f, "M15 6l-6 6 6 6")

    val ChevronForward: ImageVector = strokeIcon("Forward", strokeWidth = 2f, "M9 6l6 6-6 6")

    val ArrowUpRight: ImageVector = strokeIcon("UpRight", strokeWidth = 2.2f, "M5 19L19 5M19 5h-8M19 5v8")

    val Check: ImageVector = strokeIcon("Check", strokeWidth = 2.5f, "M5 12l5 5 9-10")

    private fun strokeIcon(name: String, strokeWidth: Float, vararg paths: String): ImageVector =
        ImageVector.Builder(name, VIEWPORT.dp, VIEWPORT.dp, VIEWPORT, VIEWPORT).apply {
            paths.forEach { path ->
                addPath(
                    pathData = addPathNodes(path),
                    stroke = SolidColor(Color.White),
                    strokeLineWidth = strokeWidth,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                )
            }
        }.build()
}
