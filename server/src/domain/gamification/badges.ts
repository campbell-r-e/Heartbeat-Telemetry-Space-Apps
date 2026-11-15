// The two badges (SPEC §7, owner decision), each earned once, on the day its run of days completes:
// "7-day check-in streak" (the mood check-in done 7 UTC days in a row) and "Bone Guardian" (the
// daily exercise goal met 7 UTC days in a row). Once earned a badge is stored and never removed
// (owner decision); the storing is done by the use case. Pure.
import { BADGE_IDS, type Badge, type BadgeId, type ScheduledTaskKind } from "@heartbeat/shared";
import type { EarnedBadge } from "../ports.ts";
import type { RuleSettings, SettingKey } from "../rules/settings.ts";
import { utcDayLabel } from "../time.ts";
import type { TaskDay } from "../today-tasks.ts";
import { allDoneOfKinds } from "./streak.ts";

interface BadgeDefinition {
  /** The kind of task that must be done every day of the run. */
  kind: ScheduledTaskKind;
  /** How many UTC days in a row. */
  daysSetting: SettingKey;
  name: (days: number | null) => string;
  description: (days: number | null) => string;
}

const inARow = (days: number | null) => (days === null ? "on consecutive days" : `${days} days in a row`);

export const BADGES: Record<BadgeId, BadgeDefinition> = {
  checkInStreak: {
    kind: "checkIn",
    daysSetting: "badges.checkInStreakDays",
    name: (days) => (days === null ? "Check-in streak" : `${days}-day check-in streak`),
    description: (days) => `Mood check-in done ${inARow(days)}`,
  },
  boneGuardian: {
    kind: "exercise",
    daysSetting: "badges.boneGuardianDays",
    name: () => "Bone Guardian",
    description: (days) => `Exercise goal met ${inARow(days)}`,
  },
};

/**
 * The start of the first day (from `days`, oldest first) on which `qualifies` has held `length`
 * days in a row; null when it never has, or when `length` is unset.
 */
export function firstRunEnd(days: readonly TaskDay[], qualifies: (day: TaskDay) => boolean, length: number | null): number | null {
  if (length === null) return null;
  let run = 0;
  for (const day of days) {
    run = qualifies(day) ? run + 1 : 0;
    if (run >= length) return day.dayStartMs;
  }
  return null;
}

/** The badges the activity in `days` (oldest first, from mission day 1) has earned, with the day each was earned. */
export function badgesEarnedBy(days: readonly TaskDay[], settings: RuleSettings): EarnedBadge[] {
  return BADGE_IDS.flatMap((badgeId) => {
    const badge = BADGES[badgeId];
    const earnedMs = firstRunEnd(days, (day) => allDoneOfKinds(day, [badge.kind]), settings[badge.daysSetting]);
    return earnedMs === null ? [] : [{ badgeId, earnedOn: utcDayLabel(earnedMs) }];
  });
}

/**
 * The earned badges not stored yet. A stored badge is never earned again or moved to another day,
 * and stays even when the activity that earned it is later deleted (owner decision).
 */
export function newlyEarned(stored: readonly EarnedBadge[], earned: readonly EarnedBadge[]): EarnedBadge[] {
  return earned.filter((badge) => !stored.some((s) => s.badgeId === badge.badgeId));
}

/** Every badge in BADGE_IDS order, with the day it was earned from the stored badges (null until then). */
export function badgeList(stored: readonly EarnedBadge[], settings: RuleSettings): Badge[] {
  return BADGE_IDS.map((id) => {
    const badge = BADGES[id];
    const length = settings[badge.daysSetting];
    const earnedOn = stored.find((s) => s.badgeId === id)?.earnedOn ?? null;
    return { id, name: badge.name(length), description: badge.description(length), earnedOn };
  });
}
