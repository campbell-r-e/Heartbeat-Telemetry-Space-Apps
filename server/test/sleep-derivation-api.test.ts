// Live sleep end to end against a throwaway Postgres container (see support/throwaway-postgres.ts):
// wristAngle minutes are accepted and stored, sleep cannot be posted, the derivation turns a stored
// day of minutes into one sleep reading, Zepp keeps its other nights, and the Mind rule's
// short-sleep fact reads the derived nights.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import type { Astronaut, Reading } from "@heartbeat/shared";
import { readRadiationHours } from "../src/data/bundled-files.ts";
import { createSchema, postgresStores } from "../src/db/index.ts";
import { deriveRecentSleep } from "../src/domain/derive-sleep.ts";
import type { Stores } from "../src/domain/ports.ts";
import { DEFAULT_RULE_BOOK } from "../src/domain/rules/rule-book.ts";
import { DEFAULT_MISSION } from "../src/domain/mission.ts";
import { EPOCHS_PER_MINUTE } from "../src/domain/sleep/epochs.ts";
import { sleepDays, type AnalysisDay } from "../src/domain/sleep/sleep-days.ts";
import { solarEventProfile } from "../src/domain/solar-storm.ts";
import { loadStatusInputs } from "../src/domain/status/astronaut-status.ts";
import { computeFacts } from "../src/domain/status/compute-facts.ts";
import { DAY_MS, HOUR_MS } from "../src/domain/time.ts";
import { buildApp } from "../src/http/app.ts";
import { testRelay, type TestRelay } from "./support/relay.ts";
import { testStatusEvaluator } from "./support/status-evaluator.ts";
import { testSleepDerivation, type TestSleepDerivation } from "./support/sleep-job.ts";
import { startThrowawayPostgres, type ThrowawayPostgres } from "./support/throwaway-postgres.ts";
import { angleDay, DAY, dayWithStillPeriods, nightOfEightHours, UTC_DAYS, wristAngleReadings } from "./support/wrist-angles.ts";

const TOKEN = "test-token";
const AUTH = { authorization: `Bearer ${TOKEN}` };
const AFTER_DAY_ENDS = DAY.endMs + HOUR_MS;

let db: ThrowawayPostgres;
let stores: Stores;
let app: FastifyInstance;
let relay: TestRelay;
let sleepJob: TestSleepDerivation;
/** The app's clock: real time unless a test sets a fixed time. */
let fixedNowMs: number | null = null;
const appNow = () => fixedNowMs ?? Date.now();

const astronaut = (id: string): Astronaut => ({ id, name: id, watchId: null, age: null, sex: null, massKg: null, heightM: null });

before(async () => {
  db = await startThrowawayPostgres();
  await createSchema(db.pool);
  stores = postgresStores(db.pool);
  for (const id of ["a1", "open-day", "zepp-wearer", "short-sleeper", "earth-tester"]) await stores.astronauts.upsert(astronaut(id));
  await stores.mission.saveIfMissing(DEFAULT_MISSION);
  relay = testRelay(stores, Date.now);
  sleepJob = testSleepDerivation(stores, appNow);
  app = await buildApp(
    { stores, token: TOKEN, solarEvent: solarEventProfile(readRadiationHours()), ruleBook: DEFAULT_RULE_BOOK, now: appNow, ...relay.deps, statusEvaluator: testStatusEvaluator(stores, appNow, relay), sleepDerivation: sleepJob.job },
    { logger: false },
  );
});

after(async () => {
  await relay?.system.stop();
  relay?.deps.live.close();
  await app?.close();
  await db?.stop();
});

const postReadings = (readings: Reading[]) => app.inject({ method: "POST", url: "/api/readings", headers: AUTH, payload: { readings } });

