import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UNCOUNTED_DAYS_NOTE, exerciseChartData, exerciseDayPoints, exerciseDayRange, latestGoal } from "./exercise";

const days = [
  { day: "2026-11-12", minutes: 10, goalMinutes: 120 },
  { day: "2026-11-13", minutes: null, goalMinutes: 120 },
  { day: "2026-11-14", minutes: 4, goalMinutes: null },
];

describe("exercise minutes per day", () => {
  it("charts each counted day at its UTC start and leaves out days with no count", () => {
    assert.deepEqual(exerciseDayPoints(days), [
      { tMs: Date.parse("2026-11-12T00:00:00Z"), value: 10, simulated: false },
      { tMs: Date.parse("2026-11-14T00:00:00Z"), value: 4, simulated: false },
    ]);
  });

  it("takes the goal line from the newest day that has a goal", () => {
    assert.equal(latestGoal(days), 120);
    assert.equal(latestGoal([{ day: "2026-11-14", minutes: 1, goalMinutes: null }]), null);
  });

  it("maps the page's range onto the endpoint's ranges and refuses others", () => {
    assert.equal(exerciseDayRange("7d"), "7d");
    assert.equal(exerciseDayRange("mission"), "mission");
    assert.throws(() => exerciseDayRange("24h"));
  });
});

describe("exerciseChartData", () => {
  const now = Date.parse("2026-11-14T12:00:00Z");

  it("draws the server's goal and notes days it could not count", () => {
    const data = exerciseChartData(days, "7d", now);
    assert.deepEqual(data.goal, { value: 120, label: "Daily goal" });
    assert.equal(data.note, UNCOUNTED_DAYS_NOTE);
    assert.equal(data.unit, "min");
    assert.equal(data.points.length, 2);
  });

  it("has no note when every day was counted, and no goal while it is unset", () => {
    const data = exerciseChartData([{ day: "2026-11-14", minutes: 4, goalMinutes: null }], "7d", now);
    assert.equal(data.note, undefined);
    assert.equal(data.goal, null);
  });
});
