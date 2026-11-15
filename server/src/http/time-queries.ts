// Turns ?range=, ?from=&to= and ?bucket= query strings into domain windows, and window
// problems into the API's 400 error codes and messages.
import {
  DEFAULT_RANGE, DEFAULT_RANGE_LENGTH_MS, MAX_BUCKET_MINUTES, MIN_BUCKET_MINUTES, SERIES_RANGES, isOneOf,
  isValidBucket, namedRangeBounds, timeBounds, type SeriesWindow, type TimeBounds,
} from "../domain/time-windows.ts";
import { EXERCISE_DAY_RANGES, type SeriesRange } from "@heartbeat/shared";
import {
  DEFAULT_EXERCISE_DAY_RANGE, EXERCISE_DEFAULT_DAYS, MAX_EXERCISE_DAYS, namedExerciseWindow, utcDaysTouched, type ExerciseDaysWindow,
} from "../domain/exercise-days.ts";
import { DAY_MS } from "../domain/time.ts";

export interface TimeRangeQuery {
  from?: string;
  to?: string;
}

export interface SeriesQuery extends RangeOrTimesQuery {
  bucket?: string;
}

/** Why a query could not be used; `error` is a stable code, `message` is for people. */
export interface QueryProblem {
  ok: false;
  error: string;
  message: string;
}

export type Parsed<T> = { ok: true; value: T } | QueryProblem;

const problem = (error: string, message: string): QueryProblem => ({ ok: false, error, message });
const parsed = <T>(value: T): Parsed<T> => ({ ok: true, value });

/** A ranged endpoint's query: a named `range`, or `from`/`to` times. */
export interface RangeOrTimesQuery extends TimeRangeQuery {
  range?: string;
}

/** The named ranges an endpoint knows, its default, and the window each one covers. */
interface NamedRanges<R extends string, W> {
  ranges: readonly R[];
  defaultRange: R;
  window: (range: R) => W;
}

/**
 * The one window policy for every ranged endpoint: a named range (the default when nothing is
 * given) or from/to times, never both.
 */
function parseRangeOrTimes<R extends string, W>(
  query: RangeOrTimesQuery, named: NamedRanges<R, W>, parseTimes: () => Parsed<W>,
): Parsed<W> {
  const hasExplicitTimes = query.from !== undefined || query.to !== undefined;
  if (query.range !== undefined && hasExplicitTimes) return problem("range_and_times", "use either range or from/to, not both");
  if (hasExplicitTimes) return parseTimes();
  const range = query.range ?? named.defaultRange;
  if (!isOneOf(named.ranges, range)) return problem("invalid_range", `range must be one of ${named.ranges.join(", ")}`);
  return parsed(named.window(range));
}

/** Turns ?range= or ?from=&to=, plus ?bucket=, into a chart window. */
export function parseSeriesQuery(query: SeriesQuery, nowMs: number): Parsed<SeriesWindow> {
  const bucketMinutes = query.bucket === undefined ? null : parseWholeNumber(query.bucket);
  if (bucketMinutes !== null && !isValidBucket(bucketMinutes)) {
    return problem("invalid_bucket", `bucket must be a whole number of minutes from ${MIN_BUCKET_MINUTES} to ${MAX_BUCKET_MINUTES}`);
  }
  const bounds = parseRangeOrTimes<SeriesRange, Omit<SeriesWindow, "bucketMinutes">>(
    query,
    { ranges: SERIES_RANGES, defaultRange: DEFAULT_RANGE, window: (range) => namedRangeBounds(range, nowMs) },
    () => parseTimeRangeQuery(query, DEFAULT_RANGE_LENGTH_MS, nowMs),
  );
  return bounds.ok ? parsed({ ...bounds.value, bucketMinutes }) : bounds;
}

/**
 * Turns ?range=7d|mission or ?from=&to= into the days to report (default: the last 7 days). A
 * from/to window may touch at most MAX_EXERCISE_DAYS UTC days.
 */
export function parseExerciseDaysQuery(query: RangeOrTimesQuery, nowMs: number): Parsed<ExerciseDaysWindow> {
  return parseRangeOrTimes(
    query,
    { ranges: EXERCISE_DAY_RANGES, defaultRange: DEFAULT_EXERCISE_DAY_RANGE, window: (range) => namedExerciseWindow(range, nowMs) },
    () => parseExerciseTimes(query, nowMs),
  );
}

function parseExerciseTimes(query: TimeRangeQuery, nowMs: number): Parsed<ExerciseDaysWindow> {
  const bounds = parseTimeRangeQuery(query, (EXERCISE_DEFAULT_DAYS - 1) * DAY_MS, nowMs);
  if (!bounds.ok) return bounds;
  if (utcDaysTouched(bounds.value.fromMs, bounds.value.toMs) > MAX_EXERCISE_DAYS) {
    return problem("range_too_long", `from and to may span at most ${MAX_EXERCISE_DAYS} days`);
  }
  return bounds;
}

/**
 * Parses optional ISO `from`/`to` times. `to` defaults to now and `from` to `defaultLengthMs`
 * before `to`.
 */
export function parseTimeRangeQuery(query: TimeRangeQuery, defaultLengthMs: number, nowMs: number): Parsed<TimeBounds> {
  const fromMs = query.from === undefined ? undefined : parseIsoTime(query.from);
  const toMs = query.to === undefined ? undefined : parseIsoTime(query.to);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return problem("invalid_date", "from and to must be ISO 8601 times");
  const bounds = timeBounds({ fromMs, toMs }, defaultLengthMs, nowMs);
  return bounds ? parsed(bounds) : problem("invalid_date", "from must not be after to");
}

/** NaN unless the text is only digits. */
function parseWholeNumber(text: string): number {
  return /^\d+$/.test(text) ? Number(text) : Number.NaN;
}

/** NaN for anything that is not an ISO 8601 date or date-time. */
function parseIsoTime(text: string): number {
  const looksIso = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(text);
  return looksIso ? Date.parse(text) : Number.NaN;
}
