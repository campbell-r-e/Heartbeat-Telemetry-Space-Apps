// The 1 h / 24 h / 7 d / Mission chart ranges on the detail pages (SPEC §9.1), mapped onto the
// server's `range=` values and a bucket size that keeps each chart to a readable number of points.

import type { SeriesRange } from "@heartbeat/shared";
import { DAY_MS, HOUR_MS, startOfUtcDay } from "./time";

export interface RangeOption {
  id: SeriesRange;
  label: string;
  /** Used in chart descriptions: "Heart rate over the last 24 hours". */
  phrase: string;
  /** Averaging bucket in minutes, or null for raw points. */
  bucketMinutes: number | null;
  /** Window length, or null for "mission" (all stored data). */
  lengthMs: number | null;
}

const QUARTER_HOUR_MINUTES = 15;
const TWO_HOURS_MINUTES = 120;
const HALF_DAY_MINUTES = 720;
const WEEK_DAYS = 7;

export const RANGE_OPTIONS: readonly RangeOption[] = [
  { id: "1h", label: "1 h", phrase: "the last hour", bucketMinutes: null, lengthMs: HOUR_MS },
  { id: "24h", label: "24 h", phrase: "the last 24 hours", bucketMinutes: QUARTER_HOUR_MINUTES, lengthMs: DAY_MS },
  { id: "7d", label: "7 d", phrase: "the last 7 days", bucketMinutes: TWO_HOURS_MINUTES, lengthMs: WEEK_DAYS * DAY_MS },
  { id: "mission", label: "Mission", phrase: "the mission so far", bucketMinutes: HALF_DAY_MINUTES, lengthMs: null },
];

/** Every range, in display order. */
export const RANGE_IDS: readonly SeriesRange[] = RANGE_OPTIONS.map((option) => option.id);

export const DEFAULT_RANGE: SeriesRange = "24h";

/** "mission" means all stored data; for endpoints that only take from/to, that starts at the epoch. */
const ALL_STORED_DATA_FROM_MS = 0;

export function rangeOption(id: SeriesRange): RangeOption {
  const option = RANGE_OPTIONS.find((candidate) => candidate.id === id);
  if (!option) throw new Error(`Unknown range: ${id}`);
  return option;
}

/**
 * The range named in a `?range=` search param when the page offers it; otherwise the default
 * (24 h when offered, else the first offered range).
 */
export function parseRangeParam(param: string | string[] | undefined, offered: readonly SeriesRange[] = RANGE_IDS): SeriesRange {
  const value = Array.isArray(param) ? param[0] : param;
  const fallback = offered.includes(DEFAULT_RANGE) ? DEFAULT_RANGE : offered[0];
  return offered.find((id) => id === value) ?? fallback;
}

export interface TimeWindow {
  fromMs: number;
  toMs: number;
}

/** The span a chart of this range shows: its window ending now; "mission" starts at the first point. */
export function chartWindow(id: SeriesRange, nowMs: number, firstPointMs: number | null): TimeWindow {
  const { lengthMs } = rangeOption(id);
  return { fromMs: lengthMs === null ? (firstPointMs ?? nowMs) : nowMs - lengthMs, toMs: nowMs };
}

/**
 * The span a chart of daily values shows, from the first day to today's UTC day start (where today's
 * point sits): the last 7 days for "7d", or from the first point for "mission".
 */
export function dayChartWindow(id: SeriesRange, nowMs: number, firstPointMs: number | null): TimeWindow {
  const today = startOfUtcDay(nowMs);
  const { lengthMs } = rangeOption(id);
  return { fromMs: lengthMs === null ? (firstPointMs ?? today) : today - lengthMs + DAY_MS, toMs: today };
}

/** The from/to window of a range, for endpoints that take times instead of `range=`. */
export function rangeWindow(id: SeriesRange, nowMs: number): TimeWindow {
  const { lengthMs } = rangeOption(id);
  return { fromMs: lengthMs === null ? ALL_STORED_DATA_FROM_MS : nowMs - lengthMs, toMs: nowMs };
}

/** The query string of GET .../series: a named range, plus the range's bucket when it has one. */
export function seriesQuery(metric: string, range: SeriesRange): Record<string, string | number | undefined> {
  return { metric, range, bucket: rangeOption(range).bucketMinutes ?? undefined };
}

/** The ?from=&to= query of the time-window endpoints (meals, check-ins). */
export function windowQuery(window: TimeWindow): Record<string, string> {
  return { from: new Date(window.fromMs).toISOString(), to: new Date(window.toMs).toISOString() };
}
