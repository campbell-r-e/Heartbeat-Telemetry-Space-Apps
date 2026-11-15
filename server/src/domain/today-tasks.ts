// The schedule's tasks with their done-state, worked out on the server from real activity (owner
// decision): a meal logged, a check-in, or an ECG or SpO₂ recorded within the match window of the
// task's time. Tasks of the same kind never share one activity, on the same day or across midnight.
// The exercise task has no time and is done once the day's exercise minutes reach the daily goal.
// Today's tasks and every earlier day's (for points, the streak and badges, SPEC §7) are worked out
// by the same function, day by day in time order.
import type { Astronaut, ScheduledTask, ScheduledTaskKind, TaskState } from "@heartbeat/shared";
import { taskPoints } from "./task-points.ts";
import type { CheckInStore, MealStore, ReadingStore, ScheduleStore } from "./ports.ts";
import { readByRules } from "./rule-sources.ts";
import type { RuleSettings } from "./rules/settings.ts";
import { exerciseThresholdBpm } from "./exercise-intensity.ts";
import { exerciseMinutesByDay } from "./status/exercise.ts";
import { MINUTE_MS, startOfUtcDay, utcDayStarts } from "./time.ts";

export interface TaskStores {
  schedule: ScheduleStore;
  meals: MealStore;
  checkIns: CheckInStore;
  readings: ReadingStore;
}

const MINUTES_UNIT = "min";

type TimedKind = Exclude<ScheduledTaskKind, "exercise">;
type TimedTask = ScheduledTask & { kind: TimedKind; localTime: string };

/** Times (ms) of the real activities that can complete each timed kind of task. */
export type ActivityTimes = Record<TimedKind, number[]>;

/**
 * The activities already used to complete a task, as "kind:ms" keys. Carried from day to day, so
 * an activity near midnight never completes a task on both days.
 */
export type UsedActivities = Set<string>;

const usedKey = (kind: ScheduledTaskKind, atMs: number) => `${kind}:${atMs}`;

const isTimed = (task: ScheduledTask): task is TimedTask => task.kind !== "exercise" && task.localTime !== null;

/** "HH:MM" on the UTC day starting at `dayStartMs`, in ms. */
function taskTimeMs(localTime: string, dayStartMs: number): number {
  const [hours, minutes] = localTime.split(":").map(Number);
  return dayStartMs + (hours * 60 + minutes) * MINUTE_MS;
}

/**
 * Matches each timed task with the earliest unused activity of its kind within `windowMs` of its
 * time (inclusive), going through the tasks in time order, so same-kind tasks never share one.
 * Each match is added to `used`, which may come from earlier days.
 */
export function matchTimedTasks(
  tasks: readonly ScheduledTask[], activities: ActivityTimes, dayStartMs: number, windowMs: number, used: UsedActivities = new Set(),
): Map<string, number> {
  const doneAt = new Map<string, number>();
  const timed = tasks.filter(isTimed)
    .map((task) => ({ task, atMs: taskTimeMs(task.localTime, dayStartMs) }))
    .sort((a, b) => a.atMs - b.atMs);
  for (const { task, atMs } of timed) {
    const match = [...activities[task.kind]].sort((a, b) => a - b)
      .find((t) => !used.has(usedKey(task.kind, t)) && Math.abs(t - atMs) <= windowMs);
    if (match === undefined) continue;
    used.add(usedKey(task.kind, match));
    doneAt.set(task.id, match);
  }
  return doneAt;
}

/** One UTC day's activity: the timed activities around it and its exercise minutes (null: unknown). */
export interface DayActivity {
  dayStartMs: number;
  activities: ActivityTimes;
  exerciseMinutes: number | null;
}

/**
 * Each task's state on one UTC day, with the points it earns once done. Activities in `used` (from
 * earlier days) are not matched again, and this day's matches are added to it. Pure.
 */
