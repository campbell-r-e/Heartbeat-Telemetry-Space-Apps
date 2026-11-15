// How points, the streak and badges read on the dashboard (SPEC §7, §9.1). Every number comes from
// the server (GET /api/astronauts/:id/points and each task's `points`); this formats them, and adds
// up the server's per-task points for the meal picker's label (sumMealTaskPoints).

import type { Badge, PointsSummary, TaskState } from "@heartbeat/shared";
import { NO_VALUE, formatNumber } from "./format";
import type { Loaded } from "./onboard-response";

/** Shown where points would be when the server could not provide them. */
export const POINTS_UNAVAILABLE = "Points unavailable";

/** The header's "Points · Streak" tile: "1,240 · 9d", with today's points under it. */
export function pointsTile(summary: PointsSummary): { value: string; detail: string } {
  const { days, includesToday } = summary.streak;
  const streakNote = days === 0 ? "no streak yet" : includesToday ? "streak includes today" : "streak through yesterday";
  return {
    value: `${formatNumber(summary.totalPoints, 0)} · ${days}d`,
    detail: `+${formatNumber(summary.today.points, 0)} today · ${streakNote}`,
  };
}

/** The tile from a load that may have failed: "—" and why, so the rest of the page still shows. */
export function loadedPointsTile(points: Loaded<PointsSummary>): { value: string; detail: string } {
  return points.ok ? pointsTile(points.value) : { value: NO_VALUE, detail: POINTS_UNAVAILABLE };
}

/** "+60 pts earned today", for Today's tasks; "Points unavailable" when they could not be loaded. */
export function loadedEarnedTodayText(points: Loaded<PointsSummary>): string {
  return points.ok ? earnedTodayText(points.value) : POINTS_UNAVAILABLE;
}

/** "+60 pts earned today", for Today's tasks. */
export function earnedTodayText(summary: PointsSummary): string {
  return `+${formatNumber(summary.today.points, 0)} pts earned today`;
}

/** A task's point value, "+20"; null when the server gives it none. */
export function taskPointsText(task: Pick<TaskState, "points">): string | null {
  return task.points === null ? null : `+${formatNumber(task.points, 0)}`;
}

/** How a badge's state reads: "Earned 2026-11-11" or "Not earned yet". */
export function badgeStateText(badge: Pick<Badge, "earnedOn">): string {
  return badge.earnedOn === null ? "Not earned yet" : `Earned ${badge.earnedOn}`;
}

/**
 * Adds up the server-given `points` of today's meal tasks that the server marks done, for the meal
 * picker's log. Which tasks are done, and what each is worth, are the server's (each meal task
 * once, never per food); only the sum is done here.
 */
export function sumMealTaskPoints(tasks: readonly TaskState[]): number {
  return tasks.filter((task) => task.kind === "meal" && task.done).reduce((sum, task) => sum + (task.points ?? 0), 0);
}
