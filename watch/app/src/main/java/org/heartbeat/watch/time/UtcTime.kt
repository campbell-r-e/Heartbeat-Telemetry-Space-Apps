package org.heartbeat.watch.time

import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Every time the app shows is spacecraft time, UTC, and says so (owner decision): the clock, reading times, reminder
 * times, notes, the last upload, meal times and measurement results all go through this one formatter, and "today" is the
 * UTC day.
 */
object UtcTime {
    val ZONE: ZoneOffset = ZoneOffset.UTC
    private const val LABEL = "UTC"
    private val CLOCK: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm", Locale.US).withZone(ZONE)
    private val DAY: DateTimeFormatter = DateTimeFormatter.ofPattern("EEE d", Locale.US).withZone(ZONE)

    /** "19:43 UTC". */
    fun time(instant: Instant): String = "${CLOCK.format(instant)} $LABEL"

    /** "09:00 UTC", for a time of day that is already UTC (the schedule's times). */
    fun time(utcTimeOfDay: LocalTime): String = "${CLOCK.format(utcTimeOfDay)} $LABEL"

    /** "Sat 14", the UTC day. */
    fun day(instant: Instant): String = DAY.format(instant)

    fun date(instant: Instant): LocalDate = instant.atZone(ZONE).toLocalDate()
}
