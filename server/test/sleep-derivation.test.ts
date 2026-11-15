// The live sleep use case and its hourly job, against an in-memory store: one reading per night,
// replaced atomically; the Galaxy Watch's night wins over Zepp's; one astronaut's failure does
// not stop the others; and a failed run is reported, never thrown.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import type { Astronaut, Mission, ReadingSource } from "@heartbeat/shared";
import { deriveDaySleep, deriveRecentSleep } from "../src/domain/derive-sleep.ts";
import { DEFAULT_MISSION } from "../src/domain/mission.ts";
import type { ArrayReading, AstronautStore, MetricRange, MissionStore, ReadingStore, StoredReading } from "../src/domain/ports.ts";
import { sleepDays, wakeTimesOf } from "../src/domain/sleep/sleep-days.ts";
import { createSleepDerivationJob, SLEEP_DERIVATION_INTERVAL_MS, type SleepDerivationJobDeps } from "../src/jobs/sleep-derivation-job.ts";
import { angleDay, DAY, minutesOf, nightOfEightHours, UTC_DAYS } from "./support/wrist-angles.ts";

const AFTER_DAY_ENDS = DAY.endMs + 60 * 60_000;

interface Replacement { source: ReadingSource; range: MetricRange; readings: StoredReading[] }

/** A readings store holding each astronaut's wristAngle minutes; it records what derivation writes. */
function fakeReadings(minutesByAstronaut: Record<string, ArrayReading[]>, broken: ReadonlySet<string> = new Set()) {
  const replaced: Replacement[] = [];
  const deleted: Array<{ source: ReadingSource; ranges: MetricRange[] }> = [];
  const unused = () => { throw new Error("not used by sleep derivation"); };
  const store: ReadingStore = {
    add: unused, upsert: unused, replaceSource: unused, deleteSource: unused, series: unused, latest: unused,
    arrayReadingsOverlapping: unused, readingTimesReadByRules: unused, latestReadByRules: unused,
    async arrayReadingsTakenIn(_source, range) {
      if (broken.has(range.astronautId)) throw new Error(`storage failed for ${range.astronautId}`);
      return (minutesByAstronaut[range.astronautId] ?? []).filter((m) => Date.parse(m.takenAt) >= range.fromMs && Date.parse(m.takenAt) < range.toMs);
    },
    async replaceSourceInRange(source, range, readings) { replaced.push({ source, range, readings: [...readings] }); },
    async deleteSourceInRanges(source, ranges) { deleted.push({ source, ranges: [...ranges] }); return 0; },
  };
  return { store, replaced, deleted };
}

const noFailureExpected = (error: unknown) => assert.fail(`unexpected failure: ${String(error)}`);

/** The mission settings record with the given sleep-day time zone. */
const missionIn = (sleepDayTimeZone: string): MissionStore => {
  const unused = () => { throw new Error("not used by sleep derivation"); };
  const mission: Mission = { ...DEFAULT_MISSION, sleepDayTimeZone };
  return { get: async () => mission, saveIfMissing: unused, updateSleepDayTimeZone: unused, relaySetting: unused, updateRelaySetting: unused };
};
const UTC_MISSION = missionIn("UTC");

const crew = (...ids: string[]): AstronautStore => {
  const astronauts: Astronaut[] = ids.map((id) => ({ id, name: id, watchId: null, age: null, sex: null, massKg: null, heightM: null }));
  const unused = () => { throw new Error("not used by sleep derivation"); };
  return { list: async () => astronauts, find: unused, exists: unused, upsert: unused, hasHistory: unused, addToCrew: unused, remove: unused, assignWatch: unused };
};

