import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SHIP_ID } from "@heartbeat/shared";
import { METRIC_DISPLAY, formatReadingNumber, indexLatest, isShownMetric, metricOwner, unitText } from "./metrics";

describe("metrics", () => {
  it("store radiation and cabin air under the ship, everything else under the astronaut", () => {
    assert.equal(metricOwner("co2", "a1"), SHIP_ID);
    assert.equal(metricOwner("pressure", "a1"), "a1");
  });

  it("format a latest reading's number, or a dash when there is none", () => {
    const latest = indexLatest([{ metric: "humidity", value: 45.7, unit: "%RH", takenAt: "2026-11-14T00:00:00Z", source: "osdr" }]);
    assert.equal(formatReadingNumber("humidity", latest.get("humidity")), "46");
    assert.equal(formatReadingNumber("spo2", latest.get("spo2")), "—");
    assert.equal(unitText("%RH"), "% RH");
  });

  it("hide the watch's raw wrist angles: never indexed from /latest and given no display", () => {
    const wristAngle = { metric: "wristAngle" as const, value: Array(12).fill(-30), unit: "deg", takenAt: "2026-11-14T00:00:00Z", source: "watch" as const };
    const sleep = { metric: "sleep" as const, value: 7.4, unit: "h", takenAt: "2026-11-14T07:00:00Z", source: "watch" as const };
    const latest = indexLatest([wristAngle, sleep]);
    assert.deepEqual([...latest.keys()], ["sleep"]);
    assert.equal(isShownMetric("wristAngle"), false);
    assert.equal("wristAngle" in METRIC_DISPLAY, false);
  });
});
