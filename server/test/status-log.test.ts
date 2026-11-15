import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AstronautStatus, Evaluation } from "@heartbeat/shared";
import { statesToStore, statusChanges, subjectStates } from "../src/domain/status/status-log.ts";

const AT = "2026-11-14T12:00:00.000Z";
const areas = (radiation: AstronautStatus["areas"][number]["status"]) =>
  (["vitals", "radiation", "gravity", "cabin", "nutrition", "mind"] as const).map((area) =>
    ({ area, status: area === "radiation" ? radiation : null, reason: null }));
const spike: Evaluation = {
  astronautId: "a1", ruleId: "radiation-solar-event-alert", title: "Radiation dose spike", area: "radiation", hazard: "radiation",
  metrics: ["radiationDoseRate"], layer: "standard", status: "alert", message: { what: "w", why: "y", do: "d" },
  source: { requirementId: "[V1 4031]", document: "doc", ours: true, citations: [] }, crewWide: true, at: AT,
};
const status = (radiation: "normal" | "alert", evaluations: Evaluation[]) =>
  ({ astronautId: "a1", at: AT, areas: areas(radiation), evaluations }) as unknown as AstronautStatus;

describe("the alert log", () => {
  it("logs an area's first status and a rule's first firing, from no status and from normal", () => {
    const changes = statusChanges("a1", AT, new Map(), subjectStates(status("alert", [spike])));
    const radiation = changes.filter((c) => c.subject.kind === "area" ? c.subject.area === "radiation" : true);
    assert.deepEqual(radiation.map((c) => [c.subject.kind, c.from, c.to, c.title]), [
      ["area", null, "alert", "Radiation: alert"],
      ["rule", "normal", "alert", "Radiation dose spike"],
    ]);
    assert.deepEqual(radiation[1].message, spike.message);
  });

  it("logs nothing when nothing changed", () => {
    const current = subjectStates(status("alert", [spike]));
    assert.deepEqual(statusChanges("a1", AT, statesToStore(current), current), []);
  });

  it("logs a rule that stopped firing as cleared, back to normal", () => {
    const before = statesToStore(subjectStates(status("alert", [spike])));
    const changes = statusChanges("a1", AT, before, subjectStates(status("normal", [])));
    assert.deepEqual(changes.map((c) => [c.subject.kind, c.from, c.to, c.title]), [
      ["area", "alert", "normal", "Radiation: normal"],
      ["rule", "alert", "normal", "Radiation dose spike: cleared"],
    ]);
  });
});
