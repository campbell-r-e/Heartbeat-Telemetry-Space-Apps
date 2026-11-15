// Every UTC day's tasks since mission day 1, for today's tasks, points, the streak and badges
// (SPEC §7). A past day's tasks change only through a write that lands on it (a backdated meal or
// check-in, a deletion, a late upload), a changed profile (the age sets the exercise threshold) or
// a changed mission start, so each astronaut's settled days are kept once worked out and only the
// rest, and any day a write has touched since, is read again. The schedule and settings are fixed
// while the server runs, so a restart (which empties this cache) covers a change to them.
import type { Astronaut } from "@heartbeat/shared";
import { missionFirstDayMs } from "../mission.ts";
import type { MissionStore } from "../ports.ts";
import { MAX_CLOCK_SKEW_MS } from "../reading-validation.ts";
import type { RuleSettings } from "../rules/settings.ts";
import { DAY_MS, MINUTE_MS, startOfUtcDay } from "../time.ts";
import { taskDays, type TaskDay, type TaskStores } from "../today-tasks.ts";

export interface TaskHistoryStores extends TaskStores {
  mission: Pick<MissionStore, "get">;
}

export interface TaskHistory {
  /**
   * The astronaut's tasks on every UTC day from mission day 1 (or today, if that is earlier) to
   * today, oldest first, as at `nowMs`.
   */
  days(astronaut: Astronaut, nowMs: number): Promise<TaskDay[]>;
  /** Activity at `atMs` was added or removed: the days whose tasks it can complete are read again. */
  activityChanged(astronautId: string, atMs: number): void;
  /** Everything may read differently (the astronaut was removed or added again): read it all again. */
  historyChanged(astronautId: string): void;
}

/** What is kept for one astronaut. */
interface Kept {
  /** Settled days, contiguous from `firstDayMs`, as last worked out. */
  days: TaskDay[];
  firstDayMs: number;
  /** The age they were worked out with (it sets the exercise threshold). */
  age: number | null;
}

interface AstronautState {
  kept: Kept | null;
  /** The earliest day a write has touched since `kept` was worked out; null when none has. */
  dirtyFromMs: number | null;
  /** Counts marks, so a mark made while the days are being read is never lost. */
  marks: number;
}

/**
 * Whether a day can no longer change unless a write marks it: its last task's match window has
 * closed, plus the clock skew a reading may be ahead of now (an activity stamped a little in the
 * future is stored before its time, and a read only sees activity up to now).
 */
export function isSettled(dayStartMs: number, nowMs: number, windowMs: number): boolean {
  return nowMs >= dayStartMs + DAY_MS + windowMs + MAX_CLOCK_SKEW_MS;
}

export function cachedTaskHistory(stores: TaskHistoryStores, settings: RuleSettings): TaskHistory {
  const states = new Map<string, AstronautState>();
  const stateOf = (astronautId: string): AstronautState => {
    let state = states.get(astronautId);
    if (!state) states.set(astronautId, (state = { kept: null, dirtyFromMs: null, marks: 0 }));
    return state;
  };
  const windowMs = (settings["tasks.doneWithinMinutes"] ?? 0) * MINUTE_MS;
  const settled = (day: TaskDay, nowMs: number) => isSettled(day.dayStartMs, nowMs, windowMs);

  /** The kept days still valid for this read: same start and age, settled, and before any touched day. */
  const reusable = (state: AstronautState, firstDayMs: number, age: number | null, nowMs: number): TaskDay[] => {
    const { kept } = state;
    if (!kept || kept.firstDayMs !== firstDayMs || kept.age !== age) return [];
    const reused: TaskDay[] = [];
    for (const day of kept.days) {
      if (!settled(day, nowMs) || day.dayStartMs >= (state.dirtyFromMs ?? Infinity)) break;
      reused.push(day);
    }
    return reused;
  };

  return {
    async days(astronaut, nowMs) {
      const state = stateOf(astronaut.id);
      const marksAtStart = state.marks;
      const firstDayMs = Math.min(await missionFirstDayMs(stores.mission, nowMs), startOfUtcDay(nowMs));
      const reused = reusable(state, firstDayMs, astronaut.age, nowMs);
      const lastReused = reused.at(-1);
      // Every activity the reused days used is carried over, so none is used twice, however wide the window.
      const fresh = await taskDays(stores, {
        astronaut, nowMs, earlierDays: reused, firstDayMs: lastReused ? lastReused.dayStartMs + DAY_MS : firstDayMs,
      }, settings);
      const days = [...reused, ...fresh];
      // Keep the result only if nothing was marked while it was read; otherwise the next call reads again.
      if (state.marks === marksAtStart) {
        const keep: TaskDay[] = [];
        for (const day of days) {
          if (!settled(day, nowMs)) break;
          keep.push(day);
        }
        state.kept = { days: keep, firstDayMs, age: astronaut.age };
        state.dirtyFromMs = null;
      }
      return days;
    },

    activityChanged(astronautId, atMs) {
      const state = stateOf(astronautId);
      // An activity can complete a task timed at most one match window before it, so the earliest
      // day it can change is the day of (atMs − window), which can be the day before.
      const fromMs = startOfUtcDay(atMs - windowMs);
      state.dirtyFromMs = Math.min(state.dirtyFromMs ?? Infinity, fromMs);
      state.marks++;
    },

    historyChanged(astronautId) {
      const state = stateOf(astronautId);
      state.kept = null;
      state.dirtyFromMs = null;
      state.marks++;
    },
  };
}
