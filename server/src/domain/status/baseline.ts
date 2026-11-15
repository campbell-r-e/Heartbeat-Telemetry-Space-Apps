// The personal baseline (SPEC §6.2): the mean and spread of the astronaut's own real readings,
// used once they cover enough distinct days.
import { DAY_MS, startOfUtcDay } from "../time.ts";
import { mean, sampleStandardDeviation, type TimedValue } from "./timed-values.ts";

export interface BaselineSettings {
  /** Days of readings, back from now, the baseline is taken over. */
  windowDays: number;
  /** Distinct UTC days those readings must fall on before the baseline applies. */
  minimumDistinctDays: number;
}

export interface Baseline {
  mean: number;
  /** Sample standard deviation. */
  sd: number;
}

/**
 * The baseline from the real readings in the `windowDays` before now, taken before `beforeMs`
 * (the reading being rated, which is left out). Null until they fall on `minimumDistinctDays`
 * distinct UTC days, and when they do not vary (a zero spread rates nothing).
 */
export function baselineOf(
  realReadings: readonly TimedValue[], beforeMs: number, nowMs: number, settings: BaselineSettings,
): Baseline | null {
  const windowStartMs = nowMs - settings.windowDays * DAY_MS;
  const history = realReadings.filter((r) => r.tMs >= windowStartMs && r.tMs < beforeMs);
  if (distinctDays(history, windowStartMs, beforeMs) < settings.minimumDistinctDays) return null;
  const values = history.map((r) => r.value);
  const sd = sampleStandardDeviation(values);
  return sd === null || sd === 0 ? null : { mean: mean(values)!, sd };
}

/** How many distinct UTC days hold at least one of the readings in [fromMs, beforeMs). */
export function distinctDays(readings: readonly TimedValue[], fromMs: number, beforeMs: number): number {
  return new Set(readings.filter((r) => r.tMs >= fromMs && r.tMs < beforeMs).map((r) => startOfUtcDay(r.tMs))).size;
}

/** How many standard deviations `value` is above the baseline mean (negative when below). */
export function sdsAbove(value: number, baseline: Baseline): number {
  return (value - baseline.mean) / baseline.sd;
}
