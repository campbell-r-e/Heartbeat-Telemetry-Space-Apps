package org.heartbeat.watch.ui.model

import org.heartbeat.watch.domain.ReadingSource

/**
 * The one table of human labels for where a reading came from (SPEC §5.7 sources). It matches the shared
 * `READING_SOURCE_LABELS` (@heartbeat/shared), which the watch cannot import; keep the two the same.
 */
object SourceLabels {
    private val LABELS = mapOf(
        "watch" to "Galaxy Watch",
        "wxserver" to "Galaxy Watch history",
        "zepp" to "Zepp watch",
        "radlab" to "ship data",
        "osdr" to "ship data",
        "manual" to "manual",
        "simulated" to "simulated",
    )

    /** A source not in the table is shown by its own name rather than hidden. */
    fun label(source: ReadingSource): String = LABELS[source.name] ?: source.name
}
