// Sleep detection from wrist angles (van Hees et al. 2018, HDCZA + sustained inactivity) on
// synthetic angle data that walks through the algorithm's steps. No published per-epoch example
// with expected output exists in the paper, so the expected values come from the steps themselves.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ArrayReading } from "../src/domain/ports.ts";
import { epochGrid, epochsIn, runsWhere } from "../src/domain/sleep/epochs.ts";
import { sleepDays, wakeTimesOf } from "../src/domain/sleep/sleep-days.ts";
import {
  criticalThreshold, detectSptWindow, longBlocksBelow, longestBlock, MAX_MERGED_GAP_EPOCHS, mergeShortGaps, MIN_BLOCK_EPOCHS, percentile,
  rollingMedianAbsoluteChange, ROLLING_WINDOW_EPOCHS, THRESHOLD_RANGE_DEG,
} from "../src/domain/sleep/hdcza.ts";
import { detectSleepPeriod, MIN_WEAR_EPOCHS } from "../src/domain/sleep/sleep-period.ts";
import { epochsInside, MIN_BOUT_EPOCHS, sustainedInactivityBouts } from "../src/domain/sleep/sustained-inactivity.ts";
import { angleDay, at, DAY, dayWithStillPeriods, still, UTC_DAYS } from "./support/wrist-angles.ts";

const EPOCHS_PER_DAY = epochsIn(DAY);
const INDIANA = sleepDays("America/Indiana/Indianapolis");
const HOUR_MS = 3_600_000;
const hoursOf = (day: { startMs: number; endMs: number }) => (day.endMs - day.startMs) / HOUR_MS;
const iso = (ms: number) => new Date(ms).toISOString();

describe("sleep days: noon to noon in the mission's sleep-day time zone", () => {
  it("in UTC (the in-flight setting) run from 12:00 UTC to 12:00 UTC the next day", () => {
    assert.deepEqual(UTC_DAYS.containing(Date.parse("2026-11-11T11:59:59Z")), DAY);
    assert.equal(iso(DAY.startMs), "2026-11-10T12:00:00.000Z");
    assert.equal(iso(DAY.endMs), "2026-11-11T12:00:00.000Z");
    assert.equal(iso(UTC_DAYS.containing(Date.parse("2026-11-11T12:00:00Z")).startMs), "2026-11-11T12:00:00.000Z");
  });

  it("lists the days that have ended, newest first", () => {
    const days = UTC_DAYS.ended(Date.parse("2026-11-12T09:00:00Z"), 2);
    assert.deepEqual(days.map((d) => iso(d.startMs)), ["2026-11-10T12:00:00.000Z", "2026-11-09T12:00:00.000Z"]);
  });

  it("in a local zone run from local noon to local noon, kept in UTC", () => {
    const day = INDIANA.containing(Date.parse("2026-11-11T03:00:00Z")); // 22:00 EST on Nov 10
    assert.deepEqual([iso(day.startMs), iso(day.endMs)], ["2026-11-10T17:00:00.000Z", "2026-11-11T17:00:00.000Z"]);
    assert.equal(iso(INDIANA.containing(Date.parse("2026-11-11T16:59:59Z")).startMs), "2026-11-10T17:00:00.000Z");
    assert.equal(iso(INDIANA.containing(Date.parse("2026-11-11T17:00:00Z")).startMs), "2026-11-11T17:00:00.000Z");
  });

  it("lasts 25 hours over the fall-back change and 23 hours over the spring-forward change", () => {
    const fallBack = INDIANA.containing(Date.parse("2026-11-01T08:00:00Z")); // clocks go back at 02:00 on Nov 1
    assert.deepEqual([iso(fallBack.startMs), iso(fallBack.endMs), hoursOf(fallBack)], ["2026-10-31T16:00:00.000Z", "2026-11-01T17:00:00.000Z", 25]);
    const springForward = INDIANA.containing(Date.parse("2026-03-08T08:00:00Z")); // clocks go forward at 02:00 on Mar 8
    assert.deepEqual([iso(springForward.startMs), iso(springForward.endMs), hoursOf(springForward)], ["2026-03-07T17:00:00.000Z", "2026-03-08T16:00:00.000Z", 23]);
    assert.equal(epochsIn(fallBack), 25 * 720);
    assert.equal(epochsIn(springForward), 23 * 720);
  });

  it("lists ended days back across a daylight-time change without gaps or overlaps", () => {
    const days = INDIANA.ended(Date.parse("2026-11-02T20:00:00Z"), 3);
    assert.deepEqual(days.map((d) => [iso(d.startMs), hoursOf(d)]), [
      ["2026-11-01T17:00:00.000Z", 24], ["2026-10-31T16:00:00.000Z", 25], ["2026-10-30T16:00:00.000Z", 24],
    ]);
    days.slice(1).forEach((day, k) => assert.equal(day.endMs, days[k].startMs));
  });

  it("places value k of a minute at the epoch k × 5 s after its takenAt and leaves unrecorded epochs empty", () => {
    const minute: ArrayReading = { takenAt: "2026-11-10T12:01:00.000Z", values: Array.from({ length: 12 }, (_, k) => k) };
    const grid = epochGrid(DAY, [minute]);
    assert.equal(grid.length, EPOCHS_PER_DAY);
    assert.deepEqual(grid.slice(11, 25), [null, ...minute.values, null]);
  });

  it("leaves out angles outside the day", () => {
    const grid = epochGrid(DAY, [{ takenAt: "2026-11-11T11:59:30.000Z", values: Array(12).fill(1) }]);
    assert.equal(grid.filter((angle) => angle !== null).length, 6);
  });

  it("stamps a night inside (start, end]: a waking time is after the day's start and at most its end", () => {
    assert.deepEqual(wakeTimesOf(DAY), { fromMs: DAY.startMs + 1, toMs: DAY.endMs + 1 });
    assert.deepEqual(UTC_DAYS.ofWake(DAY.endMs), DAY);
    assert.deepEqual(UTC_DAYS.ofWake(DAY.startMs + 1), DAY);
  });

  it("finds the maximal runs where a condition holds", () => {
    assert.deepEqual(runsWhere(6, (i) => i !== 2), [{ start: 0, end: 2 }, { start: 3, end: 6 }]);
  });
});

