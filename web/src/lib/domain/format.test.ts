import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatAgo, formatCountdown, formatDelay, formatMinutes, formatNumber, formatNumberUpTo, formatUtcClock, formatUtcClockSeconds, formatUtcDateTime } from "./format";

describe("formatNumber", () => {
  it("rounds to the given decimals with thousands separators", () => {
    assert.equal(formatNumber(1620.456, 0), "1,620");
    assert.equal(formatNumber(2.443, 1), "2.4");
    assert.equal(formatNumber(0.5, 2), "0.50");
  });

  it("keeps a value as given up to a number of decimals, without trailing zeros", () => {
    assert.equal(formatNumberUpTo(2.26, 2), "2.26");
    assert.equal(formatNumberUpTo(1000, 2), "1,000");
    assert.equal(formatNumberUpTo(0.125, 2), "0.13");
  });
});

describe("UTC clock formatting", () => {
  it("shows the UTC clock time regardless of the machine's time zone", () => {
    assert.equal(formatUtcClock("2026-11-14T19:05:59.000Z"), "19:05");
    assert.equal(formatUtcDateTime("2026-11-14T03:40:00.000Z"), "Nov 14 · 03:40 UTC");
  });
});

describe("formatMinutes", () => {
  it("uses minutes under an hour, hours and minutes above", () => {
    assert.equal(formatMinutes(20), "20 min");
    assert.equal(formatMinutes(120), "2 h");
    assert.equal(formatMinutes(98.4), "1 h 38 min");
    assert.equal(formatMinutes(-3), "0 min");
  });
});

describe("relay times", () => {
  it("words a one-way delay the way the presets read", () => {
    assert.deepEqual([0, 1300, 10_000, 30_000, 180_000, 1_320_000, 185_000].map(formatDelay), ["0 s", "1.3 s", "10 s", "30 s", "3 min", "22 min", "3 min 5 s"]);
  });

  it("counts down as m:ss, rounding up and stopping at 0:00", () => {
    assert.deepEqual([161_000, 160_001, 999, 0, -5].map(formatCountdown), ["2:41", "2:41", "0:01", "0:00", "0:00"]);
  });

  it("says roughly how long ago", () => {
    assert.deepEqual([30_000, 120_000, 3 * 3_600_000, 2 * 86_400_000].map(formatAgo), ["30 s ago", "2 min ago", "3 h ago", "2 d ago"]);
  });

  it("shows seconds in UTC", () => {
    assert.equal(formatUtcClockSeconds("2026-11-14T19:05:59.000Z"), "19:05:59");
  });
});
