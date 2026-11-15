// The pure calculations behind the status: radiation dose (including the real 2017 record and the
// simulated storm), coverage, expiry, exercise, noise, the personal baseline and the facts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Food, LatestReading, MealLog, SeriesPoint } from "@heartbeat/shared";
import { readRadiationHours } from "../src/data/bundled-files.ts";
import { ASTRONAUT_1, radiationReadings } from "../src/data/load-bundled.ts";
import type { ReadingStore } from "../src/domain/ports.ts";
import { isReadByRules } from "../src/domain/rule-sources.ts";
import { RULES } from "../src/domain/rules/catalog.ts";
import { evaluateRules } from "../src/domain/rules/engine.ts";
import { DEFAULT_RULE_BOOK } from "../src/domain/rules/rule-book.ts";
import { MAX_READING_AGE_MINUTES, RULE_SETTINGS } from "../src/domain/rules/settings.ts";
import { SIMULATED_READING_SPAN_MS, solarEventProfile, simulatedStormReadings } from "../src/domain/solar-storm.ts";
import { loadStatusInputs, type StatusStores } from "../src/domain/status/astronaut-status.ts";
import { baselineOf, sdsAbove } from "../src/domain/status/baseline.ts";
import { computeFacts, type StatusInputs } from "../src/domain/status/compute-facts.ts";
import { exerciseThresholdBpm } from "../src/domain/exercise-intensity.ts";
import { exerciseMinutes, exerciseMinutesSoFar } from "../src/domain/status/exercise.ts";
import { withoutExpiredReadings } from "../src/domain/status/freshness.ts";
import { equivalentLevelDba, inSleepPeriod } from "../src/domain/status/noise-level.ts";
import { estimatedEnergyRequirement, knownTotal, nutritionDay, nutritionTargets } from "../src/domain/status/nutrition.ts";
import { careerDoseMSv, dailyDoseComparison } from "../src/domain/status/radiation-dose.ts";
import { coversWindow, type TimedValue } from "../src/domain/status/timed-values.ts";
import { facts } from "./support/facts.ts";
import { longestPerNight } from "../src/domain/sleep/nights.ts";
import { sleepDays } from "../src/domain/sleep/sleep-days.ts";
import { DAY_MS, HOUR_MS, MINUTE_MS, utcDayLabel } from "../src/domain/time.ts";

const NOW = Date.parse("2026-11-14T12:00:00Z");
const QUARTER_HOUR = 15 * MINUTE_MS;
/** Readings `stepMs` apart, the last one at `endMs`. */
const spaced = (values: readonly number[], stepMs: number, endMs = NOW): TimedValue[] =>
  values.map((value, i) => ({ tMs: endMs - (values.length - 1 - i) * stepMs, value }));
const hourly = (values: readonly number[], endMs = NOW) => spaced(values, HOUR_MS, endMs);
/** One reading every 15 minutes for 24 hours, the last at NOW. */
const fullDay = (value: (i: number) => number) => spaced(Array.from({ length: 96 }, (_, i) => value(i)), QUARTER_HOUR);
const realRadiation = (): TimedValue[] => readRadiationHours().map((p) => ({ tMs: Date.parse(p.t), value: p.uGyPerHour }));
const inputs = (overrides: Partial<StatusInputs>): StatusInputs => ({
  nowMs: NOW, profile: { age: null, sex: null, massKg: null, heightM: null }, missionStartMs: null, sleepDayTimeZone: "UTC", ship: {}, astronaut: {}, latest: {},
  checkIns: [], meals: [], foods: [], ...overrides,
});
const radiationVerdict = (rates: TimedValue[], nowMs: number) =>
  evaluateRules(RULES, RULE_SETTINGS, computeFacts(inputs({ nowMs, ship: { radiationDoseRate: rates } }), RULE_SETTINGS), "a1");
const radiationStatus = (rates: TimedValue[], nowMs: number) => radiationVerdict(rates, nowMs).areas.find((a) => a.area === "radiation")!.status;

describe("coversWindow (a reading in every slot)", () => {
  it("needs 4 readings spread over an hour of 15-minute slots", () => {
    assert.ok(coversWindow(spaced([1, 1, 1, 1], QUARTER_HOUR), NOW, HOUR_MS, QUARTER_HOUR));
    assert.ok(!coversWindow(spaced([1, 1, 1], QUARTER_HOUR), NOW, HOUR_MS, QUARTER_HOUR));
    assert.ok(!coversWindow(spaced([1, 1, 1, 1], MINUTE_MS), NOW, HOUR_MS, QUARTER_HOUR), "bunched in one slot");
  });

  it("treats each slot as including its end and excluding its start", () => {
    const edges = [NOW - 45 * MINUTE_MS, NOW - 30 * MINUTE_MS, NOW - 15 * MINUTE_MS, NOW].map((tMs) => ({ tMs, value: 1 }));
    assert.ok(coversWindow(edges, NOW, HOUR_MS, QUARTER_HOUR));
    assert.ok(!coversWindow([...edges.slice(1), { tMs: NOW - HOUR_MS, value: 1 }], NOW, HOUR_MS, QUARTER_HOUR), "the window start is outside");
  });
});

