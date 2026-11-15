// When the real looped ISS record alone shows Radiation 🟡 or 🔴 (scripts/radiation-forecast-plan.ts,
// SPEC §13), so the presenter can avoid those hours.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readRadiationHours } from "../src/data/bundled-files.ts";
import { ASTRONAUT_1 } from "../src/data/load-bundled.ts";
import { DEFAULT_MISSION, missionStartDayMs } from "../src/domain/mission.ts";
import { RULE_SETTINGS, type RuleSettings } from "../src/domain/rules/settings.ts";
import { HOUR_MS } from "../src/domain/time.ts";
import { MAX_FORECAST_DAYS, parseForecastDays, realRadiationWindows, type ForecastContext, type RadiationWindow } from "../scripts/radiation-forecast-plan.ts";

const START = Date.parse("2026-11-15T06:02:00Z");
const LOOP_HOURS = 755;
const CONTEXT: ForecastContext = { missionStartMs: missionStartDayMs(DEFAULT_MISSION.startDate), profiles: [ASTRONAUT_1], settings: RULE_SETTINGS };
const hoursOf = (windows: RadiationWindow[], status: RadiationWindow["status"]) =>
  windows.filter((w) => w.status === status).reduce((sum, w) => sum + (w.toMs - w.fromMs) / HOUR_MS, 0);
const forecast = (fromMs: number, toMs: number, context = CONTEXT) => realRadiationWindows(readRadiationHours(), START, fromMs, toMs, context);

describe("realRadiationWindows", () => {
  const loop = forecast(START, START + LOOP_HOURS * HOUR_MS);

  it("finds 7 🔴 and 15 🟡 hours in one loop, the same count as the record checked hour by hour", () => {
    assert.equal(hoursOf(loop, "alert"), 7);
    assert.equal(hoursOf(loop, "watch"), 15);
  });

  it("starts with the Sept 2017 event 313 hours (about 13 days) after the server starts, on the start's minute", () => {
    assert.deepEqual(loop.slice(0, 2).map((w) => [w.status, (w.fromMs - START) / HOUR_MS]), [["watch", 313], ["alert", 315]]);
    assert.ok(loop.every((w) => (w.fromMs - START) % HOUR_MS === 0), "windows follow the server's start, not the clock hour");
  });

  it("merges neighboring hours of one status and leaves none before the event", () => {
    assert.ok(loop.every((w, i) => i === 0 || !(loop[i - 1].status === w.status && loop[i - 1].toMs === w.fromMs)));
    assert.deepEqual(forecast(START, START + 300 * HOUR_MS), []);
  });

  it("reports a window already on at the forecast's start as starting then (\"now\")", () => {
    const now = START + 318.5 * HOUR_MS; // inside the 🔴 hours 317–322
    const [first] = forecast(now, now + 2 * HOUR_MS);
    assert.deepEqual([first.status, first.fromMs, first.inProgress], ["alert", now, true]);
    assert.equal(forecast(START, START + LOOP_HOURS * HOUR_MS).some((w) => w.inProgress), false);
  });

  it("includes the career-dose rules: none fire on the real record (about 28% of the limit), but they would with a lower limit", () => {
    // With the real settings the mission dose stays far below the limit, so only the daily-dose hours count.
    assert.equal(hoursOf(loop, "alert"), 7);
    const lowLimit: RuleSettings = { ...RULE_SETTINGS, "radiation.careerLimitMSv": 10 };
    const withLowLimit = forecast(START, START + 2 * HOUR_MS, { ...CONTEXT, settings: lowLimit });
    assert.deepEqual(withLowLimit.map((w) => w.status), ["alert"], "projected past the limit: the career alert fires from the first hour");
    assert.deepEqual(forecast(START, START + 2 * HOUR_MS, { ...CONTEXT, missionStartMs: null, settings: lowLimit }), [], "no mission start, no career dose");
  });
});

describe("parseForecastDays", () => {
  it("takes a whole number of days, or the default", () => {
    assert.equal(parseForecastDays(undefined, 14), 14);
    assert.equal(parseForecastDays("45", 14), 45);
  });

  it("refuses anything else", () => {
    for (const bad of ["", "two", "1.5", "-3", "0", String(MAX_FORECAST_DAYS + 1)]) {
      assert.throws(() => parseForecastDays(bad, 14), /--days must be a whole number/, bad);
    }
  });
});
