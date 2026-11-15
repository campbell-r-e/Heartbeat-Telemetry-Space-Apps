// What clients display without computing it: the plain-language limits per area (GET
// /api/settings) and the daily exercise minutes behind the Gravity chart.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AREAS, DISPLAY_SETTING_KEYS, type Astronaut, type Mission, type ReadingSource, type SeriesPoint } from "@heartbeat/shared";
import { exerciseThresholdBpm } from "../src/domain/exercise-intensity.ts";
import { dailyExercise, namedExerciseWindow, type ExerciseDaysWindow } from "../src/domain/exercise-days.ts";
import type { MissionStore, ReadingStore } from "../src/domain/ports.ts";
import { RULES } from "../src/domain/rules/catalog.ts";
import { areaLimits } from "../src/domain/rules/limits.ts";
import { RULE_SETTINGS } from "../src/domain/rules/settings.ts";
import { exerciseMinutesByDay, exerciseMinutesSoFar } from "../src/domain/status/exercise.ts";
import { DAY_MS, MINUTE_MS, startOfUtcDay } from "../src/domain/time.ts";
import type { SeriesWindow } from "../src/domain/time-windows.ts";
import { parseExerciseDaysQuery, type RangeOrTimesQuery } from "../src/http/time-queries.ts";

const NOW = Date.parse("2026-11-14T12:00:00Z");
const TODAY = startOfUtcDay(NOW);
const THRESHOLD = exerciseThresholdBpm(24, RULE_SETTINGS); // 125.44 bpm

describe("limits in use", () => {
  const limits = areaLimits(RULES, RULE_SETTINGS);
  const find = (label: string) => limits.find((l) => l.label === label);

  it("lists every area, in AREAS order", () => {
    const areas = limits.map((l) => l.area).filter((area, i, all) => all.indexOf(area) === i);
    assert.deepEqual(areas, [...AREAS]);
  });

  it("never repeats the value in the label", () => {
    for (const { label, value } of limits) {
      if (value !== undefined) assert.ok(!label.includes(String(value)), `${label} repeats ${value}`);
    }
  });

  it("words thresholds from the rule's status and comparison, with the setting's value and the rule's source", () => {
    assert.deepEqual(find("Blood oxygen, watch below"), {
      area: "vitals", label: "Blood oxygen, watch below", value: 95, unit: "%", status: "watch",
      source: RULES.find((r) => r.id === "spo2-watch")!.source,
    });
    assert.deepEqual([find("Energy, alert at or above")?.value, find("Calcium, alert above")?.value], [120, 2500]);
    assert.equal(find("Vitamin D, alert above"), undefined, "NASA gives vitamin D no red band above");
    assert.equal(find("CO₂ 1-hour average, alert above")!.source.requirementId, "[V2 6004]");
  });

  it("gives Gravity its goal, the evening watch rule and the exercise-minute cutoff, all from the settings", () => {
    const gravity = limits.filter((l) => l.area === "gravity").map((l) => [l.label, l.value, l.unit, l.status]);
    assert.deepEqual(gravity, [
      ["Daily exercise goal", 120, "min", "normal"],
      ["Exercise today, from 18:00 UTC, watch below", 60, "min", "watch"],
      ["An exercise minute has heart rate at or above", 64, "% of max heart rate (220 − age)", null],
    ]);
  });

  it("shows fractions as percentages, and the comfort zone with no single value", () => {
    assert.deepEqual([find("Career dose, watch at or above")?.value, find("Career dose, watch at or above")?.unit], [80, "% of the career limit"]);
    const zone = find("Temperature and humidity, watch outside NASA's zone")!;
    assert.deepEqual([zone.value, zone.unit, zone.status], [undefined, undefined, "watch"]);
    assert.equal(find("Noise in the sleep period (21:30–06:00 UTC), watch above")?.value, 50);
  });

  it("leaves out a limit whose setting is unset", () => {
    const unset = areaLimits(RULES, { ...RULE_SETTINGS, "spo2.watchBelowPct": null, "gravity.exerciseCheckFromHourUtc": null });
    assert.equal(unset.some((l) => l.label === "Blood oxygen, watch below"), false);
    assert.equal(unset.some((l) => l.label.startsWith("Exercise today")), false);
    assert.equal(unset.length, limits.length - 2);
  });

  it("refuses a catalog that no longer has a limit's rule", () => {
    assert.throws(() => areaLimits(RULES.filter((r) => r.id !== "spo2-watch"), RULE_SETTINGS), /unknown rule spo2-watch/);
  });

  it("refuses a parameter whose setting its rule does not read", () => {
    const rules = RULES.map((rule) => rule.id !== "gravity-exercise-goal-met" ? rule : {
      ...rule, when: [{ fact: "exerciseMinutesToday", op: "gte", setting: "gravity.exerciseWatchBelowMinutes" } as const],
    });
    assert.throws(() => areaLimits(rules, RULE_SETTINGS), /does not read exercise.dailyGoalMinutes/);
  });

  it("includes every setting key clients display", () => {
    for (const key of DISPLAY_SETTING_KEYS) assert.equal(typeof RULE_SETTINGS[key], "number");
  });
});