describe("dailyDoseComparison", () => {
  it("compares the last 24 hours' dose with the mean daily dose of the 7 days before", () => {
    const rates = hourly([...Array(7 * 24).fill(10), ...Array(24).fill(15)]);
    const comparison = dailyDoseComparison(rates, NOW, HOUR_MS)!;
    assert.equal(comparison.dailyDoseUGy, 360);
    assert.equal(comparison.previousSevenDayAverageUGy, 240);
    assert.equal(comparison.multiple, 1.5);
    assert.equal(comparison.atMs, NOW);
  });

  it("is null when any hour of the 8 days is missing, or a day has no readings", () => {
    assert.ok(dailyDoseComparison(hourly(Array(8 * 24).fill(10)), NOW, HOUR_MS));
    assert.equal(dailyDoseComparison(hourly(Array(8 * 24).fill(10)).filter((_, i) => i !== 100), NOW, HOUR_MS), null);
    assert.equal(dailyDoseComparison(hourly(Array(7 * 24).fill(10)), NOW, HOUR_MS), null);
  });
});

describe("the real ISS record (RadLab DosTel2, 2017), rolling 24 hours", () => {
  const multipleAt = (iso: string) => dailyDoseComparison(realRadiation(), Date.parse(iso), HOUR_MS)!.multiple;

  it("gives the strong 🟡 at the end of Sept 11, 2017: 1.47×", () => {
    const verdict = radiationVerdict(realRadiation(), Date.parse("2017-09-11T23:00:00Z"));
    assert.deepEqual(verdict.evaluations.map((e) => e.ruleId), ["radiation-solar-event-watch"]);
    assert.match(verdict.evaluations[0].message.what, /is 1\.47× the average of the 7 days before \(574 vs\. 390 µGy\)/);
  });

  it("reaches 🔴 for 7 hours, peaking at 1.547× at 2017-09-12T00:00Z", () => {
    const red = realRadiation().filter((p) => radiationStatus(realRadiation(), p.tMs) === "alert").map((p) => new Date(p.tMs).toISOString());
    assert.deepEqual(red, [
      "2017-09-11T16:00:00.000Z", "2017-09-11T18:00:00.000Z", "2017-09-11T19:00:00.000Z", "2017-09-11T20:00:00.000Z",
      "2017-09-11T21:00:00.000Z", "2017-09-11T22:00:00.000Z", "2017-09-12T00:00:00.000Z",
    ]);
    assert.equal(multipleAt("2017-09-12T00:00:00Z").toFixed(3), "1.547");
  });

  it("with the labeled simulated storm (default factor 5) replacing the hours it overlaps, gives 🔴 when it ends", () => {
    const hours = readRadiationHours();
    const played = loopedRadiation(NOW, NOW);
    const storm = simulatedStormReadings(solarEventProfile(hours), 5, NOW).map((r) => ({ tMs: Date.parse(r.takenAt), value: r.value as number }));
    const notReplaced = played.filter((r) => storm.every((s) => Math.abs(s.tMs - r.tMs) >= SIMULATED_READING_SPAN_MS));
    assert.equal(radiationStatus([...notReplaced, ...storm], NOW), "alert");
    assert.equal(radiationStatus(played, NOW), "normal");
  });
});

/** The bundled radiation looping from `startMs`, as the status sees it at `nowMs` (nothing after now). */
function loopedRadiation(startMs: number, nowMs: number): TimedValue[] {
  return radiationReadings(readRadiationHours(), startMs)
    .map((r) => ({ tMs: Date.parse(r.takenAt), value: r.value as number }))
    .filter((r) => r.tMs <= nowMs)
    .sort((a, b) => a.tMs - b.tMs);
}

