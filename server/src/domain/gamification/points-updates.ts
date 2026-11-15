// Live points (SPEC §7, §10): after a write that can complete or undo a task (a meal, a check-in, an
// ECG, SpO₂ or heart-rate upload), a crew or profile change, and once a minute (a new day), the
// astronaut's points are worked out again and, when anything changed, pushed to /ws/onboard as a
// `points` message, so the dashboard and the watch update without reloading.
import type { Astronaut, Metric, PointsSummary, Reading, TaskState } from "@heartbeat/shared";
import type { AstronautStore, BadgeStore, LiveUpdates, PointsChanges } from "../ports.ts";
import type { RuleSettings } from "../rules/settings.ts";
import { astronautPoints } from "./points-summary.ts";
import { cachedTaskHistory, type TaskHistoryStores } from "./task-history.ts";

/** The uploaded metrics that can complete a task: the ECG and SpO₂ checks, and exercise from heart rate. */
const TASK_METRICS: ReadonlySet<Metric> = new Set<Metric>(["ecg", "spo2", "heartRate"]);

/** Each astronaut whose tasks an upload can change, with the earliest time it changes them from. */
export function taskActivityInUpload(readings: readonly Pick<Reading, "astronautId" | "metric" | "takenAt">[]): { astronautId: string; atMs: number }[] {
  const earliest = new Map<string, number>();
  for (const { astronautId, metric, takenAt } of readings) {
    if (!TASK_METRICS.has(metric)) continue;
    earliest.set(astronautId, Math.min(earliest.get(astronautId) ?? Infinity, Date.parse(takenAt)));
  }
  return [...earliest].map(([astronautId, atMs]) => ({ astronautId, atMs }));
}

export interface PointsUpdatesDeps {
  /** The astronaut's summary now, or null when the id is not in the crew. */
  compute: (astronautId: string) => Promise<PointsSummary | null>;
  live: LiveUpdates;
  /** Told when working out an astronaut's points fails; nothing is pushed then. */
  onError: (error: unknown, astronautId: string) => void;
}

export interface PointsUpdates {
  /** Works out the astronaut's points again and pushes them if they changed. */
  changed(astronautId: string): void;
  /** Resolves once every recompute asked for so far has finished (tests and shutdown). */
  settled(): Promise<void>;
}

/** What a summary says, without the time it was worked out: an unchanged one is not pushed again. */
const contentOf = ({ at: _at, ...content }: PointsSummary) => JSON.stringify(content);

/**
 * One recompute at a time per astronaut. Changes asked for while one runs are folded into a single
 * further run, so a burst of uploads costs at most two.
 */
export function pointsUpdates({ compute, live, onError }: PointsUpdatesDeps): PointsUpdates {
  const running = new Map<string, Promise<void>>();
  const again = new Set<string>();
  const lastPushed = new Map<string, string>();

  const recompute = async (astronautId: string) => {
    try {
      const summary = await compute(astronautId);
      if (!summary) return;
      const content = contentOf(summary);
      if (lastPushed.get(astronautId) === content) return;
      lastPushed.set(astronautId, content);
      live.publish("onboard", { type: "points", points: summary });
    } catch (error) {
      onError(error, astronautId);
    }
  };

  const run = async (astronautId: string) => {
    await null; // let the caller register this run before it can finish
    do await recompute(astronautId);
    while (again.delete(astronautId));
    running.delete(astronautId);
  };

  return {
    changed(astronautId) {
      if (running.has(astronautId)) {
        again.add(astronautId);
        return;
      }
      running.set(astronautId, run(astronautId));
    },
    async settled() {
      while (running.size > 0) await Promise.all(running.values());
    },
  };
}

export interface CrewPointsDeps {
  stores: TaskHistoryStores & { badges: BadgeStore; astronauts: Pick<AstronautStore, "find" | "list"> };
  settings: RuleSettings;
  live: LiveUpdates;
  now: () => number;
  onError: (error: unknown, astronautId: string | null) => void;
}

/** The crew's tasks and points, kept current and pushed live. */
export interface CrewPoints extends PointsChanges {
  /** The astronaut's points, streak and badges now. */
  summary(astronaut: Astronaut, nowMs: number): Promise<PointsSummary>;
  /** Today's tasks with their done-state, from the same history as the points. */
  todayTasks(astronaut: Astronaut, nowMs: number): Promise<TaskState[]>;
  /** Works out every crew member's points again (start, and the minute's upkeep: a new day changes today's). */
  crewChanged(): Promise<void>;
  /** Resolves once every recompute asked for so far has finished. */
  settled(): Promise<void>;
}

export function crewPoints({ stores, settings, live, now, onError }: CrewPointsDeps): CrewPoints {
  const history = cachedTaskHistory(stores, settings);
  const sources = { history, badges: stores.badges };
  const updates = pointsUpdates({
    live,
    onError,
    compute: async (astronautId) => {
      const astronaut = await stores.astronauts.find(astronautId);
      return astronaut && astronautPoints(sources, astronaut, settings, now());
    },
  });
  return {
    summary: (astronaut, nowMs) => astronautPoints(sources, astronaut, settings, nowMs),
    async todayTasks(astronaut, nowMs) {
      return (await history.days(astronaut, nowMs)).at(-1)?.tasks ?? [];
    },
    activityChanged(astronautId, atMs) {
      history.activityChanged(astronautId, atMs);
      updates.changed(astronautId);
    },
    historyChanged(astronautId) {
      history.historyChanged(astronautId);
      updates.changed(astronautId);
    },
    async crewChanged() {
      try {
        for (const astronaut of await stores.astronauts.list()) updates.changed(astronaut.id);
      } catch (error) {
        onError(error, null);
      }
    },
    settled: () => updates.settled(),
  };
}
