// Sustained inactivity bouts, the sleep inside the SPT-window. van Hees et al. 2018 (Sci Rep 8,
// 12975), section "Sleep episodes within the SPT-window": "Sleep episodes were defined as the
// sustained periods of inactivity within the SPT-window". Section "Second algorithm for
// reference": "sustained inactivity periods are calculated as the absence of change in arm
// elevation angle (same angle-z as used above) larger than 5 degrees for more than 5 minutes",
// citing van Hees et al. 2015 (PLoS ONE 10, e0142533). GGIR 1.5-23 (R/g.sib.det.R) counts a bout
// between two posture changes when they are more than 60 epochs apart (`diff(postch) > (i*(60/ws3))`
// with i = 5 minutes and ws3 = 5 s), so a bout is more than 60 epochs long; this does the same. The
// 2015 paper says "at least 5 minutes"; the 2018 paper and GGIR's "more than" are followed.
import { epochCount, EPOCHS_PER_MINUTE, runsWhere, type EpochAngles, type EpochRange } from "./epochs.ts";

/** The largest change between successive epochs that still counts as no posture change. */
export const MAX_STILL_CHANGE_DEG = 5;

/** A bout must last more than this many epochs (5 minutes). */
export const MIN_BOUT_EPOCHS = 5 * EPOCHS_PER_MINUTE;

/**
 * The runs of recorded epochs in which no change between successive epochs exceeds 5°, lasting
 * more than 5 minutes. A missing epoch ends a run: there is no evidence of stillness across it.
 */
export function sustainedInactivityBouts(angles: EpochAngles): EpochRange[] {
  // A run of epochs that each changed little from the one before also takes in that first "before" epoch.
  return runsWhere(angles.length, (epoch) => changedLittle(angles, epoch))
    .map(({ start, end }) => ({ start: start - 1, end }))
    .filter((bout) => epochCount(bout) > MIN_BOUT_EPOCHS);
}

/** Whether the epoch and the one before it both have angles at most 5° apart. */
function changedLittle(angles: EpochAngles, epoch: number): boolean {
  const previous = angles[epoch - 1];
  const current = angles[epoch];
  return typeof previous === "number" && typeof current === "number" && Math.abs(current - previous) <= MAX_STILL_CHANGE_DEG;
}

/** How many epochs of `bouts` fall inside `window`. */
export function epochsInside(bouts: readonly EpochRange[], window: EpochRange): number {
  return bouts.reduce((sum, bout) => sum + Math.max(0, Math.min(bout.end, window.end) - Math.max(bout.start, window.start)), 0);
}
