package org.heartbeat.watch

import org.heartbeat.watch.domain.Badge
import org.heartbeat.watch.domain.Metric
import org.heartbeat.watch.domain.PointsSummary
import org.heartbeat.watch.domain.Reading
import org.heartbeat.watch.domain.ReadingSource
import org.heartbeat.watch.domain.ReadingValue
import org.heartbeat.watch.domain.SurgeonNote
import java.time.Instant
import java.time.LocalDate

/** Synthetic values for unit tests only; nothing here is ever shown in the app. */
val T0: Instant = Instant.parse("2026-11-14T14:00:00Z")

/** The UTC day of [T0]. */
val DAY0: LocalDate = LocalDate.parse("2026-11-14")

fun reading(
    metric: Metric = Metric.HEART_RATE,
    value: Double = 1.0,
    at: Instant = T0,
    source: ReadingSource = ReadingSource.WATCH,
): Reading = Reading(metric, ReadingValue.Scalar(value), at, source)

fun note(id: String, sentMinute: Long, readAt: Instant? = null, alertId: String? = null): SurgeonNote =
    SurgeonNote(id, "Text of $id", alertId, T0.plusSeconds(sentMinute * 60), readAt)

fun readings(count: Int): List<Reading> = List(count) { reading(value = it.toDouble(), at = T0.plusSeconds(it.toLong())) }

fun badge(id: String, earnedOn: LocalDate? = null): Badge = Badge(id, "Name of $id", "What earns $id", earnedOn)

fun pointsSummary(
    totalPoints: Int = 0,
    streakDays: Int = 0,
    badges: List<Badge> = emptyList(),
    astronautId: String = "a1",
    day: LocalDate = DAY0,
): PointsSummary = PointsSummary(astronautId, day, totalPoints, streakDays, badges)
