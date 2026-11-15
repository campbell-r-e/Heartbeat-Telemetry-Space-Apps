import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AreaLimit } from "@heartbeat/shared";
import { areaLimits, formatLimitValue, limitText } from "./limits";

const source = { requirementId: null, document: "d", ours: false, citations: [] };
const limit = (overrides: Partial<AreaLimit>): AreaLimit => ({ area: "vitals", label: "Blood oxygen, watch below", value: 95, unit: "%", status: "watch", source, ...overrides });

describe("limits in use (composed from the server's label, value and unit)", () => {
  it("shows the label, then the value and unit", () => {
    assert.equal(limitText(limit({})), "Blood oxygen, watch below 95 %");
    assert.equal(limitText(limit({ label: "Daily dose, watch at or above", value: 1.25, unit: "× the previous 7-day average" })), "Daily dose, watch at or above 1.25 × the previous 7-day average");
  });

  it("shows a limit with no single number as its label alone, and a count without a unit", () => {
    assert.equal(limitText(limit({ label: "Temperature and humidity, watch outside NASA's zone", value: undefined, unit: undefined })), "Temperature and humidity, watch outside NASA's zone");
    assert.equal(limitText(limit({ label: "Check-ins needed", value: 2, unit: undefined })), "Check-ins needed 2");
  });

  it("formats values as sent, without trailing zeros", () => {
    assert.equal(formatLimitValue(1000), "1,000");
    assert.equal(formatLimitValue(2.26), "2.26");
    assert.equal(formatLimitValue(3), "3");
  });

  it("lists one area's limits in the server's order, with their status", () => {
    const lines = areaLimits([limit({}), limit({ area: "cabin", label: "CO₂", value: 3, unit: "mmHg", status: "alert" }), limit({ label: "Window", value: 14, unit: "days", status: null })], "vitals");
    assert.deepEqual(lines, [
      { text: "Blood oxygen, watch below 95 %", status: "watch" },
      { text: "Window 14 days", status: null },
    ]);
  });
});
