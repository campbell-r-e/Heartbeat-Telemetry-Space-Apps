// Points, streak and badges (SPEC §7) from the tasks done on each UTC day since mission day 1.
// Points come only from tasks done by the done-state rules (real activity, never simulated).
// Badges are stored once earned and never removed (owner decision).
import type { Astronaut, PointsSummary, TaskState } from "@heartbeat/shared";
import type { BadgeStore, EarnedBadge } from "../ports.ts";
import type { RuleSettings } from "../rules/settings.ts";
import { utcDayLabel } from "../time.ts";
import type { TaskDay } from "../today-tasks.ts";
import { badgeList, badgesEarnedBy, newlyEarned } from "./badges.ts";
import { measurementStreak } from "./streak.ts";
import type { TaskHistory } from "./task-history.ts";

/** The tasks' points added up; a task with no points setting counts none. */
const sumOfPoints = (tasks: readonly TaskState[]) => tasks.reduce((sum, task) => sum + (task.points ?? 0), 0);

/** Points the tasks done have earned. */
const earnedPoints = (tasks: readonly TaskState[]) => sumOfPoints(tasks.filter((task) => task.done));

/** Points the tasks are worth when all are done. */
const possiblePoints = (tasks: readonly TaskState[]) => sumOfPoints(tasks);

/** What a summary is worked out from. */
export interface PointsInputs {
  astronautId: string;
  /** Oldest first, one per UTC day from mission day 1 to today. */
  days: readonly TaskDay[];
  /** The astronaut's stored badges. */
  storedBadges: readonly EarnedBadge[];
}

/** The summary as of `nowMs`. Pure. */
export function pointsSummary({ astronautId, days, storedBadges }: PointsInputs, settings: RuleSettings, nowMs: number): PointsSummary {
  const todayTasks = days.at(-1)?.tasks ?? [];
  return {
    astronautId,
    at: new Date(nowMs).toISOString(),
    day: utcDayLabel(nowMs),
    totalPoints: days.reduce((sum, day) => sum + earnedPoints(day.tasks), 0),
    today: {
      points: earnedPoints(todayTasks),
      possiblePoints: possiblePoints(todayTasks),
      tasksDone: todayTasks.filter((task) => task.done).length,
      tasks: todayTasks.length,
    },
    streak: measurementStreak(days),
    badges: badgeList(storedBadges, settings),
  };
}

export interface PointsSources {
  /** Every day's tasks since mission day 1, with past days kept once worked out. */
  history: Pick<TaskHistory, "days">;
  badges: BadgeStore;
}

/**
 * The astronaut's points, streak and badges from every day since mission day 1 (owner decision).
 * Badges the activity has earned that are not stored yet are stored first, so a badge, once
 * served, is served with the same day ever after.
 */
export async function astronautPoints(sources: PointsSources, astronaut: Astronaut, settings: RuleSettings, nowMs: number): Promise<PointsSummary> {
  const [days, stored] = await Promise.all([sources.history.days(astronaut, nowMs), sources.badges.earned(astronaut.id)]);
  const toStore = newlyEarned(stored, badgesEarnedBy(days, settings));
  const storedBadges = toStore.length === 0 ? stored : await sources.badges.record(astronaut.id, toStore, nowMs);
  return pointsSummary({ astronautId: astronaut.id, days, storedBadges }, settings, nowMs);
}
