// The sleep period time window (SPT-window) of one noon-to-noon day, found with HDCZA, the
// "Heuristic algorithm looking at Distribution of Change in Z-Angle" of van Hees et al. 2018
// (Sci Rep 8, 12975, doi:10.1038/s41598-018-31266-z), section "Heuristic algorithm to detect the
// SPT-window" (p. 3 of docs/sleep/vanHees-2018-SciRep-sleep-without-diary.pdf). Each step below
// quotes the paper. Where the paper is silent, this follows the implementation the paper names
// under "Code availability", GGIR 1.5-23 (R/g.sib.det.R, function sptwindow_HDCZA), and says so.
// The threshold is kept within 0.13–0.50° (owner decision): the paper's range from "the 2.5th and
// 97.5th percentile of the distribution of the threshold value observed in a sample of daily life
// accelerometer recordings" (p. 4), applied by GGIR by default (constrain2range). Without it a
// restless day's threshold sits above all its movement and the whole day becomes one window. With
// it, GGIR's 0.20 substitute for a zero threshold can never apply.
import { epochCount, EPOCHS_PER_MINUTE, runsWhere, type EpochAngles, type EpochRange } from "./epochs.ts";

/**
 * Steps 3–5: "a 5-minute rolling median of the absolute differences between successive 5 second
 * averages of the z-angle": 60 epochs, GGIR's k = 60.
 */
export const ROLLING_WINDOW_EPOCHS = 5 * EPOCHS_PER_MINUTE;

/** Steps 6–7: "Calculate the 10th percentile from the output of step 5 over an individual day (noon-noon), and multiply by 15." */
export const THRESHOLD_PERCENTILE = 10;
export const THRESHOLD_MULTIPLIER = 15;

/** The range the threshold is kept within, in degrees (paper p. 4; owner decision). */
export const THRESHOLD_RANGE_DEG = { min: 0.13, max: 0.5 } as const;

/** Step 7: keep the blocks below the threshold "lasting longer than 30 minutes". */
export const MIN_BLOCK_EPOCHS = 30 * EPOCHS_PER_MINUTE;

/** Step 8: "if the duration is less than 60 minutes then count these gaps towards the identified blocks". */
export const MAX_MERGED_GAP_EPOCHS = 60 * EPOCHS_PER_MINUTE;

export interface SptWindow {
  /** The epochs from sleep onset (start of the block) to waking time (end of the block). */
  range: EpochRange;
  /** The day's critical threshold in degrees (step 6–7). */
  thresholdDeg: number;
}

/**
 * Steps 3–5 for each epoch: the median of the absolute angle changes across the 60 epochs that
 * start at it (59 changes), as GGIR's zoo::rollapply(angle, 60, medabsdi) indexes its output.
 * Null where the window runs past the day's end (GGIR's output is shorter by the same 59 epochs)
 * or holds an epoch with no angle, since the paper does not say how to bridge missing data.
 */
export function rollingMedianAbsoluteChange(angles: EpochAngles): (number | null)[] {
  return angles.map((_, epoch) => {
    const window = angles.slice(epoch, epoch + ROLLING_WINDOW_EPOCHS);
    if (window.length < ROLLING_WINDOW_EPOCHS || !window.every(isPresent)) return null;
    return median(window.slice(1).map((angle, k) => Math.abs(angle - window[k])));
  });
}

/**
 * Steps 6–7: the 10th percentile of the day's step-5 values × 15, kept within 0.13–0.50°. The
 * percentile is R's default (type 7, linear interpolation), as GGIR's quantile(x, probs = 0.1).
 * Null with no values.
 */
export function criticalThreshold(changes: readonly (number | null)[]): number | null {
  const values = changes.filter(isPresent);
  if (values.length === 0) return null;
  const threshold = percentile(values, THRESHOLD_PERCENTILE) * THRESHOLD_MULTIPLIER;
  return Math.min(THRESHOLD_RANGE_DEG.max, Math.max(THRESHOLD_RANGE_DEG.min, threshold));
}

/**
 * Steps 3–9: the day's main SPT-window, or null when no block below the threshold lasts longer
 * than 30 minutes.
 */
export function detectSptWindow(angles: EpochAngles): SptWindow | null {
  const changes = rollingMedianAbsoluteChange(angles);
  const thresholdDeg = criticalThreshold(changes);
  if (thresholdDeg === null) return null;
  const longest = longestBlock(mergeShortGaps(longBlocksBelow(changes, thresholdDeg)));
  return longest === null ? null : { range: longest, thresholdDeg };
}

/**
 * Step 7: "Detect the observation blocks for which the output from step 5 was below the critical
 * threshold, and keep the ones lasting longer than 30 minutes."
 */
export function longBlocksBelow(changes: readonly (number | null)[], thresholdDeg: number): EpochRange[] {
  const belowThreshold = (epoch: number) => {
    const change = changes[epoch];
    return change !== null && change < thresholdDeg;
  };
  return runsWhere(changes.length, belowThreshold).filter((block) => epochCount(block) > MIN_BLOCK_EPOCHS);
}

/**
 * Step 8: joins neighboring blocks whose gap is shorter than 60 minutes. Only gaps between blocks
 * are counted, as the paper says ("the time gaps between the observation blocks").
 */
export function mergeShortGaps(blocks: readonly EpochRange[]): EpochRange[] {
  const merged: EpochRange[] = [];
  for (const block of blocks) {
    const previous = merged.at(-1);
    if (previous && block.start - previous.end < MAX_MERGED_GAP_EPOCHS) previous.end = block.end;
    else merged.push({ ...block });
  }
  return merged;
}

/**
 * Step 9: "The longest block in the day (noon-noon) will be the main SPT-window". The paper does
 * not say which of two equally long blocks wins, so the earlier one does.
 */
export function longestBlock(blocks: readonly EpochRange[]): EpochRange | null {
  return blocks.reduce<EpochRange | null>((best, block) => (best === null || epochCount(block) > epochCount(best) ? block : best), null);
}

const isPresent = (value: number | null): value is number => value !== null;

function median(values: readonly number[]): number {
  return percentile(values, 50);
}

/** The p-th percentile with linear interpolation between order statistics (R's quantile type 7). */
export function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * (p / 100);
  const below = Math.floor(position);
  const above = Math.min(below + 1, sorted.length - 1);
  return sorted[below] + (position - below) * (sorted[above] - sorted[below]);
}
