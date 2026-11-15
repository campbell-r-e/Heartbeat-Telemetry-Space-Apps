// The measurement streak (SPEC §7, owner decision): consecutive UTC days on which every measurement
// task (ECG, both SpO₂ checks, mood check-in) is done. Meals and exercise do not count. Today does
// not break the streak until it is over. Pure.
import type { ScheduledTaskKind } from "@heartbeat/shared";
import type { TaskDay } from "../today-tasks.ts";

/** The kinds of task the streak counts. */
export const MEASUREMENT_KINDS: readonly ScheduledTaskKind[] = ["ecg", "spo2", "checkIn"];

/**
 * Whether every task of the kinds is done that day. A day with no such task at all does not
 * qualify, so an empty schedule never makes a streak.
 */
export function allDoneOfKinds(day: TaskDay, kinds: readonly ScheduledTaskKind[]): boolean {
  const tasks = day.tasks.filter((task) => kinds.includes(task.kind));
  return tasks.length > 0 && tasks.every((task) => task.done);
}

export interface Streak {
  days: number;
  includesToday: boolean;
}

/**
 * The streak as of the last day in `days` (today; oldest first, one entry per UTC day from mission
 * day 1). If today is complete the streak includes it; otherwise it runs through yesterday.
 */
export function measurementStreak(days: readonly TaskDay[]): Streak {
  const complete = (day: TaskDay) => allDoneOfKinds(day, MEASUREMENT_KINDS);
  const today = days.at(-1);
  if (!today) return { days: 0, includesToday: false };
  const includesToday = complete(today);
  // An incomplete today does not break the streak: count back from yesterday instead.
  const counted = includesToday ? days : days.slice(0, -1);
  return { days: trailingRun(counted, complete), includesToday };
}

/** How many items at the end of `items` pass `qualifies` in a row. */
function trailingRun<T>(items: readonly T[], qualifies: (item: T) => boolean): number {
  let run = 0;
  while (run < items.length && qualifies(items[items.length - 1 - run])) run++;
  return run;
}