describe("the radiation recording looping on the mission clock", () => {
  const firstMs = Date.parse(readRadiationHours()[0].t);

  it("has a 24-hour dose and a 7-day baseline at every hour across the seam, from the previous loop", () => {
    for (let hour = -30; hour <= 30; hour++) {
      const at = NOW + hour * HOUR_MS;
      assert.ok(dailyDoseComparison(loopedRadiation(NOW, at), at, HOUR_MS), `no comparison ${hour} h from the start`);
      assert.equal(radiationStatus(loopedRadiation(NOW, at), at), "normal", `${hour} h from the start`);
    }
  });

  it("plays the real Sept 2017 event as 🔴 at its place on the loop, as in the original record", () => {
    const peak = NOW + (Date.parse("2017-09-12T00:00:00Z") - firstMs);
    assert.equal(radiationStatus(loopedRadiation(NOW, peak), peak), "alert");
    assert.equal(dailyDoseComparison(loopedRadiation(NOW, peak), peak, HOUR_MS)!.multiple.toFixed(3), "1.547");
  });
});

describe("career dose", () => {
  it("adds the absorbed dose times the conversion factor to the prior career dose", () => {
    // 10 µGy/h for 100 h = 1 mGy absorbed.
    assert.equal(careerDoseMSv(10, 100, { doseEquivalentPerAbsorbed: 2, priorCareerDoseMSv: 50 }), 52);
  });

  it("counts the mission dose from the mission start, and projects the average daily dose since then over 180 days", () => {
    const missionStartMs = NOW - 9 * DAY_MS;
    const rates = loopedRadiation(NOW, NOW);
    const facts = computeFacts(inputs({ missionStartMs, ship: { radiationDoseRate: rates } }), RULE_SETTINGS);
    const sinceStart = rates.filter((r) => r.tMs >= missionStartMs);
    const meanRate = sinceStart.reduce((sum, r) => sum + r.value, 0) / sinceStart.length;
    const hours = (Math.max(...sinceStart.map((r) => r.tMs)) - missionStartMs) / HOUR_MS;
    assert.ok(Math.abs(facts.radiationCareerDoseMSv!.value - (meanRate * hours / 1000) * 2.26) < 1e-9);
    assert.ok(Math.abs(facts.radiationProjectedCareerFraction!.value - (meanRate * 24 * 180 / 1000) * 2.26 / 600) < 1e-9);
    // About 17 µGy/h × 24 h × 180 days × 2.26 ≈ 170 mSv projected.
    assert.ok(facts.radiationProjectedCareerFraction!.value > 0.25 && facts.radiationProjectedCareerFraction!.value < 0.32);
    assert.equal(computeFacts(inputs({ ship: { radiationDoseRate: rates } }), RULE_SETTINGS).radiationCareerDoseMSv, undefined, "no mission record");
  });
});

describe("exercise minutes", () => {
  it("uses 64% of (220 − age), and none without an age", () => {
    assert.ok(Math.abs(exerciseThresholdBpm(24, RULE_SETTINGS)! - 125.44) < 1e-9);
    assert.equal(exerciseThresholdBpm(null, RULE_SETTINGS), null);
  });

  it("counts minutes whose mean heart rate is at or above the threshold, and no minute without readings", () => {
    const at = (minute: number, second: number, value: number) => ({ tMs: NOW + minute * MINUTE_MS + second * 1000, value });
    const readings = [at(0, 0, 125.44), at(1, 0, 125.43), at(2, 0, 120), at(2, 30, 131), at(3, 0, 140), at(3, 30, 110)];
    assert.equal(exerciseMinutes(readings, 125.44), 2);
    assert.equal(exerciseMinutes([], 125.44), 0);
  });

  it("feeds the gravity rule through computeFacts, with the UTC hour", () => {
    const facts = computeFacts(inputs({ profile: ASTRONAUT_1, astronaut: { heartRate: [{ tMs: NOW - MINUTE_MS, value: 130 }] } }), RULE_SETTINGS);
    assert.deepEqual([facts.exerciseMinutesToday?.value, facts.utcHourOfDay?.value], [1, 12]);
    assert.equal(computeFacts(inputs({}), RULE_SETTINGS).exerciseMinutesToday, undefined, "no age");
    assert.equal(utcDayLabel(Date.parse("2026-11-14T23:59:59Z")), "2026-11-14");
  });
});