describe("HDCZA steps 3–5: 5-minute rolling median of absolute angle changes", () => {
  it("is the median of the 59 changes across the 60 epochs starting at each epoch", () => {
    // 30 changes of 1° then 29 of 3°: the median of 59 changes is the 30th smallest, 1°.
    const angles = Array.from({ length: ROLLING_WINDOW_EPOCHS + 1 }, (_, k) => (k <= 30 ? k : 30 + 3 * (k - 30)));
    const changes = rollingMedianAbsoluteChange(angles);
    assert.equal(changes[0], 1);
    assert.equal(changes[1], 3); // changes 1..59 of the series: 29 of 1° and 30 of 3°
    assert.equal(changes[2], null); // the window would run past the end
  });

  it("gives no value where the window holds an epoch with no angle", () => {
    const angles: (number | null)[] = Array(ROLLING_WINDOW_EPOCHS + 1).fill(0);
    angles[ROLLING_WINDOW_EPOCHS] = null;
    assert.deepEqual(rollingMedianAbsoluteChange(angles).slice(0, 2), [0, null]);
  });
});

describe("HDCZA steps 6–7: the critical threshold", () => {
  it("uses R's default percentile (type 7) and the median it implies", () => {
    assert.equal(percentile([4, 1, 3, 2], 10), 1.3); // R: quantile(c(1, 2, 3, 4), 0.1) = 1.3
    assert.equal(percentile([3, 1, 2], 50), 2);
    assert.equal(percentile([4, 1, 3, 2], 50), 2.5);
  });

  it("is the 10th percentile of the day's values × 15, ignoring epochs with no value", () => {
    const changes = [null, ...Array.from({ length: 11 }, (_, k) => k * 0.02), null];
    assert.ok(Math.abs((criticalThreshold(changes) ?? Number.NaN) - 0.3) < 1e-12); // 10th percentile of 0..0.2 is 0.02
    assert.equal(criticalThreshold([null, null]), null);
  });

  it("is kept within 0.13–0.50° (paper p. 4; owner decision)", () => {
    assert.equal(criticalThreshold(Array(10).fill(0)), THRESHOLD_RANGE_DEG.min);
    assert.equal(criticalThreshold(Array(10).fill(20)), THRESHOLD_RANGE_DEG.max);
  });
});

