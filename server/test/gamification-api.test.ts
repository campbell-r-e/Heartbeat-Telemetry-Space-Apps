// Points, streak and badges over HTTP and /ws/onboard (SPEC §7, §10), against a throwaway Postgres
// with the bundled menu, a fixed clock and an astronaut of its own, so no other data counts.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import type { AstronautSummary, LiveMessage, PointsSummary, Reading, TaskState } from "@heartbeat/shared";
import { readBundledData } from "../src/data/bundled-files.ts";
import { ASTRONAUT_1, loadBundledData } from "../src/data/load-bundled.ts";
import { createSchema, postgresStores } from "../src/db/index.ts";
import { DEFAULT_MISSION } from "../src/domain/mission.ts";
import type { Stores } from "../src/domain/ports.ts";
import { DEFAULT_RULE_BOOK } from "../src/domain/rules/rule-book.ts";
import { DEFAULT_SCHEDULE } from "../src/domain/schedule.ts";
import { solarEventProfile, type SolarEventProfile } from "../src/domain/solar-storm.ts";
import { MINUTE_MS } from "../src/domain/time.ts";
import { buildApp } from "../src/http/app.ts";
import { testSleepDerivation } from "./support/sleep-job.ts";
import { testRelay, type TestRelay } from "./support/relay.ts";
import { testStatusEvaluator } from "./support/status-evaluator.ts";
import { startThrowawayPostgres, type ThrowawayPostgres } from "./support/throwaway-postgres.ts";

const TOKEN = "test-token";
const AUTH = { authorization: `Bearer ${TOKEN}` };
/** Mission day 8 (the mission starts 2026-11-05), late evening UTC. */
const NOW_MS = Date.parse("2026-11-12T21:30:00.000Z");
const ID = "points-check";
const MESSAGE_TIMEOUT_MS = 5_000;

let db: ThrowawayPostgres;
let app: FastifyInstance;
let relay: TestRelay;
let stores: Stores;
let baseUrl: string;
let solarEvent: SolarEventProfile;
const now = () => NOW_MS;

/** An app on `appStores` with its own relay and points, as src/index.ts wires them. */
async function appOn(appStores: Stores): Promise<{ app: FastifyInstance; relay: TestRelay }> {
  const appRelay = testRelay(appStores, now);
  const built = await buildApp(
    { stores: appStores, token: TOKEN, solarEvent, ruleBook: DEFAULT_RULE_BOOK, now, ...appRelay.deps, statusEvaluator: testStatusEvaluator(appStores, now, appRelay), sleepDerivation: testSleepDerivation(appStores, now).job },
    { logger: false },
  );
  return { app: built, relay: appRelay };
}

before(async () => {
  db = await startThrowawayPostgres();
  await createSchema(db.pool);
  stores = postgresStores(db.pool);
  const bundle = readBundledData();
  solarEvent = solarEventProfile(bundle.radiationHours);
  await loadBundledData(stores, bundle);
  await stores.schedule.replace(DEFAULT_SCHEDULE);
  await stores.mission.saveIfMissing(DEFAULT_MISSION);
  await stores.astronauts.upsert({ ...ASTRONAUT_1, id: ID, name: "Points check", watchId: null });
  ({ app, relay } = await appOn(stores));
  baseUrl = await app.listen({ port: 0, host: "127.0.0.1" });
});

after(async () => {
  await relay?.points.settled();
  await relay?.system.stop();
  relay?.deps.live.close();
  await app?.close();
  await db?.stop();
  assert.deepEqual(relay.errors, []);
});

