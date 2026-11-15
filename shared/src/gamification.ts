// Points, the measurement streak and badges (SPEC §7), worked out on the server from the tasks done
// since mission day 1, for the dashboard and the watch. Re-exported from index.ts.
import type { AreaStatus, Status } from "./index";

/** The badges, each earned once (SPEC §7), in display order. */
export const BADGE_IDS = ["checkInStreak", "boneGuardian"] as const;
export type BadgeId = (typeof BADGE_IDS)[number];

/** One badge and, once earned, the UTC day it was earned. */
export interface Badge {
  id: BadgeId;
  /** e.g. "7-day check-in streak", "Bone Guardian". */
  name: string;
  /** What earns it, in plain language, e.g. "Exercise goal met 7 days in a row". */
  description: string;
  /** "YYYY-MM-DD" (UTC) of the day it was earned; null until then. */
  earnedOn: string | null;
}

/** GET /api/astronauts/:id/points, and the live `points` message on /ws/onboard. */
export interface PointsSummary {
  astronautId: string;
  /** ISO time it was worked out. */
  at: string;
  /** "YYYY-MM-DD", today's UTC day. */
  day: string;
  /** Points from every task done since mission day 1, today included. */
  totalPoints: number;
  today: {
    /** Points from today's tasks done so far. */
    points: number;
    /** Points today's tasks are worth when all are done. */
    possiblePoints: number;
    tasksDone: number;
    tasks: number;
  };
  /**
   * Consecutive UTC days with every measurement task (ECG, SpO₂, mood check-in) done. Today counts
   * once it is complete; until then the streak runs through yesterday.
   */
  streak: { days: number; includesToday: boolean };
  /** Every badge, in BADGE_IDS order, earned or not. */
  badges: Badge[];
}

/** GET /api/astronauts/:id/summary: the current status per area plus points, streak and badges. */
export interface AstronautSummary {
  astronautId: string;
  /** ISO time the status was evaluated. */
  at: string;
  overall: Status | null;
  /** One entry per area, in AREAS order, as GET /api/astronauts/:id/status gives them. */
  areas: AreaStatus[];
  points: PointsSummary;
}
