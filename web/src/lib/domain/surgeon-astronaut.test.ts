import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DailyLog, GroundCrewMember } from "@heartbeat/shared";
import { CHART_SOURCE_TRAITS, chartSourceKey } from "./area-charts";
import type { ChartData } from "./chart";
import { NO_DAILY_LOG_TEXT, NO_SERIES_TEXT, astronautHeader, astronautPanels } from "./surgeon-astronaut";
import { groundChartSpecs } from "./surgeon";

const T0 = Date.parse("2026-11-15T01:00:00.000Z");
const specs = groundChartSpecs();
const chart = (value: number): ChartData => ({
  points: [{ tMs: T0, value, simulated: false }], unit: "bpm", decimals: 0, reference: null, goal: null, window: null, timeUnit: "time",
});
const member: GroundCrewMember = {
  astronautId: "a1",
  name: "Astronaut 1",
  watch: null,
  status: { astronautId: "a1", at: "t", overall: "watch", areas: [{ area: "vitals", status: "watch", reason: null }] },
  receivedAt: "t",
};
const LOG: DailyLog = {
  astronautId: "a1",
  at: "2026-11-15T01:00:00.000Z",
  checkIns: [{ id: 1, astronautId: "a1", mood: 4, stress: 2, at: "2026-11-15T00:30:00.000Z" }],
  calories: [],
  exercise: [],
};

describe("astronautPanels (each chart paired with its data by key)", () => {
  const series = new Map([[chartSourceKey({ kind: "metric", metric: "heartRate" }), chart(72)]]);

  it("draws a reading chart from its own series, whatever the order of the specs", () => {
    const panels = astronautPanels({ specs: [...specs].reverse(), series, dailyLog: LOG, range: "24h", member });
    const heart = panels.find((panel) => panel.key === "metric:heartRate")!;
    assert.equal(heart.data?.points[0].value, 72);
    assert.equal(heart.title, "Heart rate · Vitals");
    assert.equal(heart.tone, "warn", "the area's status from the last snapshot");
  });

  it("draws check-ins, calories and exercise from the daily log, and says so before one has arrived", () => {
    const withLog = astronautPanels({ specs, series, dailyLog: LOG, range: "24h", member });
    assert.deepEqual(withLog.find((panel) => panel.key === "checkIns:mood")!.data?.points.map((p) => p.value), [4]);
    const withoutLog = astronautPanels({ specs, series, dailyLog: null, range: "24h", member });
    const mood = withoutLog.find((panel) => panel.key === "checkIns:mood")!;
    assert.deepEqual([mood.data, mood.emptyText], [null, NO_DAILY_LOG_TEXT]);
  });

  it("says why a panel is empty: no daily log yet, or no series for a reading chart", () => {
    const panels = astronautPanels({ specs, series: new Map(), dailyLog: null, range: "24h", member });
    const textOf = (key: string) => panels.find((panel) => panel.key === key)!.emptyText;
    assert.equal(textOf("metric:heartRate"), NO_SERIES_TEXT);
    assert.equal(textOf("metric:co2"), NO_SERIES_TEXT);
    assert.equal(textOf("checkIns:stress"), NO_DAILY_LOG_TEXT);
    assert.equal(textOf("dailyCalories"), NO_DAILY_LOG_TEXT);
  });

  it("gives the range picker to the first panel only, and every panel a unique key", () => {
    const panels = astronautPanels({ specs, series, dailyLog: LOG, range: "1h", member });
    assert.deepEqual(panels.map((panel) => panel.showsRangePicker).filter(Boolean), [true]);
    assert.equal(panels[0].showsRangePicker, true);
    assert.equal(new Set(panels.map((panel) => panel.key)).size, panels.length);
    assert.equal(panels.find((panel) => panel.key === "exerciseDays")!.rangePhrase, "the last 7 days");
  });

  it("describes every chart source kind in one table", () => {
    assert.deepEqual(Object.keys(CHART_SOURCE_TRAITS).sort(), ["checkIns", "dailyCalories", "exerciseDays", "metric"]);
    assert.equal(CHART_SOURCE_TRAITS.metric.fromDailyLog, false);
  });
});

describe("astronautHeader", () => {
  it("names the astronaut and where the data stands", () => {
    const header = astronautHeader({ astronautId: "a1", member, oneWayDelayMs: 180_000, dailyLogReceivedAt: "2026-11-15T00:59:00.000Z", nowMs: T0 });
    assert.equal(header.name, "Astronaut 1");
    assert.equal(header.status, "watch");
    assert.equal(
      header.subtitle,
      "Mission Control view · readings up to now − the link delay (3 min) · daily log received Nov 15 · 00:59 UTC · No watch assigned",
    );
  });

  it("falls back to the id for an astronaut no longer on the roster", () => {
    const header = astronautHeader({ astronautId: "gone", member: null, oneWayDelayMs: 0, dailyLogReceivedAt: null, nowMs: T0 });
    assert.deepEqual([header.name, header.status], ["gone", null]);
    assert.match(header.subtitle, /no daily log received yet · Not on the crew roster$/);
  });
});