const iso = (day: string, hhmm: string) => `2026-11-${day}T${hhmm}:00.000Z`;
const points = async (): Promise<PointsSummary> => {
  const res = await app.inject({ method: "GET", url: `/api/astronauts/${ID}/points` });
  assert.equal(res.statusCode, 200);
  return res.json();
};
const post = (url: string, payload: object) => app.inject({ method: "POST", url, headers: AUTH, payload });
const checkIn = (day: string) => post(`/api/astronauts/${ID}/checkins`, { mood: 4, stress: 2, at: iso(day, "20:00") });
const reading = (metric: "ecg" | "spo2", takenAt: string): Reading => ({
  astronautId: ID, metric, value: metric === "ecg" ? [0.1, 0.4, 0.2] : 97, unit: metric === "ecg" ? "mV" : "%", takenAt, source: "watch",
});
/** The day's ECG and both SpO₂ checks, at their scheduled times. */
const measurements = (day: string) =>
  post("/api/readings", { readings: [reading("ecg", iso(day, "09:00")), reading("spo2", iso(day, "09:00")), reading("spo2", iso(day, "21:00"))] });

async function listenOnboard() {
  const socket = new WebSocket(`${baseUrl.replace("http", "ws")}/ws/onboard`);
  const messages: LiveMessage[] = [];
  socket.on("message", (data) => messages.push(JSON.parse(String(data))));
  await new Promise((resolve, reject) => socket.once("open", resolve).once("error", reject));
  return {
    socket,
    async nextPoints(matches: (summary: PointsSummary) => boolean): Promise<PointsSummary> {
      const deadline = Date.now() + MESSAGE_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const found = messages.find((m) => m.type === "points" && m.points.astronautId === ID && matches(m.points));
        if (found && found.type === "points") return found.points;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`no matching points message within ${MESSAGE_TIMEOUT_MS} ms`);
    },
  };
}

