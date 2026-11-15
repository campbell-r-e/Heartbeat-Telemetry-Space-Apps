// Every threshold, at its boundary and just past it, through the real rule catalog and settings.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Metric, Status } from "@heartbeat/shared";
import { RULES } from "../src/domain/rules/catalog.ts";
import { evaluateRules } from "../src/domain/rules/engine.ts";
import type { NumberFactId } from "../src/domain/rules/facts.ts";
import { RULE_SETTINGS, type RuleSettings } from "../src/domain/rules/settings.ts";
import { facts, type FactInput } from "./support/facts.ts";

const verdict = (values: FactInput, settings: RuleSettings = RULE_SETTINGS) => evaluateRules(RULES, settings, facts(values), "a1");
const statusOf = (metric: Metric, values: FactInput) => verdict(values).metrics.find((m) => m.metric === metric)?.status;
const firedRules = (values: FactInput) => verdict(values).evaluations.map((e) => e.ruleId);
const areaOf = (area: string, values: FactInput) => verdict(values).areas.find((a) => a.area === area)?.status;

/** [value, expected status] pairs for one numeric fact. */
function assertBands(metric: Metric, fact: NumberFactId, cases: ReadonlyArray<readonly [number, Status]>, extra: FactInput = {}) {
  for (const [value, expected] of cases) {
    assert.equal(statusOf(metric, { ...extra, [fact]: value }), expected, `${fact} = ${value}`);
  }
}

describe("radiation, solar event: rolling 24-hour dose vs. the previous 7-day average", () => {
  it("is 🟡 from 1.25× and 🔴 from 1.5×", () => {
    assertBands("radiationDoseRate", "radiationDailyDoseMultiple", [
      [1.2499, "normal"], [1.25, "watch"], [1.4999, "watch"], [1.5, "alert"], [3, "alert"],
    ]);
  });

  it("fires exactly one rule per band", () => {
    assert.deepEqual(firedRules({ radiationDailyDoseMultiple: 1.25 }), ["radiation-solar-event-watch"]);
    assert.deepEqual(firedRules({ radiationDailyDoseMultiple: 1.5 }), ["radiation-solar-event-alert"]);
  });
});

describe("radiation, career (600 mSv)", () => {
  const at = (fraction: number, projected: number) =>
    statusOf("radiationDoseRate", { radiationCareerFraction: fraction, radiationProjectedCareerFraction: projected });

  it("is 🟢 below 80% of the limit, 🟡 from 80%, 🔴 once projected to reach it", () => {
    assert.equal(at(0.7999, 0.9), "normal");
    assert.equal(at(0.8, 0.9), "watch");
    assert.equal(at(0.8, 0.9999), "watch");
    assert.equal(at(0.5, 1), "alert");
  });

  it("is pending, and listed so, while a setting it needs is unset", () => {
    const unset: RuleSettings = { ...RULE_SETTINGS, "mission.plannedLengthDays": null };
    const pending = verdict({ radiationCareerFraction: 0.9, radiationProjectedCareerFraction: 1.2 }, unset).pendingRules;
    assert.deepEqual(pending.map((p) => [p.ruleId, p.waitingFor]), [
      ["radiation-career-watch", ["mission.plannedLengthDays"]],
      ["radiation-career-alert", ["mission.plannedLengthDays"]],
    ]);
  });
});

describe("CO₂", () => {
  it("1-hour average: 🟡 from 2.5 to 3.0 mmHg, 🔴 above 3.0", () => {
    assertBands("co2", "co2OneHourAverageMmHg", [[2.4999, "normal"], [2.5, "watch"], [3.0, "watch"], [3.0001, "alert"]]);
  });

  it("7-day average: 🟡 from 2.5 mmHg", () => {
    assertBands("co2", "co2SevenDayAverageMmHg", [[2.4999, "normal"], [2.5, "watch"]]);
  });

  it("shows both a 1-hour alert and a 7-day watch when both hold", () => {
    assert.deepEqual(firedRules({ co2OneHourAverageMmHg: 3.1, co2SevenDayAverageMmHg: 2.6 }), ["co2-one-hour-alert", "co2-seven-day-watch"]);
  });
});

