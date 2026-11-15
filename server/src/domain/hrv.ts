// HRV as RMSSD over beat-to-beat intervals (IBI) in 5-minute windows. The thresholds are the
// method in SPEC.md §5.7. Pure, so the wxserver import and live watch data can share it.

export const HRV_WINDOW_MINUTES = 5;
export const MIN_VALID_IBI_MS = 300;
export const MAX_VALID_IBI_MS = 2000;
/** Fewer beats than this in a window give no meaningful RMSSD. */
export const MIN_WINDOW_INTERVALS = 30;
/** A pair differing by more than this share of the earlier interval is a missed or extra beat. */
export const ARTIFACT_RATIO = 0.2;
export const MIN_RMSSD_PAIRS = 20;
/** RMSSD is kept to one decimal place. */
const RMSSD_ROUNDING = 10;
/** The watch's IBI status for a valid interval. */
const VALID_IBI_STATUS = 0;

/** One heart-rate sample's beat-to-beat intervals, as the watch reports them. */
export interface IbiSample {
  /** ISO time of the sample. */
  t: string;
  ibisMs: readonly number[];
  /** One status per interval; a missing status counts as valid. */
  statuses: readonly number[];
}

export interface HrvWindow {
  /** ISO start of the 5-minute window. */
  t: string;
  rmssdMs: number;
  /** Valid intervals in the window. */
  beats: number;
  /** Successive pairs used, after the artifact rule. */
  pairs: number;
}

/** ISO start of the 5-minute UTC window containing `isoTime`. */
export function windowKey(isoTime: string): string {
  const time = new Date(isoTime);
  time.setUTCMinutes(time.getUTCMinutes() - (time.getUTCMinutes() % HRV_WINDOW_MINUTES), 0, 0);
  return time.toISOString();
}

/** The intervals the watch marks valid and that lie within 300–2000 ms. */
export function validIntervals(ibisMs: readonly number[], statuses: readonly number[]): number[] {
  return ibisMs.filter((v, i) => (statuses[i] ?? VALID_IBI_STATUS) === VALID_IBI_STATUS && v >= MIN_VALID_IBI_MS && v <= MAX_VALID_IBI_MS);
}

/**
 * RMSSD over successive pairs, skipping a pair whose difference is more than 20% of the earlier
 * interval. Null when no pair is usable.
 */
export function rmssd(intervalsMs: readonly number[]): { rmssdMs: number; pairs: number } | null {
  let sum = 0;
  let pairs = 0;
  for (let i = 1; i < intervalsMs.length; i++) {
    const d = intervalsMs[i] - intervalsMs[i - 1];
    if (Math.abs(d) / intervalsMs[i - 1] > ARTIFACT_RATIO) continue;
    sum += d * d;
    pairs++;
  }
  if (pairs === 0) return null;
  return { rmssdMs: Math.round(Math.sqrt(sum / pairs) * RMSSD_ROUNDING) / RMSSD_ROUNDING, pairs };
}

/**
 * Splits one live ibi batch into per-window samples. Each beat gets its own time: the batch's
 * `takenAt` is the first beat, and each following beat is `takenAt` plus the intervals before it.
 * Interval i starts at beat i, so it belongs to the window holding beat i's time; a batch that
 * crosses a window boundary is split across windows. The watch drops invalid intervals before
 * uploading, so every interval is marked valid (the 300–2000 ms range still applies).
 */
export function liveBatchSamples(takenAt: string, ibisMs: readonly number[]): IbiSample[] {
  const pieces: Array<{ t: string; window: string; ibisMs: number[] }> = [];
  let beatMs = Date.parse(takenAt);
  for (const interval of ibisMs) {
    const t = new Date(beatMs).toISOString();
    const window = windowKey(t);
    const current = pieces.at(-1);
    if (current?.window === window) current.ibisMs.push(interval);
    else pieces.push({ t, window, ibisMs: [interval] });
    beatMs += interval;
  }
  return pieces.map(({ t, ibisMs: intervals }) => ({ t, ibisMs: intervals, statuses: [] }));
}

/** The ISO starts of the 5-minute windows a live batch's beats fall in. */
export function liveBatchWindows(takenAt: string, ibisMs: readonly number[]): string[] {
  return [...new Set(liveBatchSamples(takenAt, ibisMs).map((s) => windowKey(s.t)))];
}

/**
 * Groups samples (in time order) into 5-minute windows and keeps the windows with at least 30
 * valid intervals and at least 20 usable pairs. Windows come out in the order first seen.
 */
export function hrvWindows(samples: Iterable<IbiSample>): HrvWindow[] {
  const windows = new Map<string, number[]>();
  for (const sample of samples) {
    const key = windowKey(sample.t);
    const list = windows.get(key) ?? [];
    list.push(...validIntervals(sample.ibisMs, sample.statuses));
    windows.set(key, list);
  }
  const result: HrvWindow[] = [];
  for (const [t, intervals] of windows) {
    if (intervals.length < MIN_WINDOW_INTERVALS) continue;
    const r = rmssd(intervals);
    if (r === null || r.pairs < MIN_RMSSD_PAIRS) continue;
    result.push({ t, rmssdMs: r.rmssdMs, beats: intervals.length, pairs: r.pairs });
  }
  return result;
}
