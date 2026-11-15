import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_RANGE, chartWindow, dayChartWindow, parseRangeParam, rangeWindow, seriesQuery, windowQuery } from "./ranges";
import { DAY_MS } from "./time";

describe("ranges", () => {
  it("reads the range param, defaulting when missing or unknown", () => {
    assert.equal(parseRangeParam("7d"), "7d");
    assert.equal(parseRangeParam(["1h", "7d"]), "1h");
    assert.equal(parseRangeParam("year"), DEFAULT_RANGE);
    assert.equal(parseRangeParam(undefined), DEFAULT_RANGE);
  });

  it("offers only an area's ranges, defaulting to its first when 24 h is not offered", () => {
    assert.equal(parseRangeParam("1h", ["7d", "mission"]), "7d");
    assert.equal(parseRangeParam("mission", ["7d", "mission"]), "mission");
  });

  it("gives each chart a window ending now; mission starts at the first reading", () => {
    const now = Date.parse("2026-11-14T12:00:00Z");
    assert.deepEqual(chartWindow("24h", now, null), { fromMs: now - DAY_MS, toMs: now });
    assert.deepEqual(chartWindow("mission", now, 1000), { fromMs: 1000, toMs: now });
    assert.deepEqual(chartWindow("mission", now, null), { fromMs: now, toMs: now });
  });

  it("gives daily charts whole UTC days ending today: 7 d is today and the 6 days before", () => {
    const now = Date.parse("2026-11-14T12:00:00Z");
    const today = Date.parse("2026-11-14T00:00:00Z");
    assert.deepEqual(dayChartWindow("7d", now, null), { fromMs: today - 6 * DAY_MS, toMs: today });
    assert.deepEqual(dayChartWindow("mission", now, today - 9 * DAY_MS), { fromMs: today - 9 * DAY_MS, toMs: today });
  });

  it("turns a range into a from/to window; mission means all stored data", () => {
    const now = Date.parse("2026-11-14T12:00:00Z");
    assert.deepEqual(rangeWindow("24h", now), { fromMs: now - DAY_MS, toMs: now });
    assert.equal(rangeWindow("mission", now).fromMs, 0);
  });
});

describe("query building", () => {
  it("asks for a named range with its bucket, and raw points for one hour", () => {
    assert.deepEqual(seriesQuery("co2", "24h"), { metric: "co2", range: "24h", bucket: 15 });
    assert.deepEqual(seriesQuery("co2", "1h"), { metric: "co2", range: "1h", bucket: undefined });
  });

  it("sends from/to as ISO times", () => {
    assert.deepEqual(windowQuery({ fromMs: 0, toMs: 1000 }), { from: "1970-01-01T00:00:00.000Z", to: "1970-01-01T00:00:01.000Z" });
  });
});
