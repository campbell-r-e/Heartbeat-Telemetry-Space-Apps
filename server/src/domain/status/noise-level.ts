// Noise averages for the §6.5 noise rules. Sound levels are averaged by energy (the equivalent
// continuous level, Leq), the way NASA's dBA limits are defined, not by plain arithmetic mean.
import { hourOfUtcDay } from "../time.ts";
import type { TimedValue } from "./timed-values.ts";

const DECIBEL_SCALE = 10;

/** Equivalent continuous level of equally weighted readings in dBA; null when there are none. */
export function equivalentLevelDba(levelsDba: readonly number[]): number | null {
  if (levelsDba.length === 0) return null;
  const meanEnergy = levelsDba.reduce((sum, l) => sum + 10 ** (l / DECIBEL_SCALE), 0) / levelsDba.length;
  return DECIBEL_SCALE * Math.log10(meanEnergy);
}

/** The crew sleep period in hours of the UTC day (21.5 = 21:30), [start, end); it may wrap past midnight. */
export interface SleepPeriod {
  startHourUtc: number;
  endHourUtc: number;
}

export function inSleepPeriod(tMs: number, period: SleepPeriod): boolean {
  const hour = hourOfUtcDay(tMs);
  const { startHourUtc: start, endHourUtc: end } = period;
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** Leq of the readings during the sleep period and outside it. */
export function sleepAndAwakeLevels(readings: readonly TimedValue[], period: SleepPeriod) {
  const asleep = readings.filter((r) => inSleepPeriod(r.tMs, period));
  const awake = readings.filter((r) => !inSleepPeriod(r.tMs, period));
  return { sleepDba: equivalentLevelDba(asleep.map((r) => r.value)), awakeDba: equivalentLevelDba(awake.map((r) => r.value)) };
}
