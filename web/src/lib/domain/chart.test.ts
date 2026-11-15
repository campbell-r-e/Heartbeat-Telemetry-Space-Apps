import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MARK_STYLE, bandEdges, chartRows, edgePaddingPx, dailyChartData, fromSeriesPoints, hasSimulated, latestPoint, referenceItems, timeExtent, timeSpanMs,
  niceStep, timeTick, timeTickLabel, timeTicks, valueAxis, valueDomain, valueTicks, type ChartPoint,
} from "./chart";
import { formatNumber } from "./format";
import { DAY_MS, HOUR_MS } from "./time";

const point = (hour: number, value: number, simulated = false): ChartPoint => ({ tMs: hour * HOUR_MS, value, simulated });
const shape = (rows: ReturnType<typeof chartRows>) => rows.map((row) => [row.recorded, row.simulated, row.lone]);

describe("fromSeriesPoints", () => {
  it("marks simulated points by their source", () => {
    const points = fromSeriesPoints([
      { t: "2026-11-14T00:00:00Z", value: 1, n: 1, source: "radlab" },
      { t: "2026-11-14T01:00:00Z", value: 2, n: 1, source: "simulated" },
    ]);
    assert.deepEqual(points.map((p) => p.simulated), [false, true]);
    assert.equal(hasSimulated(points), true);
  });
});

describe("chartRows", () => {
  it("puts recorded and simulated values in separate series", () => {
    assert.deepEqual(shape(chartRows([point(0, 1), point(1, 2)])), [
      [1, null, false],
      [2, null, false],
    ]);
  });

  it("repeats the joining reading in both series so the line is continuous", () => {
    assert.deepEqual(shape(chartRows([point(0, 1), point(1, 2), point(2, 9, true)])), [
      [1, null, false],
      [2, 2, false],
      [null, 9, false],
    ]);
  });

  it("breaks the line with an empty row after a gap much longer than the usual spacing", () => {
    const rows = chartRows([point(0, 1), point(1, 2), point(2, 1), point(12, 2), point(13, 1)]);
    assert.equal(rows.length, 6);
    assert.deepEqual([rows[3].recorded, rows[3].simulated], [null, null]);
  });

  it("marks a reading with no neighbor as lone so it is drawn as a dot", () => {
    assert.deepEqual(shape(chartRows([point(3, 7)])), [[7, null, true]]);
  });

  it("is empty with no points", () => {
    assert.deepEqual(chartRows([]), []);
  });
});

describe("time axis", () => {
  it("shows UTC clock times, with dates once the span exceeds a day", () => {
    assert.equal(timeTick(Date.parse("2026-11-14T19:05:00Z"), HOUR_MS), "19:05");
    assert.equal(timeTick(Date.parse("2026-11-14T19:05:00Z"), 48 * HOUR_MS), "Nov 14 19:05");
    assert.equal(timeSpanMs([point(0, 1), point(2, 1)]), 2 * HOUR_MS);
    assert.equal(timeSpanMs([point(0, 1)]), 0);
  });
});

describe("referenceItems (the legend under a chart)", () => {
  const base = { unit: "mmHg", decimals: 1, goal: null };

  it("is empty with no reference and no goal", () => {
    assert.deepEqual(referenceItems({ ...base, reference: null }), []);
  });

  it("names the band and each threshold with the server's label, then the value", () => {
    const items = referenceItems({ ...base, reference: { band: { low: null, high: 2.5 }, thresholds: [{ value: 3, status: "alert", label: "1-hour limit" }], basis: "settings" } });
    assert.deepEqual(items, [
      { kind: "band", text: "Normal band: up to 2.5 mmHg" },
      { kind: "alert", text: "1-hour limit: 3.0 mmHg" },
    ]);
  });

  it("names a goal line", () => {
    assert.deepEqual(referenceItems({ unit: "min", decimals: 0, reference: null, goal: { value: 120, label: "Daily goal" } }), [{ kind: "goal", text: "Daily goal: 120 min" }]);
  });
});

