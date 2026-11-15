package org.heartbeat.watch.network

import org.heartbeat.watch.domain.Badge
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate

class PointsJsonTest {
    /** The shape of `PointsSummary` in shared/src/gamification.ts; the values are synthetic. */
    private val body = """
        {"astronautId":"a1","at":"2026-11-14T14:00:00.000Z","day":"2026-11-14","totalPoints":1240,
         "today":{"points":60,"possiblePoints":125,"tasksDone":3,"tasks":8},
         "streak":{"days":9,"includesToday":false},
         "badges":[
           {"id":"checkInStreak","name":"7-day check-in streak","description":"Mood check-in 7 days in a row","earnedOn":"2026-11-11"},
           {"id":"boneGuardian","name":"Bone Guardian","description":"Exercise goal met 7 days in a row","earnedOn":null}
         ]}
    """.trimIndent()

    @Test
    fun `reads the total, the streak and every badge with the day it was earned`() {
        val summary = PointsJson.decode(body)

        assertEquals("a1", summary.astronautId)
        assertEquals(LocalDate.parse("2026-11-14"), summary.day)
        assertEquals(1240, summary.totalPoints)
        assertEquals(9, summary.streakDays)
        assertEquals(
            listOf(
                Badge("checkInStreak", "7-day check-in streak", "Mood check-in 7 days in a row", LocalDate.parse("2026-11-11")),
                Badge("boneGuardian", "Bone Guardian", "Exercise goal met 7 days in a row", earnedOn = null),
            ),
            summary.badges,
        )
    }

    @Test
    fun `a badge without earnedOn is not earned`() {
        val summary = PointsJson.decode(body.replace(""","earnedOn":null""", ""))

        assertNull(summary.badges.single { it.id == "boneGuardian" }.earnedOn)
    }

    @Test(expected = MalformedResponseException::class)
    fun `a summary without the streak breaks the contract`() {
        PointsJson.decode("""{"astronautId":"a1","day":"2026-11-14","totalPoints":0,"badges":[]}""")
    }

    @Test(expected = MalformedResponseException::class)
    fun `points that are not a whole number break the contract`() {
        PointsJson.decode(body.replace("1240", "\"many\""))
    }

    @Test(expected = MalformedResponseException::class)
    fun `an earned day that is not a date breaks the contract`() {
        PointsJson.decode(body.replace("2026-11-11", "yesterday"))
    }
}
