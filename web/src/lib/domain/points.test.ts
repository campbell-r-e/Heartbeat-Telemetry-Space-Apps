import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PointsSummary } from "@heartbeat/shared";
import { badgeStateText, earnedTodayText, loadedEarnedTodayText, loadedPointsTile, pointsTile, sumMealTaskPoints, taskPointsText } from "./points";
import { taskFixture as task } from "./test-fixtures";

function summary(overrides: Partial<PointsSummary> = {}): PointsSummary {
  return {
    astronautId: "a1", at: "2026-11-15T12:00:00.000Z", day: "2026-11-15", totalPoints: 1240,
    today: { points: 60, possiblePoints: 125, tasksDone: 3, tasks: 8 }, streak: { days: 9, includesToday: false }, badges: [],
    ...overrides,
  };
}

describe("pointsTile", () => {
  it("reads like the mockup, with today's points and how far the streak runs", () => {
    assert.deepEqual(pointsTile(summary()), { value: "1,240 · 9d", detail: "+60 today · streak through yesterday" });
    assert.equal(pointsTile(summary({ streak: { days: 10, includesToday: true } })).detail, "+60 today · streak includes today");
    assert.equal(pointsTile(summary({ totalPoints: 0, streak: { days: 0, includesToday: false } })).value, "0 · 0d");
    assert.equal(pointsTile(summary({ streak: { days: 0, includesToday: false } })).detail, "+60 today · no streak yet");
  });
});

describe("when the points could not be loaded", () => {
  it("shows a dash and says so, instead of failing the page", () => {
    const failed = { ok: false as const, problem: "the onboard server answered HTTP 500 for /points" };
    assert.deepEqual(loadedPointsTile(failed), { value: "—", detail: "Points unavailable" });
    assert.equal(loadedEarnedTodayText(failed), "Points unavailable");
    assert.deepEqual(loadedPointsTile({ ok: true, value: summary() }), pointsTile(summary()));
    assert.equal(loadedEarnedTodayText({ ok: true, value: summary() }), "+60 pts earned today");
  });
});

describe("task and badge text", () => {
  it("shows the server's points per task and today's total", () => {
    assert.equal(taskPointsText(task("ecg", "09:00", false, { points: 20 })), "+20");
    assert.equal(taskPointsText(task("ecg", "09:00", false, { points: null })), null);
    assert.equal(earnedTodayText(summary()), "+60 pts earned today");
  });

  it("says when a badge was earned", () => {
    assert.equal(badgeStateText({ earnedOn: "2026-11-11" }), "Earned 2026-11-11");
    assert.equal(badgeStateText({ earnedOn: null }), "Not earned yet");
  });
});

describe("sumMealTaskPoints", () => {
  it("counts each meal task done once, and nothing else", () => {
    const tasks = [
      task("meal-0800", "08:00", true, { kind: "meal", points: 10 }),
      task("meal-1300", "13:00", false, { kind: "meal", points: 10 }),
      task("ecg-0900", "09:00", true, { kind: "ecg", points: 20 }),
    ];
    assert.equal(sumMealTaskPoints(tasks), 10);
  });
});
