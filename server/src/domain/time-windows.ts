// Chart and history windows: the named ranges, bucket limits and default lengths. Takes typed
// values; turning query strings into these values, and problems into API errors, is http/'s job.
import type { SeriesRange } from "@heartbeat/shared";
import { DAY_MS, HOUR_MS } from "./time.ts";

export const SERIES_RANGES: readonly SeriesRange[] = ["1h", "24h", "7d", "mission"];
export const DEFAULT_RANGE = "7d" satisfies SeriesRange;
export const MIN_BUCKET_MINUTES = 1;
/** 30 days in minutes. */
export const MAX_BUCKET_MINUTES = 43_200;

const RANGE_LENGTH_MS: Record<Exclude<SeriesRange, "mission">, number> = {
  "1h": HOUR_MS,
  "24h": DAY_MS,
  "7d": 7 * DAY_MS,
};

/** Length of the default chart window, used when only from/to bounds the series. */
export const DEFAULT_RANGE_LENGTH_MS = RANGE_LENGTH_MS[DEFAULT_RANGE];

/** Inclusive time bounds in ms. */
export interface TimeBounds {
  fromMs: number;
  toMs: number;
}

/** Like TimeBounds, but null means unbounded on that side ("mission"). */
export interface SeriesWindow {
  fromMs: number | null;
  toMs: number | null;
  /** null = raw points, not averaged. */
  bucketMinutes: number | null;
}

/** Whether `text` is one of `values` (a named-range guard for any list of names). */
export function isOneOf<T extends string>(values: readonly T[], text: string): text is T {
  return (values as readonly string[]).includes(text);
}

export function isSeriesRange(text: string): text is SeriesRange {
  return isOneOf(SERIES_RANGES, text);
}

/** A bucket is a whole number of minutes from 1 to 43200. */
export function isValidBucket(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes >= MIN_BUCKET_MINUTES && minutes <= MAX_BUCKET_MINUTES;
}

/** The window a named range covers, ending now; "mission" is all stored data up to now. */
export function namedRangeBounds(range: SeriesRange, nowMs: number): Omit<SeriesWindow, "bucketMinutes"> {
  if (range === "mission") return { fromMs: null, toMs: nowMs };
  return { fromMs: nowMs - RANGE_LENGTH_MS[range], toMs: nowMs };
}

/**
 * Bounds from optional from/to times: `to` defaults to now and `from` to `defaultLengthMs`
 * before `to`. Null when `from` is after `to`.
 */
export function timeBounds(
  given: { fromMs?: number; toMs?: number },
  defaultLengthMs: number,
  nowMs: number,
): TimeBounds | null {
  const toMs = given.toMs ?? nowMs;
  const fromMs = given.fromMs ?? toMs - defaultLengthMs;
  return fromMs > toMs ? null : { fromMs, toMs };
}

/**
 * Readings are shown only at or before now: the looping mission clock stores future loops of the
 * bundled data (SPEC §5.7), so a window never reaches past now.
 */
export function upToNow<W extends { toMs: number | null }>(window: W, nowMs: number): W {
  return { ...window, toMs: window.toMs === null ? nowMs : Math.min(window.toMs, nowMs) };
}