describe("cabin pressure", () => {
  it("is 🔴 at or below 34.5 kPa and above 103 kPa, whatever the shift", () => {
    assertBands("pressure", "pressureKPa", [[34.5, "alert"], [34.5001, "normal"], [103, "normal"], [103.0001, "alert"]], { pressureShiftKPa: 0 });
    assert.deepEqual(firedRules({ pressureKPa: 110, pressureShiftKPa: 9 }), ["pressure-high-alert"]);
  });

  it("is 🟡 more than 3 kPa from the watch's own 24-hour average", () => {
    assertBands("pressure", "pressureShiftKPa", [[3, "normal"], [3.0001, "watch"]], { pressureKPa: 98 });
  });
});

describe("cabin temperature + humidity zone", () => {
  it("is 🟢 inside, 🟡 outside, 🔴 beyond the margin", () => {
    const zone = (outside: boolean, beyond: boolean) =>
      statusOf("cabinTemp", { cabinOutsideZone: outside, cabinBeyondZoneMargin: beyond, cabinTempC: 0, cabinHumidityPct: 0 });
    assert.equal(zone(false, false), "normal");
    assert.equal(zone(true, false), "watch");
    assert.equal(zone(true, true), "alert");
  });
});

describe("noise", () => {
  it("24-hour level: 🔴 above 70 dBA", () => {
    assertBands("noise", "noiseDayLevelDba", [[70, "normal"], [70.0001, "alert"]]);
  });

  it("sleep period: 🟡 above 50 dBA; awake: 🟡 above 58 dBA", () => {
    const at = (sleep: number, awake: number) => statusOf("noise", { noiseDayLevelDba: 60, noiseSleepLevelDba: sleep, noiseAwakeLevelDba: awake });
    assert.equal(at(50, 58), "normal");
    assert.equal(at(50.0001, 58), "watch");
    assert.equal(at(50, 58.0001), "watch");
  });
});

describe("SpO₂", () => {
  it("is 🟢 from 95%, 🟡 from 90% to under 95%, 🔴 under 90%", () => {
    assertBands("spo2", "spo2Pct", [[95, "normal"], [94.9999, "watch"], [90, "watch"], [89.9999, "alert"]]);
  });
});

describe("heart rate", () => {
  it("is 🔴 below 40 or above 180 bpm at any time, and otherwise not rated without a baseline", () => {
    assertBands("heartRate", "heartRateBpm", [[39.9, "alert"], [40, "normal"], [180, "normal"], [180.1, "alert"]]);
    assert.deepEqual(firedRules({ heartRateBpm: 150 }), []);
  });

  it("is 🟡 more than 2 and 🔴 more than 3 standard deviations above baseline", () => {
    assertBands("heartRate", "heartRateAboveBaselineSd", [[2, "normal"], [2.0001, "watch"], [3, "watch"], [3.0001, "alert"], [-5, "normal"]], { heartRateBpm: 70 });
  });
});

describe("skin temperature and HRV against baseline", () => {
  it("skin temperature: 🟡 beyond 2 and 🔴 beyond 3 standard deviations, either way", () => {
    assertBands("skinTemp", "skinTempAwayFromBaselineSd", [[2, "normal"], [2.0001, "watch"], [3, "watch"], [3.0001, "alert"]]);
  });

  it("HRV: 🟡 beyond 2 and 🔴 beyond 3 standard deviations below", () => {
    assertBands("hrv", "hrvBelowBaselineSd", [[2, "normal"], [2.0001, "watch"], [3, "watch"], [3.0001, "alert"], [-4, "normal"]]);
  });
});

