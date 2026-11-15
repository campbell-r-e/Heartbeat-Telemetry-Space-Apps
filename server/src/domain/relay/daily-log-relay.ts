// Each astronaut's daily logs (mood and stress check-ins, calories per day, exercise minutes per
// day) reach the ground through the relay (SPEC §8, §9.2), like everything else Mission Control
// knows: the ground reads only the reports that have arrived, never the onboard tables.
import type { Astronaut, DailyCalories, DailyLog, Food, GroundDailyLogResponse, MealLog, Metric, Reading } from "@heartbeat/shared";
import { dailyExercise } from "../exercise-days.ts";
import { missionFirstDayMs } from "../mission.ts";
import type { DailyLogChanges, RelayReader, Stores } from "../ports.ts";
import type { RuleSettings } from "../rules/settings.ts";
import { nutritionDay } from "../status/nutrition.ts";
import { DAY_MS, startOfUtcDay, utcDayLabel } from "../time.ts";
import type { Relay } from "./relay.ts";

export type DailyLogStores = Pick<Stores, "astronauts" | "checkIns" | "meals" | "foods" | "readings" | "mission">;
export type ExerciseSettings = Pick<RuleSettings, "exercise.dailyGoalMinutes" | "exercise.moderateIntensityFraction">;

/**
 * How many UTC days back each minute's upkeep rebuilds (today and yesterday, owner decision): a day
 * before that is complete, so it is kept as already built and sent.
 */
export const RECENT_DAYS = 2;

/** Calories per UTC day with meals, oldest first, from the same day totals the nutrition status uses. */
export function caloriesByDay(meals: readonly MealLog[], foods: readonly Food[]): DailyCalories[] {
  const dayStarts = [...new Set(meals.map((meal) => startOfUtcDay(Date.parse(meal.eatenAt))))].sort((a, b) => a - b);
  // Only the kcal totals are read here, and whether the day is over does not change them.
  const complete = false;
  return dayStarts.map((dayStartMs) => {
    const day = nutritionDay(meals, foods, dayStartMs, complete);
    return { day: day.day, kcalAtLeast: day.totals.kcal.atLeast, mealsLogged: day.mealsLogged, mealsWithoutKcal: day.totals.kcal.unknownMeals };
  });
}

const byTime = <T>(time: (item: T) => string) => (a: T, b: T) => Date.parse(time(a)) - Date.parse(time(b));

/** The astronaut's logs for the UTC days from `fromDayMs` up to `nowMs`. */
async function readDays(stores: DailyLogStores, settings: ExerciseSettings, astronaut: Astronaut, fromDayMs: number, nowMs: number): Promise<DailyLog> {
  const [checkIns, meals, menu, exercise] = await Promise.all([
    stores.checkIns.between(astronaut.id, fromDayMs, nowMs),
    stores.meals.between(astronaut.id, fromDayMs, nowMs),
    stores.foods.menu(),
    dailyExercise(stores, { astronaut, settings, window: { fromMs: fromDayMs, toMs: nowMs }, nowMs }),
  ]);
  return {
    astronautId: astronaut.id,
    at: new Date(nowMs).toISOString(),
    checkIns: [...checkIns].sort(byTime((checkIn) => checkIn.at)),
    calories: caloriesByDay(meals, menu.foods),
    exercise,
  };
}

/** The astronaut's whole daily log since mission day 1, as of `nowMs` (the full rebuild). */
export async function readDailyLog(stores: DailyLogStores, settings: ExerciseSettings, astronaut: Astronaut, nowMs: number): Promise<DailyLog> {
  return readDays(stores, settings, astronaut, await missionFirstDayMs(stores.mission, nowMs), nowMs);
}

/**
 * `built` with its days from `fromDayMs` on replaced by `recent` (which covers exactly those days).
 * Earlier days are kept as they were built.
 */
export function withRecentDays(built: DailyLog, recent: DailyLog, fromDayMs: number): DailyLog {
  const fromDay = utcDayLabel(fromDayMs);
  return {
    ...recent,
    checkIns: [...built.checkIns.filter((checkIn) => Date.parse(checkIn.at) < fromDayMs), ...recent.checkIns],
    calories: [...built.calories.filter((day) => day.day < fromDay), ...recent.calories],
    exercise: [...built.exercise.filter((day) => day.day < fromDay), ...recent.exercise],
  };
}

/** The metrics a daily log is built from besides check-ins and meals: exercise minutes come from heart rate. */
const DAILY_LOG_METRICS: ReadonlySet<Metric> = new Set<Metric>(["heartRate"]);

/** The astronaut and time of each uploaded reading a daily log is built from, one per UTC day. */
export function dailyLogDaysTouched(readings: readonly Pick<Reading, "astronautId" | "metric" | "takenAt">[]): { astronautId: string; atMs: number }[] {
  const days = new Map<string, { astronautId: string; atMs: number }>();
  for (const { astronautId, metric, takenAt } of readings) {
    if (!DAILY_LOG_METRICS.has(metric)) continue;
    const atMs = startOfUtcDay(Date.parse(takenAt));
    days.set(`${astronautId}:${atMs}`, { astronautId, atMs });
  }
  return [...days.values()];
}

/**
 * The first day a rebuild after `previous` must read: yesterday; the day `previous` was built on
 * if that is earlier (the runs were more than a day apart); or the earliest day a write changed
 * since (`changedDayMs`). Never before mission day 1. Every other earlier day is as built.
 */
