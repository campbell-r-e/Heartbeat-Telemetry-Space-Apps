// One day's sleep period from wrist angles alone (van Hees et al. 2018, Sci Rep 8, 12975): the
// SPT-window from HDCZA, and the time asleep as the sustained inactivity bouts inside it. The paper
// uses no heart rate, so neither does this. Sleep stages are not estimated.
import { EPOCH_MS, EPOCHS_PER_MINUTE, epochTimeMs, type EpochAngles } from "./epochs.ts";
import type { AnalysisDay } from "./sleep-days.ts";
import { detectSptWindow } from "./hdcza.ts";
import { epochsInside, sustainedInactivityBouts } from "./sustained-inactivity.ts";
import { HOUR_MS } from "../time.ts";

export interface SleepPeriod {
  /** Sleep onset: the start of the SPT-window. */
  onsetMs: number;
  /** Waking time: the end of the SPT-window. */
  wakeMs: number;
  /** Time in sustained inactivity bouts inside the window, in hours. */
  asleepHours: number;
}

/**
 * A day is analyzed only with more than 16 hours of wear time, the paper's own criterion for a
 * night ("Study population": "at least one night defined as noon-noon with >16 h of wear time").
 * The watch sends angles only while it is on the wrist, so wear time is the recorded epochs.
 */
export const MIN_WEAR_EPOCHS = 16 * 60 * EPOCHS_PER_MINUTE;

/** The day's main sleep period, or null with 16 hours of wear time or less, or when HDCZA finds no SPT-window. */
export function detectSleepPeriod(day: AnalysisDay, angles: EpochAngles): SleepPeriod | null {
  const wornEpochs = angles.filter((angle) => angle !== null).length;
  if (wornEpochs <= MIN_WEAR_EPOCHS) return null;
  const spt = detectSptWindow(angles);
  if (spt === null) return null;
  const asleepEpochs = epochsInside(sustainedInactivityBouts(angles), spt.range);
  return {
    onsetMs: epochTimeMs(day, spt.range.start),
    wakeMs: epochTimeMs(day, spt.range.end),
    asleepHours: (asleepEpochs * EPOCH_MS) / HOUR_MS,
  };
}