describe("bandEdges", () => {
  const points = [point(0, 5), point(1, 90)];

  it("draws an open lower bound from the lowest value shown", () => {
    assert.deepEqual(bandEdges({ low: null, high: 21.3 }, points), { low: 5, high: 21.3 });
  });

  it("draws an open upper bound to the highest value shown", () => {
    assert.deepEqual(bandEdges({ low: 95, high: null }, [point(0, 97), point(1, 99)]), { low: 95, high: 99 });
  });

  it("keeps a closed band as given", () => {
    assert.deepEqual(bandEdges({ low: 1, high: 2 }, points), { low: 1, high: 2 });
  });
});

describe("valueDomain (fits the data and the server's limits)", () => {
  const reference = { band: { low: null, high: 21 }, thresholds: [{ value: 25, status: "alert" as const, label: "x" }], basis: "previousSevenDays" as const };

  it("includes thresholds above the data, with room, and never dips below zero", () => {
    const [low, high] = valueDomain([point(0, 5), point(1, 10)], reference) ?? [NaN, NaN];
    assert.ok(low >= 0 && low < 5);
    assert.ok(high > 25);
    assert.equal(valueDomain([point(0, 0.5), point(1, 10)], null)?.[0], 0);
  });

  it("ends on round numbers", () => {
    assert.deepEqual(valueDomain([point(0, 5), point(1, 98.8)], null), [0, 125]);
    assert.equal(niceStep(23), 25);
    assert.equal(niceStep(0.3), 0.5);
    assert.deepEqual(valueTicks([0, 125]), [0, 25, 50, 75, 100, 125]);
  });

  /** Each tick as the axis labels it. */
  const labels = (domain: [number, number] | null, decimals: number) => valueTicks(domain ?? [NaN, NaN], decimals).map((t) => formatNumber(t, decimals));
  const distinct = (texts: string[]) => new Set(texts).size === texts.length;

  it("labels every tick differently for a single value (no '4 4 4 4')", () => {
    const domain = valueDomain([point(0, 4)], null, null, { decimals: 0 });
    const ticks = labels(domain, 0);
    assert.ok(ticks.length >= 2, ticks.join(" "));
    assert.ok(distinct(ticks), ticks.join(" "));
    assert.ok(domain![0] <= 4 && domain![1] >= 4);
  });

  it("labels every tick differently when all values are equal, at the chart's decimals", () => {
    for (const [value, decimals] of [[72, 0], [97, 0], [36.6, 1], [0.5, 2], [0, 0]] as const) {
      const domain = valueDomain([point(0, value), point(1, value), point(2, value)], null, null, { decimals });
      const ticks = labels(domain, decimals);
      assert.ok(ticks.length >= 2 && distinct(ticks), `${value}: ${ticks.join(" ")}`);
      assert.ok(domain![0] <= value && domain![1] >= value);
    }
  });

  it("gives the ticks with the span, from one step", () => {
    assert.deepEqual(valueAxis([point(0, 4)], null, null, { decimals: 0, scale: { min: 1, max: 5 } }), { domain: [1, 5], ticks: [1, 2, 3, 4, 5] });
    assert.equal(valueAxis([], null, null, {}), null);
  });

  it("spans a fixed scale exactly (check-ins 1–5), widening only for data outside it", () => {
    const scale = { min: 1, max: 5 };
    assert.deepEqual(valueDomain([point(0, 4)], null, null, { decimals: 0, scale }), [1, 5]);
    assert.deepEqual(labels([1, 5], 0), ["1", "2", "3", "4", "5"]);
    assert.deepEqual(valueDomain([point(0, 7)], null, null, { decimals: 0, scale }), [1, 7]);
  });

  it("fits the data alone without a reference, and is null with nothing to show", () => {
    const [low, high] = valueDomain([point(0, 50), point(1, 100)], null) ?? [NaN, NaN];
    assert.ok(low < 50 && low > 0 && high > 100);
    assert.equal(valueDomain([], null), null);
  });
});