describe("points, streak and badges from real activity since mission day 1", () => {
  it("starts at zero with nothing done, and refuses an unknown astronaut", async () => {
    const summary = await points();
    assert.deepEqual(
      [summary.day, summary.totalPoints, summary.today, summary.streak],
      ["2026-11-12", 0, { points: 0, possiblePoints: 125, tasksDone: 0, tasks: 8 }, { days: 0, includesToday: false }],
    );
    assert.deepEqual(summary.badges.map((b) => [b.id, b.name, b.earnedOn]), [["checkInStreak", "7-day check-in streak", null], ["boneGuardian", "Bone Guardian", null]]);
    assert.equal((await app.inject({ method: "GET", url: "/api/astronauts/nobody/points" })).statusCode, 404);
    assert.equal((await app.inject({ method: "GET", url: "/api/astronauts/nobody/summary" })).statusCode, 404);
  });

  it("earns the check-in badge on the seventh day in a row, and counts the streak through yesterday", async () => {
    for (const day of ["05", "06", "07", "08", "09", "10", "11"]) assert.equal((await checkIn(day)).statusCode, 200);
    for (const day of ["10", "11"]) assert.equal((await measurements(day)).statusCode, 200);
    const summary = await points();
    assert.equal(summary.badges.find((b) => b.id === "checkInStreak")!.earnedOn, "2026-11-11");
    assert.deepEqual(summary.streak, { days: 2, includesToday: false }, "today is not over, so it does not break the streak");
    assert.equal(summary.totalPoints, 7 * 15 + 2 * (20 + 10 + 10));
  });

  it("pushes the new points live when today's measurements are done, and the streak then includes today", async () => {
    const onboard = await listenOnboard();
    await measurements("12");
    await checkIn("12");
    const pushed = await onboard.nextPoints((s) => s.streak.includesToday);
    assert.deepEqual(pushed.streak, { days: 3, includesToday: true });
    assert.equal(pushed.today.points, 20 + 10 + 10 + 15);
    onboard.socket.close();
  });

  it("earns a meal task's points once, however many foods are logged for it", async () => {
    const before = await points();
    const foods = (await app.inject({ method: "GET", url: "/api/menu" })).json().foods as Array<{ id: string }>;
    for (const [food, hhmm] of [[foods[0], "08:00"], [foods[1], "08:10"]] as const) {
      assert.equal((await post(`/api/astronauts/${ID}/meals`, { foodId: food.id, eatenAt: iso("12", hhmm) })).statusCode, 200);
    }
    const after = await points();
    assert.equal(after.today.points - before.today.points, 10);
    assert.equal(after.totalPoints - before.totalPoints, 10);
  });

  it("gives the exercise task its 40 points once the day's goal is met, and lists each task's points", async () => {
    const start = Date.parse(iso("12", "10:00"));
    await stores.readings.add(Array.from({ length: 120 }, (_, i) => ({
      astronautId: ID, metric: "heartRate" as const, value: 150, unit: "bpm", takenAt: new Date(start + i * MINUTE_MS).toISOString(), source: "watch" as const,
    })));
    relay.points.activityChanged(ID, start);
    const tasks: TaskState[] = (await app.inject({ method: "GET", url: `/api/astronauts/${ID}/tasks/today` })).json();
    assert.deepEqual(tasks.map((t) => [t.taskId, t.points, t.done]), [
      ["meal-0800", 10, true], ["ecg-0900", 20, true], ["spo2-0900", 10, true], ["meal-1300", 10, false],
      ["meal-1900", 10, false], ["checkin-2000", 15, true], ["spo2-2100", 10, true], ["exercise-daily", 40, true],
    ]);
    const summary = await points();
    assert.deepEqual(summary.today, { points: 10 + 20 + 10 + 15 + 10 + 40, possiblePoints: 125, tasksDone: 6, tasks: 8 });
  });

  it("serves the status per area with the same points in the summary", async () => {
    const res = await app.inject({ method: "GET", url: `/api/astronauts/${ID}/summary` });
    assert.equal(res.statusCode, 200);
    const summary: AstronautSummary = res.json();
    assert.equal(summary.astronautId, ID);
    assert.equal(summary.areas.length, 6);
    const { at: _at, ...expected } = await points();
    const { at: _summaryAt, ...served } = summary.points;
    assert.deepEqual(served, expected);
  });

  it("takes a deleted check-in's points away again", async () => {
    const before = await points();
    const today = (await app.inject({ method: "GET", url: `/api/astronauts/${ID}/checkins?from=${iso("12", "00:00")}&to=${iso("12", "21:30")}` })).json() as Array<{ id: number }>;
    assert.equal((await app.inject({ method: "DELETE", url: `/api/astronauts/${ID}/checkins/${today[0].id}`, headers: AUTH })).statusCode, 200);
    const after = await points();
    assert.equal(before.totalPoints - after.totalPoints, 15);
    assert.deepEqual(after.streak, { days: 2, includesToday: false });
  });

  it("keeps a stored badge, with its day, after the check-in behind it is deleted", async () => {
    const day5 = (await app.inject({ method: "GET", url: `/api/astronauts/${ID}/checkins?from=${iso("05", "00:00")}&to=${iso("05", "23:59")}` })).json() as Array<{ id: number }>;
    assert.equal((await app.inject({ method: "DELETE", url: `/api/astronauts/${ID}/checkins/${day5[0].id}`, headers: AUTH })).statusCode, 200);
    const summary = await points();
    assert.equal(summary.badges.find((b) => b.id === "checkInStreak")!.earnedOn, "2026-11-11");
    assert.deepEqual(await stores.badges.earned(ID), [{ badgeId: "checkInStreak", earnedOn: "2026-11-11" }]);
  });

  it("counts imported Zepp heart rate toward exercise points", async () => {
    const before = await points();
    const start = Date.parse(iso("11", "10:00"));
    await stores.readings.add(Array.from({ length: 120 }, (_, i) => ({
      astronautId: ID, metric: "heartRate" as const, value: 150, unit: "bpm", takenAt: new Date(start + i * MINUTE_MS).toISOString(), source: "zepp" as const,
    })));
    // Written straight to the store (as the Zepp import does at start), so the kept day is marked by hand.
    relay.points.activityChanged(ID, start);
    assert.equal((await points()).totalPoints - before.totalPoints, 40);
  });
});

