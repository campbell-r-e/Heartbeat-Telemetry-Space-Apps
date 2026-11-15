import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Area } from "@heartbeat/shared";
import { findArea } from "./areas";
import { CARD_SECONDARY_COUNT, buildCardModel } from "./cards";
import type { ChartData } from "./chart";
import { indexLatest } from "./metrics";
import type { AreaSnapshot } from "./readouts";
import { MISSION_FIXTURE, evaluationFixture, statusFixture } from "./test-fixtures";

const emptyChart: ChartData = { points: [], unit: "", decimals: 0, reference: null, goal: null, window: null, timeUnit: "time" };
const noStatus: AreaSnapshot = { latest: indexLatest([]), checkIns: [], derived: null, mission: MISSION_FIXTURE, nowMs: Date.parse("2026-11-15T12:00:00Z") };

function area(id: Area) {
  const found = findArea(id);
  if (!found) throw new Error(`No area ${id}`);
  return found;
}

describe("buildCardModel", () => {
  it("is neutral with no status and notes that there are no readings", () => {
    const card = buildCardModel(area("cabin"), noStatus, null, emptyChart);
    assert.equal(card.status, null);
    assert.equal(card.statusReason, null);
    assert.equal(card.note, "No readings yet.");
    assert.equal(card.secondaries.length, CARD_SECONDARY_COUNT);
  });

  it("shows the server's reason under No status (decision 15)", () => {
    const status = statusFixture();
    status.areas = [{ area: "mind", status: null, reason: "Baseline needs more days" }];
    assert.equal(buildCardModel(area("mind"), noStatus, status, emptyChart).statusReason, "Baseline needs more days");
  });

  it("takes status and note from the rules engine, headed by the server's title", () => {
    const evaluation = { ...evaluationFixture("co2-7d", "watch", "2026-11-14T00:00:00Z", "cabin"), title: "CO₂ high this week", message: { what: "CO₂ is high.", why: "", do: "" } };
    const card = buildCardModel(area("cabin"), noStatus, statusFixture({ cabin: "watch" }, [evaluation]), emptyChart);
    assert.equal(card.status, "watch");
    assert.equal(card.note, "CO₂ high this week: CO₂ is high.");
  });

  it("shows the last ECG on the Vitals card (demo step 2)", () => {
    const latest = indexLatest([{ metric: "ecg", value: Array<number>(15_000).fill(0), unit: "mV", takenAt: "2026-11-15T09:04:00Z", source: "watch" }]);
    const card = buildCardModel(area("vitals"), { ...noStatus, latest }, null, emptyChart);
    assert.ok(card.secondaries.includes("ECG · taken 09:04 UTC · 30 s recording"), card.secondaries.join(" | "));
  });
});