describe("noise", () => {
  it("averages by energy, not arithmetic", () => {
    assert.equal(equivalentLevelDba([60, 60]), 60);
    assert.ok(Math.abs(equivalentLevelDba([60, 70])! - 67.4) < 0.01);
    assert.equal(equivalentLevelDba([]), null);
  });

  it("puts 21:30–06:00 UTC in the sleep period", () => {
    const period = { startHourUtc: 21.5, endHourUtc: 6 };
    assert.ok(!inSleepPeriod(Date.parse("2026-11-14T21:29:59Z"), period));
    assert.ok(inSleepPeriod(Date.parse("2026-11-14T21:30:00Z"), period));
    assert.ok(inSleepPeriod(Date.parse("2026-11-14T05:59:59Z"), period));
    assert.ok(!inSleepPeriod(Date.parse("2026-11-14T06:00:00Z"), period));
  });

  it("computes the 24-hour, sleep and awake levels once the day is covered", () => {
    // NOW is 12:00 UTC, so readings from 21:30 to 06:00 the night before are the sleep period.
    const noise = fullDay((i) => (inSleepPeriod(NOW - (95 - i) * QUARTER_HOUR, { startHourUtc: 21.5, endHourUtc: 6 }) ? 40 : 60));
    const facts = computeFacts(inputs({ astronaut: { noise } }), RULE_SETTINGS);
    assert.deepEqual([facts.noiseSleepLevelDba?.value, facts.noiseAwakeLevelDba?.value].map((v) => v?.toFixed(1)), ["40.0", "60.0"]);
    assert.ok(facts.noiseDayLevelDba!.value > 57 && facts.noiseDayLevelDba!.value < 60);
    const gap = noise.filter((_, i) => i !== 50);
    assert.equal(computeFacts(inputs({ astronaut: { noise: gap } }), RULE_SETTINGS).noiseDayLevelDba, undefined, "one empty 15-minute slot");
  });
});

describe("pressure", () => {
  it("reads hPa as kPa and measures the shift from the watch's covered 24-hour average", () => {
    // Readings every 15 minutes up to a minute before the newest, which the average leaves out.
    const pressure = [...spaced(Array(96).fill(1013), QUARTER_HOUR, NOW - MINUTE_MS), { tMs: NOW, value: 979.5 }];
    const facts = computeFacts(inputs({ astronaut: { pressure }, latest: { pressure: { tMs: NOW, value: 979.5 } } }), RULE_SETTINGS);
    assert.equal(facts.pressureKPa?.value, 97.95);
    assert.ok(Math.abs(facts.pressureShiftKPa!.value - 3.35) < 1e-9);
    const exactCadence = spaced(Array(97).fill(1013), QUARTER_HOUR);
    const everyQuarter = computeFacts(inputs({ astronaut: { pressure: exactCadence }, latest: { pressure: { tMs: NOW, value: 1013 } } }), RULE_SETTINGS);
    assert.equal(everyQuarter.pressureShiftKPa?.value, 0, "a reading exactly every 15 minutes covers the 24 hours before the newest");
    const sparse = computeFacts(inputs({ astronaut: { pressure: pressure.slice(-3) }, latest: { pressure: { tMs: NOW, value: 979.5 } } }), RULE_SETTINGS);
    assert.equal(sparse.pressureShiftKPa, undefined);
  });
});

describe("cabin air", () => {
  it("averages CO₂ over the last hour (an hourly mean covers its hour) and the last 7 days", () => {
    const fiveDays = spaced([2, 2, 2, 2, 2], DAY_MS, NOW - HOUR_MS);
    const facts = computeFacts(inputs({ ship: { co2: [...fiveDays, { tMs: NOW, value: 3.2 }] } }), RULE_SETTINGS);
    assert.equal(facts.co2OneHourAverageMmHg?.value, 3.2);
    assert.equal(facts.co2SevenDayAverageMmHg?.value.toFixed(2), "2.20");
  });

  it("needs CO₂ readings on at least 5 of the 7 days for the 7-day average", () => {
    const fourDays = spaced([2, 2, 2, 2], DAY_MS);
    assert.equal(computeFacts(inputs({ ship: { co2: fourDays } }), RULE_SETTINGS).co2SevenDayAverageMmHg, undefined);
  });

  it("checks the 1-hour cabin temperature and humidity against the zone", () => {
    const at = (tempC: number, rhPct: number) => {
      const facts = computeFacts(inputs({ ship: { cabinTemp: hourly([tempC]), humidity: hourly([rhPct]) } }), RULE_SETTINGS);
      return [facts.cabinOutsideZone?.value, facts.cabinBeyondZoneMargin?.value];
    };
    assert.deepEqual(at(22, 50), [false, false]);
    assert.deepEqual(at(22, 80), [true, false]);
    assert.deepEqual(at(29.95, 40), [true, true]);
  });
});

