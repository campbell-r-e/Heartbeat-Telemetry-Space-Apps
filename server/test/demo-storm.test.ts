// The surgeon console's two-step simulated storm (SPEC §13, owner decision): each step's factor lands
// on its status through the real rules engine at every point of the mission clock's loop, and a
// stored storm's factor reads back exactly.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEMO_STORM_STEPS, type Status } from "@heartbeat/shared";
import { readRadiationHours } from "../src/data/bundled-files.ts";
import { radiationReadings } from "../src/data/load-bundled.ts";
import { MISSION_SAMPLE_PERIOD_MS, RULE_HISTORY_MS } from "../src/domain/mission-clock.ts";
import { RULES } from "../src/domain/rules/catalog.ts";
import { evaluateRules } from "../src/domain/rules/engine.ts";
import { RULE_SETTINGS } from "../src/domain/rules/settings.ts";
import {
  SIMULATED_READING_SPAN_MS, STORM_ACTIVE_MS, isStormOn, simulatedStormReadings, solarEventProfile, solarStormState, stalePressReason, stormFactorOf,
} from "../src/domain/solar-storm.ts";
import { computeFacts } from "../src/domain/status/compute-facts.ts";
import type { TimedValue } from "../src/domain/status/timed-values.ts";
import { HOUR_MS } from "../src/domain/time.ts";

const START = Date.parse("2026-11-14T12:00:00Z");
const hours = readRadiationHours();
const profile = solarEventProfile(hours);
const played: TimedValue[] = radiationReadings(hours, START)
  .map((r) => ({ tMs: Date.parse(r.takenAt), value: r.value as number }))
  .sort((a, b) => a.tMs - b.tMs);
const loopHours = Math.round((Date.parse(hours.at(-1)!.t) - Date.parse(hours[0].t) + MISSION_SAMPLE_PERIOD_MS) / HOUR_MS);

/** The ship's radiation as the rules see it at `nowMs` with the storm of `factor` pressed then. */
function radiationWithStorm(factor: number, nowMs: number): TimedValue[] {
  const storm = simulatedStormReadings(profile, factor, nowMs).map((r) => ({ tMs: Date.parse(r.takenAt), value: r.value as number }));
  // The rules read the 8 days before now (and one hour more for the oldest slot's edge).
  const recorded = played.filter((r) => r.tMs <= nowMs && r.tMs > nowMs - RULE_HISTORY_MS - HOUR_MS);
  const kept = recorded.filter((r) => storm.every((s) => Math.abs(s.tMs - r.tMs) >= SIMULATED_READING_SPAN_MS));
  return [...kept, ...storm].sort((a, b) => a.tMs - b.tMs);
}

function radiationStatus(rates: TimedValue[], nowMs: number): Status | null {
  const facts = computeFacts({
    nowMs, profile: { age: null, sex: null, massKg: null, heightM: null }, missionStartMs: null, sleepDayTimeZone: "UTC",
    ship: { radiationDoseRate: rates }, astronaut: {}, latest: {}, checkIns: [], meals: [], foods: [],
  }, RULE_SETTINGS);
  return evaluateRules(RULES, RULE_SETTINGS, facts, "a1").areas.find((a) => a.area === "radiation")!.status;
}

describe("the real looped ISS record alone, with no storm (review F003)", () => {
  /** Each hour of one loop at which the real record rates Radiation, by status. */
  function hoursByStatus(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (let hour = 0; hour < loopHours; hour++) {
      const nowMs = START + hour * HOUR_MS;
      const recorded = played.filter((r) => r.tMs <= nowMs && r.tMs > nowMs - RULE_HISTORY_MS - HOUR_MS);
      const status = String(radiationStatus(recorded, nowMs));
      counts[status] = (counts[status] ?? 0) + 1;
    }
    return counts;
  }

  it("does fire the storm's two rules: the Sept 2017 event and later rises give 🔴 for 7 hours and 🟡 for 15 in each loop", () => {
    // So a storm-rule alert can come from real data: the reset resolves only those raised since the storm started.
    assert.deepEqual(hoursByStatus(), { normal: loopHours - 22, watch: 15, alert: 7 });
  });
});

