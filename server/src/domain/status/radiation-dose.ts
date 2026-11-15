// Radiation dose from the ship's hourly dose rates (µGy/h, absorbed dose; SPEC §5.2, §5.7).
import { DAY_MS, HOUR_MS, HOURS_PER_DAY } from "../time.ts";
import { mean, newestTime, windowAverage, type TimedValue } from "./timed-values.ts";

export const PREVIOUS_DAYS = 7;
const MICRO_PER_MILLI = 1000;

export interface DailyDoseComparison {
  /** Dose over the 24 hours ending at the evaluation time. */
  dailyDoseUGy: number;
  /** Mean of the daily doses of the 7 days before that. */
  previousSevenDayAverageUGy: number;
  multiple: number;
  /** Newest reading in the last 24 hours. */
  atMs: number;
}

/**
 * The radiation alert rule's comparison (SPEC §5.7): the dose of the rolling 24 hours ending at
 * `atMs` against the mean daily dose of the 7 days before. A day's dose is its mean dose rate ×
 * 24 h, so a missing hour does not count as zero dose. Null unless every `slotMs` slot of all
 * 8 days holds a reading.
 */
export function dailyDoseComparison(rates: readonly TimedValue[], atMs: number, slotMs: number): DailyDoseComparison | null {
  const doseOfDay = (daysBack: number) => {
    const average = windowAverage(rates, atMs - daysBack * DAY_MS, DAY_MS, slotMs);
    return average && { doseUGy: average.value * HOURS_PER_DAY, atMs: average.atMs };
  };
  const today = doseOfDay(0);
  const previous = Array.from({ length: PREVIOUS_DAYS }, (_, i) => doseOfDay(i + 1));
  if (today === null || previous.some((day) => day === null)) return null;
  const previousAverage = mean(previous.map((day) => day!.doseUGy))!;
  return {
    dailyDoseUGy: today.doseUGy,
    previousSevenDayAverageUGy: previousAverage,
    multiple: today.doseUGy / previousAverage,
    atMs: today.atMs,
  };
}

/**
 * Mean dose rate of the readings since the mission start, and the hours from the start to the
 * newest of them (owner decision: mission dose accumulates from the mission's start date).
 */
export function missionDoseRate(
  rates: readonly TimedValue[], missionStartMs: number,
): { meanUGyPerHour: number; elapsedHours: number; atMs: number } | null {
  const sinceStart = rates.filter((p) => p.tMs >= missionStartMs);
  const meanRate = mean(sinceStart.map((p) => p.value));
  if (meanRate === null) return null;
  const atMs = newestTime(sinceStart);
  return { meanUGyPerHour: meanRate, elapsedHours: (atMs - missionStartMs) / HOUR_MS, atMs };
}

export interface CareerDoseSettings {
  /** mSv of dose equivalent per mGy of absorbed dose. */
  doseEquivalentPerAbsorbed: number;
  priorCareerDoseMSv: number;
}

/** Dose equivalent (mSv, an estimate) of an absorbed dose in µGy, at mSv per mGy. */
export function doseEquivalentMSv(absorbedUGy: number, doseEquivalentPerAbsorbed: number): number {
  return (absorbedUGy / MICRO_PER_MILLI) * doseEquivalentPerAbsorbed;
}

/** Career dose equivalent (mSv, an estimate) after `hours` at `uGyPerHour` absorbed. */
export function careerDoseMSv(uGyPerHour: number, hours: number, settings: CareerDoseSettings): number {
  return settings.priorCareerDoseMSv + doseEquivalentMSv(uGyPerHour * hours, settings.doseEquivalentPerAbsorbed);
}

export const hoursInDays = (days: number) => days * HOURS_PER_DAY;
