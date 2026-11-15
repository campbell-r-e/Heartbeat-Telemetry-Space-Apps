package org.heartbeat.watch.reminders

import org.heartbeat.watch.domain.MeasurementKind
import org.heartbeat.watch.domain.ScheduledTask
import org.heartbeat.watch.domain.TaskKind
import org.heartbeat.watch.ui.model.EcgDue
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalTime
import java.time.ZonedDateTime

internal fun task(id: String, kind: TaskKind, time: String) =
    ScheduledTask(id, kind, kind.wireName, id, LocalTime.parse(time))

/** The owner's default schedule, as the server will send it. */
internal val SCHEDULE = listOf(
    task("ecg", TaskKind.ECG, "09:00"),
    task("spo2-am", TaskKind.SPO2, "09:00"),
    task("spo2-pm", TaskKind.SPO2, "21:00"),
    task("mood", TaskKind.CHECK_IN, "20:00"),
    task("breakfast", TaskKind.MEAL, "08:00"),
    task("lunch", TaskKind.MEAL, "13:00"),
    task("dinner", TaskKind.MEAL, "19:00"),
)

/** Schedule times are spacecraft time, UTC (SPEC §7). */
private fun utc(text: String): ZonedDateTime = ZonedDateTime.parse("2026-11-14T${text}Z")

class ReminderPlanTest {

    @Test
    fun `the next reminder groups every task due at that minute`() {
        val due = ReminderPlan.nextDue(SCHEDULE, utc("08:30"))!!

        assertEquals(utc("09:00").toInstant(), due.at.toInstant())
        assertEquals(setOf("ecg", "spo2-am"), due.tasks.map { it.id }.toSet())
    }

    @Test
    fun `a task due exactly now is next due tomorrow`() {
        val due = ReminderPlan.nextDue(SCHEDULE, utc("21:00"))!!

        assertEquals(ZonedDateTime.parse("2026-11-15T08:00Z").toInstant(), due.at.toInstant())
    }

    @Test
    fun `schedule times are UTC whatever zone the watch is set to`() {
        val newYorkMorning = ZonedDateTime.parse("2026-11-14T03:30-05:00[America/New_York]") // 08:30 UTC

        val due = ReminderPlan.nextDue(SCHEDULE, newYorkMorning)!!

        assertEquals(utc("09:00").toInstant(), due.at.toInstant())
        assertEquals(setOf("ecg", "spo2-am"), due.tasks.map { it.id }.toSet())
    }

    @Test
    fun `the reminder text gives its time in UTC, labeled`() {
        assertEquals("Due 09:00 UTC", ReminderPlan.dueText(task("ecg", TaskKind.ECG, "09:00")))
        assertEquals("Due 21:30 UTC", ReminderPlan.dueText(task("spo2-pm", TaskKind.SPO2, "21:30")))
    }

    @Test
    fun `no schedule, no reminder`() {
        assertNull(ReminderPlan.nextDue(emptyList(), utc("08:30")))
    }

    @Test
    fun `reminders open the matching measurement where the watch has one`() {
        assertEquals(MeasurementKind.ECG, ReminderPlan.measurementFor(SCHEDULE[0]))
        assertEquals(MeasurementKind.SPO2, ReminderPlan.measurementFor(SCHEDULE[1]))
        assertNull(ReminderPlan.measurementFor(SCHEDULE[3]))
        assertNull(ReminderPlan.measurementFor(SCHEDULE[4]))
    }

    @Test
    fun `the ECG note shows the next time in UTC, labeled, whatever the watch's zone`() {
        assertEquals("next 09:00 UTC", EcgDue.note(SCHEDULE, utc("08:00")))
        assertEquals("next 09:00 UTC tomorrow", EcgDue.note(SCHEDULE, utc("09:02")))
        assertEquals("next 09:00 UTC", EcgDue.note(SCHEDULE, ZonedDateTime.parse("2026-11-14T03:00-05:00[America/New_York]")))
        assertEquals(
            "tomorrow is the UTC day",
            "next 09:00 UTC tomorrow",
            EcgDue.note(SCHEDULE, ZonedDateTime.parse("2026-11-14T08:00-05:00[America/New_York]")),
        )
        assertEquals("no schedule yet", EcgDue.note(null, utc("08:00")))
        assertEquals("not scheduled", EcgDue.note(SCHEDULE.drop(1), utc("08:00")))
    }
}
