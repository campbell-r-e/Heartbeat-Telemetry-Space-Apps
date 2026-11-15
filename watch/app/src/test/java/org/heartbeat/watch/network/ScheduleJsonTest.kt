package org.heartbeat.watch.network

import org.heartbeat.watch.domain.TaskKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalTime

class ScheduleJsonTest {
    @Test
    fun `reads the server's schedule and round-trips it for the cache`() {
        val body = """[{"id":"ecg-am","kind":"ecg","label":"ECG","localTime":"09:00","astronautId":null},
            {"id":"x","kind":"stretch","label":"Stretch","localTime":"18:30"},
            {"id":"exercise-daily","kind":"exercise","label":"Exercise","localTime":null,"astronautId":null}]"""

        val tasks = ScheduleJson.decode(body)

        assertEquals(TaskKind.ECG, tasks[0].kind)
        assertEquals(LocalTime.of(9, 0), tasks[0].localTime)
        assertNull("an unknown kind is still reminded", tasks[1].kind)
        assertEquals("a task with no set time has nothing to remind at", 2, tasks.size)
        assertEquals(tasks, ScheduleJson.decode(ScheduleJson.encode(tasks)))
    }
}
