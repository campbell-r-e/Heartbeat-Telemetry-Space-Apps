import type pg from "pg";
import { SHIP_ID, type LatestReading, type Metric, type ReadingSource, type SeriesPoint } from "@heartbeat/shared";
import type { ArrayReading, MetricRange, ReadingStore, StoredReading } from "../domain/ports.ts";
import { HISTORY_ONLY, NEVER_READ_BY_RULES } from "../domain/rule-sources.ts";
import type { SeriesWindow } from "../domain/time-windows.ts";
import { SIMULATED_READING_SPAN_MS } from "../domain/solar-storm.ts";
import { MINUTE_MS } from "../domain/time.ts";
import { withTransaction, type Queryable } from "./pool.ts";

// One statement per batch: each column travels as one array parameter and is unnested in SQL.
const INSERT_ROWS = `
  INSERT INTO readings (astronaut_id, metric, value, value_json, unit, taken_ms, source, original_ms)
  SELECT * FROM unnest($1::text[], $2::text[], $3::float8[], $4::jsonb[], $5::text[], $6::bigint[], $7::text[], $8::bigint[])`;
const INSERT_READINGS = `${INSERT_ROWS} ON CONFLICT ON CONSTRAINT readings_unique DO NOTHING`;
const UPSERT_READINGS = `${INSERT_ROWS} ON CONFLICT ON CONSTRAINT readings_unique
  DO UPDATE SET value = excluded.value, value_json = excluded.value_json, unit = excluded.unit`;

// For ibi the values are intervals in ms, so a batch ends at taken_ms plus their sum.
const ARRAY_READINGS_OVERLAPPING = `
  SELECT taken_ms, value_json FROM readings
  WHERE astronaut_id = $1 AND metric = $2 AND source = $3 AND value_json IS NOT NULL AND taken_ms < $5
    AND taken_ms + (SELECT coalesce(sum(x::float8), 0) FROM jsonb_array_elements_text(value_json) AS x) >= $4
  ORDER BY taken_ms`;

const ARRAY_READINGS_TAKEN_IN = `
  SELECT taken_ms, value_json FROM readings
  WHERE astronaut_id = $1 AND metric = $2 AND source = $3 AND value_json IS NOT NULL AND taken_ms >= $4 AND taken_ms < $5
  ORDER BY taken_ms`;

const IN_WINDOW = `($3::bigint IS NULL OR taken_ms >= $3) AND ($4::bigint IS NULL OR taken_ms <= $4)`;

// Simulated readings replace the recorded ones they overlap (owner decision), so charts match
// the rules: a recorded reading is left out when a simulated reading of the same metric was
// taken less than one simulated reading's span (an hour) away; only the ship's radiation is
// replaced (the storm guard). The span is written as a range on taken_ms, not abs(), so the
// readings_unique index finds the few candidates instead of every reading of the metric (which
// made long heart-rate series quadratic).
const NOT_REPLACED_BY_SIMULATED = `NOT (source <> 'simulated' AND astronaut_id = '${SHIP_ID}' AND metric = 'radiationDoseRate' AND EXISTS (
    SELECT 1 FROM readings sim
    WHERE sim.astronaut_id = readings.astronaut_id AND sim.metric = readings.metric AND sim.source = 'simulated'
      AND sim.taken_ms > readings.taken_ms - ${SIMULATED_READING_SPAN_MS}
      AND sim.taken_ms < readings.taken_ms + ${SIMULATED_READING_SPAN_MS}))`;

const RAW_SERIES = `
  SELECT taken_ms AS t, value, 1 AS n, source FROM readings
  WHERE astronaut_id = $1 AND metric = $2 AND ${IN_WINDOW} AND value IS NOT NULL AND ${NOT_REPLACED_BY_SIMULATED}
  ORDER BY taken_ms`;

