// Readings expire (owner decision): a metric whose newest reading is older than its maximum age
// reports "no recent data" and is not rated.
import { METRICS, type Metric } from "@heartbeat/shared";
import type { MaxReadingAges } from "../rules/settings.ts";
import { MINUTE_MS } from "../time.ts";
import type { StatusInputs } from "./compute-facts.ts";
import { newestTime } from "./timed-values.ts";

export interface FreshInputs {
  inputs: StatusInputs;
  /** Metrics with readings, none of them recent enough. */
  noRecentData: Metric[];
}

const isStale = (maxAges: MaxReadingAges, metric: Metric, newestMs: number, nowMs: number) => {
  const maxAgeMinutes = maxAges[metric];
  return maxAgeMinutes !== undefined && newestMs < nowMs - maxAgeMinutes * MINUTE_MS;
};

/**
 * Drops the astronaut's latest reading of each expired metric, and the whole series of each
 * expired ship metric. Astronaut series stay: they are history (today's exercise, the baseline).
 */
export function withoutExpiredReadings(inputs: StatusInputs, maxAges: MaxReadingAges): FreshInputs {
  const { nowMs } = inputs;
  const noRecentData: Metric[] = [];
  const latest = { ...inputs.latest };
  const ship = { ...inputs.ship };
  for (const metric of METRICS) {
    const reading = latest[metric];
    if (reading && isStale(maxAges, metric, reading.tMs, nowMs)) {
      delete latest[metric];
      noRecentData.push(metric);
    }
    const points = ship[metric];
    if (points && points.length > 0 && isStale(maxAges, metric, newestTime(points), nowMs)) {
      ship[metric] = [];
      noRecentData.push(metric);
    }
  }
  return { inputs: { ...inputs, latest, ship }, noRecentData };
}
