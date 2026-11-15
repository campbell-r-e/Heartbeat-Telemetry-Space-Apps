// Daily exercise minutes for the Gravity chart (SPEC §5.4, §10): each UTC day counted with the
// same function as today's status and tasks, against the daily goal.
import type { Astronaut, ExerciseDay, ExerciseDayRange } from "@heartbeat/shared";
import { exerciseThresholdBpm } from "./exercise-intensity.ts";
import { missionFirstDayMs } from "./mission.ts";
import type { MissionStore, ReadingStore } from "./ports.ts";
import { readByRules } from "./rule-sources.ts";
import type { RuleSettings } from "./rules/settings.ts";
import { exerciseMinutesByDay } from "./status/exercise.ts";
import { DAY_MS, startOfUtcDay, utcDayLabel } from "./time.ts";

export const DEFAULT_EXERCISE_DAY_RANGE = "7d" satisfies ExerciseDayRange;
/** "7d", and a from/to request without `from`: the day of `to` and the 6 UTC days before it. */
export const EXERCISE_DEFAULT_DAYS = 7;
/** The most days a from/to request may cover. */
export const MAX_EXERCISE_DAYS = 366;

/** The UTC days to report: from the day of `fromMs` (null: mission day 1) to the day of `toMs`. */
export interface ExerciseDaysWindow {
  fromMs: number | null;
  toMs: number;
}

export function namedExerciseWindow(range: ExerciseDayRange, nowMs: number): ExerciseDaysWindow {
  if (range === "mission") return { fromMs: null, toMs: nowMs };
  return { fromMs: startOfUtcDay(nowMs) - (EXERCISE_DEFAULT_DAYS - 1) * DAY_MS, toMs: nowMs };
}

/** How many UTC days the window from `fromMs` to `toMs` touches. */
export function utcDaysTouched(fromMs: number, toMs: number): number {
  return (startOfUtcDay(toMs) - startOfUtcDay(fromMs)) / DAY_MS + 1;
}

export interface ExerciseDayStores {
  readings: ReadingStore;
  mission: MissionStore;
}

export interface ExerciseDaysRequest {
  astronaut: Astronaut;
  settings: Pick<RuleSettings, "exercise.dailyGoalMinutes" | "exercise.moderateIntensityFraction">;
  window: ExerciseDaysWindow;
  nowMs: number;
}

/**
 * Each UTC day's exercise minutes, oldest first, never past today. Days are counted whole (today
 * up to now). "From mission day 1" starts on the mission settings record's start date (owner
 * decision), or today when there is no record.
 */
export async function dailyExercise(stores: ExerciseDayStores, { astronaut, settings, window, nowMs }: ExerciseDaysRequest): Promise<ExerciseDay[]> {
  const lastDayMs = startOfUtcDay(Math.min(window.toMs, nowMs));
  const firstDayMs = window.fromMs === null ? await missionFirstDayMs(stores.mission, lastDayMs) : startOfUtcDay(window.fromMs);
  const toMs = Math.min(lastDayMs + DAY_MS - 1, nowMs);
  const points = await stores.readings.series(astronaut.id, "heartRate", { fromMs: firstDayMs, toMs, bucketMinutes: null });
  const thresholdBpm = exerciseThresholdBpm(astronaut.age, settings);
  const goalMinutes = settings["exercise.dailyGoalMinutes"];
  return exerciseMinutesByDay(readByRules("heartRate", points), thresholdBpm, { firstDayMs, lastDayMs }, nowMs)
    .map(({ dayStartMs, minutes }) => ({ day: utcDayLabel(dayStartMs), minutes, goalMinutes }));
}
