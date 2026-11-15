import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cabinReadings, radiationReadings } from "../src/data/load-bundled.ts";
import {
  MISSION_CLOCK_HORIZON_MS, RULE_HISTORY_MS, loopsBeforeStart, missionLoop, playTimeMs, storedLoops,
} from "../src/domain/mission-clock.ts";
import { HOUR_MS } from "../src/domain/time.ts";

const START = Date.parse("2026-11-14T12:00:00Z");
const HOURS = [
  { t: "2017-09-10T22:00:00Z", uGyPerHour: 6.1 },
  { t: "2017-09-10T23:00:00Z", uGyPerHour: 6.2 },
  { t: "2017-09-11T01:00:00Z", uGyPerHour: 9.4 },
];

describe("the looping mission clock", () => {
  const loop = missionLoop(HOURS, START, HOUR_MS);

  it("plays the first recorded point at the start and keeps the spacing, gaps included", () => {
    assert.deepEqual(HOURS.map((p) => playTimeMs(loop, p.t, 0) - START), [0, HOUR_MS, 3 * HOUR_MS]);
  });

  it("repeats every span plus one sample period, so the seam keeps the hourly spacing", () => {
    assert.equal(loop.periodMs, 4 * HOUR_MS);
    assert.equal(playTimeMs(loop, HOURS[0].t, 1) - playTimeMs(loop, HOURS[2].t, 0), HOUR_MS);
    assert.equal(playTimeMs(loop, HOURS[2].t, -1), START - HOUR_MS, "the loop before the start ends an hour before it");
  });

  it("stores enough loops before the start for the rules' 8 days of history, and enough after it to reach the horizon", () => {
    const loops = storedLoops(loop);
    assert.equal(loops[0], -loopsBeforeStart(loop));
    assert.ok(-loops[0] * loop.periodMs >= RULE_HISTORY_MS && (-loops[0] - 1) * loop.periodMs < RULE_HISTORY_MS);
    assert.ok(playTimeMs(loop, HOURS[0].t, loops.at(-1)!) >= START + MISSION_CLOCK_HORIZON_MS - loop.periodMs);
  });

  it("throws on empty mission data", () => {
    assert.throws(() => missionLoop([], START, HOUR_MS), /empty/);
  });
});

describe("mission data readings", () => {
  it("keep the source time as originalTakenAt on every loop", () => {
    const readings = radiationReadings(HOURS, START);
    const atStart = readings.filter((r) => Date.parse(r.takenAt) === START);
    assert.deepEqual(atStart.map((r) => r.originalTakenAt), [HOURS[0].t]);
    assert.equal(readings.length, HOURS.length * storedLoops(missionLoop(HOURS, START, HOUR_MS)).length);
  });

  it("give one reading per loop for a cabin hour with only CO2", () => {
    const readings = cabinReadings([{ t: "2018-08-14T00:00:00Z", tempC: null, rhPct: null, co2mmHg: 2.443 }], START);
    assert.ok(readings.every((r) => r.metric === "co2" && r.value === 2.443));
  });
});