describe("personal baseline (review F002)", () => {
  /** One reading a day for `days` days before NOW, alternating around `center` by `spread`. */
  const history = (days: number, center: number, spread: number) =>
    Array.from({ length: days }, (_, i) => ({ tMs: NOW - (i + 1) * DAY_MS + HOUR_MS, value: center + (i % 2 === 0 ? spread : -spread) }));
  const withBaseline = (metric: "heartRate" | "skinTemp" | "hrv", latestValue: number, center: number, spread: number, days = 8) =>
    computeFacts(inputs({ astronaut: { [metric]: history(days, center, spread) }, latest: { [metric]: { tMs: NOW, value: latestValue } } }), RULE_SETTINGS);

  it("is the mean and sample standard deviation of 14 days of real readings on at least 7 distinct days", () => {
    const baseline = baselineOf(history(8, 60, 5), NOW, NOW, { windowDays: 14, minimumDistinctDays: 7 })!;
    assert.equal(baseline.mean, 60);
    assert.ok(Math.abs(baseline.sd - 5.345) < 0.001);
    assert.ok(Math.abs(sdsAbove(70, baseline) - 1.871) < 0.001);
    assert.equal(baselineOf(history(6, 60, 5), NOW, NOW, { windowDays: 14, minimumDistinctDays: 7 }), null);
  });

  it("ignores readings older than 14 days", () => {
    const old = history(20, 60, 5).filter((r) => r.tMs < NOW - 14 * DAY_MS);
    assert.equal(baselineOf(old, NOW, NOW, { windowDays: 14, minimumDistinctDays: 1 }), null);
  });

  it("heart rate: standard deviations above (negative when below)", () => {
    assert.ok(withBaseline("heartRate", 76, 60, 5).heartRateAboveBaselineSd!.value > 2.9);
    assert.ok(withBaseline("heartRate", 44, 60, 5).heartRateAboveBaselineSd!.value < -2.9);
  });

  it("skin temperature: distance either way", () => {
    assert.ok(Math.abs(withBaseline("skinTemp", 33, 34, 0.5).skinTempAwayFromBaselineSd!.value - 1.871) < 0.001);
    assert.ok(Math.abs(withBaseline("skinTemp", 35, 34, 0.5).skinTempAwayFromBaselineSd!.value - 1.871) < 0.001);
  });

  it("HRV: positive when below baseline, negative when above", () => {
    assert.ok(withBaseline("hrv", 40, 60, 5).hrvBelowBaselineSd!.value > 3);
    assert.ok(withBaseline("hrv", 80, 60, 5).hrvBelowBaselineSd!.value < -3);
  });

  it("has no value before 7 distinct days of real readings", () => {
    assert.equal(withBaseline("hrv", 40, 60, 5, 6).hrvBelowBaselineSd, undefined);
  });
});

describe("check-ins and sleep", () => {
  it("averages mood and stress over the check-ins loaded for the 3-day window", () => {
    const at = new Date(NOW).toISOString();
    const checkIns = [{ id: 1, astronautId: "a1", mood: 2, stress: 4, at }, { id: 2, astronautId: "a1", mood: 3, stress: 5, at }];
    const facts = computeFacts(inputs({ checkIns }), RULE_SETTINGS);
    assert.deepEqual([facts.moodAverage?.value, facts.stressAverage?.value], [2.5, 4.5]);
    assert.equal(computeFacts(inputs({ checkIns: checkIns.slice(1) }), RULE_SETTINGS).moodAverage, undefined, "one check-in is too few");
  });

  it("counts the most recent short nights in a row", () => {
    const sleep = [{ tMs: NOW - 2 * DAY_MS, value: 5 }, { tMs: NOW - DAY_MS, value: 7 }, { tMs: NOW, value: 5.5 }];
    assert.equal(computeFacts(inputs({ astronaut: { sleep } }), RULE_SETTINGS).shortSleepNightsInARow?.value, 1);
  });

  it("reads one sleep reading per night, the longest, so a night recorded twice counts once", () => {
    // Two short readings in the same noon-to-noon night (a nap and the night) are one short night, not two.
    const night = (dayOffset: number, hoursAfterNoon: number, value: number) => ({ tMs: NOW - dayOffset * DAY_MS + hoursAfterNoon * HOUR_MS, value });
    const sleep = [night(2, -4, 5), night(1, -4, 5), night(1, -10, 0.8), night(0, -4, 5.5)];
    assert.equal(computeFacts(inputs({ astronaut: { sleep } }), RULE_SETTINGS).shortSleepNightsInARow?.value, 3);
    assert.deepEqual(longestPerNight(sleep, sleepDays("UTC")).map((n) => n.value), [5.5, 5, 5]);
  });
});

