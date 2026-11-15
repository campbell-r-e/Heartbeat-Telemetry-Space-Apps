import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEMO_STORM_STEPS } from "@heartbeat/shared";
import { NO_STORM, nextStormStep, parseExpectedFactor, parseStormStep, stepOfFactor, stormControl, STORM_STEPS } from "./storm";

const loaded = (active: boolean, factor: number | null) => ({ ok: true as const, value: { active, factor, startedAt: null } });

describe("the console's storm control (two presses, then clear)", () => {
  it("has the watch step first, then the alert step", () => {
    assert.deepEqual(STORM_STEPS, ["watch", "alert"]);
  });

  it("starts at ▲ watch when no storm is stored, with nothing to clear", () => {
    const model = stormControl(loaded(false, null));
    assert.deepEqual(model, { state: "No simulated storm", nextStep: "watch", pressLabel: "Start storm (Radiation ▲ watch)", canClear: false, expected: NO_STORM });
  });

  it("escalates to ■ alert after the first press", () => {
    const model = stormControl(loaded(true, DEMO_STORM_STEPS.watch));
    assert.equal(model.nextStep, "alert");
    assert.equal(model.pressLabel, "Escalate storm (Radiation ■ alert)");
    assert.equal(model.state, `Simulated storm, step 1 of 2 (factor ${DEMO_STORM_STEPS.watch})`);
    assert.equal(model.canClear, true);
  });

  it("has no further step at ■ alert; only clearing is left", () => {
    const model = stormControl(loaded(true, DEMO_STORM_STEPS.alert));
    assert.deepEqual([model.nextStep, model.pressLabel, model.canClear], [null, "Storm at its peak (■ alert)", true]);
    assert.equal(model.state, `Simulated storm, step 2 of 2 (factor ${DEMO_STORM_STEPS.alert})`);
  });

  it("treats a storm started some other way by the highest step its factor reaches", () => {
    assert.equal(stepOfFactor(1), null);
    assert.equal(stepOfFactor(DEMO_STORM_STEPS.watch), "watch");
    assert.equal(stepOfFactor(2), "watch");
    assert.equal(stepOfFactor(50), "alert");
    assert.equal(stormControl(loaded(true, 1)).nextStep, "watch");
    assert.equal(stormControl(loaded(true, null)).state, "Simulated storm active");
  });

  it("offers no press when the state cannot be loaded, but still offers to clear", () => {
    const model = stormControl({ ok: false, problem: "server down" });
    assert.deepEqual([model.nextStep, model.canClear], [null, true]);
    assert.match(model.state, /unavailable: server down/);
  });

  it("orders the steps and reads them from a form", () => {
    assert.deepEqual([nextStormStep(null), nextStormStep("watch"), nextStormStep("alert")], ["watch", "alert", null]);
    assert.deepEqual([parseStormStep("watch"), parseStormStep("alert"), parseStormStep("boom"), parseStormStep(null)], ["watch", "alert", null, null]);
  });

  it("sends the storm the view shows, so the server can refuse an out-of-date press", () => {
    assert.equal(stormControl(loaded(true, DEMO_STORM_STEPS.watch)).expected, String(DEMO_STORM_STEPS.watch));
    assert.equal(stormControl(loaded(true, null)).expected, null, "a factor that could not be read back sends no expectation");
    assert.equal(stormControl({ ok: false, problem: "server down" }).expected, null);
  });

  it("reads the expected storm back from the form", () => {
    assert.deepEqual(
      [parseExpectedFactor(NO_STORM), parseExpectedFactor("1.3"), parseExpectedFactor(null), parseExpectedFactor("soon"), parseExpectedFactor("")],
      [null, 1.3, undefined, "invalid", "invalid"],
    );
  });
});