describe("exercise minutes by day", () => {
  const hard = (dayMs: number, minute: number) => ({ tMs: dayMs + minute * MINUTE_MS, value: 140 });

  it("counts each UTC day with the same function as today's, and null for a day without heart rate", () => {
    const readings = [hard(TODAY - 2 * DAY_MS, 600), hard(TODAY - 2 * DAY_MS, 601), hard(TODAY, 60), hard(TODAY, 1000)];
    const days = exerciseMinutesByDay(readings, THRESHOLD, { firstDayMs: TODAY - 2 * DAY_MS, lastDayMs: TODAY }, NOW);
    assert.deepEqual(days.map((d) => d.minutes), [2, null, 1], "today counts only up to now (12:00)");
    assert.equal(days[2].minutes, exerciseMinutesSoFar(readings, THRESHOLD, NOW));
  });

  it("counts a reading at the last millisecond of a day in that day, and is null without a threshold (no age)", () => {
    const lastMs = { tMs: TODAY - 1, value: 140 };
    assert.deepEqual(exerciseMinutesByDay([lastMs], THRESHOLD, { firstDayMs: TODAY - DAY_MS, lastDayMs: TODAY }, NOW).map((d) => d.minutes), [1, null]);
    assert.deepEqual(exerciseMinutesByDay([lastMs], null, { firstDayMs: TODAY - DAY_MS, lastDayMs: TODAY - DAY_MS }, NOW).map((d) => d.minutes), [null]);
  });
});

