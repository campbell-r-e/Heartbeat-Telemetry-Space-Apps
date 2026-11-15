import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hrvWindows, liveBatchSamples, liveBatchWindows, rmssd, validIntervals, windowKey, type IbiSample,
} from "../src/domain/hrv.ts";

const STEADY = 1000;
const SPIKE = 1500;

/** `count` intervals around 1 s with spikes at `spikeAt`; each spike breaks the pairs it touches. */
function intervals(count: number, spikeAt: readonly number[] = []): number[] {
  return Array.from({ length: count }, (_, i) => (spikeAt.includes(i) ? SPIKE : STEADY + (i % 2) * 10));
}

const sample = (t: string, ibisMs: number[], statuses: number[] = []): IbiSample => ({ t, ibisMs, statuses });

describe("validIntervals", () => {
  it("keeps 300 and 2000 ms and drops anything outside", () => {
    assert.deepEqual(validIntervals([299, 300, 2000, 2001], []), [300, 2000]);
  });

  it("drops intervals the watch flags invalid and treats a missing status as valid", () => {
    assert.deepEqual(validIntervals([800, 900, 1000], [0, 1]), [800, 1000]);
  });
});

describe("rmssd", () => {
  it("is the root mean square of successive differences, to one decimal", () => {
    assert.deepEqual(rmssd([1000, 1010, 1000]), { rmssdMs: 10, pairs: 2 });
    assert.deepEqual(rmssd([1000, 1003, 1000]), { rmssdMs: 3, pairs: 2 });
  });

  it("keeps a pair exactly 20% apart and skips one just over", () => {
    assert.equal(rmssd([1000, 1200])?.pairs, 1);
    assert.equal(rmssd([1000, 800])?.pairs, 1);
    assert.equal(rmssd([1000, 1201]), null);
  });

  it("measures the 20% against the earlier interval", () => {
    // 199 ms is 19.9% of the earlier 1000 ms (kept) but 24.8% of the later 801 ms.
    assert.equal(rmssd([1000, 801])?.pairs, 1);
  });

  it("is null when no pair is usable", () => {
    assert.equal(rmssd([1000]), null);
    assert.equal(rmssd([]), null);
  });
});

describe("windowKey", () => {
  it("is the start of the 5-minute UTC window", () => {
    assert.equal(windowKey("2026-11-14T12:07:30.500Z"), "2026-11-14T12:05:00.000Z");
    assert.equal(windowKey("2026-11-14T12:04:59.999Z"), "2026-11-14T12:00:00.000Z");
    assert.equal(windowKey("2026-11-14T12:05:00.000Z"), "2026-11-14T12:05:00.000Z");
  });
});

describe("hrvWindows", () => {
  const T = "2026-11-14T12:00:00.000Z";

  it("keeps a window with exactly 30 intervals and drops one with 29", () => {
    assert.equal(hrvWindows([sample(T, intervals(30))]).length, 1);
    assert.equal(hrvWindows([sample(T, intervals(29))]).length, 0);
  });

  it("keeps a window with exactly 20 usable pairs and drops one with 19", () => {
    const twentyPairs = intervals(30, [0, 5, 10, 15, 20]); // 29 pairs - 1 - 4 × 2
    const nineteenPairs = intervals(30, [0, 5, 10, 15, 20, 29]);
    assert.equal(rmssd(twentyPairs)?.pairs, 20);
    assert.equal(rmssd(nineteenPairs)?.pairs, 19);
    assert.deepEqual(hrvWindows([sample(T, twentyPairs)]).map((w) => [w.beats, w.pairs]), [[30, 20]]);
    assert.equal(hrvWindows([sample(T, nineteenPairs)]).length, 0);
  });

  it("counts only valid intervals toward the 30", () => {
    const withInvalid = [...intervals(29), 2500];
    assert.equal(hrvWindows([sample(T, withInvalid)]).length, 0);
  });

  it("pools samples into their 5-minute window, in the order first seen", () => {
    const windows = hrvWindows([
      sample("2026-11-14T12:00:10Z", intervals(15)),
      sample("2026-11-14T12:04:50Z", intervals(15)),
      sample("2026-11-14T12:05:00Z", intervals(30)),
    ]);
    assert.deepEqual(windows.map((w) => [w.t, w.beats]), [
      ["2026-11-14T12:00:00.000Z", 30],
      ["2026-11-14T12:05:00.000Z", 30],
    ]);
  });

  it("emits t, rmssdMs, beats and pairs in that order, as the bundled file stores them", () => {
    assert.deepEqual(Object.keys(hrvWindows([sample(T, intervals(30))])[0]), ["t", "rmssdMs", "beats", "pairs"]);
  });
});

describe("liveBatchSamples", () => {
  it("gives each beat its own time and splits a batch at a 5-minute boundary", () => {
    // The first beat is 2 s before the boundary; the second is at 12:04:59.5; the third is past it.
    const samples = liveBatchSamples("2026-11-14T12:04:58.000Z", [1500, 600, 900]);
    assert.deepEqual(samples, [
      { t: "2026-11-14T12:04:58.000Z", ibisMs: [1500, 600], statuses: [] },
      { t: "2026-11-14T12:05:00.100Z", ibisMs: [900], statuses: [] },
    ]);
    assert.deepEqual(liveBatchWindows("2026-11-14T12:04:58.000Z", [1500, 600, 900]), [
      "2026-11-14T12:00:00.000Z", "2026-11-14T12:05:00.000Z",
    ]);
  });

  it("keeps a batch inside one window whole", () => {
    assert.deepEqual(liveBatchSamples("2026-11-14T12:01:00Z", [800, 810]).map((s) => s.ibisMs), [[800, 810]]);
  });
});