// A bucket containing any simulated reading is labeled simulated, so the UI never shows
// demo data as recorded data. Otherwise a bucket mixing sources is labeled with the source that
// has the most readings in it; on a tie, the alphabetically first source wins, so the label
// never depends on row order.
const BUCKETED_SERIES = `
  WITH points AS (
    SELECT (taken_ms / $5::bigint) * $5::bigint AS t, value, source FROM readings
    WHERE astronaut_id = $1 AND metric = $2 AND ${IN_WINDOW} AND value IS NOT NULL AND ${NOT_REPLACED_BY_SIMULATED}
  ),
  majority AS (
    SELECT DISTINCT ON (t) t, source FROM points
    GROUP BY t, source
    ORDER BY t, count(*) DESC, source
  )
  SELECT points.t, avg(points.value) AS value, count(*)::int AS n,
         CASE WHEN bool_or(points.source = 'simulated') THEN 'simulated' ELSE min(majority.source) END AS source
  FROM points JOIN majority ON majority.t = points.t
  GROUP BY points.t ORDER BY points.t`;

// The SQL form of domain/rule-sources.ts, which decides which readings the rules read: never the
// sources in $3, nor the metric and source pairs in $4/$5. Its parameters come from
// readByRulesParams, so no caller supplies the list.
const READ_BY_RULES = `source <> ALL($3::text[]) AND NOT EXISTS (
    SELECT 1 FROM unnest($4::text[], $5::text[]) AS history_only(metric, source)
    WHERE history_only.metric = readings.metric AND history_only.source = readings.source)`;

const readByRulesParams = (): unknown[] =>
  [[...NEVER_READ_BY_RULES], HISTORY_ONLY.map((h) => h.metric), HISTORY_ONLY.map((h) => h.source)];

const latestQuery = (readByRulesOnly: boolean) => `
  SELECT DISTINCT ON (metric) metric, value, value_json, unit, taken_ms, source FROM readings
  WHERE astronaut_id = $1 AND taken_ms <= $2${readByRulesOnly ? ` AND ${READ_BY_RULES}` : ""}
  ORDER BY metric, taken_ms DESC, id DESC`;
const LATEST = latestQuery(false);
const LATEST_READ_BY_RULES = latestQuery(true);

const READING_TIMES_READ_BY_RULES = `
  SELECT taken_ms FROM readings
  WHERE astronaut_id = $1 AND metric = $2 AND ${READ_BY_RULES} AND taken_ms BETWEEN $6 AND $7
  ORDER BY taken_ms`;

const DELETE_SOURCE_IN_RANGES = `
  DELETE FROM readings USING unnest($2::text[], $3::text[], $4::bigint[], $5::bigint[]) AS r(astronaut_id, metric, from_ms, to_ms)
  WHERE readings.source = $1 AND readings.astronaut_id = r.astronaut_id AND readings.metric = r.metric
    AND readings.taken_ms >= r.from_ms AND readings.taken_ms < r.to_ms`;

interface SeriesRow { t: number; value: number; n: number; source: ReadingSource }
interface LatestRow {
  metric: Metric; value: number | null; value_json: number[] | null; unit: string; taken_ms: number; source: ReadingSource;
}

