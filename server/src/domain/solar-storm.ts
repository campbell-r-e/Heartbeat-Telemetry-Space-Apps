import { SHIP_ID, type Reading, type SolarStormState } from "@heartbeat/shared";
import { METRIC_UNITS } from "./metrics.ts";
import { MISSION_SAMPLE_PERIOD_MS } from "./mission-clock.ts";
import { DAY_MS, HOUR_MS } from "./time.ts";

export const DEFAULT_STORM_FACTOR = 5;
export const MIN_STORM_FACTOR = 1;
export const MAX_STORM_FACTOR = 50;

/** The real September 2017 solar particle event seen by the ISS DosTel2 instrument. */
export const SOLAR_EVENT_START_MS = Date.parse("2017-09-11T00:00:00Z");
export const SOLAR_EVENT_LENGTH_MS = 2 * DAY_MS;
export const BASELINE_LENGTH_MS = 7 * DAY_MS;

/** Dose rates are kept to three decimal places, like the source data. */
const DOSE_ROUNDING = 1000;

export function roundDose(uGyPerHour: number): number {
  return Math.round(uGyPerHour * DOSE_ROUNDING) / DOSE_ROUNDING;
}

export interface HourlyDose {
  t: string;
  uGyPerHour: number;
}

export interface SolarEventProfile {
  /** Mean dose rate over the 7 days before the event. */
  baseline: number;
  /** Real hourly dose rates during the event, in order. */
  hours: number[];
}

/** Picks the event hours and their pre-event baseline out of the bundled radiation record. */
export function solarEventProfile(hourly: readonly HourlyDose[]): SolarEventProfile {
  const between = (startMs: number, endMs: number) =>
    hourly.filter((p) => {
      const t = Date.parse(p.t);
      return t >= startMs && t < endMs;
    });
  const before = between(SOLAR_EVENT_START_MS - BASELINE_LENGTH_MS, SOLAR_EVENT_START_MS);
  if (before.length === 0) throw new Error("radiation data has no hours in the 7 days before the solar event");
  const baseline = before.reduce((sum, p) => sum + p.uGyPerHour, 0) / before.length;
  const hours = between(SOLAR_EVENT_START_MS, SOLAR_EVENT_START_MS + SOLAR_EVENT_LENGTH_MS).map((p) => p.uGyPerHour);
  return { baseline, hours };
}

/**
 * "Amplify only the rise": the part of a reading above baseline is multiplied by `factor`, so
 * the result is never below the real reading and never negative.
 */
export function amplifyRise(real: number, baseline: number, factor: number): number {
  const amplified = real + Math.max(0, real - baseline) * (factor - 1);
  return Math.max(0, real, roundDose(amplified));
}

/**
 * Labeled simulated readings for the ship, one per event hour. The last hour lands at `nowMs`,
 * so the whole storm shows at once instead of unfolding over the next two days.
 */
export function simulatedStormReadings(profile: SolarEventProfile, factor: number, nowMs: number): Reading[] {
  const startMs = nowMs - (profile.hours.length - 1) * HOUR_MS;
  return profile.hours.map((real, i) => ({
    astronautId: SHIP_ID,
    metric: "radiationDoseRate",
    value: amplifyRise(real, profile.baseline, factor),
    unit: METRIC_UNITS.radiationDoseRate,
    takenAt: new Date(startMs + i * HOUR_MS).toISOString(),
    source: "simulated",
  }));
}

/**
 * Each simulated storm reading is an hourly mean, like the record it replays, so it replaces the
 * recorded readings taken less than one sample period from it (owner decision; see ReadingStore.series).
 */
export const SIMULATED_READING_SPAN_MS = MISSION_SAMPLE_PERIOD_MS;

/** A read-back factor is reported to 2 decimals, enough to tell the demo's steps apart. */
const FACTOR_ROUNDING = 100;

/**
 * The factor a stored storm was made with, read back from its values (in time order) by inverting
 * `amplifyRise` at the event hour that rises most above baseline, where rounding matters least.
 * Null when the values are not one storm of this event (another length, or no hour above baseline).
 */
export function stormFactorOf(profile: SolarEventProfile, storedValues: readonly number[]): number | null {
  if (storedValues.length !== profile.hours.length) return null;
  const rises = profile.hours.map((real) => real - profile.baseline);
  const peak = rises.indexOf(Math.max(...rises));
  if (rises[peak] <= 0) return null;
  const factor = 1 + (storedValues[peak] - profile.hours[peak]) / rises[peak];
  return Math.round(factor * FACTOR_ROUNDING) / FACTOR_ROUNDING;
}

/**
 * How long a storm counts as on after its press (pending owner review): its own 48 hours. After
 * that the console treats it as over, and the next press starts a fresh storm with a new start time.
 */
export const STORM_ACTIVE_MS = SOLAR_EVENT_LENGTH_MS;

/** Whether `readings` (in time order) are a storm still on at `nowMs`: its last hour, the press, is less than STORM_ACTIVE_MS ago. */
export function isStormOn(readings: readonly { takenMs: number }[], nowMs: number): boolean {
  const last = readings.at(-1);
  return last !== undefined && nowMs - last.takenMs < STORM_ACTIVE_MS;
}

/**
 * Whether a storm is on at `nowMs`, the factor it was made with, and when the latest storm started
 * (GET /api/demo/solar-storm). A storm older than STORM_ACTIVE_MS counts as no storm.
 */
export function solarStormState(
  profile: SolarEventProfile, readings: readonly { takenMs: number; value: number }[], startedMs: number | null, nowMs: number,
): SolarStormState {
  const startedAt = startedMs === null ? null : new Date(startedMs).toISOString();
  if (!isStormOn(readings, nowMs)) return { active: false, factor: null, startedAt };
  return { active: true, factor: stormFactorOf(profile, readings.map((r) => r.value)), startedAt };
}

type StormView = Pick<SolarStormState, "active" | "factor">;

const describeStorm = (state: StormView) =>
  !state.active ? "no storm" : state.factor === null ? "a storm of unknown factor" : `a storm at factor ${state.factor}`;

/**
 * Why a press is out of date, or null when it is not: the sender expected `expectedFactor` (null:
 * no storm) but the storm is now something else. A press that names no expectation is never stale.
 */
export function stalePressReason(current: StormView, expectedFactor: number | null | undefined): string | null {
  if (expectedFactor === undefined) return null;
  const expected: StormView = { active: expectedFactor !== null, factor: expectedFactor };
  if (current.active === expected.active && current.factor === expected.factor) return null;
  return `The storm changed since this was shown: expected ${describeStorm(expected)}, but the ship has ${describeStorm(current)}. Nothing was changed; check the current step and press again`;
}
