// Today's tasks (SPEC §7) and which one is next. Task times are spacecraft local time, assumed to be
// UTC. Done state and the exercise task's progress come from the server (GET .../tasks/today).

import type { ScheduledTask, TaskState } from "@heartbeat/shared";
import { DAY_MS, MINUTE_MS, parseClockMinutes, startOfUtcDay } from "./time";

export interface DueTask {
  task: TaskState;
  /** The next time this task is due, at or after now (tomorrow if today's time has passed). */
  dueAtMs: number;
  minutesUntil: number;
}

/** When `task` is next due at or after `nowMs`, or null if it has no valid "HH:MM" time. */
export function nextDue(task: TaskState, nowMs: number): DueTask | null {
  const clockMinutes = task.localTime === null ? null : parseClockMinutes(task.localTime);
  if (clockMinutes === null) return null;
  const todayAtMs = startOfUtcDay(nowMs) + clockMinutes * MINUTE_MS;
  const dueAtMs = todayAtMs >= nowMs ? todayAtMs : todayAtMs + DAY_MS;
  return { task, dueAtMs, minutesUntil: (dueAtMs - nowMs) / MINUTE_MS };
}

/** The soonest upcoming timed task that is not already done, or null. */
export function nextReminder(tasks: readonly TaskState[], nowMs: number): DueTask | null {
  return tasks
    .filter((task) => !task.done)
    .map((task) => nextDue(task, nowMs))
    .filter((due): due is DueTask => due !== null)
    .reduce<DueTask | null>((soonest, due) => (soonest === null || due.dueAtMs < soonest.dueAtMs ? due : soonest), null);
}

/** "3 of 8 done". */
export function taskSummary(tasks: readonly TaskState[]): string {
  return `${tasks.filter((task) => task.done).length} of ${tasks.length} done`;
}

/** The time of the first scheduled task of a kind ("20:00" for the check-in), or null. */
export function firstTimeOf(tasks: readonly (ScheduledTask | TaskState)[], kind: ScheduledTask["kind"]): string | null {
  const times = tasks.filter((task) => task.kind === kind).map((task) => task.localTime);
  return times.filter((time): time is string => time !== null).sort()[0] ?? null;
}