describe("the readings route keeps kept task days current", () => {
  const ROUTE_ID = "route-check";
  /** 120 exercise minutes on 2026-11-10, a day the history keeps by 2026-11-12. */
  const exerciseBatch = {
    readings: Array.from({ length: 120 }, (_, i): Reading => ({
      astronautId: ROUTE_ID, metric: "heartRate", value: 150, unit: "bpm",
      takenAt: new Date(Date.parse(iso("10", "10:00")) + i * MINUTE_MS).toISOString(), source: "watch",
    })),
  };

  it("marks the days as soon as the readings are stored, even when a later step fails, and again on an all-duplicate retry", async () => {
    await stores.astronauts.upsert({ ...ASTRONAUT_1, id: ROUTE_ID, name: "Route check", watchId: null });
    // Removing outranked Zepp minutes runs after the readings are stored; it fails once here.
    let failOnce = true;
    const failing: Stores = {
      ...stores,
      readings: {
        ...stores.readings,
        deleteSourceInRanges: async (...args) => {
          if (failOnce) {
            failOnce = false;
            throw new Error("connection reset");
          }
          return stores.readings.deleteSourceInRanges(...args);
        },
      },
    };
    const routed = await appOn(failing);
    const routePoints = async (): Promise<PointsSummary> => (await routed.app.inject({ method: "GET", url: `/api/astronauts/${ROUTE_ID}/points` })).json();
    const upload = () => routed.app.inject({ method: "POST", url: "/api/readings", headers: AUTH, payload: exerciseBatch });
    try {
      const before = await routePoints(); // the history now keeps 2026-11-10 without exercise
      assert.equal((await upload()).statusCode, 500, "the step after storing failed");
      assert.equal((await routePoints()).totalPoints - before.totalPoints, 40, "the stored readings already count");
      const retry = await upload();
      assert.deepEqual([retry.statusCode, retry.json()], [200, { accepted: 0, duplicates: 120 }]);
      assert.equal((await routePoints()).totalPoints - before.totalPoints, 40);
    } finally {
      await routed.relay.points.settled();
      await routed.relay.system.stop();
      routed.relay.deps.live.close();
      await routed.app.close();
    }
    assert.deepEqual(routed.relay.errors, []);
  });

  it("brings a kept day up to date through an all-duplicate batch whose first delivery left no mark", async () => {
    const DUP_ID = "duplicate-check";
    await stores.astronauts.upsert({ ...ASTRONAUT_1, id: DUP_ID, name: "Duplicate check", watchId: null });
    const pointsOf = async (): Promise<PointsSummary> => (await app.inject({ method: "GET", url: `/api/astronauts/${DUP_ID}/points` })).json();
    const batch = { readings: exerciseBatch.readings.map((r) => ({ ...r, astronautId: DUP_ID })) };
    const before = await pointsOf();
    await stores.readings.add(batch.readings); // stored, but nothing was told (a first delivery cut short)
    assert.equal((await pointsOf()).totalPoints, before.totalPoints, "the kept day does not know yet");
    const res = await post("/api/readings", batch);
    assert.deepEqual(res.json(), { accepted: 0, duplicates: 120 });
    assert.equal((await pointsOf()).totalPoints - before.totalPoints, 40);
  });
});

