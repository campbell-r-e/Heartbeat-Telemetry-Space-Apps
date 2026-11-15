package org.heartbeat.watch.reminders

import org.heartbeat.watch.domain.MeasurementKind
import org.heartbeat.watch.domain.ScheduledTask
import org.heartbeat.watch.domain.TaskKind
import org.heartbeat.watch.time.UtcTime
import java.time.LocalTime
import java.time.ZoneOffset
import java.time.ZonedDateTime
import java.time.temporal.ChronoUnit

/** The tasks that fall due together at [at] (in UTC). */
data class DueReminders(val at: ZonedDateTime, val tasks: List<ScheduledTask>)

/**
 * Works out when reminders fall due from the server's daily schedule. Schedule times are spacecraft time, which is
 * UTC (SPEC §7), so occurrences are computed in UTC whatever zone the watch is set to. Pure, so it is unit-tested.
 */
object ReminderPlan {
    /** Spacecraft time. */
    val SCHEDULE_ZONE: ZoneOffset = ZoneOffset.UTC

    /** The next moment strictly after [now] when one or more tasks fall due; `null` for an empty schedule. */
    fun nextDue(tasks: List<ScheduledTask>, now: ZonedDateTime): DueReminders? {
        val at = tasks.minOfOrNull { nextOccurrence(it.localTime, now) } ?: return null
        return DueReminders(at, dueAt(tasks, at.toLocalTime()))
    }

    /** The tasks scheduled at [utcTime] (to the minute). */
    fun dueAt(tasks: List<ScheduledTask>, utcTime: LocalTime): List<ScheduledTask> =
        tasks.filter { it.localTime.truncatedTo(ChronoUnit.MINUTES) == utcTime.truncatedTo(ChronoUnit.MINUTES) }

    /** When the next task of [kind] is due (in UTC), for notes like "next 09:00"; `null` if none is scheduled. */
    fun nextOfKind(tasks: List<ScheduledTask>, kind: TaskKind, now: ZonedDateTime): ZonedDateTime? =
        tasks.filter { it.kind == kind }.minOfOrNull { nextOccurrence(it.localTime, now) }

    /** The screen a reminder opens, where the watch has one; meals and check-ins have no watch screen. */
    fun measurementFor(task: ScheduledTask): MeasurementKind? =
        when (task.kind) {
            TaskKind.ECG -> MeasurementKind.ECG
            TaskKind.SPO2 -> MeasurementKind.SPO2
            TaskKind.CHECK_IN, TaskKind.MEAL, null -> null
        }

    /**
     * The reminder's text, with its time in UTC ("Due 09:00 UTC"). The system draws its own timestamp in the watch's
     * local time; the notification asks to hide it, which the Galaxy Watch ignores.
     */
    fun dueText(task: ScheduledTask): String = "Due ${UtcTime.time(task.localTime)}"

    /** Today at [utcTime] in UTC if that is still ahead of [now], otherwise tomorrow. */
    private fun nextOccurrence(utcTime: LocalTime, now: ZonedDateTime): ZonedDateTime {
        val nowUtc = now.withZoneSameInstant(SCHEDULE_ZONE)
        val today = nowUtc.toLocalDate().atTime(utcTime.truncatedTo(ChronoUnit.MINUTES)).atZone(SCHEDULE_ZONE)
        return if (today.isAfter(nowUtc)) today else today.plusDays(1)
    }
}