describe("expired readings", () => {
  it("drop heart rate, HRV and pressure after 15 minutes and SpO₂ after 24 hours, and report no recent data", () => {
    const fresh = withoutExpiredReadings(inputs({
      latest: {
        heartRate: { tMs: NOW - 15 * MINUTE_MS, value: 70 },
        spo2: { tMs: NOW - DAY_MS, value: 97 },
        pressure: { tMs: NOW - 15 * MINUTE_MS - 1, value: 1013 },
        hrv: { tMs: NOW - 15 * MINUTE_MS - 1, value: 50 },
      },
    }), MAX_READING_AGE_MINUTES);
    assert.deepEqual(Object.keys(fresh.inputs.latest).sort(), ["heartRate", "spo2"]);
    assert.deepEqual(fresh.noRecentData, ["hrv", "pressure"]);
  });

  it("drop a ship series whose newest reading is more than 2 hours old", () => {
    const fresh = withoutExpiredReadings(inputs({ ship: { co2: hourly([2, 2], NOW - 2 * HOUR_MS - 1), cabinTemp: hourly([22], NOW - 2 * HOUR_MS) } }), MAX_READING_AGE_MINUTES);
    assert.deepEqual(fresh.inputs.ship.co2, []);
    assert.equal(fresh.inputs.ship.cabinTemp?.length, 1);
    assert.deepEqual(fresh.noRecentData, ["co2"]);
  });
});

describe("loadStatusInputs (review F002)", () => {
  /** A store whose series and latest come from fixed rows; filtering the latest is the store's job. */
  function fakeReadings(rows: Record<string, SeriesPoint[]>, latestReadByRules: LatestReading[]): ReadingStore {
    const unused = () => { throw new Error("not used by the status"); };
    return {
      add: unused, upsert: unused, replaceSource: unused, deleteSource: unused, deleteSourceInRanges: unused, latest: unused,
      arrayReadingsOverlapping: unused, arrayReadingsTakenIn: unused, replaceSourceInRange: unused, readingTimesReadByRules: unused,
      series: async (astronautId, metric) => rows[`${astronautId}/${metric}`] ?? [],
      latestReadByRules: async () => latestReadByRules,
    };
  }
  const unused = () => { throw new Error("not used by the status"); };
  const statusStores = (readings: ReadingStore): StatusStores => ({
    readings,
    checkIns: { add: unused, remove: unused, between: async () => [] },
    meals: { add: unused, remove: unused, between: async () => [] },
    foods: { replaceMenu: unused, exists: unused, menu: async () => ({ sources: [], foods: [] }) },
    mission: { saveIfMissing: unused, get: async () => null, updateSleepDayTimeZone: unused, relaySetting: unused, updateRelaySetting: unused },
  });
  const point = (minutesAgo: number, value: number, source: SeriesPoint["source"]): SeriesPoint =>
    ({ t: new Date(NOW - minutesAgo * MINUTE_MS).toISOString(), value, n: 1, source });

  it("keeps the ship's simulated storm readings", async () => {
    const readings = fakeReadings({ "ship/radiationDoseRate": [point(10, 50, "simulated")] }, []);
    const loaded = await loadStatusInputs(statusStores(readings), ASTRONAUT_1, DEFAULT_RULE_BOOK, NOW);
    assert.deepEqual(loaded.ship.radiationDoseRate?.map((r) => r.value), [50]);
  });

  it("never lets a simulated reading into the astronaut's own readings", async () => {
    const readings = fakeReadings({ "a1/heartRate": [point(5, 70, "watch"), point(1, 200, "simulated")] }, []);
    const loaded = await loadStatusInputs(statusStores(readings), ASTRONAUT_1, DEFAULT_RULE_BOOK, NOW);
    assert.deepEqual(loaded.astronaut.heartRate?.map((r) => r.value), [70]);
    assert.deepEqual(loaded.profile, { age: 35, sex: "female", massKg: 66, heightM: 1.68 });
  });

  it("keeps Zepp's nightly HRV out of the HRV baseline, but Zepp heart rate in", async () => {
    const readings = fakeReadings({
      "a1/hrv": [point(600, 40, "wxserver"), point(300, 56, "zepp")],
      "a1/heartRate": [point(600, 60, "zepp"), point(5, 70, "watch")],
    }, []);
    const loaded = await loadStatusInputs(statusStores(readings), ASTRONAUT_1, DEFAULT_RULE_BOOK, NOW);
    assert.deepEqual(loaded.astronaut.hrv?.map((r) => r.value), [40]);
    assert.deepEqual(loaded.astronaut.heartRate?.map((r) => r.value), [60, 70]);
  });
});