export function rebuildFromDayMs(previousAt: string, firstDayMs: number, nowMs: number, changedDayMs: number | null = null): number {
  const recent = startOfUtcDay(nowMs) - (RECENT_DAYS - 1) * DAY_MS;
  const earliest = Math.min(recent, startOfUtcDay(Date.parse(previousAt)), changedDayMs ?? Infinity);
  return Math.max(firstDayMs, earliest);
}

/**
 * The astronaut's daily log as of `nowMs`: rebuilt from `previous` by reading only the recent days
 * (today and yesterday; from further back when the last run was longer ago or a write changed an
 * earlier day, `changedDayMs`), or in full when there is no previous one.
 */
export async function updateDailyLog(
  stores: DailyLogStores, settings: ExerciseSettings, astronaut: Astronaut, previous: DailyLog | null, nowMs: number,
  changedDayMs: number | null = null,
): Promise<DailyLog> {
  if (!previous) return readDailyLog(stores, settings, astronaut, nowMs);
  const fromDayMs = rebuildFromDayMs(previous.at, await missionFirstDayMs(stores.mission, nowMs), nowMs, changedDayMs);
  return withRecentDays(previous, await readDays(stores, settings, astronaut, fromDayMs, nowMs), fromDayMs);
}

/** What a log says, without the time it was read: an unchanged log is not sent again. */
const contentOf = ({ at: _at, ...content }: DailyLog) => JSON.stringify(content);

export interface DailyLogRelayDeps {
  stores: DailyLogStores;
  settings: ExerciseSettings;
  relay: Pick<Relay, "send">;
  now: () => number;
}

/** A mark that an astronaut's log must be rebuilt from `fromDayMs`; `version` tells a newer mark apart. */
interface ChangeMark {
  fromDayMs: number;
  version: number;
}

/** Marks the whole history: a rebuild from it reads from mission day 1. */
const WHOLE_HISTORY = Number.NEGATIVE_INFINITY;

/**
 * Sends each crew member's daily log when it differs from the last one sent (on start, then with
 * each minute's upkeep). The first run builds each log in full; later runs rebuild only today and
 * yesterday (owner decision), plus any earlier day a write changed since (`dayChanged`), and the
 * whole history after a removal, a re-add or a profile change (`historyChanged`). A mark is
 * cleared only once its rebuild has been sent (or found unchanged), so a failed read or send keeps
 * it for the next run, as it keeps the send itself. After a restart the first run builds in full.
 */
export function dailyLogRelay({ stores, settings, relay, now }: DailyLogRelayDeps): DailyLogChanges & { announceIfChanged(): Promise<void> } {
  const built = new Map<string, { log: DailyLog; profile: string }>();
  const lastSent = new Map<string, string>();
  const marks = new Map<string, ChangeMark>();
  let markVersion = 0;

  const mark = (astronautId: string, fromDayMs: number) => {
    const earlier = marks.get(astronautId)?.fromDayMs ?? fromDayMs;
    marks.set(astronautId, { fromDayMs: Math.min(earlier, fromDayMs), version: ++markVersion });
  };

  /** Clears the mark a run used, unless a write marked again while it ran. */
  const clearMark = (astronautId: string, used: ChangeMark | undefined) => {
    if (used && marks.get(astronautId)?.version === used.version) marks.delete(astronautId);
  };

  /** Every profile field: the exercise minutes depend on the age, so any change rebuilds in full. */
  const profileOf = (astronaut: Astronaut) => JSON.stringify(astronaut);

  async function announce(astronaut: Astronaut): Promise<void> {
    const used = marks.get(astronaut.id);
    const previous = built.get(astronaut.id);
    const profile = profileOf(astronaut);
    const reusable = previous && previous.profile === profile ? previous.log : null;
    const log = await updateDailyLog(stores, settings, astronaut, reusable, now(), used?.fromDayMs ?? null);
    built.set(astronaut.id, { log, profile });
    const content = contentOf(log);
    if (lastSent.get(astronaut.id) !== content) {
      await relay.send("dailyLog", log);
      lastSent.set(astronaut.id, content);
    }
    clearMark(astronaut.id, used);
  }

  return {
    dayChanged(astronautId, atMs) {
      mark(astronautId, startOfUtcDay(atMs));
    },

    historyChanged(astronautId) {
      mark(astronautId, WHOLE_HISTORY);
    },

    async announceIfChanged(): Promise<void> {
      const crew = await stores.astronauts.list();
      const crewIds = new Set(crew.map((astronaut) => astronaut.id));
      // Logs of astronauts no longer on the crew are dropped; one added again is built in full.
      for (const id of [...built.keys()]) if (!crewIds.has(id)) built.delete(id);
      for (const astronaut of crew) await announce(astronaut);
    },
  };
}

/**
 * GET /api/ground/astronauts/:id/daily-log: the newest daily log of the astronaut that has reached
 * the ground (also for an astronaut removed since); nulls before the first.
 */
export async function groundDailyLog(store: RelayReader, astronautId: string, nowMs: number): Promise<GroundDailyLogResponse> {
  const arrived = await store.list("dailyLog", { astronautId, deliveredByMs: nowMs });
  const report = arrived.at(-1);
  return { log: report?.payload ?? null, sentAt: report?.sentAt ?? null, receivedAt: report?.deliverAt ?? null };
}
