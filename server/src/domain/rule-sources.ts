// The one place that decides which of an astronaut's readings the rules read (owner decisions,
// SPEC §6.2, §6.7): recorded readings only, never simulated, and not the readings kept for
// history and charts only. The status, today's tasks and the readings store all take it from here.
import type { Metric, ReadingSource, SeriesPoint } from "@heartbeat/shared";
import { toTimedValue, type TimedValue } from "./status/timed-values.ts";

export interface MetricSource {
  metric: Metric;
  source: ReadingSource;
}

/** Sources the rules never read, for any metric: the labeled demo data. */
export const NEVER_READ_BY_RULES: readonly ReadingSource[] = ["simulated"];

/**
 * Zepp's nightly sleep HRV and nightly SpO₂ score are history and charts only: the HRV baseline,
 * the HRV and SpO₂ rules, the latest-HRV value and today's SpO₂ task use spot readings.
 */
export const HISTORY_ONLY: readonly MetricSource[] = [
  { metric: "hrv", source: "zepp" },
  { metric: "spo2", source: "zepp" },
];

/** Whether the rules, baselines, derived values and tasks read this metric's readings from `source`. */
export function isReadByRules(metric: Metric, source: ReadingSource): boolean {
  return !NEVER_READ_BY_RULES.includes(source) && !HISTORY_ONLY.some((h) => h.metric === metric && h.source === source);
}

/** The points of `metric` the rules read, as timed values. */
export function readByRules(metric: Metric, points: readonly SeriesPoint[]): TimedValue[] {
  return points.filter((p) => isReadByRules(metric, p.source)).map(toTimedValue);
}