describe("rule sources (SPEC §6.7)", () => {
  it("reads every recorded source except Zepp's nightly HRV and SpO₂, and never simulated data", () => {
    assert.equal(isReadByRules("heartRate", "zepp"), true);
    assert.equal(isReadByRules("sleep", "zepp"), true);
    assert.equal(isReadByRules("hrv", "zepp"), false);
    assert.equal(isReadByRules("spo2", "zepp"), false);
    assert.equal(isReadByRules("spo2", "watch"), true);
    assert.equal(isReadByRules("heartRate", "simulated"), false);
  });
});

describe("nutrition", () => {
  const food = (id: string, values: Partial<Food>): Food => ({
    id, name: id, category: "Entrées", foodType: null, serving: "1", kcal: 0, proteinG: 0, calciumMg: 0, vitaminDUg: 0, sodiumMg: 0, ...values,
  });
  const FOODS = [
    food("steak", { kcal: 2000, proteinG: 100, calciumMg: 600, vitaminDUg: 10, sodiumMg: 1000 }),
    food("milk", { kcal: 1500, proteinG: 40, calciumMg: 700, vitaminDUg: 20, sodiumMg: 800 }),
    food("mystery", { kcal: 300, proteinG: 5, calciumMg: null, vitaminDUg: null, sodiumMg: 50 }),
  ];
  const YESTERDAY_NOON = NOW - DAY_MS;
  const meal = (id: number, foodId: string, eatenAtMs: number): MealLog => ({ id, astronautId: "a1", foodId, eatenAt: new Date(eatenAtMs).toISOString() });

  it("gives Astronaut 1 an EER of about 2,409 kcal and a protein target of about 53 g", () => {
    const eer = estimatedEnergyRequirement(ASTRONAUT_1)!;
    assert.equal(eer.toFixed(1), "2409.0");
    const targets = nutritionTargets(ASTRONAUT_1, RULE_SETTINGS);
    assert.equal(targets.proteinG.min!.toFixed(1), "52.8");
    assert.deepEqual([targets.calciumMg, targets.vitaminDUg, targets.sodiumMg], [{ min: 1200, max: 2000 }, { min: 25, max: 50 }, { min: 1500, max: 2300 }]);
    assert.ok(Math.abs(targets.kcal.min! - 0.9 * eer) < 1e-9 && Math.abs(targets.kcal.max! - eer) < 1e-9);
  });

  it("uses the female equation, and has no EER without a full adult profile", () => {
    const female = { age: 30, sex: "female", massKg: 60, heightM: 1.65 } as const;
    assert.equal(estimatedEnergyRequirement(female)!.toFixed(1), String((354 - 6.91 * 30 + 1.25 * (9.36 * 60 + 726 * 1.65)).toFixed(1)));
    assert.equal(estimatedEnergyRequirement({ ...female, sex: null }), null);
    assert.equal(estimatedEnergyRequirement({ ...female, age: 18 }), null);
  });

  it("totals a UTC day's meals, counting a missing value as unknown, not 0", () => {
    const meals = [meal(1, "steak", YESTERDAY_NOON), meal(2, "mystery", YESTERDAY_NOON + HOUR_MS), meal(3, "milk", NOW)];
    const day = nutritionDay(meals, FOODS, NOW - 12 * HOUR_MS - DAY_MS, true);
    assert.equal(day.day, "2026-11-13");
    assert.equal(day.mealsLogged, 2);
    assert.deepEqual(day.totals.calciumMg, { atLeast: 600, unknownMeals: 1 });
    assert.deepEqual(day.totals.kcal, { atLeast: 2300, unknownMeals: 0 });
    assert.equal(knownTotal(day, "calciumMg"), null);
    assert.equal(knownTotal(day, "kcal"), 2300);
  });

  it("rates yesterday only: totals known for every meal, none when no meals were logged", () => {
    const facts = computeFacts(inputs({
      profile: ASTRONAUT_1, foods: FOODS,
      meals: [meal(1, "steak", YESTERDAY_NOON), meal(2, "milk", YESTERDAY_NOON), meal(3, "milk", NOW - HOUR_MS)],
    }), RULE_SETTINGS);
    assert.deepEqual([facts.calciumDayMg?.value, facts.sodiumDayMg?.value, facts.vitaminDDayUg?.value], [1300, 1800, 30]);
    assert.ok(Math.abs(facts.energyDayPctOfEer!.value - (3500 / estimatedEnergyRequirement(ASTRONAUT_1)!) * 100) < 0.01);
    assert.equal(facts.proteinDayPctOfKcal!.value.toFixed(2), String(((140 * 4 * 100) / 3500).toFixed(2)));
    assert.equal(computeFacts(inputs({ profile: ASTRONAUT_1, foods: FOODS, meals: [meal(1, "milk", NOW - HOUR_MS)] }), RULE_SETTINGS).calciumDayMg, undefined);
  });

  it("does not rate a nutrient with an unknown value yesterday", () => {
    const facts = computeFacts(inputs({ foods: FOODS, meals: [meal(1, "steak", YESTERDAY_NOON), meal(2, "mystery", YESTERDAY_NOON)] }), RULE_SETTINGS);
    assert.equal(facts.calciumDayMg, undefined);
    assert.equal(facts.sodiumDayMg?.value, 1050);
  });
});