describe("HDCZA step 7: blocks below the threshold lasting longer than 30 minutes", () => {
  const changesWithQuietRun = (quietEpochs: number) => [5, ...Array(quietEpochs).fill(0), 5];

  it("drops a block of exactly 30 minutes and keeps one 5 s longer", () => {
    assert.deepEqual(longBlocksBelow(changesWithQuietRun(MIN_BLOCK_EPOCHS), 1), []);
    assert.deepEqual(longBlocksBelow(changesWithQuietRun(MIN_BLOCK_EPOCHS + 1), 1), [{ start: 1, end: MIN_BLOCK_EPOCHS + 2 }]);
  });

  it("counts only values strictly below the threshold", () => {
    assert.deepEqual(longBlocksBelow(Array(MIN_BLOCK_EPOCHS + 1).fill(1), 1), []);
  });
});

describe("HDCZA steps 8–9: gaps under 60 minutes merged, longest block kept", () => {
  it("merges a gap of 60 minutes less 5 s but not one of exactly 60 minutes", () => {
    const first = { start: 0, end: 400 };
    assert.deepEqual(mergeShortGaps([first, { start: 400 + MAX_MERGED_GAP_EPOCHS - 1, end: 2000 }]), [{ start: 0, end: 2000 }]);
    const apart = [first, { start: 400 + MAX_MERGED_GAP_EPOCHS, end: 2000 }];
    assert.deepEqual(mergeShortGaps(apart), apart);
  });

  it("keeps the longest block, the earlier of two equally long ones, and none of none", () => {
    assert.deepEqual(longestBlock([{ start: 0, end: 10 }, { start: 20, end: 40 }, { start: 50, end: 60 }]), { start: 20, end: 40 });
    assert.deepEqual(longestBlock([{ start: 0, end: 10 }, { start: 20, end: 30 }]), { start: 0, end: 10 });
    assert.equal(longestBlock([]), null);
  });
});

describe("sustained inactivity: no change above 5° for more than 5 minutes", () => {
  const stillRun = (epochs: number) => [90, ...Array.from({ length: epochs }, (_, k) => still(k)), 0];

  it("needs more than 5 minutes: 60 still epochs are not a bout, 61 are", () => {
    assert.deepEqual(sustainedInactivityBouts(stillRun(MIN_BOUT_EPOCHS)), []);
    assert.deepEqual(sustainedInactivityBouts(stillRun(MIN_BOUT_EPOCHS + 1)), [{ start: 1, end: MIN_BOUT_EPOCHS + 2 }]);
  });

  it("allows a change of exactly 5° and splits at a larger one", () => {
    const steps = (change: number) => Array.from({ length: 2 * MIN_BOUT_EPOCHS }, (_, k) => (k < MIN_BOUT_EPOCHS ? 0 : change));
    assert.equal(sustainedInactivityBouts(steps(5)).length, 1);
    assert.deepEqual(sustainedInactivityBouts(steps(5.01)), []);
  });

  it("ends a bout at an epoch with no angle", () => {
    const angles: (number | null)[] = Array(2 * MIN_BOUT_EPOCHS).fill(0);
    angles[MIN_BOUT_EPOCHS] = null;
    assert.deepEqual(sustainedInactivityBouts(angles), []);
  });

  it("counts only the epochs inside the window", () => {
    assert.equal(epochsInside([{ start: 0, end: 10 }, { start: 20, end: 30 }, { start: 40, end: 50 }], { start: 5, end: 25 }), 10);
  });
});