describe("gravity: exercise minutes", () => {
  it("is 🟡 under 60 minutes at or after 18:00 UTC, 🟢 from 120 minutes, never 🔴", () => {
    assert.equal(areaOf("gravity", { exerciseMinutesToday: 59, utcHourOfDay: 18 }), "watch");
    assert.equal(areaOf("gravity", { exerciseMinutesToday: 0, utcHourOfDay: 23.9 }), "watch");
    assert.equal(areaOf("gravity", { exerciseMinutesToday: 120, utcHourOfDay: 10 }), "normal");
    assert.equal(areaOf("gravity", { exerciseMinutesToday: 120, utcHourOfDay: 20 }), "normal");
  });

  it("has no status at any other time (owner decision)", () => {
    assert.equal(areaOf("gravity", { exerciseMinutesToday: 0, utcHourOfDay: 10 }), null);
    assert.equal(areaOf("gravity", { exerciseMinutesToday: 0, utcHourOfDay: 17.99 }), null);
    assert.equal(areaOf("gravity", { exerciseMinutesToday: 60, utcHourOfDay: 18 }), null);
    assert.equal(areaOf("gravity", { exerciseMinutesToday: 90, utcHourOfDay: 20 }), null);
    assert.equal(areaOf("gravity", { exerciseMinutesToday: 119, utcHourOfDay: 23 }), null);
  });

  it("lists no evaluation for the 🟢 goal-met rule", () => {
    assert.deepEqual(firedRules({ exerciseMinutesToday: 130, utcHourOfDay: 20 }), []);
  });

  it("does not rate heart rate itself", () => {
    assert.equal(statusOf("heartRate", { exerciseMinutesToday: 0, utcHourOfDay: 20 }), undefined);
  });
});

describe("nutrition, yesterday's daily totals (NASA nutrition requirements, 2005)", () => {
  const bands = (fact: NumberFactId, cases: ReadonlyArray<readonly [number, Status]>) => {
    for (const [value, expected] of cases) assert.equal(areaOf("nutrition", { [fact]: value }), expected, `${fact} = ${value}`);
  };

  it("calcium (Req. 20): 🟢 1200–2000, 🟡 1000–1200 or 2000–2500, 🔴 < 1000 or > 2500 mg", () => {
    bands("calciumDayMg", [[999, "alert"], [1000, "watch"], [1199, "watch"], [1200, "normal"], [2000, "normal"], [2001, "watch"], [2500, "watch"], [2501, "alert"]]);
  });

  it("vitamin D (Req. 8): 🟢 25–50, 🟡 10–25 or > 50, 🔴 < 10 µg", () => {
    bands("vitaminDDayUg", [[9.9, "alert"], [10, "watch"], [24.9, "watch"], [25, "normal"], [50, "normal"], [50.1, "watch"], [500, "watch"]]);
  });

  it("sodium (Req. 23): 🟢 1500–2300, 🟡 500–1500 or 2300–3500, 🔴 < 500 or > 3500 mg", () => {
    bands("sodiumDayMg", [[499, "alert"], [500, "watch"], [1499, "watch"], [1500, "normal"], [2300, "normal"], [2301, "watch"], [3500, "watch"], [3501, "alert"]]);
  });

  it("energy (Req. 1, strict reading): 🟢 90–100%, 🟡 80–90% or 100–120%, 🔴 < 80% or ≥ 120% of EER", () => {
    bands("energyDayPctOfEer", [[79.9, "alert"], [80, "watch"], [89.9, "watch"], [90, "normal"], [100, "normal"], [100.1, "watch"], [119.9, "watch"], [120, "alert"]]);
  });

  it("protein (Req. 2): 🟢 15–30%, 🟡 10–15% or 30–35%, 🔴 < 10% or > 35% of calories", () => {
    bands("proteinDayPctOfKcal", [[9.9, "alert"], [10, "watch"], [14.9, "watch"], [15, "normal"], [30, "normal"], [30.1, "watch"], [35, "watch"], [35.1, "alert"]]);
  });

  it("is pending, naming the profile fields, until the astronaut's profile is complete", () => {
    const pending = evaluateRules(RULES, RULE_SETTINGS, facts({ energyDayPctOfEer: 70 }), "a1", ["sex", "heightM"]).pendingRules;
    assert.deepEqual(pending.find((p) => p.ruleId === "nutrition-energy-low-alert")?.waitingFor, ["profile.sex", "profile.heightM"]);
    assert.equal(pending.some((p) => p.ruleId.startsWith("nutrition-calcium")), false);
  });

  it("cites the requirement and page, and quotes the target from the settings", () => {
    const [evaluation] = verdict({ calciumDayMg: 900 }).evaluations;
    assert.equal(evaluation.source.requirementId, "Req. 20");
    assert.ok(evaluation.source.document.endsWith("Req. 20, p. 78"));
    assert.equal(evaluation.message.what, "Yesterday you logged 900 mg of calcium, below the daily target of 1200–2000 mg.");
  });
});
