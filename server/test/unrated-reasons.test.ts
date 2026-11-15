import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Metric, NutritionDay } from "@heartbeat/shared";
import { ASTRONAUT_1 } from "../src/data/load-bundled.ts";
import { RULES } from "../src/domain/rules/catalog.ts";
import type { ProfileField } from "../src/domain/rules/facts.ts";
import { RULE_SETTINGS } from "../src/domain/rules/settings.ts";
import type { StatusInputs } from "../src/domain/status/compute-facts.ts";
import { unratedReason, type UnratedContext } from "../src/domain/status/unrated-reasons.ts";
import { DAY_MS, HOUR_MS, MINUTE_MS } from "../src/domain/time.ts";

const NOW = Date.parse("2026-11-14T12:00:00Z");
const EVENING = Date.parse("2026-11-14T19:00:00Z");
const total = (atLeast: number, unknownMeals = 0) => ({ atLeast, unknownMeals });
const day = (mealsLogged: number, unknownMeals = 0): NutritionDay => ({
  day: "2026-11-13", complete: true, mealsLogged,
  totals: { kcal: total(0), proteinG: total(0), calciumMg: total(0, unknownMeals), vitaminDUg: total(0), sodiumMg: total(0) },
});
const inputs = (overrides: Partial<StatusInputs> = {}): StatusInputs => ({
  nowMs: NOW, profile: ASTRONAUT_1, missionStartMs: null, sleepDayTimeZone: "UTC", ship: {}, astronaut: {}, latest: {}, checkIns: [], meals: [], foods: [], ...overrides,
});
const context = (overrides: Partial<UnratedContext> = {}): UnratedContext => ({
  inputs: inputs(), rules: RULES, settings: RULE_SETTINGS, noRecentData: [], missingProfile: [], nutritionYesterday: day(1), ...overrides,
});
/** `minutes` heart-rate readings, one a minute, ending at `endMs`, all at an exercise level. */
const exercising = (minutes: number, endMs: number) =>
  Array.from({ length: minutes }, (_, i) => ({ tMs: endMs - i * MINUTE_MS, value: 140 }));
/** One reading a day for `days` days before NOW, all the same value. */
const flat = (days: number) => Array.from({ length: days }, (_, i) => ({ tMs: NOW - (i + 1) * DAY_MS + HOUR_MS, value: 60 }));
const checkIn = (id: number) => ({ id, astronautId: "a1", mood: 3, stress: 3, at: new Date(NOW).toISOString() });

describe("reasons for an unrated area", () => {
  it("vitals: expired readings, and progress toward the baseline", () => {
    const reason = unratedReason("vitals", context({ noRecentData: ["heartRate", "hrv"] as Metric[], inputs: inputs({ astronaut: { heartRate: flat(5) } }) }));
    assert.equal(reason, "No recent heart rate and HRV readings; Baseline needs readings on 7 days (5 so far)");
  });

  it("vitals: a ready baseline whose readings do not vary", () => {
    assert.equal(unratedReason("vitals", context({ inputs: inputs({ astronaut: { heartRate: flat(8) } }) })),
      "Baseline readings do not vary yet, so there is no normal range to compare with");
  });

  it("radiation: expired, or not enough readings for the 8-day comparison", () => {
    assert.equal(unratedReason("radiation", context({ noRecentData: ["radiationDoseRate"] })), "No recent radiation readings");
    assert.equal(unratedReason("radiation", context()), "Not enough radiation readings yet for the 8-day comparison");
  });

  it("gravity: no watch data today, the missing age, and how far today's exercise is", () => {
    assert.equal(unratedReason("gravity", context()), "No watch data today");
    const noAge: ProfileField[] = ["age"];
    assert.equal(unratedReason("gravity", context({ missingProfile: noAge })), "Needs the astronaut's age");
    const morning = context({ inputs: inputs({ astronaut: { heartRate: exercising(30, NOW) } }) });
    assert.equal(unratedReason("gravity", morning), "Exercise 30 of 120 min today; rated from 18:00 UTC");
  });

  it("gravity: after 18:00 with 60 to 119 minutes it is on pace (review F016)", () => {
    const evening = context({ inputs: inputs({ nowMs: EVENING, astronaut: { heartRate: exercising(90, EVENING) } }) });
    assert.equal(unratedReason("gravity", evening), "Exercise 90 of 120 min today — on pace");
  });

  it("cabin: expired readings", () => {
    assert.equal(unratedReason("cabin", context({ noRecentData: ["co2", "cabinTemp"] })), "No recent CO₂ and cabin temperature readings");
  });

  it("nutrition: no meals, unknown values, the missing profile", () => {
    assert.equal(unratedReason("nutrition", context({ nutritionYesterday: day(0) })), "No meals logged yesterday");
    assert.equal(unratedReason("nutrition", context({ nutritionYesterday: day(2, 1) })), "Some of yesterday's meals have no value for a nutrient");
    assert.equal(unratedReason("nutrition", context({ missingProfile: ["sex", "heightM"] })), "Needs the astronaut's sex and height");
  });

  it("mind: too few check-ins, and an expired HRV reading the Mind rules read (review F014)", () => {
    assert.equal(unratedReason("mind", context({ inputs: inputs({ astronaut: { hrv: flat(8).map((r, i) => ({ ...r, value: 50 + i })) } }) })),
      "Needs 2 mood check-ins in the last 3 days (0 so far)");
    const enoughCheckIns = inputs({ checkIns: [checkIn(1), checkIn(2)], astronaut: { hrv: flat(8).map((r, i) => ({ ...r, value: 50 + i })) } });
    assert.equal(unratedReason("mind", context({ inputs: enoughCheckIns, noRecentData: ["hrv"] })), "No recent HRV readings");
  });

  it("mind: progress toward the HRV baseline only, even when heart rate already has a baseline", () => {
    const hrvShort = inputs({
      checkIns: [checkIn(1), checkIn(2)],
      astronaut: { heartRate: flat(10).map((r, i) => ({ ...r, value: 60 + i })), hrv: flat(5).map((r, i) => ({ ...r, value: 50 + i })) },
    });
    assert.equal(unratedReason("mind", context({ inputs: hrvShort })), "HRV baseline needs readings on 7 days (5 so far)");
    assert.equal(unratedReason("vitals", context({ inputs: hrvShort })), "Not enough data yet", "Vitals still counts heart rate's days");
    const hrvFlat = inputs({ checkIns: [checkIn(1), checkIn(2)], astronaut: { hrv: flat(8) } });
    assert.equal(unratedReason("mind", context({ inputs: hrvFlat })),
      "HRV baseline readings do not vary yet, so there is no normal range to compare with");
  });

  it("falls back to a general reason when nothing specific applies", () => {
    assert.equal(unratedReason("cabin", context()), "Not enough data yet");
  });
});