export function dayTaskStates(tasks: readonly ScheduledTask[], day: DayActivity, settings: RuleSettings, used: UsedActivities = new Set()): TaskState[] {
  const windowMinutes = settings["tasks.doneWithinMinutes"];
  const goalMinutes = settings["exercise.dailyGoalMinutes"];
  const doneAt = windowMinutes === null
    ? new Map<string, number>()
    : matchTimedTasks(tasks, day.activities, day.dayStartMs, windowMinutes * MINUTE_MS, used);
  return tasks.map((task): TaskState => {
    const base = { taskId: task.id, kind: task.kind, label: task.label, localTime: task.localTime, points: taskPoints(task.kind, settings) };
    if (task.kind === "exercise") {
      const progress = day.exerciseMinutes === null || goalMinutes === null ? null : { value: day.exerciseMinutes, goal: goalMinutes, unit: MINUTES_UNIT };
      return { ...base, done: progress !== null && progress.value >= progress.goal, doneAt: null, progress };
    }
    const at = doneAt.get(task.id);
    return { ...base, done: at !== undefined, doneAt: at === undefined ? null : new Date(at).toISOString(), progress: null };
  });
}

/** One UTC day's tasks with their done-state. */
export interface TaskDay {
  dayStartMs: number;
  tasks: TaskState[];
}

/**
 * Every activity the days' tasks used, so later days do not match them again. It is the same set
 * working those days out in order leaves behind: each match adds exactly its task's `doneAt`.
 */
export function activitiesUsedBy(days: readonly TaskDay[]): UsedActivities {
  return new Set(days.flatMap((day) => day.tasks.flatMap((task) => (task.doneAt === null ? [] : [usedKey(task.kind, Date.parse(task.doneAt))]))));
}

/** Which days to work out: from the day of `firstDayMs` to today (the day of `nowMs`), as at `nowMs`. */
export interface TaskDaysRequest {
  astronaut: Astronaut;
  firstDayMs: number;
  nowMs: number;
  /** Every day before `firstDayMs`, already worked out: the activities they used are not used again. */
  earlierDays?: readonly TaskDay[];
}

/**
 * The astronaut's tasks on every UTC day of the request, oldest first, each as it stands at
 * `nowMs` (today up to now). The current schedule applies to every day (owner decision).
 */
export async function taskDays(stores: TaskStores, request: TaskDaysRequest, settings: RuleSettings): Promise<TaskDay[]> {
  const { astronaut, nowMs, earlierDays = [] } = request;
  const days = utcDayStarts(request.firstDayMs, nowMs).filter((dayStartMs) => dayStartMs <= startOfUtcDay(nowMs));
  if (days.length === 0) return [];
  const [firstDayMs, lastDayMs] = [days[0], days[days.length - 1]];
  // Activity up to the match window before the first day's tasks can complete them.
  const fromMs = firstDayMs - (settings["tasks.doneWithinMinutes"] ?? 0) * MINUTE_MS;
  const [tasks, meals, checkIns, ecg, spo2, heartRate] = await Promise.all([
    stores.schedule.forAstronaut(astronaut.id),
    stores.meals.between(astronaut.id, fromMs, nowMs),
    stores.checkIns.between(astronaut.id, fromMs, nowMs),
    stores.readings.readingTimesReadByRules(astronaut.id, "ecg", fromMs, nowMs),
    stores.readings.readingTimesReadByRules(astronaut.id, "spo2", fromMs, nowMs),
    stores.readings.series(astronaut.id, "heartRate", { fromMs: firstDayMs, toMs: nowMs, bucketMinutes: null }),
  ]);
  const activities: ActivityTimes = {
    meal: meals.map((m) => Date.parse(m.eatenAt)),
    checkIn: checkIns.map((c) => Date.parse(c.at)),
    ecg,
    spo2,
  };
  const exercise = new Map(exerciseMinutesByDay(
    readByRules("heartRate", heartRate), exerciseThresholdBpm(astronaut.age, settings), { firstDayMs, lastDayMs }, nowMs,
  ).map(({ dayStartMs, minutes }) => [dayStartMs, minutes]));
  const used = activitiesUsedBy(earlierDays);
  return days.map((dayStartMs) => ({
    dayStartMs,
    tasks: dayTaskStates(tasks, { dayStartMs, activities, exerciseMinutes: exercise.get(dayStartMs) ?? null }, settings, used),
  }));
}