describe("the readings route keeps the ground's daily log current", () => {
  it("marks the batch's days for the daily log right after storing, through a failure and an all-duplicate retry", async () => {
    const LOG_ID = "log-check";
    await stores.astronauts.upsert({ ...ASTRONAUT_1, id: LOG_ID, name: "Log check", watchId: null });
    let failNext = false;
    const failing: Stores = {
      ...stores,
      readings: {
        ...stores.readings,
        deleteSourceInRanges: async (...args) => {
          if (failNext) {
            failNext = false;
            throw new Error("connection reset");
          }
          return stores.readings.deleteSourceInRanges(...args);
        },
      },
    };
    const logged = await appOn(failing);
    const batchOn = (day: string) => ({
      readings: Array.from({ length: 30 }, (_, i): Reading => ({
        astronautId: LOG_ID, metric: "heartRate", value: 150, unit: "bpm",
        takenAt: new Date(Date.parse(iso(day, "10:00")) + i * MINUTE_MS).toISOString(), source: "watch",
      })),
    });
    const upload = (day: string) => logged.app.inject({ method: "POST", url: "/api/readings", headers: AUTH, payload: batchOn(day) });
    /** Runs the minute's upkeep, hands over what it sent, and reads the day's exercise minutes as the ground has them. */
    const groundMinutes = async (day: string) => {
      await logged.relay.system.upkeep();
      await logged.relay.system.deliverNow();
      const res = await logged.app.inject({ method: "GET", url: `/api/ground/astronauts/${LOG_ID}/daily-log` });
      return (res.json().log.exercise as Array<{ day: string; minutes: number | null }>).find((d) => d.day === `2026-11-${day}`)?.minutes;
    };
    try {
      // The full log goes down at start; later runs rebuild only recent and marked days.
      await logged.relay.system.start();
      await logged.relay.system.deliverNow();
      assert.equal(await groundMinutes("08"), null, "no heart rate yet");

      failNext = true;
      assert.equal((await upload("08")).statusCode, 500, "the step after storing failed");
      assert.equal(await groundMinutes("08"), 30, "the stored readings reach the ground's log");

      // A batch stored with no mark at all (a first delivery cut short), then sent again: all duplicates.
      await stores.readings.add(batchOn("07").readings);
      assert.equal(await groundMinutes("07"), null, "the log does not know yet");
      const retry = await upload("07");
      assert.deepEqual([retry.statusCode, retry.json()], [200, { accepted: 0, duplicates: 30 }]);
      assert.equal(await groundMinutes("07"), 30);
    } finally {
      await logged.relay.points.settled();
      await logged.relay.system.stop();
      logged.relay.deps.live.close();
      await logged.app.close();
    }
    assert.deepEqual(logged.relay.errors, []);
  });
});

describe("a crew change through the relay reaches the points", () => {
  it("reads an astronaut's whole history again when the ground removes and adds them, and pushes their points", async () => {
    const CREW_ID = "crew-check";
    await stores.astronauts.upsert({ ...ASTRONAUT_1, id: CREW_ID, name: "Crew check", watchId: null });
    const pointsOf = async (): Promise<PointsSummary> => (await app.inject({ method: "GET", url: `/api/astronauts/${CREW_ID}/points` })).json();
    const before = await pointsOf(); // keeps the past days
    await stores.checkIns.add(CREW_ID, 4, 2, iso("09", "20:00")); // written while nothing listens
    assert.equal((await pointsOf()).totalPoints, before.totalPoints);
    // The ground learns the crew from the roster sent at start, then removes and adds the astronaut.
    await relay.system.start();
    await relay.system.deliverNow();
    const onboard = await listenOnboardFor(CREW_ID);
    const ground = (method: string, url: string, payload?: object) => app.inject({ method: method as "POST", url, headers: AUTH, payload });
    assert.equal((await ground("DELETE", `/api/ground/crew/astronauts/${CREW_ID}`)).statusCode, 202);
    await relay.system.deliverNow();
    assert.equal((await ground("POST", "/api/ground/crew/astronauts", { id: CREW_ID, name: "Crew check", age: 24 })).statusCode, 202);
    await relay.system.deliverNow();
    const pushed = await onboard.next();
    assert.equal(pushed.totalPoints - before.totalPoints, 15, "the check-in written earlier now counts");
    onboard.socket.close();
  });
});

/** A listener for one astronaut's `points` messages. */
async function listenOnboardFor(astronautId: string) {
  const socket = new WebSocket(`${baseUrl.replace("http", "ws")}/ws/onboard`);
  const messages: PointsSummary[] = [];
  socket.on("message", (data) => {
    const message: LiveMessage = JSON.parse(String(data));
    if (message.type === "points" && message.points.astronautId === astronautId) messages.push(message.points);
  });
  await new Promise((resolve, reject) => socket.once("open", resolve).once("error", reject));
  return {
    socket,
    async next(): Promise<PointsSummary> {
      const deadline = Date.now() + MESSAGE_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (messages.length > 0) return messages[messages.length - 1];
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`no points message for ${astronautId} within ${MESSAGE_TIMEOUT_MS} ms`);
    },
  };
}
