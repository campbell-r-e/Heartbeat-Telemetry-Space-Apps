// Synthetic wrist-angle days for the sleep tests (test data only; never loaded by the app).
import type { Reading } from "@heartbeat/shared";
import type { ArrayReading } from "../../src/domain/ports.ts";
import { EPOCHS_PER_MINUTE, epochsIn } from "../../src/domain/sleep/epochs.ts";
import { sleepDays, type AnalysisDay } from "../../src/domain/sleep/sleep-days.ts";

/** UTC noon-to-noon days, the in-flight setting. */
export const UTC_DAYS = sleepDays("UTC");

/** The UTC noon-to-noon day the sleep tests use: 2026-11-10 12:00 to 2026-11-11 12:00 UTC. */
export const DAY = UTC_DAYS.containing(Date.parse("2026-11-10T12:00:00Z"));

const EPOCHS_PER_HOUR = 60 * EPOCHS_PER_MINUTE;

/** The epoch of a day at a time given in hours after its noon start (11 = 23:00 UTC). */
export const at = (hoursAfterNoon: number) => Math.round(hoursAfterNoon * EPOCHS_PER_HOUR);

/** Moving wrist: successive epochs differ by up to ~27°, so the rolling median of changes is large. */
export const moving = (epoch: number) => 40 * Math.sin(epoch * 0.7);

/** Still wrist: a fixed posture with a 0.1° ripple, so every change is 0.1°. */
export const still = (epoch: number) => -30 + 0.1 * (epoch % 2);

/** A day of angles (24 h unless `day` says otherwise): still inside the given [from, to) hour ranges after noon, moving elsewhere. */
export function dayWithStillPeriods(...periods: Array<[number, number]>): number[] {
  return angleDay(DAY, ...periods);
}

/** `dayWithStillPeriods` for a day of any length (a 23- or 25-hour daylight-time change day). */
export function angleDay(day: AnalysisDay, ...periods: Array<[number, number]>): number[] {
  return Array.from({ length: epochsIn(day) }, (_, epoch) =>
    (periods.some(([from, to]) => epoch >= at(from) && epoch < at(to)) ? still(epoch) : moving(epoch)));
}

/** A day still from 23:00 to 07:00 UTC and moving otherwise. */
export const nightOfEightHours = () => dayWithStillPeriods([11, 19]);

/** A day's angles as the watch's minutes: 12 epoch angles each, stamped at the minute's start. */
export function minutesOf(day: AnalysisDay, angles: readonly number[]): ArrayReading[] {
  return Array.from({ length: angles.length / EPOCHS_PER_MINUTE }, (_, m) => ({
    takenAt: new Date(day.startMs + m * 60_000).toISOString(),
    values: angles.slice(m * EPOCHS_PER_MINUTE, (m + 1) * EPOCHS_PER_MINUTE),
  }));
}

/** The same minutes as watch wristAngle readings for one astronaut. */
export function wristAngleReadings(astronautId: string, day: AnalysisDay, angles: readonly number[]): Reading[] {
  return minutesOf(day, angles).map(({ takenAt, values }) => ({ astronautId, metric: "wristAngle", value: values, unit: "deg", takenAt, source: "watch" }));
}
