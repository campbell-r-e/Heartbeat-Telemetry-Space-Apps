import type { SeriesPoint } from "@heartbeat/shared";

/** One numeric reading, in the form the status calculations use. */
export interface TimedValue {
  tMs: number;
  value: number;
}

/** Readings in the window that ends at `endMs` (inclusive) and lasts `lengthMs` (start exclusive). */
export function inWindowEndingAt(points: readonly TimedValue[], endMs: number, lengthMs: number): TimedValue[] {
  return points.filter((p) => p.tMs > endMs - lengthMs && p.tMs <= endMs);
}

export function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Sample standard deviation (n − 1); null for fewer than two values. */
export function sampleStandardDeviation(values: readonly number[]): number | null {
  const average = mean(values);
  if (average === null || values.length < 2) return null;
  return Math.sqrt(values.reduce((sum, v) => sum + (v - average) ** 2, 0) / (values.length - 1));
}

/** The newest reading's time; the input must not be empty. */
export function newestTime(points: readonly TimedValue[]): number {
  return Math.max(...points.map((p) => p.tMs));
}

/**
 * Whether every `slotMs` slot of the window ending at `endMs` holds a reading (slots counted back
 * from the end, each including its end). This is the minimum coverage for a windowed average.
 */
export function coversWindow(points: readonly TimedValue[], endMs: number, lengthMs: number, slotMs: number): boolean {
  const slotsFilled = new Set(inWindowEndingAt(points, endMs, lengthMs).map((p) => Math.floor((endMs - p.tMs) / slotMs)));
  return slotsFilled.size === Math.ceil(lengthMs / slotMs);
}

export interface WindowAverage {
  value: number;
  /** Newest reading in the window. */
  atMs: number;
}

/**
 * Mean of the readings in the window ending at `endMs`, or null when the window is empty or, with
 * `slotMs`, when some slot of that length holds no reading.
 */
export function windowAverage(points: readonly TimedValue[], endMs: number, lengthMs: number, slotMs?: number): WindowAverage | null {
  if (slotMs !== undefined && !coversWindow(points, endMs, lengthMs, slotMs)) return null;
  const inWindow = inWindowEndingAt(points, endMs, lengthMs);
  const value = mean(inWindow.map((p) => p.value));
  return value === null ? null : { value, atMs: newestTime(inWindow) };
}

export const toTimedValue = (p: SeriesPoint): TimedValue => ({ tMs: Date.parse(p.t), value: p.value });