describe("the console's storm steps (DEMO_STORM_STEPS)", () => {
  it("are picked from the rules' radiation thresholds: 🟡 between them, 🔴 above the alert one", () => {
    assert.equal(RULE_SETTINGS["radiation.solarEventWatchMultiple"], 1.25);
    assert.equal(RULE_SETTINGS["radiation.solarEventAlertMultiple"], 1.5);
    assert.ok(DEMO_STORM_STEPS.watch < DEMO_STORM_STEPS.alert);
  });

  it("give 🟡 for the first press and 🔴 for the second at every point of the loop", () => {
    for (let hour = 0; hour < loopHours; hour++) {
      for (const minutes of [0, 30, 59]) {
        const nowMs = START + hour * HOUR_MS + minutes * 60_000;
        assert.equal(radiationStatus(radiationWithStorm(DEMO_STORM_STEPS.watch, nowMs), nowMs), "watch", `watch step, ${hour} h ${minutes} min into the loop`);
        assert.equal(radiationStatus(radiationWithStorm(DEMO_STORM_STEPS.alert, nowMs), nowMs), "alert", `alert step, ${hour} h ${minutes} min into the loop`);
      }
    }
  });
});

describe("stormFactorOf (reading a stored storm's factor back)", () => {
  const values = (factor: number) => simulatedStormReadings(profile, factor, START).map((r) => r.value as number);

  it("returns the factor the storm was made with, to 2 decimals", () => {
    for (const factor of [1, DEMO_STORM_STEPS.watch, 2.5, DEMO_STORM_STEPS.alert, 50]) assert.equal(stormFactorOf(profile, values(factor)), factor);
  });

  it("is null for values that are not one storm of the event", () => {
    assert.equal(stormFactorOf(profile, values(5).slice(1)), null);
    assert.equal(stormFactorOf({ baseline: 10, hours: [5, 9] }, [5, 9]), null, "no hour above baseline");
  });
});

describe("solarStormState", () => {
  const stored = (factor: number, pressedMs = START) =>
    simulatedStormReadings(profile, factor, pressedMs).map((r) => ({ takenMs: Date.parse(r.takenAt), value: r.value as number }));
  const startedAt = new Date(START).toISOString();

  it("is inactive with no stored storm, and active with its factor otherwise", () => {
    assert.deepEqual(solarStormState(profile, [], null, START), { active: false, factor: null, startedAt: null });
    assert.deepEqual(solarStormState(profile, stored(DEMO_STORM_STEPS.watch), START, START), { active: true, factor: DEMO_STORM_STEPS.watch, startedAt });
  });

  it("keeps the latest storm's start after it is cleared", () => {
    assert.deepEqual(solarStormState(profile, [], START, START), { active: false, factor: null, startedAt });
  });

  it("counts a storm as on for its own 48 hours after the press, then as no storm (pending owner review)", () => {
    const readings = stored(DEMO_STORM_STEPS.alert);
    assert.equal(solarStormState(profile, readings, START, START + STORM_ACTIVE_MS - 1).active, true);
    assert.deepEqual(solarStormState(profile, readings, START, START + STORM_ACTIVE_MS), { active: false, factor: null, startedAt });
    assert.equal(isStormOn(readings, START + 2 * HOUR_MS), true);
    assert.equal(isStormOn([], START), false);
  });
});

describe("stalePressReason (a press from an out-of-date console)", () => {
  const none = { active: false, factor: null };
  const atWatch = { active: true, factor: DEMO_STORM_STEPS.watch };

  it("is null when the storm is what the sender saw, or the sender named no expectation", () => {
    assert.equal(stalePressReason(none, null), null);
    assert.equal(stalePressReason(atWatch, DEMO_STORM_STEPS.watch), null);
    assert.equal(stalePressReason(atWatch, undefined), null);
  });

  it("explains what was expected and what the ship has", () => {
    assert.match(stalePressReason(atWatch, null)!, /expected no storm, but the ship has a storm at factor 1\.3\. Nothing was changed/);
    assert.match(stalePressReason(none, DEMO_STORM_STEPS.watch)!, /expected a storm at factor 1\.3, but the ship has no storm/);
  });
});
