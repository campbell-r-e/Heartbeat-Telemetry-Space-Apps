// Galaxy Watch readings win over the imported Zepp history (owner decision, SPEC §5.7): a Zepp
// reading is not kept when the Galaxy Watch has a reading of the same metric in the same slot
// (minute, 5-minute window, or night).
// Applied when the Zepp history loads and whenever Galaxy Watch readings are written.
import type { Metric, Reading, ReadingSource } from "@heartbeat/shared";
import { HRV_WINDOW_MINUTES } from "./hrv.ts";
import type { MetricRange, ReadingStore } from "./ports.ts";
import { wakeTimesOf, type SleepDays } from "./sleep/sleep-days.ts";
import { MINUTE_MS } from "./time.ts";

/** Sources that are the Galaxy Watch: its imported history and the live watch app. */
export const GALAXY_WATCH_SOURCES = ["wxserver", "watch"] as const satisfies readonly ReadingSource[];

/** The source the Galaxy Watch outranks. */
export const OUTRANKED_SOURCE: ReadingSource = "zepp";

/** A slot a Galaxy Watch reading takes from the outranked source: [fromMs, toMs). */
export interface Slot {
  fromMs: number;
  toMs: number;
}

const fixedSlots = (lengthMs: number) => (ms: number): Slot => {
  const fromMs = Math.floor(ms / lengthMs) * lengthMs;
  return { fromMs, toMs: fromMs + lengthMs };
};

/** The slot a reading at `ms` competes in. */
export type SlotOf = (ms: number) => Slot;

/**
 * The slot each metric a Galaxy Watch posting can contest competes in: heart rate per minute and
 * HRV per 5-minute window (the Galaxy Watch's own spacing). Sleep competes per night, which depends
 * on the mission's sleep-day time zone: see `nightSlots`.
 */
export const PRECEDENCE_SLOTS = {
  heartRate: fixedSlots(MINUTE_MS),
  hrv: fixedSlots(HRV_WINDOW_MINUTES * MINUTE_MS),
} as const satisfies Partial<Record<Metric, SlotOf>>;

export type ContestedMetric = keyof typeof PRECEDENCE_SLOTS;

/** Sleep competes per night: the noon-to-noon day (in the sleep-day time zone) the waking time closes (SPEC §5.7). */
export const nightSlots = (days: SleepDays): SlotOf => (wakeMs) => wakeTimesOf(days.ofWake(wakeMs));

/** Times (ms) of the Galaxy Watch's readings, per contested metric and for sleep. */
export type GalaxyReadingTimes = Record<ContestedMetric | "sleep", readonly number[]>;

export const isGalaxyWatch = (source: ReadingSource) => (GALAXY_WATCH_SOURCES as readonly ReadingSource[]).includes(source);

const isContested = (metric: Metric): metric is ContestedMetric => metric in PRECEDENCE_SLOTS;

/** The points whose slot holds none of `winnerTimesMs`, so the winning source keeps that slot. */
export function withoutContestedSlots<P extends { t: string }>(
  points: readonly P[], winnerTimesMs: readonly number[], slotOf: SlotOf,
): P[] {
  const slotStart = (ms: number) => slotOf(ms).fromMs;
  const taken = new Set(winnerTimesMs.map(slotStart));
  return points.filter((p) => !taken.has(slotStart(Date.parse(p.t))));
}

/** The slots the Galaxy Watch readings among `written` take from the outranked source. */
export function slotsTakenBy(written: readonly Reading[]): MetricRange[] {
  return written.flatMap(({ astronautId, metric, source, takenAt }) => {
    if (!isGalaxyWatch(source) || !isContested(metric)) return [];
    return [{ astronautId, metric, ...PRECEDENCE_SLOTS[metric](Date.parse(takenAt)) }];
  });
}

/** Deletes the outranked readings in the slots that `written` Galaxy Watch readings take; returns how many. */
export function removeOutrankedReadings(readings: ReadingStore, written: readonly Reading[]): Promise<number> {
  return readings.deleteSourceInRanges(OUTRANKED_SOURCE, slotsTakenBy(written));
}