describe("dailyExercise", () => {
  const ASTRONAUT: Astronaut = { id: "a1", name: "A1", watchId: null, age: 24, sex: null, massKg: null, heightM: null };
  const MISSION: Mission = { name: "Test", startDate: "2026-11-05", gravity: "iss", sleepDayTimeZone: "UTC" };
  const point = (tMs: number, source: ReadingSource = "watch"): SeriesPoint => ({ t: new Date(tMs).toISOString(), value: 140, n: 1, source });
  const storesWith = (points: SeriesPoint[], mission: Mission | null = MISSION) => {
    const loaded: SeriesWindow[] = [];
    const readings = {
      async series(_id: string, _metric: string, window: SeriesWindow) {
        loaded.push(window);
        return points.filter((p) => (window.fromMs === null || Date.parse(p.t) >= window.fromMs) && (window.toMs === null || Date.parse(p.t) <= window.toMs));
      },
    } as unknown as ReadingStore;
    const unused = () => { throw new Error("not used"); };
    const missions: MissionStore = { get: async () => mission, saveIfMissing: async () => {}, updateSleepDayTimeZone: unused, relaySetting: unused, updateRelaySetting: unused };
    return { stores: { readings, mission: missions }, loaded };
  };
  const days = async (window: ExerciseDaysWindow, points: SeriesPoint[] = [], mission?: Mission | null) =>
    dailyExercise(storesWith(points, mission).stores, { astronaut: ASTRONAUT, settings: RULE_SETTINGS, window, nowMs: NOW });

  it("stops at today when `to` is in the future, and never loads readings after now", async () => {
    const { stores, loaded } = storesWith([point(NOW + DAY_MS)]);
    const result = await dailyExercise(stores, { astronaut: ASTRONAUT, settings: RULE_SETTINGS, window: { fromMs: TODAY - DAY_MS, toMs: NOW + 5 * DAY_MS }, nowMs: NOW });
    assert.deepEqual(result.map((d) => d.day), ["2026-11-13", "2026-11-14"]);
    assert.equal(loaded[0].toMs, NOW);
  });

  it("returns each UTC day a from/to window touches, counted whole, with the goal", async () => {
    const result = await days({ fromMs: Date.parse("2026-11-10T23:00:00Z"), toMs: Date.parse("2026-11-12T01:00:00Z") }, [point(Date.parse("2026-11-10T08:00:00Z"))]);
    assert.deepEqual(result, [
      { day: "2026-11-10", minutes: 1, goalMinutes: 120 },
      { day: "2026-11-11", minutes: null, goalMinutes: 120 },
      { day: "2026-11-12", minutes: null, goalMinutes: 120 },
    ]);
  });

  it("starts mission on mission day 1, not on the first heart-rate reading, and on today without a mission record", async () => {
    const early = point(Date.parse("2026-11-01T08:00:00Z"));
    const mission = await days({ fromMs: null, toMs: NOW }, [early]);
    assert.deepEqual([mission[0].day, mission.at(-1)!.day, mission.length], ["2026-11-05", "2026-11-14", 10]);
    assert.deepEqual((await days({ fromMs: null, toMs: NOW }, [early], null)).map((d) => d.day), ["2026-11-14"]);
  });

  it("counts the heart rate the rules read: Zepp counts, simulated does not", async () => {
    const at = Date.parse("2026-11-13T08:00:00Z");
    const result = await days({ fromMs: at, toMs: at }, [point(at, "zepp"), point(at + MINUTE_MS, "simulated")]);
    assert.deepEqual(result.map((d) => d.minutes), [1]);
  });
});

describe("parseExerciseDaysQuery", () => {
  const parse = (query: RangeOrTimesQuery) => parseExerciseDaysQuery(query, NOW);
  const errorOf = (query: RangeOrTimesQuery) => { const r = parse(query); return r.ok ? null : r.error; };

  it("defaults to the last 7 UTC days, today included, and takes mission as from mission day 1", () => {
    assert.deepEqual(parse({}), { ok: true, value: { fromMs: TODAY - 6 * DAY_MS, toMs: NOW } });
    assert.deepEqual(parse({ range: "7d" }), { ok: true, value: namedExerciseWindow("7d", NOW) });
    assert.deepEqual(parse({ range: "mission" }), { ok: true, value: { fromMs: null, toMs: NOW } });
  });

  it("takes from/to, and refuses other ranges, both at once, and a backwards window", () => {
    assert.deepEqual(parse({ from: "2026-11-01", to: "2026-11-03" }), {
      ok: true, value: { fromMs: Date.parse("2026-11-01"), toMs: Date.parse("2026-11-03") },
    });
    assert.equal(errorOf({ range: "24h" }), "invalid_range");
    assert.equal(errorOf({ range: "7d", from: "2026-11-01" }), "range_and_times");
    assert.equal(errorOf({ from: "2026-11-05", to: "2026-11-01" }), "invalid_date");
  });

  it("allows a from/to window touching exactly 366 UTC days and refuses 367", () => {
    assert.equal(errorOf({ from: "2025-11-14T00:00:00Z", to: "2026-11-14T23:00:00Z" }), null, "2025-11-14 to 2026-11-14 is 366 days");
    assert.equal(errorOf({ from: "2025-11-13T23:00:00Z", to: "2026-11-14T00:00:00Z" }), "range_too_long", "367 days");
  });
});
