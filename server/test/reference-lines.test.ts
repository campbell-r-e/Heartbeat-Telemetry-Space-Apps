import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_RULE_BOOK as BOOK } from "../src/domain/rules/rule-book.ts";
import type { StatusInputs } from "../src/domain/status/compute-facts.ts";
import { referenceLines } from "../src/domain/status/reference-lines.ts";
import { DAY_MS, HOUR_MS } from "../src/domain/time.ts";
import { facts } from "./support/facts.ts";

const NOW = Date.parse("2026-11-14T12:00:00Z");
const inputs = (overrides: Partial<StatusInputs> = {}): StatusInputs => ({
  nowMs: NOW, profile: { age: null, sex: null, massKg: null, heightM: null }, missionStartMs: null, sleepDayTimeZone: "UTC", ship: {}, astronaut: {},
  latest: {}, checkIns: [], meals: [], foods: [], ...overrides,
});
const forMetric = (lines: ReturnType<typeof referenceLines>, metric: string) => lines.find((l) => l.metric === metric);

describe("chart reference lines", () => {
  it("draws SpO₂, CO₂ and noise from the settings, in the chart's unit", () => {
    const lines = referenceLines(inputs(), facts({}), BOOK);
    assert.deepEqual(forMetric(lines, "spo2"), {
      metric: "spo2", unit: "%", basis: "settings", band: { low: 95, high: null },
      thresholds: [{ value: 95, status: "watch", label: "Watch below" }, { value: 90, status: "alert", label: "Alert below" }],
    });
    assert.deepEqual(forMetric(lines, "co2")!.thresholds.map((l) => [l.value, l.status]), [[2.5, "watch"], [3, "alert"]]);
    assert.deepEqual(forMetric(lines, "noise")!.thresholds.map((l) => l.value), [50, 58, 70]);
  });

  it("draws heart rate's extremes until the baseline is ready, then mean + 2 and 3 SD as well", () => {
    assert.deepEqual(forMetric(referenceLines(inputs(), facts({}), BOOK), "heartRate"), {
      metric: "heartRate", unit: "bpm", basis: "settings", band: null,
      thresholds: [{ value: 40, status: "alert", label: "Alert below" }, { value: 180, status: "alert", label: "Alert above" }],
    });
    const history = Array.from({ length: 8 }, (_, i) => ({ tMs: NOW - (i + 1) * DAY_MS + HOUR_MS, value: i % 2 === 0 ? 65 : 55 }));
    const withBaseline = forMetric(referenceLines(inputs({ astronaut: { heartRate: history } }), facts({}), BOOK), "heartRate")!;
    const sd = Math.sqrt((8 * 25) / 7);
    assert.equal(withBaseline.basis, "baseline");
    assert.ok(Math.abs(withBaseline.band!.high! - (60 + 2 * sd)) < 1e-9);
    assert.deepEqual(withBaseline.thresholds.map((l) => l.status), ["watch", "alert", "alert", "alert"]);
  });

  it("draws HRV below the baseline and skin temperature both ways, and nothing without a baseline", () => {
    assert.equal(forMetric(referenceLines(inputs(), facts({}), BOOK), "hrv"), undefined);
    const history = Array.from({ length: 8 }, (_, i) => ({ tMs: NOW - (i + 1) * DAY_MS + HOUR_MS, value: i % 2 === 0 ? 55 : 45 }));
    const lines = referenceLines(inputs({ astronaut: { hrv: history, skinTemp: history } }), facts({}), BOOK);
    assert.deepEqual(forMetric(lines, "hrv")!.band!.high, null);
    assert.equal(forMetric(lines, "skinTemp")!.thresholds.length, 4);
  });

  it("draws radiation at 1.25× and 1.5× the previous 7-day average dose rate", () => {
    const lines = forMetric(referenceLines(inputs(), facts({ radiationPreviousAverageUGy: 240 }), BOOK), "radiationDoseRate")!;
    assert.equal(lines.basis, "previousSevenDays");
    assert.deepEqual(lines.thresholds.map((l) => l.value), [12.5, 15]);
  });

  it("labels lines without repeating their value, which clients show beside the label", () => {
    const history = Array.from({ length: 8 }, (_, i) => ({ tMs: NOW - (i + 1) * DAY_MS + HOUR_MS, value: i % 2 === 0 ? 65 : 55 }));
    const all = referenceLines(
      inputs({ astronaut: { heartRate: history, hrv: history, skinTemp: history } }),
      facts({ radiationPreviousAverageUGy: 240, pressureDayAverageKPa: 100 }),
      BOOK,
    ).flatMap((chart) => chart.thresholds);
    for (const { label, value } of all) assert.ok(!label.includes(String(value)), `${label} repeats ${value}`);
  });

  it("words each settings line from its catalog rule, noise included, so a changed comparison changes the label", () => {
    const labels = (book: typeof BOOK, metric: string) => forMetric(referenceLines(inputs(), facts({}), book), metric)!.thresholds.map((l) => l.label);
    assert.deepEqual(labels(BOOK, "co2"), ["Watch at or above", "Alert above"]);
    assert.deepEqual(labels(BOOK, "noise"), ["Sleep period, watch above", "Awake, watch above", "24-hour average, alert above"]);
    assert.deepEqual(labels(BOOK, "pressure"), ["Alert at or below", "Alert above"]);
    const rules = BOOK.rules.map((rule) => rule.id !== "co2-one-hour-watch" ? rule : {
      ...rule, when: rule.when.map((c) => ("setting" in c && c.setting === "co2.oneHourWatchFromMmHg" ? { ...c, op: "gt" as const } : c)),
    });
    assert.deepEqual(labels({ ...BOOK, rules }, "co2"), ["Watch above", "Alert above"]);
  });

  it("draws pressure in hPa: NASA's range, and the shift band around the watch's 24-hour average once known", () => {
    const plain = forMetric(referenceLines(inputs(), facts({}), BOOK), "pressure")!;
    assert.deepEqual(plain.thresholds.map((l) => l.value), [345, 1030]);
    const withAverage = forMetric(referenceLines(inputs(), facts({ pressureDayAverageKPa: 100 }), BOOK), "pressure")!;
    assert.deepEqual(withAverage.band, { low: 970, high: 1030 });
  });
});
