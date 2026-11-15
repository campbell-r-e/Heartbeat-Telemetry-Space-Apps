import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { METRICS, type Reading } from "@heartbeat/shared";
import { derivedFrom, expectedShape, expectedUnit } from "../src/domain/metrics.ts";
import { findInvalidReading } from "../src/domain/reading-validation.ts";

const NOW = Date.parse("2026-11-14T12:00:00Z");
const MINUTE = 60_000;

const heartRate = (overrides: Partial<Reading> = {}): Reading => ({
  astronautId: "a1", metric: "heartRate", value: 60, unit: "bpm", takenAt: new Date(NOW).toISOString(), source: "watch", ...overrides,
});

describe("findInvalidReading", () => {
  it("accepts a valid batch", () => {
    assert.equal(findInvalidReading([heartRate(), heartRate({ metric: "spo2", unit: "%", value: 98 })], NOW), null);
  });

  it("allows up to 5 minutes of clock skew and rejects more", () => {
    assert.equal(findInvalidReading([heartRate({ takenAt: new Date(NOW + 5 * MINUTE).toISOString() })], NOW), null);
    const problem = findInvalidReading([heartRate({ takenAt: new Date(NOW + 5 * MINUTE + 1000).toISOString() })], NOW);
    assert.equal(problem?.kind, "takenInFuture");
  });

  it("rejects a unit that does not match the metric", () => {
    const problem = findInvalidReading([heartRate(), heartRate({ unit: "bps" })], NOW);
    assert.deepEqual(problem, { kind: "wrongUnit", index: 1, metric: "heartRate", unit: "bps", expectedUnit: "bpm" });
  });

  it("has a unit for every metric in the shared list", () => {
    for (const metric of METRICS) assert.equal(typeof expectedUnit(metric), "string", metric);
  });

  it("for every metric a client may post, accepts its own unit and names it when another unit is sent", () => {
    for (const metric of METRICS.filter((m) => derivedFrom(m) === undefined)) {
      const unit = expectedUnit(metric);
      const value = expectedShape(metric) === "array" ? [800, 810] : 60;
      assert.equal(findInvalidReading([heartRate({ metric, unit, value })], NOW), null, metric);
      assert.deepEqual(
        findInvalidReading([heartRate({ metric, unit: "not-a-unit", value })], NOW),
        { kind: "wrongUnit", index: 0, metric, unit: "not-a-unit", expectedUnit: unit },
      );
    }
  });

  it("refuses a server-derived metric, naming the metric to send instead", () => {
    assert.deepEqual(
      findInvalidReading([heartRate(), heartRate({ metric: "hrv", unit: "ms", value: 52 })], NOW),
      { kind: "serverDerivedMetric", index: 1, metric: "hrv", sendInstead: "ibi" },
    );
  });

  it("refuses an empty array for an array metric", () => {
    assert.deepEqual(
      findInvalidReading([heartRate({ metric: "ibi", unit: "ms", value: [] })], NOW),
      { kind: "emptyArray", index: 0, metric: "ibi" },
    );
    assert.equal(findInvalidReading([heartRate({ metric: "ibi", unit: "ms", value: [812] })], NOW), null);
  });

  it("refuses a value of the wrong shape, naming the expected shape", () => {
    assert.deepEqual(
      findInvalidReading([heartRate({ metric: "ibi", unit: "ms", value: 812 })], NOW),
      { kind: "wrongValueShape", index: 0, metric: "ibi", expectedShape: "array" },
    );
    assert.deepEqual(
      findInvalidReading([heartRate({ value: [61] })], NOW),
      { kind: "wrongValueShape", index: 0, metric: "heartRate", expectedShape: "number" },
    );
  });

  it("takes body composition (skeletal muscle mass) in kilograms", () => {
    assert.equal(findInvalidReading([heartRate({ metric: "bodyComposition", unit: "kg", value: 31.2 })], NOW), null);
    assert.equal(findInvalidReading([heartRate({ metric: "bodyComposition", unit: "%" })], NOW)?.kind, "wrongUnit");
  });

  it("refuses sleep, which the server derives from wristAngle, and takes wristAngle as an array of degrees", () => {
    assert.deepEqual(
      findInvalidReading([heartRate({ metric: "sleep", unit: "h", value: 7.5 })], NOW),
      { kind: "serverDerivedMetric", index: 0, metric: "sleep", sendInstead: "wristAngle" },
    );
    const angles = [-12.5, -12.4, -12.6, -12.5, -12.5, -12.3, -12.5, -12.4, -12.6, -12.5, -12.5, -12.4];
    assert.equal(findInvalidReading([heartRate({ metric: "wristAngle", unit: "deg", value: angles })], NOW), null);
    assert.equal(findInvalidReading([heartRate({ metric: "wristAngle", unit: "deg", value: -12.5 })], NOW)?.kind, "wrongValueShape");
  });
});