const sleepRows = async (astronautId: string) =>
  (await db.pool.query<{ value: number; taken_ms: string; source: string }>(
    "SELECT value, taken_ms, source FROM readings WHERE astronaut_id = $1 AND metric = 'sleep' ORDER BY taken_ms", [astronautId],
  )).rows.map((row) => ({ value: row.value, takenMs: Number(row.taken_ms), source: row.source }));

const zeppNight = (astronautId: string, wakeAt: string, hours: number): Reading =>
  ({ astronautId, metric: "sleep", value: hours, unit: "h", takenAt: wakeAt, source: "zepp" });

describe("POST /api/readings with wrist angles", () => {
  it("accepts a wristAngle minute and refuses sleep, which the server derives", async () => {
    const [minute] = wristAngleReadings("a1", UTC_DAYS.containing(Date.now()), Array(EPOCHS_PER_MINUTE).fill(-30));
    const accepted = await postReadings([{ ...minute, takenAt: new Date(Date.now() - 60_000).toISOString() }]);
    assert.equal(accepted.statusCode, 200);
    assert.deepEqual(accepted.json(), { accepted: 1, duplicates: 0 });

    const refused = await postReadings([{ ...minute, metric: "sleep", value: 7.5, unit: "h" }]);
    assert.equal(refused.statusCode, 400);
    assert.equal(refused.json().error, "server_derived_metric");
    assert.match(refused.json().message, /send wristAngle instead/);
  });
});

describe("arrayReadingsTakenIn", () => {
  it("returns the minutes taken in [from, to), whatever their angles add up to", async () => {
    const day = UTC_DAYS.containing(Date.parse("2026-10-01T12:00:00Z"));
    const minute = (offsetMinutes: number): Reading =>
      ({ astronautId: "a1", metric: "wristAngle", value: Array(EPOCHS_PER_MINUTE).fill(-80), unit: "deg", takenAt: new Date(day.startMs + offsetMinutes * 60_000).toISOString(), source: "watch" });
    await stores.readings.add([minute(-1), minute(0), minute(1)]);
    const found = await stores.readings.arrayReadingsTakenIn("watch", { astronautId: "a1", metric: "wristAngle", fromMs: day.startMs, toMs: day.startMs + 60_000 });
    assert.deepEqual(found.map((m) => m.takenAt), [new Date(day.startMs).toISOString()]);
  });
});

describe("deriveRecentSleep", () => {
  it("stores one sleep reading for the ended day, stamped at waking, and replaces it on the next run", async () => {
    await stores.readings.add(wristAngleReadings("a1", DAY, nightOfEightHours()));
    assert.deepEqual(await deriveRecentSleep(stores, AFTER_DAY_ENDS), []);
    assert.deepEqual(await deriveRecentSleep(stores, AFTER_DAY_ENDS + HOUR_MS), []);

    const rows = await sleepRows("a1");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source, "watch");
    assert.ok(Math.abs(rows[0].takenMs - Date.parse("2026-11-11T07:00:00Z")) <= 3 * 60_000, `wake ${rows[0].takenMs}`);
    assert.ok(Math.abs(rows[0].value - 8) <= 5 / 60, `asleep ${rows[0].value} h`);
  });

  it("does not analyze a day that has not ended", async () => {
    const openDay = UTC_DAYS.containing(Date.parse("2026-11-12T12:00:00Z"));
    await stores.readings.add(wristAngleReadings("open-day", openDay, nightOfEightHours()));
    await deriveRecentSleep(stores, openDay.endMs - 1);
    assert.deepEqual(await sleepRows("open-day"), []);
    await deriveRecentSleep(stores, openDay.endMs);
    assert.equal((await sleepRows("open-day")).length, 1, "the same data gives a night once the day has ended");
  });

  it("replaces Zepp's night in the same day and keeps Zepp's other nights", async () => {
    const sameNight = zeppNight("zepp-wearer", "2026-11-11T08:00:00.000Z", 6.9);
    const otherNight = zeppNight("zepp-wearer", "2026-11-05T08:00:00.000Z", 7.1);
    await stores.readings.add([sameNight, otherNight, ...wristAngleReadings("zepp-wearer", DAY, nightOfEightHours())]);
    await deriveRecentSleep(stores, AFTER_DAY_ENDS);
    const rows = await sleepRows("zepp-wearer");
    assert.deepEqual(rows.map((r) => r.source), ["zepp", "watch"]);
    assert.equal(rows[0].takenMs, Date.parse(otherNight.takenAt));
  });
});

