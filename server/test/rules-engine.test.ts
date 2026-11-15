import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RULES } from "../src/domain/rules/catalog.ts";
import { evaluateRules, isSettingKey, renderMessage, runRule } from "../src/domain/rules/engine.ts";
import { FACTS, isFactId } from "../src/domain/rules/facts.ts";
import type { Rule } from "../src/domain/rules/rule.ts";
import { RULE_SETTINGS, type RuleSettings } from "../src/domain/rules/settings.ts";
import { facts, type FactInput } from "./support/facts.ts";

const rule = (id: string): Rule => RULES.find((r) => r.id === id)!;
const PLACEHOLDERS = /\{(setting:)?([\w.]+)\}/g;

describe("rule catalog", () => {
  it("has unique ids", () => {
    assert.equal(new Set(RULES.map((r) => r.id)).size, RULES.length);
  });

  it("uses only known facts and settings in its message placeholders", () => {
    for (const r of RULES) {
      for (const text of Object.values(r.message)) {
        for (const [, isSetting, name] of text.matchAll(PLACEHOLDERS)) {
          assert.ok(isSetting ? isSettingKey(name, RULE_SETTINGS) : isFactId(name), `${r.id}: ${name}`);
        }
      }
    }
  });

  it("never restates one of its own thresholds as literal text (review F004)", () => {
    for (const r of RULES) {
      const thresholds = r.when.flatMap((c) => ("setting" in c ? [String(RULE_SETTINGS[c.setting])] : []));
      for (const text of Object.values(r.message)) {
        const literal = text.replace(PLACEHOLDERS, "").replace(/\[V\d \d{4}\]/g, ""); // requirement IDs are not numbers
        for (const threshold of thresholds) assert.ok(!new RegExp(`(^|[^\\d.])${threshold.replace(".", "\\.")}([^\\d]|$)`).test(literal), `${r.id}: "${threshold}" in "${text}"`);
      }
    }
  });

  it("cites NASA requirement IDs in the [V2 6004] form, on the rules built from SPEC §6.5's NASA limits", () => {
    for (const r of RULES) {
      // NASA-STD-3001 IDs, or the nutrition requirements document's own numbering.
      if (r.source.requirementId !== null) assert.match(r.source.requirementId, /^\[V[12] \d{4}\]$|^Req\. \d+$/, r.id);
    }
    assert.equal(rule("radiation-solar-event-alert").source.requirementId, "[V1 4031]");
    assert.equal(rule("radiation-career-watch").source.requirementId, "[V1 4030]");
    assert.equal(rule("co2-one-hour-alert").source.requirementId, "[V2 6004]");
    assert.equal(rule("pressure-low-alert").source.requirementId, "[V2 6006]");
    assert.equal(rule("cabin-comfort-zone-watch").source.requirementId, "[V2 6012]");
    assert.equal(rule("noise-sleep-watch").source.requirementId, "[V2 6079]");
    assert.equal(rule("noise-awake-watch").source.requirementId, "[V2 6078]");
    assert.equal(rule("noise-day-alert").source.requirementId, "[V2 6115]");
  });

  it("has no dehydration rule (no fluid-intake data)", () => {
    assert.equal(RULES.some((r) => r.id.startsWith("dehydration")), false);
  });
});

describe("runRule", () => {
  it("is pending while a setting it or its fact needs is unset, naming the settings", () => {
    const unset: RuleSettings = { ...RULE_SETTINGS, "baseline.windowDays": null, "baseline.watchBeyondSd": null };
    assert.deepEqual(runRule(rule("hrv-below-baseline-watch"), unset, facts({ hrvBelowBaselineSd: 5 })), {
      rule: rule("hrv-below-baseline-watch"), kind: "pending", waitingFor: ["baseline.watchBeyondSd", "baseline.windowDays"],
    });
  });

  it("is noData when a fact it reads is missing", () => {
    assert.equal(runRule(rule("spo2-alert"), RULE_SETTINGS, facts({})).kind, "noData");
  });

  it("dates a fired rule by its newest fact", () => {
    const outcome = runRule(rule("cabin-comfort-zone-watch"), RULE_SETTINGS, {
      cabinOutsideZone: { value: true, atMs: 5 }, cabinBeyondZoneMargin: { value: false, atMs: 9 },
    });
    assert.deepEqual(outcome, { rule: rule("cabin-comfort-zone-watch"), kind: "checked", fired: true, atMs: 9 });
  });
});

describe("two layers: a reading gets the worse status", () => {
  const heartRate = (bpm: number, sds: number) => evaluateRules(RULES, RULE_SETTINGS, facts({ heartRateBpm: bpm, heartRateAboveBaselineSd: sds }), "a1");

  it("baseline 🟡 beats standard 🟢", () => {
    const verdict = heartRate(90, 2.5);
    assert.deepEqual(verdict.metrics, [{ metric: "heartRate", status: "watch" }]);
    assert.deepEqual(verdict.evaluations.map((e) => [e.ruleId, e.layer]), [["heart-rate-above-baseline-watch", "baseline"]]);
  });

  it("standard 🔴 beats baseline 🟡", () => {
    assert.deepEqual(heartRate(185, 2.5).metrics, [{ metric: "heartRate", status: "alert" }]);
  });

  it("baseline 🔴 beats standard 🟢", () => {
    assert.deepEqual(heartRate(120, 3.5).metrics, [{ metric: "heartRate", status: "alert" }]);
  });

  it("both 🟢 stays 🟢", () => {
    assert.deepEqual(heartRate(70, 1).metrics, [{ metric: "heartRate", status: "normal" }]);
  });
});

