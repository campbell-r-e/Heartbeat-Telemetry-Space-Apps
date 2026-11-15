import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DailyLog } from "@heartbeat/shared";
import { basisText } from "./chart";
import { dailyLogChart, dailyRange, groundRangePhrase } from "./ground-daily-log";

const LOG: DailyLog = {
  astronautId: "a1",
  at: "2026-11-15T01:00:00.000Z",
  checkIns: [
    { id: 1, astronautId: "a1", mood: 4, stress: 2, at: "2026-11-05T09:00:00.000Z" },
    { id: 2, astronautId: "a1", mood: 2, stress: 4, at: "2026-11-14T20:00:00.000Z" },
  ],
  calories: [
    { day: "2026-11-06", kcalAtLeast: 1800, mealsLogged: 3, mealsWithoutKcal: 0 },
    { day: "2026-11-14", kcalAtLeast: 900, mealsLogged: 2, mealsWithoutKcal: 1 },
  ],
  exercise: [
    { day: "2026-11-13", minutes: 30, goalMinutes: 120 },
    { day: "2026-11-14", minutes: null, goalMinutes: 120 },
    { day: "2026-11-15", minutes: 5, goalMinutes: 120 },
  ],
};

describe("the surgeon's daily-log charts", () => {
  it("charts check-ins over the chosen range, ending when the log was read on board", () => {
    const mood = dailyLogChart({ kind: "checkIns", field: "mood" }, LOG, "24h")!;
    assert.deepEqual(mood.points.map((p) => p.value), [2], "only the check-in in the last 24 hours");
    assert.equal(mood.window?.toMs, Date.parse(LOG.at));
    assert.equal(mood.endsNow, false);
    const stress = dailyLogChart({ kind: "checkIns", field: "stress" }, LOG, "mission")!;
    assert.deepEqual(stress.points.map((p) => p.value), [2, 4]);
  });

  it("charts the calories counted on board per day, noting days that are lower bounds", () => {
    const week = dailyLogChart({ kind: "dailyCalories" }, LOG, "7d")!;
    assert.deepEqual(week.points.map((p) => p.value), [900]);
    assert.match(week.note ?? "", /1 day\(s\) include items with no published calorie value/);
    assert.equal(dailyLogChart({ kind: "dailyCalories" }, LOG, "mission")!.points.length, 2);
  });

  it("counts its notes only over the days shown, not the whole mission", () => {
    const log: DailyLog = {
      ...LOG,
      calories: [
        { day: "2026-11-05", kcalAtLeast: 300, mealsLogged: 1, mealsWithoutKcal: 1 }, // lower bound, before the 7 days
        { day: "2026-11-14", kcalAtLeast: 900, mealsLogged: 2, mealsWithoutKcal: 0 },
      ],
      exercise: [
        { day: "2026-11-06", minutes: null, goalMinutes: 120 }, // uncounted, before the 7 days
        { day: "2026-11-14", minutes: 30, goalMinutes: 120 },
      ],
    };
    assert.equal(dailyLogChart({ kind: "dailyCalories" }, log, "7d")!.note, undefined);
    assert.equal(dailyLogChart({ kind: "exerciseDays" }, log, "7d")!.note, undefined);
    assert.match(dailyLogChart({ kind: "dailyCalories" }, log, "mission")!.note ?? "", /1 day\(s\)/);
    assert.ok(dailyLogChart({ kind: "exerciseDays" }, log, "mission")!.note, "the uncounted day is on the mission chart");
  });

  it("charts exercise minutes with the goal, leaving out uncounted days", () => {
    const exercise = dailyLogChart({ kind: "exerciseDays" }, LOG, "7d")!;
    assert.deepEqual(exercise.points.map((p) => p.value), [30, 5]);
    assert.equal(exercise.goal?.value, 120);
  });

  it("carries no metric charts (those come from the ground's series)", () => {
    assert.equal(dailyLogChart({ kind: "metric", metric: "heartRate" }, LOG, "24h"), null);
  });

  it("shows daily charts over 7 days unless the whole mission is chosen", () => {
    assert.deepEqual(["1h", "24h", "7d", "mission"].map((r) => dailyRange(r as "1h")), ["7d", "7d", "7d", "mission"]);
    assert.equal(groundRangePhrase({ kind: "exerciseDays" }, "1h"), "the last 7 days");
    assert.equal(groundRangePhrase({ kind: "checkIns", field: "mood" }, "1h"), "the last hour");
  });
});

describe("basisText", () => {
  it("speaks to the astronaut on the dashboard and about them on the surgeon's pages", () => {
    assert.equal(basisText("baseline"), "from your personal baseline");
    assert.equal(basisText("baseline", "surgeon"), "from the astronaut's personal baseline");
    assert.equal(basisText("settings", "surgeon"), "from the onboard settings");
  });
});