describe("the Mind rule reads the derived nights", () => {
  it("counts three derived short nights in a row", async () => {
    const days: AnalysisDay[] = [0, 1, 2].map((k) => ({ startMs: DAY.startMs + k * DAY_MS, endMs: DAY.endMs + k * DAY_MS }));
    const fourHourNight = () => dayWithStillPeriods([11, 15]); // still 23:00–03:00 UTC
    for (const day of days) await stores.readings.add(wristAngleReadings("short-sleeper", day, fourHourNight()));
    const nowMs = days[2].endMs + HOUR_MS;
    await deriveRecentSleep(stores, nowMs);

    const inputs = await loadStatusInputs(stores, astronaut("short-sleeper"), DEFAULT_RULE_BOOK, nowMs);
    const facts = computeFacts(inputs, DEFAULT_RULE_BOOK.settings);
    assert.equal(facts.shortSleepNightsInARow?.value, 3);
  });
});

describe("PUT /api/mission/sleep-day-time-zone", () => {
  const putZone = (timeZone: string) =>
    app.inject({ method: "PUT", url: "/api/mission/sleep-day-time-zone", headers: AUTH, payload: { timeZone } });

  it("refuses an unknown zone and a request without the token", async () => {
    const unknown = await putZone("Mars/Jezero");
    assert.equal(unknown.statusCode, 400);
    assert.equal(unknown.json().error, "unknown_time_zone");
    const anonymous = await app.inject({ method: "PUT", url: "/api/mission/sleep-day-time-zone", payload: { timeZone: "UTC" } });
    assert.equal(anonymous.statusCode, 401);
  });

  it("stores the zone, shows it on GET /api/mission, and re-derives the nights in the new zone, in UTC", async () => {
    // The tester sleeps 01:00–09:00 EST (06:00–14:00 UTC): the night crosses noon UTC, so UTC days cut it.
    const indiana = sleepDays("America/Indiana/Indianapolis");
    const localDay = indiana.containing(Date.parse("2026-11-11T03:00:00Z"));
    await stores.readings.add(wristAngleReadings("earth-tester", localDay, angleDay(localDay, [13, 21])));
    fixedNowMs = localDay.endMs + HOUR_MS;
    const changed = await (async () => {
      try {
        await deriveRecentSleep(stores, appNow());
        const underUtc = await sleepRows("earth-tester");
        return { underUtc, reply: await putZone("America/Indiana/Indianapolis"), after: await sleepRows("earth-tester") };
      } finally {
        fixedNowMs = null;
      }
    })();

    assert.equal(changed.reply.statusCode, 200);
    assert.deepEqual(sleepJob.errors, []);
    assert.equal(changed.reply.json().sleepDayTimeZone, "America/Indiana/Indianapolis");
    assert.equal((await app.inject({ method: "GET", url: "/api/mission" })).json().sleepDayTimeZone, "America/Indiana/Indianapolis");
    assert.equal(changed.underUtc.length, 1);
    assert.ok(changed.underUtc[0].value < 7, `UTC days cut the 8-hour night: ${changed.underUtc[0].value} h`);
    assert.equal(changed.after.length, 1);
    assert.ok(Math.abs(changed.after[0].takenMs - Date.parse("2026-11-11T14:00:00Z")) <= 3 * 60_000, `wake ${changed.after[0].takenMs}`);
    assert.ok(Math.abs(changed.after[0].value - 8) <= 5 / 60, `asleep ${changed.after[0].value} h`);
    await putZone("UTC");
  });
});
