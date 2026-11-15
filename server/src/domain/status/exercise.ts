// Exercise minutes from heart rate (SPEC §5.4): a minute with heart rate at or above the exercise
// threshold (exercise-intensity.ts), counted per UTC day.
import { DAY_MS, MINUTE_MS, startOfUtcDay } from "../time.ts";
import { mean, type TimedValue } from "./timed-values.ts";

/**
 * Whole UTC minutes whose mean heart rate is at or above the threshold. A minute with no
 * heart-rate reading does not count.
 */
export function exerciseMinutes(heartRates: readonly TimedValue[], thresholdBpm: number): number {
  const byMinute = new Map<number, number[]>();
  for (const { tMs, value } of heartRates) {
    const minute = Math.floor(tMs / MINUTE_MS);
    byMinute.set(minute, [...(byMinute.get(minute) ?? []), value]);
  }
  return [...byMinute.values()].filter((bpms) => mean(bpms)! >= thresholdBpm).length;
}

/** Whether any heart-rate reading was taken today (UTC) up to `nowMs`. */
export function hasHeartRateToday(heartRates: readonly TimedValue[], nowMs: number): boolean {
  return heartRates.some((p) => p.tMs >= startOfUtcDay(nowMs) && p.tMs <= nowMs);
}

/**
 * Exercise minutes from the start of the UTC day containing `nowMs` up to `nowMs`, as the status,
 * the tasks and the daily chart all report them: null when the threshold is unknown (no age) or
 * there is no heart-rate reading in that span (owner decision).
 */
export function exerciseMinutesSoFar(realHeartRates: readonly TimedValue[], thresholdBpm: number | null, nowMs: number): number | null {
  if (thresholdBpm === null || !hasHeartRateToday(realHeartRates, nowMs)) return null;
  const today = realHeartRates.filter((p) => p.tMs >= startOfUtcDay(nowMs) && p.tMs <= nowMs);
  return exerciseMinutes(today, thresholdBpm);
}

export interface DayExerciseMinutes {
  dayStartMs: number;
  /** As exerciseMinutesSoFar reports it for that day. */
  minutes: number | null;
}

/** UTC days by their start, both ends included. */
export interface UtcDays {
  firstDayMs: number;
  lastDayMs: number;
}

/**
 * Exercise minutes of each UTC day in `days`, each counted by exerciseMinutesSoFar as at the day's
 * last millisecond, or at `nowMs` for today: the same rule as today's status and tasks.
 */
export function exerciseMinutesByDay(
  realHeartRates: readonly TimedValue[], thresholdBpm: number | null, days: UtcDays, nowMs: number,
): DayExerciseMinutes[] {
  const byDay = new Map<number, TimedValue[]>();
  for (const point of realHeartRates) {
    const day = startOfUtcDay(point.tMs);
    const points = byDay.get(day);
    if (points) points.push(point);
    else byDay.set(day, [point]);
  }
  const result: DayExerciseMinutes[] = [];
  for (let dayStartMs = days.firstDayMs; dayStartMs <= days.lastDayMs; dayStartMs += DAY_MS) {
    const asAtMs = Math.min(dayStartMs + DAY_MS - 1, nowMs);
    result.push({ dayStartMs, minutes: exerciseMinutesSoFar(byDay.get(dayStartMs) ?? [], thresholdBpm, asAtMs) });
  }
  return result;
}
