import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readRadiationHours } from "../src/data/bundled-files.ts";
import { amplifyRise, simulatedStormReadings, solarEventProfile } from "../src/domain/solar-storm.ts";

const BASELINE = 6;
const FACTORS = [1, 2, 5, 50];
const REALS = [0, 0.5, 5.999, 6, 6.001, 9, 30];

describe("amplifyRise", () => {
  it("never goes below the real reading and never negative", () => {
    for (const factor of FACTORS) {
      for (const real of REALS) {
        const value = amplifyRise(real, BASELINE, factor);
        assert.ok(value >= real, `factor ${factor}, real ${real}: ${value} < real`);
        assert.ok(value >= 0, `factor ${factor}, real ${real}: ${value} < 0`);
      }
    }
  });

  it("leaves readings at or below baseline unchanged", () => {
    assert.equal(amplifyRise(4, BASELINE, 5), 4);
    assert.equal(amplifyRise(BASELINE, BASELINE, 5), BASELINE);
  });

  it("multiplies only the rise above baseline", () => {
    // 9 = 6 + 3 above baseline; factor 5 adds 3 × 4 more.
    assert.equal(amplifyRise(9, BASELINE, 5), 21);
  });

  it("is the real value at factor 1", () => {
    assert.equal(amplifyRise(9, BASELINE, 1), 9);
  });

  it("is never negative even for a negative input", () => {
    assert.equal(amplifyRise(-1, BASELINE, 5), 0);
  });
});

describe("simulated storm from the bundled 2017 data", () => {
  const profile = solarEventProfile(readRadiationHours());

  it("uses 48 event hours and a positive pre-event baseline", () => {
    assert.equal(profile.hours.length, 48);
    assert.ok(profile.baseline > 0);
  });

  it("is labeled simulated, hourly up to and ending at now, and never below the real hour", () => {
    const now = Date.parse("2030-01-01T00:00:00Z");
    const readings = simulatedStormReadings(profile, 5, now);
    assert.equal(Date.parse(readings.at(-1)!.takenAt), now);
    assert.equal(Date.parse(readings[0].takenAt), now - (readings.length - 1) * 3_600_000);
    readings.forEach((r, i) => {
      assert.equal(r.source, "simulated");
      assert.equal(r.astronautId, "ship");
      assert.equal(Date.parse(r.takenAt), now - (readings.length - 1 - i) * 3_600_000);
      assert.ok(Date.parse(r.takenAt) <= now);
      assert.ok((r.value as number) >= profile.hours[i]);
    });
  });
});