describe("evaluateRules", () => {
  it("leaves an area null when no rule in it could run, and overall is the worst rated area", () => {
    const verdict = evaluateRules(RULES, RULE_SETTINGS, facts({ spo2Pct: 92, co2OneHourAverageMmHg: 3.5 }), "a1");
    assert.deepEqual(verdict.areas, [
      { area: "vitals", status: "watch" },
      { area: "radiation", status: null },
      { area: "gravity", status: null },
      { area: "cabin", status: "alert" },
      { area: "nutrition", status: null },
      { area: "mind", status: null },
    ]);
    assert.equal(verdict.overall, "alert");
    assert.equal(evaluateRules(RULES, RULE_SETTINGS, facts({}), "a1").overall, null);
  });

  it("lists alerts before watches, each with its three-part message, source and metrics", () => {
    const [first, second] = evaluateRules(RULES, RULE_SETTINGS, facts({ spo2Pct: 92, co2OneHourAverageMmHg: 3.5 }, 1000), "a1").evaluations;
    assert.deepEqual(first, {
      astronautId: "a1",
      ruleId: "co2-one-hour-alert",
      title: "CO₂ above limit",
      area: "cabin",
      hazard: "environment",
      metrics: ["co2"],
      layer: "standard",
      status: "alert",
      message: {
        what: "Cabin CO₂ averaged 3.50 mmHg over the last hour, above NASA's 3 mmHg limit.",
        why: rule("co2-one-hour-alert").message.why,
        do: rule("co2-one-hour-alert").message.do,
      },
      source: {
        requirementId: "[V2 6004]", document: "NASA-STD-3001 Vol 2 Rev F §6.2.1.3 · OCHMO-TB-004", ours: false,
        citations: ["NASA-STD-3001 Vol 2 Rev F §6.2.7.1, p. 63 [V2 6107]", "OCHMO-TB-004, p. 5"],
      },
      crewWide: true,
      at: "1970-01-01T00:00:01.000Z",
    });
    assert.equal(second.ruleId, "spo2-watch");
    assert.equal(second.message.what, "Your blood oxygen is 92%, below the normal 95%.");
    assert.equal(second.crewWide, false);
  });
});

describe("renderMessage", () => {
  it("rounds each fact to its own decimals, fills settings, and leaves unknown placeholders alone", () => {
    const message = { what: "{radiationDailyDoseMultiple}× and {spo2Pct}%", why: "{notAFact} {setting:noise.sleepStartHourUtc}", do: "{cabinTempC} {setting:nope}" };
    assert.deepEqual(renderMessage(message, facts({ radiationDailyDoseMultiple: 1.4734, spo2Pct: 93.6 }), RULE_SETTINGS), {
      what: "1.47× and 94%", why: "{notAFact} 21.5", do: "unknown {setting:nope}",
    });
    assert.equal(FACTS.radiationDailyDoseMultiple.decimals, 2);
  });

  it("quotes the configured threshold, so a changed setting changes the message", () => {
    const changed: RuleSettings = { ...RULE_SETTINGS, "noise.awakeWatchAboveDba": 55 };
    const [evaluation] = evaluateRules(RULES, changed, facts({ noiseDayLevelDba: 56, noiseAwakeLevelDba: 56 }), "a1").evaluations;
    assert.match(evaluation.message.what, /above 55 dBA, our rough dBA stand-in/);
  });
});

describe("behavioral health combination rule (SPEC §6.4)", () => {
  const lowMoodLowHrv: FactInput = { moodAverage: 2, hrvBelowBaselineSd: 2.5, stressAverage: 3 };
  const mind = (values: FactInput) => evaluateRules(RULES, RULE_SETTINGS, facts(values), "a1").areas.find((a) => a.area === "mind")!.status;

  it("low mood + low HRV is 🟡; adding high stress is 🔴", () => {
    assert.equal(mind(lowMoodLowHrv), "watch");
    assert.equal(mind({ ...lowMoodLowHrv, stressAverage: 4 }), "alert");
    assert.equal(mind({ ...lowMoodLowHrv, moodAverage: 2.1 }), "normal");
    assert.equal(mind({ ...lowMoodLowHrv, hrvBelowBaselineSd: 2 }), "normal");
  });

  it("applies the sleep condition only once sleep data exists", () => {
    assert.equal(mind({ ...lowMoodLowHrv, shortSleepNightsInARow: 3 }), "watch");
    assert.equal(mind({ ...lowMoodLowHrv, shortSleepNightsInARow: 2 }), "normal");
  });

  it("does not run without check-ins or an HRV baseline", () => {
    assert.equal(mind({ hrvBelowBaselineSd: 3 }), null);
    assert.equal(mind({ moodAverage: 1, stressAverage: 5 }), null);
  });

  it("rates the Mind area but not individual metrics", () => {
    const verdict = evaluateRules(RULES, RULE_SETTINGS, facts({ ...lowMoodLowHrv, shortSleepNightsInARow: 3 }), "a1");
    assert.equal(verdict.metrics.find((m) => m.metric === "sleep"), undefined);
  });
});
