// Chart data as it stood at a given time, shared by the onboard chart route (as of now) and the
// ground's (as of now − the one-way delay).
import type { Metric, SeriesResponse } from "@heartbeat/shared";
import { expectedUnit } from "../domain/metrics.ts";
import type { Stores } from "../domain/ports.ts";
import type { RuleBook } from "../domain/rules/rule-book.ts";
import { chartReference } from "../domain/status/astronaut-status.ts";
import { upToNow } from "../domain/time-windows.ts";
import { metric, object, timeRangeQuery } from "./schemas.ts";
import { parseSeriesQuery, type Parsed, type SeriesQuery } from "./time-queries.ts";

/** ?metric=&range=1h|24h|7d|mission or ?from=&to=, plus optional &bucket=<minutes>. */
export const seriesQuery = object(
  { metric, range: { type: "string" }, ...timeRangeQuery.properties, bucket: { type: "string" } },
  ["range", "from", "to", "bucket"],
);

/**
 * One metric's chart as it stood at `asOfMs`: the window is read relative to it and nothing after
 * it is returned.
 */
export async function seriesAsOf(
  { stores, ruleBook }: { stores: Stores; ruleBook: RuleBook }, id: string, query: SeriesQuery & { metric: Metric }, asOfMs: number,
): Promise<Parsed<SeriesResponse>> {
  const window = parseSeriesQuery(query, asOfMs);
  if (!window.ok) return window;
  const { metric: m } = query;
  const points = await stores.readings.series(id, m, upToNow(window.value, asOfMs));
  const reference = await chartReference(stores, ruleBook, id, m, asOfMs);
  return { ok: true, value: { astronautId: id, metric: m, unit: expectedUnit(m), bucketMinutes: window.value.bucketMinutes, points, reference } };
}