describe("deriveDaySleep", () => {
  it("replaces the day's watch night in one step with hours asleep, stamped at waking", async () => {
    const { store, replaced } = fakeReadings({ a1: minutesOf(DAY, nightOfEightHours()) });
    const sleep = await deriveDaySleep(store, "a1", DAY);
    assert.ok(sleep);
    assert.deepEqual(replaced, [{ source: "watch", range: { astronautId: "a1", metric: "sleep", ...wakeTimesOf(DAY) }, readings: [sleep] }]);
    assert.deepEqual([sleep.metric, sleep.unit, sleep.source], ["sleep", "h", "watch"]);
    assert.ok(Math.abs(Date.parse(sleep.takenAt) - Date.parse("2026-11-11T07:00:00Z")) <= 3 * 60_000);
    assert.ok(Math.abs((sleep.value as number) - 8) <= 5 / 60);
  });

  it("removes a Zepp night in the same day: the Galaxy Watch wins", async () => {
    const { store, deleted } = fakeReadings({ a1: minutesOf(DAY, nightOfEightHours()) });
    await deriveDaySleep(store, "a1", DAY);
    assert.deepEqual(deleted, [{ source: "zepp", ranges: [{ astronautId: "a1", metric: "sleep", ...wakeTimesOf(DAY) }] }]);
  });

  it("clears the day's watch night and leaves Zepp alone when no sleep period is found", async () => {
    const { store, replaced, deleted } = fakeReadings({});
    assert.equal(await deriveDaySleep(store, "a1", DAY), null);
    assert.deepEqual(replaced.map((r) => r.readings), [[]]);
    assert.deepEqual(deleted.flatMap((d) => d.ranges), []);
  });
});

describe("deriveRecentSleep", () => {
  it("derives every astronaut on its own: one failure is returned by id and the others still get their nights", async () => {
    const { store, replaced } = fakeReadings({ a1: minutesOf(DAY, nightOfEightHours()) }, new Set(["broken"]));
    const failures = await deriveRecentSleep({ astronauts: crew("broken", "a1"), readings: store, mission: UTC_MISSION }, AFTER_DAY_ENDS);
    assert.deepEqual(failures.map((f) => f.astronautId), ["broken"]);
    assert.match(String(failures[0].error), /storage failed for broken/);
    assert.equal(replaced.filter((r) => r.range.astronautId === "a1" && r.readings.length === 1).length, 1);
  });
});

describe("deriveRecentSleep in the mission's sleep-day time zone", () => {
  it("analyzes the zone's noon-to-noon days and stamps the night in UTC", async () => {
    const indiana = sleepDays("America/Indiana/Indianapolis");
    const day = indiana.containing(Date.parse("2026-11-11T03:00:00Z")); // 17:00 UTC to 17:00 UTC
    const { store, replaced } = fakeReadings({ a1: minutesOf(day, angleDay(day, [11, 19])) });
    const failures = await deriveRecentSleep({ astronauts: crew("a1"), readings: store, mission: missionIn("America/Indiana/Indianapolis") }, day.endMs + 60_000);
    assert.deepEqual(failures, []);
    const night = replaced.find((r) => r.readings.length === 1);
    assert.ok(night);
    assert.deepEqual(night.range, { astronautId: "a1", metric: "sleep", ...wakeTimesOf(day) });
    // Still 23:00–07:00 EST, so waking is near 12:00 UTC; the reading is stored in UTC.
    assert.match(night.readings[0].takenAt, /^2026-11-11T1[12]:\d\d:\d\d\.\d{3}Z$/);
  });

  it("keeps no watch night in the day still running, which also clears one stamped under an earlier zone", async () => {
    const nowMs = DAY.endMs + 60_000;
    const { store, replaced } = fakeReadings({});
    await deriveRecentSleep({ astronauts: crew("a1"), readings: store, mission: UTC_MISSION }, nowMs);
    const running = UTC_DAYS.containing(nowMs);
    assert.deepEqual(replaced.at(-1), { source: "watch", range: { astronautId: "a1", metric: "sleep", ...wakeTimesOf(running) }, readings: [] });
  });
});

