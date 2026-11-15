import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_RANGE_LENGTH_MS, isSeriesRange, isValidBucket, namedRangeBounds, timeBounds, upToNow,
} from "../src/domain/time-windows.ts";

const NOW = Date.parse("2026-11-14T12:00:00Z");
const HOUR = 3_600_000;

describe("namedRangeBounds", () => {
  it("ends each timed range now", () => {
    assert.deepEqual(namedRangeBounds("1h", NOW), { fromMs: NOW - HOUR, toMs: NOW });
    assert.deepEqual(namedRangeBounds("24h", NOW), { fromMs: NOW - 24 * HOUR, toMs: NOW });
    assert.deepEqual(namedRangeBounds("7d", NOW), { fromMs: NOW - 7 * 24 * HOUR, toMs: NOW });
  });

  it("leaves mission unbounded in the past but ends it now (the mission clock stores future loops)", () => {
    assert.deepEqual(namedRangeBounds("mission", NOW), { fromMs: null, toMs: NOW });
  });

  it("caps any window at now", () => {
    assert.deepEqual(upToNow({ fromMs: 0, toMs: NOW + 1, bucketMinutes: null }, NOW), { fromMs: 0, toMs: NOW, bucketMinutes: null });
    assert.deepEqual(upToNow({ fromMs: null, toMs: null }, NOW), { fromMs: null, toMs: NOW });
    assert.deepEqual(upToNow({ fromMs: 0, toMs: NOW - 1 }, NOW), { fromMs: 0, toMs: NOW - 1 });
  });

  it("defaults to 7 days", () => {
    assert.equal(DEFAULT_RANGE_LENGTH_MS, 7 * 24 * HOUR);
  });
});

describe("isSeriesRange", () => {
  it("knows the four ranges and nothing else", () => {
    for (const range of ["1h", "24h", "7d", "mission"]) assert.ok(isSeriesRange(range), range);
    for (const range of ["2h", "toString", ""]) assert.ok(!isSeriesRange(range), range);
  });
});

describe("isValidBucket", () => {
  it("accepts whole minutes from 1 to 43200 only", () => {
    for (const minutes of [1, 60, 43_200]) assert.ok(isValidBucket(minutes), String(minutes));
    for (const minutes of [0, 43_201, 1.5, -5, Number.NaN, 1e21]) assert.ok(!isValidBucket(minutes), String(minutes));
  });
});

describe("timeBounds", () => {
  it("defaults to now and the given length before it", () => {
    assert.deepEqual(timeBounds({}, HOUR, NOW), { fromMs: NOW - HOUR, toMs: NOW });
  });

  it("measures the default length back from a given to", () => {
    assert.deepEqual(timeBounds({ toMs: NOW - HOUR }, HOUR, NOW), { fromMs: NOW - 2 * HOUR, toMs: NOW - HOUR });
  });

  it("allows from equal to to, and refuses from after to", () => {
    assert.deepEqual(timeBounds({ fromMs: NOW, toMs: NOW }, HOUR, NOW), { fromMs: NOW, toMs: NOW });
    assert.equal(timeBounds({ fromMs: NOW + 1, toMs: NOW }, HOUR, NOW), null);
  });
});
