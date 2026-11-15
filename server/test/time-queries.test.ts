import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSeriesQuery, parseTimeRangeQuery, type SeriesQuery } from "../src/http/time-queries.ts";

const NOW = Date.parse("2026-11-14T12:00:00Z");
const HOUR = 3_600_000;

function window(query: SeriesQuery) {
  const result = parseSeriesQuery(query, NOW);
  assert.ok(result.ok, `expected ok, got ${JSON.stringify(result)}`);
  return result.value;
}

function errorOf(query: SeriesQuery) {
  const result = parseSeriesQuery(query, NOW);
  assert.ok(!result.ok, `expected an error for ${JSON.stringify(query)}`);
  return result.error;
}

describe("parseSeriesQuery", () => {
  it("maps each named range to a window ending now", () => {
    assert.deepEqual(window({ range: "1h" }), { fromMs: NOW - HOUR, toMs: NOW, bucketMinutes: null });
    assert.equal(window({ range: "24h" }).fromMs, NOW - 24 * HOUR);
    assert.equal(window({ range: "7d" }).fromMs, NOW - 7 * 24 * HOUR);
  });

  it("treats mission as all stored data up to now", () => {
    assert.deepEqual(window({ range: "mission" }), { fromMs: null, toMs: NOW, bucketMinutes: null });
  });

  it("defaults to the last 7 days", () => {
    assert.equal(window({}).fromMs, NOW - 7 * 24 * HOUR);
  });

  it("accepts explicit from/to", () => {
    const w = window({ from: "2026-11-01T00:00:00Z", to: "2026-11-02T00:00:00Z", bucket: "60" });
    assert.deepEqual(w, { fromMs: Date.parse("2026-11-01T00:00:00Z"), toMs: Date.parse("2026-11-02T00:00:00Z"), bucketMinutes: 60 });
  });

  it("rejects range together with from/to", () => {
    assert.equal(errorOf({ range: "1h", from: "2026-11-01T00:00:00Z" }), "range_and_times");
    assert.equal(errorOf({ range: "1h", to: "2026-11-01T00:00:00Z" }), "range_and_times");
  });

  it("rejects an unknown range", () => {
    assert.equal(errorOf({ range: "2h" }), "invalid_range");
    assert.equal(errorOf({ range: "toString" }), "invalid_range");
  });

  it("rejects invalid dates and from after to", () => {
    assert.equal(errorOf({ from: "yesterday" }), "invalid_date");
    assert.equal(errorOf({ to: "2026-13-45T99:00:00Z" }), "invalid_date");
    assert.equal(errorOf({ from: "2026-11-02T00:00:00Z", to: "2026-11-01T00:00:00Z" }), "invalid_date");
  });

  it("accepts buckets from 1 to 43200 minutes and rejects anything else", () => {
    assert.equal(window({ bucket: "1" }).bucketMinutes, 1);
    assert.equal(window({ bucket: "43200" }).bucketMinutes, 43_200);
    for (const bucket of ["0", "43201", "999999999999999999999", "-5", "1.5", "abc", ""]) {
      assert.equal(errorOf({ bucket }), "invalid_bucket", `bucket ${bucket}`);
    }
  });
});

describe("parseTimeRangeQuery", () => {
  it("defaults to the given length before now", () => {
    const result = parseTimeRangeQuery({}, HOUR, NOW);
    assert.deepEqual(result, { ok: true, value: { fromMs: NOW - HOUR, toMs: NOW } });
  });
});
