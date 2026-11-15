import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHECK_IN_SCALE } from "@heartbeat/shared";
import { CHECK_IN_AXIS, MOOD_CHOICES, STRESS_CHOICES, checkInChartData, checkInSeries, latestCheckIn, newestFirst, parseScore, saveNote, scaleHint } from "./checkin";

describe("the check-in scale from @heartbeat/shared", () => {
  it("has one mood and one stress choice per point", () => {
    const points = Array.from({ length: CHECK_IN_SCALE.max - CHECK_IN_SCALE.min + 1 }, (_, i) => CHECK_IN_SCALE.min + i);
    assert.deepEqual(MOOD_CHOICES.map((c) => c.value), points);
    assert.deepEqual(STRESS_CHOICES.map((c) => c.value), points);
  });

  it("describes each end of the scale with the shared labels", () => {
    assert.equal(scaleHint("mood"), "1 is very low, 5 is very good.");
    assert.equal(scaleHint("stress"), "1 is calm, 5 is very stressed.");
  });
});

describe("parseScore", () => {
  it("accepts whole numbers 1–5 only", () => {
    assert.equal(parseScore("1"), 1);
    assert.equal(parseScore("5"), 5);
    for (const bad of ["0", "6", "2.5", "", "x", null]) assert.equal(parseScore(bad), null, String(bad));
  });
});

describe("check-ins", () => {
  const checkIns = [
    { id: 1, astronautId: "a1", mood: 2, stress: 4, at: "2026-11-13T20:00:00Z" },
    { id: 2, astronautId: "a1", mood: 4, stress: 2, at: "2026-11-14T20:00:00Z" },
  ];

  it("finds the latest and orders newest first", () => {
    assert.equal(latestCheckIn(checkIns)?.id, 2);
    assert.equal(latestCheckIn([]), null);
    assert.deepEqual(newestFirst(checkIns).map((c) => c.id), [2, 1]);
  });

  it("charts one field in time order", () => {
    assert.deepEqual(checkInSeries([...checkIns].reverse(), "stress").map((p) => p.value), [4, 2]);
  });

  it("charts on the whole 1–5 scale, keeping only check-ins in the range's window", () => {
    const data = checkInChartData(checkIns, "mood", "24h", Date.parse("2026-11-14T21:00:00Z"));
    assert.deepEqual(data.scale, { min: CHECK_IN_SCALE.min, max: CHECK_IN_SCALE.max });
    assert.equal(data.scale, CHECK_IN_AXIS);
    assert.deepEqual(data.points.map((p) => p.value), [4]);
    assert.equal(data.endsNow, undefined, "ends now, the default");
  });
});

describe("saveNote (the approved mockup's note under Save)", () => {
  it("asks for both choices first", () => {
    assert.equal(saveNote(false, false, "20:00"), "Pick a mood and a stress level to save.");
  });

  it("names the scheduled check-in task time from the server", () => {
    assert.equal(saveNote(true, false, "20:00"), "Counts toward today’s 20:00 check-in task.");
    assert.equal(saveNote(true, false, null), "Counts toward today’s check-in task.");
  });

  it("confirms a save", () => {
    assert.equal(saveNote(true, true, "20:00"), "✓ Sent to the onboard server");
  });
});
