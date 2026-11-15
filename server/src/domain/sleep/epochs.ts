// The 5-second epoch grid that live sleep detection runs on (SPEC §5.7), over one noon-to-noon day
// (sleep-days.ts).
//
// Method: van Hees VT et al. "Estimating sleep parameters using an accelerometer without sleep
// diary." Sci Rep 8, 12975 (2018), doi:10.1038/s41598-018-31266-z (CC BY 4.0). Section
// "Accelerometer data preparation": "estimated arm angles were averaged per 5 second epoch".
import type { ArrayReading } from "../ports.ts";
import type { AnalysisDay } from "./sleep-days.ts";

export const EPOCH_MS = 5_000;
export const EPOCHS_PER_MINUTE = 12;

/** A run of epochs, as indices into a day's grid: [start, end). */
export interface EpochRange {
  start: number;
  end: number;
}

/** One angle in degrees per epoch of the day, in time order; null where none was recorded. */
export type EpochAngles = readonly (number | null)[];

/** How many epochs a day has: 23, 24 or 25 hours' worth. */
export const epochsIn = (day: AnalysisDay) => (day.endMs - day.startMs) / EPOCH_MS;

/**
 * Places each minute's epoch angles on the day's grid: value k of a minute is the epoch starting
 * k × 5 s after its takenAt. Angles outside the day are left out.
 */
export function epochGrid(day: AnalysisDay, minutes: readonly ArrayReading[]): (number | null)[] {
  const epochs = epochsIn(day);
  const grid: (number | null)[] = new Array(epochs).fill(null);
  for (const minute of minutes) {
    const first = Math.round((Date.parse(minute.takenAt) - day.startMs) / EPOCH_MS);
    minute.values.forEach((angle, k) => {
      const epoch = first + k;
      if (epoch >= 0 && epoch < epochs) grid[epoch] = angle;
    });
  }
  return grid;
}

/** The maximal runs of consecutive epochs in [0, length) for which `holds` is true. */
export function runsWhere(length: number, holds: (epoch: number) => boolean): EpochRange[] {
  const runs: EpochRange[] = [];
  let start: number | null = null;
  for (let epoch = 0; epoch <= length; epoch++) {
    const inRun = epoch < length && holds(epoch);
    if (inRun && start === null) start = epoch;
    if (!inRun && start !== null) {
      runs.push({ start, end: epoch });
      start = null;
    }
  }
  return runs;
}

export const epochCount = (range: EpochRange) => range.end - range.start;

/** The start time of an epoch of the day (an exclusive end index gives the end of the range). */
export const epochTimeMs = (day: AnalysisDay, epoch: number) => day.startMs + epoch * EPOCH_MS;
