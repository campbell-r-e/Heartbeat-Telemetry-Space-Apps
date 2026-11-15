// The Gravity chart's exercise minutes per UTC day (GET .../exercise/daily), counted on the server
// by the same function as today's status and exercise task (SPEC §6.7).

import { EXERCISE_DAY_RANGES, type ExerciseDay, type ExerciseDayRange, type SeriesRange } from "@heartbeat/shared";
import { dailyChartData, type ChartData, type ChartPoint } from "./chart";
import { startOfUtcDay } from "./time";

/** Exercise minutes per UTC day as chart points; a day with no count (null) is left out, never shown as 0. */
export function exerciseDayPoints(days: readonly ExerciseDay[]): ChartPoint[] {
  return days
    .filter((day): day is ExerciseDay & { minutes: number } => day.minutes !== null)
    .map((day) => ({ tMs: startOfUtcDay(Date.parse(`${day.day}T00:00:00Z`)), value: day.minutes, simulated: false }));
}

/** The daily goal of the newest day that has one, or null while the setting is unset. */
export function latestGoal(days: readonly ExerciseDay[]): number | null {
  return [...days].reverse().find((day) => day.goalMinutes !== null)?.goalMinutes ?? null;
}

/** The exercise endpoint's range for a chart range the Gravity page offers (7 d or Mission). */
export function exerciseDayRange(range: SeriesRange): ExerciseDayRange {
  const match = EXERCISE_DAY_RANGES.find((candidate) => candidate === range);
  if (!match) throw new Error(`The daily exercise chart has no ${range} range`);
  return match;
}

/** Shown under the chart when the server could not count some days. */
export const UNCOUNTED_DAYS_NOTE = "Days with no heart-rate reading (or no known age) have no count and are left out.";
const GOAL_LABEL = "Daily goal";

/** The Gravity chart: counted days as points, the server's goal as a line, and a note for uncounted days. */
export function exerciseChartData(days: readonly ExerciseDay[], range: SeriesRange, nowMs: number): ChartData {
  const goal = latestGoal(days);
  return dailyChartData(exerciseDayPoints(days), {
    unit: "min",
    range,
    nowMs,
    goal: goal === null ? null : { value: goal, label: GOAL_LABEL },
    note: days.some((day) => day.minutes === null) ? UNCOUNTED_DAYS_NOTE : undefined,
  });
}