export function readingsRepo(pool: pg.Pool): ReadingStore {
  return {
    async add(readings) {
      const inserted = await insertReadings(pool, readings);
      return { inserted, duplicates: readings.length - inserted };
    },

    async upsert(readings) {
      if (readings.length === 0) return 0;
      const result = await pool.query(UPSERT_READINGS, toColumns(readings));
      return result.rowCount ?? 0;
    },

    replaceSource(astronautId, source, readings) {
      return withTransaction(pool, async (tx) => {
        await deleteSource(tx, astronautId, source);
        return insertReadings(tx, readings);
      });
    },

    deleteSource: (astronautId, source) => deleteSource(pool, astronautId, source),


    async series(astronautId, metric, window: SeriesWindow) {
      const params: unknown[] = [astronautId, metric, window.fromMs, window.toMs];
      const { rows } = window.bucketMinutes === null
        ? await pool.query<SeriesRow>(RAW_SERIES, params)
        : await pool.query<SeriesRow>(BUCKETED_SERIES, [...params, window.bucketMinutes * MINUTE_MS]);
      return rows.map(toSeriesPoint);
    },

    async latest(astronautId, nowMs) {
      const { rows } = await pool.query<LatestRow>(LATEST, [astronautId, nowMs]);
      return rows.map(toLatestReading);
    },

    arrayReadingsOverlapping: (astronautId, metric, source, fromMs, toMs) =>
      arrayReadings(pool, ARRAY_READINGS_OVERLAPPING, [astronautId, metric, source, fromMs, toMs]),

    arrayReadingsTakenIn: (source, { astronautId, metric, fromMs, toMs }) =>
      arrayReadings(pool, ARRAY_READINGS_TAKEN_IN, [astronautId, metric, source, fromMs, toMs]),

    replaceSourceInRange(source, range, readings) {
      return withTransaction(pool, async (tx) => {
        await deleteSourceInRanges(tx, source, [range]);
        await insertReadings(tx, readings);
      });
    },

    async readingTimesReadByRules(astronautId, metric, fromMs, toMs) {
      const { rows } = await pool.query<{ taken_ms: number }>(
        READING_TIMES_READ_BY_RULES, [astronautId, metric, ...readByRulesParams(), fromMs, toMs],
      );
      return rows.map((row) => row.taken_ms);
    },

    async latestReadByRules(astronautId, nowMs) {
      const { rows } = await pool.query<LatestRow>(LATEST_READ_BY_RULES, [astronautId, nowMs, ...readByRulesParams()]);
      return rows.map(toLatestReading);
    },

    deleteSourceInRanges: (source, ranges) => deleteSourceInRanges(pool, source, ranges),
  };
}

/** Returns how many rows were actually inserted (duplicates are skipped). */
export async function insertReadings(db: Queryable, readings: readonly StoredReading[]): Promise<number> {
  if (readings.length === 0) return 0;
  const result = await db.query(INSERT_READINGS, toColumns(readings));
  return result.rowCount ?? 0;
}

async function arrayReadings(db: Queryable, sql: string, params: unknown[]): Promise<ArrayReading[]> {
  const { rows } = await db.query<{ taken_ms: number; value_json: number[] }>(sql, params);
  return rows.map((row) => ({ takenAt: new Date(row.taken_ms).toISOString(), values: row.value_json }));
}

async function deleteSourceInRanges(db: Queryable, source: ReadingSource, ranges: readonly MetricRange[]): Promise<number> {
  if (ranges.length === 0) return 0;
  const result = await db.query(DELETE_SOURCE_IN_RANGES, [
    source, ranges.map((r) => r.astronautId), ranges.map((r) => r.metric), ranges.map((r) => r.fromMs), ranges.map((r) => r.toMs),
  ]);
  return result.rowCount ?? 0;
}

export async function deleteSource(db: Queryable, astronautId: string, source: ReadingSource): Promise<void> {
  await db.query("DELETE FROM readings WHERE astronaut_id = $1 AND source = $2", [astronautId, source]);
}

function toColumns(readings: readonly StoredReading[]): unknown[][] {
  const isArrayValue = (r: StoredReading) => Array.isArray(r.value);
  return [
    readings.map((r) => r.astronautId),
    readings.map((r) => r.metric),
    readings.map((r) => (isArrayValue(r) ? null : r.value)),
    readings.map((r) => (isArrayValue(r) ? JSON.stringify(r.value) : null)),
    readings.map((r) => r.unit),
    readings.map((r) => Date.parse(r.takenAt)),
    readings.map((r) => r.source),
    readings.map((r) => (r.originalTakenAt ? Date.parse(r.originalTakenAt) : null)),
  ];
}

function toSeriesPoint(row: SeriesRow): SeriesPoint {
  return { t: new Date(row.t).toISOString(), value: row.value, n: row.n, source: row.source };
}

function toLatestReading(row: LatestRow): LatestReading {
  return {
    metric: row.metric,
    value: storedValue(row),
    unit: row.unit,
    takenAt: new Date(row.taken_ms).toISOString(),
    source: row.source,
  };
}

/** A reading is stored as either a number (value) or an array (value_json); never neither. */
function storedValue(row: LatestRow): number | number[] {
  if (row.value_json !== null) return row.value_json;
  if (row.value !== null) return row.value;
  throw new Error(`stored ${row.metric} reading at ${row.taken_ms} has no value`);
}