describe("nutrition: protein minimum and certain lower bounds (owner decisions)", () => {
  const food = (id: string, values: Partial<Food>): Food => ({
    id, name: id, category: "Entrées", foodType: null, serving: "1", kcal: 1000, proteinG: 10, calciumMg: 100, vitaminDUg: 5, sodiumMg: 100, ...values,
  });
  const yesterdayNoon = NOW - DAY_MS;
  const meal = (id: number, foodId: string): MealLog => ({ id, astronautId: "a1", foodId, eatenAt: new Date(yesterdayNoon).toISOString() });
  const factsFor = (foods: Food[], foodIds: string[]) =>
    computeFacts(inputs({ profile: ASTRONAUT_1, foods, meals: foodIds.map((id, i) => meal(i + 1, id)) }), RULE_SETTINGS);

  it("rates protein per kg of body mass against the 0.8 g/kg minimum", () => {
    const facts = factsFor([food("beans", { proteinG: 80 })], ["beans"]);
    assert.ok(Math.abs(facts.proteinDayGPerKg!.value - 80 / 66) < 1e-9);
    assert.ok(Math.abs(facts.proteinMinimumG!.value - 0.8 * 66) < 1e-9);
  });

  it("rates an 'at least' total only when it is already in the top band", () => {
    const salty = food("salty", { sodiumMg: 4000 });
    const unknown = food("unknown", { sodiumMg: null, calciumMg: null, proteinG: null });
    const certain = factsFor([salty, unknown], ["salty", "unknown"]);
    assert.equal(certain.sodiumDayMg?.value, 4000, "at least 4000 mg is above 3500 whatever the unknown meal holds");
    const uncertain = factsFor([food("some", { sodiumMg: 2400 }), unknown], ["some", "unknown"]);
    assert.equal(uncertain.sodiumDayMg, undefined, "at least 2400 mg could still be 🟡 or 🔴");
    assert.equal(uncertain.calciumDayMg, undefined, "a low lower bound is never certain");
  });

  it("rates the protein minimum from an 'at least' amount only when it already meets the minimum", () => {
    const unknown = food("unknown", { proteinG: null });
    assert.ok(factsFor([food("steak", { proteinG: 90 }), unknown], ["steak", "unknown"]).proteinDayGPerKg);
    assert.equal(factsFor([food("toast", { proteinG: 20 }), unknown], ["toast", "unknown"]).proteinDayGPerKg, undefined);
  });

  it("rates the worse of the two protein rules", () => {
    const verdict = evaluateRules(RULES, RULE_SETTINGS, facts({ proteinDayPctOfKcal: 20, proteinDayGPerKg: 0.5, proteinDayG: 52, proteinMinimumG: 83 }), "a1");
    assert.deepEqual(verdict.evaluations.map((e) => e.ruleId), ["nutrition-protein-minimum-watch"]);
    assert.equal(verdict.areas.find((a) => a.area === "nutrition")!.status, "watch");
  });
});

describe("gravity without heart-rate data today (owner decision)", () => {
  it("has no exercise fact, so Gravity is unrated", () => {
    const yesterday = { tMs: NOW - DAY_MS, value: 140 };
    const facts = computeFacts(inputs({ profile: ASTRONAUT_1, astronaut: { heartRate: [yesterday] } }), RULE_SETTINGS);
    assert.equal(facts.exerciseMinutesToday, undefined);
  });

  it("gives the status and the tasks one answer: null without a reading today or an age (review F015)", () => {
    assert.equal(exerciseMinutesSoFar([{ tMs: NOW - DAY_MS, value: 140 }], exerciseThresholdBpm(24, RULE_SETTINGS), NOW), null);
    assert.equal(exerciseMinutesSoFar([{ tMs: NOW - MINUTE_MS, value: 140 }], null, NOW), null);
    assert.equal(exerciseMinutesSoFar([{ tMs: NOW - MINUTE_MS, value: 140 }], exerciseThresholdBpm(24, RULE_SETTINGS), NOW), 1);
  });
});