describe("edgePaddingPx (edge points drawn whole)", () => {
  it("leaves room for a whole dot, or half a thick line, rounded up to a pixel", () => {
    assert.equal(edgePaddingPx(3.5, 2.5), 4);
    assert.equal(edgePaddingPx(2.5, 2), 3);
    assert.equal(edgePaddingPx(1, 6), 3);
  });
});

describe("time axis window", () => {
  const extent = { fromMs: 0, toMs: 4 * HOUR_MS };

  it("uses the chosen window, else the data", () => {
    assert.deepEqual(timeExtent({ points: [point(1, 1)], window: extent }), extent);
    assert.deepEqual(timeExtent({ points: [point(1, 1), point(3, 1)], window: null }), { fromMs: HOUR_MS, toMs: 3 * HOUR_MS });
    assert.equal(timeExtent({ points: [], window: null }), null);
  });

  it("spaces ticks evenly, the last at the end, labeled now when the window ends now", () => {
    assert.deepEqual(timeTicks(extent, "time"), [0, HOUR_MS, 2 * HOUR_MS, 3 * HOUR_MS, 4 * HOUR_MS]);
    assert.equal(timeTickLabel(4 * HOUR_MS, extent, { window: extent, timeUnit: "time" }), "now");
    assert.equal(timeTickLabel(4 * HOUR_MS, extent, { window: null, timeUnit: "time" }), "04:00");
    assert.equal(timeTickLabel(HOUR_MS, extent, { window: extent, timeUnit: "time" }), "01:00");
  });

  it("puts daily charts' ticks on whole UTC days, labeled with dates", () => {
    const week = { fromMs: Date.parse("2026-11-08T00:00:00Z"), toMs: Date.parse("2026-11-14T00:00:00Z") };
    const ticks = timeTicks(week, "day");
    assert.equal(ticks.length, 7);
    assert.ok(ticks.every((t) => t % DAY_MS === 0));
    assert.equal(timeTickLabel(week.toMs, week, { window: week, timeUnit: "day" }), "Nov 14");
    const long = { fromMs: week.fromMs - 60 * DAY_MS, toMs: week.toMs };
    const longTicks = timeTicks(long, "day");
    assert.ok(longTicks.every((t) => t % DAY_MS === 0));
    assert.ok(longTicks.length <= 10);
    assert.equal(longTicks[longTicks.length - 1], long.toMs);
    const gaps = longTicks.slice(1).map((t, i) => t - longTicks[i]);
    assert.ok(gaps.every((gap) => gap === gaps[0]), "evenly spaced");
  });

  it("labels every day up to ten days", () => {
    const tenDays = { fromMs: Date.parse("2026-11-05T00:00:00Z"), toMs: Date.parse("2026-11-14T00:00:00Z") };
    assert.equal(timeTicks(tenDays, "day").length, 10);
  });

  it("finds the latest reading for the text alternative", () => {
    assert.equal(latestPoint([point(1, 1), point(2, 9)])?.value, 9);
    assert.equal(latestPoint([]), null);
  });
});

describe("valueDomain with a goal", () => {
  it("makes room for the goal line above the data", () => {
    const [, high] = valueDomain([point(0, 4), point(1, 20)], null, { value: 120, label: "Daily goal" }) ?? [NaN, NaN];
    assert.ok(high >= 120);
  });
});

describe("MARK_STYLE (one look for the plot and its legend)", () => {
  it("dashes every line and fills only the band", () => {
    assert.equal(MARK_STYLE.band.dash, null);
    for (const kind of ["goal", "watch", "alert", "simulated"] as const) assert.ok(MARK_STYLE[kind].dash, kind);
    assert.notEqual(MARK_STYLE.goal.dash, MARK_STYLE.watch.dash);
  });
});

describe("dailyChartData", () => {
  it("covers whole UTC days ending today, with dates on the axis", () => {
    const now = Date.parse("2026-11-14T12:00:00Z");
    const data = dailyChartData([point(0, 1)], { unit: "kcal", range: "7d", nowMs: now });
    assert.equal(data.timeUnit, "day");
    assert.equal(data.window?.toMs, Date.parse("2026-11-14T00:00:00Z"));
    assert.equal(data.goal, null);
    assert.equal(data.reference, null);
  });
});