describe("a whole day: SPT-window and time asleep", () => {
  // Night 23:00–07:00 UTC with 40 minutes awake at 03:00, and a 45-minute nap at 15:00.
  const angles = dayWithStillPeriods([3, 3.75], [11, 15], [15 + 40 / 60, 19]);
  const toleranceEpochs = ROLLING_WINDOW_EPOCHS / 2;

  it("finds the night, joining its parts across the 40-minute gap and leaving out the earlier nap", () => {
    const spt = detectSptWindow(angles);
    assert.ok(spt);
    assert.equal(spt.thresholdDeg, THRESHOLD_RANGE_DEG.max); // 10th percentile 0.1° × 15 = 1.5°, kept to 0.50°
    // The rolling window looks 5 minutes ahead, so the block edges move by at most half of it.
    assert.ok(Math.abs(spt.range.start - at(11)) <= toleranceEpochs, `onset epoch ${spt.range.start}`);
    assert.ok(Math.abs(spt.range.end - at(19)) <= toleranceEpochs, `wake epoch ${spt.range.end}`);
  });

  it("counts the still parts of the night as asleep and the 40 minutes awake as not", () => {
    const period = detectSleepPeriod(DAY, angles);
    assert.ok(period);
    assert.ok(Math.abs(period.onsetMs - Date.parse("2026-11-10T23:00:00Z")) <= 3 * 60_000);
    assert.ok(Math.abs(period.wakeMs - Date.parse("2026-11-11T07:00:00Z")) <= 3 * 60_000);
    const stillHours = 4 + (3 + 20 / 60);
    assert.ok(Math.abs(period.asleepHours - stillHours) <= 5 / 60, `asleep ${period.asleepHours} h`);
  });

  it("keeps two night parts apart when the gap is 60 minutes or more, and picks the longer", () => {
    const spt = detectSptWindow(dayWithStillPeriods([11, 13], [14.5, 19]));
    assert.ok(spt);
    assert.ok(Math.abs(spt.range.start - at(14.5)) <= toleranceEpochs);
  });

  it("analyzes a 25-hour fall-back day whole and reports the night in UTC", () => {
    const day = INDIANA.containing(Date.parse("2026-11-01T08:00:00Z"));
    // Still from 23:00 EDT (11 h after noon) to 07:00 EST, 20 elapsed hours after noon: 9 real hours.
    const period = detectSleepPeriod(day, angleDay(day, [11, 20]));
    assert.ok(period);
    assert.ok(Math.abs(period.onsetMs - Date.parse("2026-11-01T03:00:00Z")) <= 3 * 60_000, iso(period.onsetMs));
    assert.ok(Math.abs(period.wakeMs - Date.parse("2026-11-01T12:00:00Z")) <= 3 * 60_000, iso(period.wakeMs));
    assert.ok(Math.abs(period.asleepHours - 9) <= 5 / 60, `asleep ${period.asleepHours} h`);
  });

  it("analyzes a 23-hour spring-forward day with the same 16-hour wear rule", () => {
    const day = INDIANA.containing(Date.parse("2026-03-08T08:00:00Z"));
    // Still from 23:00 EST (11 h after noon) to 07:00 EDT, 18 elapsed hours after noon: 7 real hours.
    const period = detectSleepPeriod(day, angleDay(day, [11, 18]));
    assert.ok(period);
    assert.ok(Math.abs(period.wakeMs - Date.parse("2026-03-08T11:00:00Z")) <= 3 * 60_000, iso(period.wakeMs));
    assert.ok(Math.abs(period.asleepHours - 7) <= 5 / 60, `asleep ${period.asleepHours} h`);
    const wornFor = (epochs: number) => angleDay(day, [11, 18]).map((angle, epoch) => (epoch < epochs ? angle : null));
    assert.equal(detectSleepPeriod(day, wornFor(MIN_WEAR_EPOCHS)), null);
    assert.ok(detectSleepPeriod(day, wornFor(MIN_WEAR_EPOCHS + 1)));
  });

  it("needs more than 16 hours of wear time in the day, the paper's criterion for a night", () => {
    const wornFor = (epochs: number) => angles.map((angle, epoch) => (epoch < epochs ? angle : null));
    assert.equal(detectSleepPeriod(DAY, wornFor(MIN_WEAR_EPOCHS)), null);
    assert.ok(detectSleepPeriod(DAY, wornFor(MIN_WEAR_EPOCHS + 1)));
    assert.equal(detectSleepPeriod(DAY, Array(EPOCHS_PER_DAY).fill(null)), null);
  });

  it("does not turn a restless day into one 24-hour window: the threshold is kept at most 0.50°", () => {
    // Unbounded, 15 × the 10th percentile of a day moving throughout sits above all its movement.
    const restless = dayWithStillPeriods([11, 11.4]);
    const unbounded = percentile(rollingMedianAbsoluteChange(restless).filter((c): c is number => c !== null), 10) * 15;
    assert.ok(unbounded > 50, `unbounded threshold ${unbounded}`);
    assert.equal(detectSptWindow(restless), null);
    assert.equal(detectSleepPeriod(DAY, restless), null);
  });

  it("finds a perfectly still day as one window: a zero threshold is raised to 0.13°, so GGIR's 0.20 substitute never applies", () => {
    const spt = detectSptWindow(Array(EPOCHS_PER_DAY).fill(10));
    assert.ok(spt);
    assert.equal(spt.thresholdDeg, THRESHOLD_RANGE_DEG.min);
    assert.deepEqual(spt.range, { start: 0, end: EPOCHS_PER_DAY - ROLLING_WINDOW_EPOCHS + 1 });
  });
});