describe("the sleep derivation job (start-up, hourly, and on demand)", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setInterval"] }));
  afterEach(() => mock.timers.reset());

  const jobDeps = (stores: SleepDerivationJobDeps["stores"], overrides: Partial<SleepDerivationJobDeps> = {}): SleepDerivationJobDeps =>
    ({ stores, now: () => AFTER_DAY_ENDS, onAstronautFailed: noFailureExpected, onError: noFailureExpected, ...overrides });

  it("derives at start, then every hour", async () => {
    const { store, replaced } = fakeReadings({ a1: minutesOf(DAY, nightOfEightHours()) });
    const job = createSleepDerivationJob(jobDeps({ astronauts: crew("a1"), readings: store, mission: UTC_MISSION }));
    await job.start();
    const runs = () => replaced.filter((r) => r.readings.length === 1).length;
    assert.equal(runs(), 1);
    mock.timers.tick(SLEEP_DERIVATION_INTERVAL_MS);
    await job.stop();
    assert.equal(runs(), 2);
  });

  it("reports a failed run instead of throwing, at start and on a tick, and keeps running", async () => {
    const errors: unknown[] = [];
    let listCalls = 0;
    const astronauts: AstronautStore = { ...crew(), list: async () => { listCalls++; throw new Error("database restarting"); } };
    const job = createSleepDerivationJob(jobDeps({ astronauts, readings: fakeReadings({}).store, mission: UTC_MISSION }, { onError: (e) => errors.push(e) }));
    await job.start();
    mock.timers.tick(SLEEP_DERIVATION_INTERVAL_MS);
    await job.stop();
    assert.equal(listCalls, 2);
    assert.equal(errors.length, 2);
  });

  it("reports each astronaut whose nights could not be derived", async () => {
    const failed: string[] = [];
    const { store } = fakeReadings({}, new Set(["broken"]));
    const job = createSleepDerivationJob(jobDeps({ astronauts: crew("broken"), readings: store, mission: UTC_MISSION }, { onAstronautFailed: (id) => failed.push(id) }));
    await job.runNow();
    assert.deepEqual(failed, ["broken"]);
  });

  it("runs on demand only after the run in progress, so a zone change during a run ends with the new zone's nights", async () => {
    let zone = "UTC";
    const mission: MissionStore = { ...UTC_MISSION, get: async () => ({ ...DEFAULT_MISSION, sleepDayTimeZone: zone }) };
    const { store, replaced } = fakeReadings({ a1: minutesOf(DAY, nightOfEightHours()) });
    let release = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    let readStarted = () => {};
    const hourlyIsReading = new Promise<void>((resolve) => { readStarted = resolve; });
    const readMinutes = store.arrayReadingsTakenIn;
    let reads = 0;
    store.arrayReadingsTakenIn = async (source, range) => {
      if (reads++ === 0) {
        readStarted();
        await held; // the hourly run is still reading when the zone changes
      }
      return readMinutes(source, range);
    };
    const job = createSleepDerivationJob(jobDeps({ astronauts: crew("a1"), readings: store, mission }));

    const hourly = job.runNow();
    await hourlyIsReading;
    zone = "America/Indiana/Indianapolis";
    const afterZoneChange = job.runNow();
    release();
    await Promise.all([hourly, afterZoneChange]);

    const indianaRunning = sleepDays(zone).containing(AFTER_DAY_ENDS);
    const lastWrite = replaced.at(-1);
    assert.deepEqual(lastWrite?.range, { astronautId: "a1", metric: "sleep", ...wakeTimesOf(indianaRunning) });
    const firstIndianaWrite = replaced.findIndex((r) => r.range.fromMs === wakeTimesOf(sleepDays(zone).ended(AFTER_DAY_ENDS, 1)[0]).fromMs);
    const utcRunningFrom = wakeTimesOf(UTC_DAYS.containing(AFTER_DAY_ENDS)).fromMs;
    const lastUtcWrite = replaced.reduce((last, r, i) => (r.range.fromMs === utcRunningFrom ? i : last), -1);
    assert.ok(lastUtcWrite >= 0 && firstIndianaWrite > lastUtcWrite, "every write of the run in the old zone comes before the run in the new zone");
  });
});
