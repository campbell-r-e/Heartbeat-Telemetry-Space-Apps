// GET /api/astronauts/:id/status and live HRV derivation over HTTP, against a throwaway Postgres
// container loaded with the real bundled data.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { AREAS, type AstronautStatus, type Reading } from "@heartbeat/shared";
import { readBundledData } from "../src/data/bundled-files.ts";
import { ASTRONAUT_1, loadBundledData } from "../src/data/load-bundled.ts";
import { createSchema, postgresStores } from "../src/db/index.ts";
import type { Stores } from "../src/domain/ports.ts";
import { DEFAULT_RULE_BOOK } from "../src/domain/rules/rule-book.ts";
import { astronautStatus } from "../src/domain/status/astronaut-status.ts";
import { DEFAULT_MISSION } from "../src/domain/mission.ts";
import { DEFAULT_SCHEDULE } from "../src/domain/schedule.ts";
import { solarEventProfile } from "../src/domain/solar-storm.ts";
import { MINUTE_MS } from "../src/domain/time.ts";
import { buildApp } from "../src/http/app.ts";
import { testSleepDerivation } from "./support/sleep-job.ts";
import { testRelay, type TestRelay } from "./support/relay.ts";
import { testStatusEvaluator } from "./support/status-evaluator.ts";
import { startThrowawayPostgres, type ThrowawayPostgres } from "./support/throwaway-postgres.ts";

const TOKEN = "test-token";
const AUTH = { authorization: `Bearer ${TOKEN}` };
const HRV_WINDOW_MS = 5 * MINUTE_MS;

let db: ThrowawayPostgres;
let app: FastifyInstance;
let relay: TestRelay;
let stores: Stores;

before(async () => {
  db = await startThrowawayPostgres();
  await createSchema(db.pool);
  stores = postgresStores(db.pool);
  const bundle = readBundledData();
  await loadBundledData(stores, bundle);
  await stores.schedule.replace(DEFAULT_SCHEDULE); // as src/index.ts does on start
  await stores.mission.saveIfMissing(DEFAULT_MISSION);
  relay = testRelay(stores, Date.now);
  app = await buildApp(
    { stores, token: TOKEN, solarEvent: solarEventProfile(bundle.radiationHours), ruleBook: DEFAULT_RULE_BOOK, now: Date.now, ...relay.deps, statusEvaluator: testStatusEvaluator(stores, Date.now, relay), sleepDerivation: testSleepDerivation(stores, Date.now).job },
    { logger: false },
  );
});

after(async () => {
  await relay?.system.stop();
  relay?.deps.live.close();
  await app?.close();
  await db?.stop();
});

const status = async (id = "a1"): Promise<AstronautStatus> => {
  const res = await app.inject({ method: "GET", url: `/api/astronauts/${id}/status` });
  assert.equal(res.statusCode, 200);
  return res.json();
};
const areaStatus = (s: AstronautStatus, area: string) => s.areas.find((a) => a.area === area)?.status;
const postReadings = (readings: Reading[]) =>
  app.inject({ method: "POST", url: "/api/readings", headers: AUTH, payload: { readings } });
const watchReading = (overrides: Partial<Reading>): Reading => ({
  astronautId: "a1", metric: "heartRate", value: 70, unit: "bpm", takenAt: new Date().toISOString(), source: "watch", ...overrides,
});

describe("GET /api/astronauts/:id/status on the real bundled data", () => {
  it("rates every area in display order, and real ISS radiation alone is normal today", async () => {
    const s = await status();
    if (process.env.PRINT_STATUS) console.log(JSON.stringify(s, null, 2));
    assert.deepEqual(s.areas.map((a) => a.area), [...AREAS]);
    assert.equal(areaStatus(s, "radiation"), "normal");
    assert.equal(s.evaluations.filter((e) => e.area === "radiation").length, 0);
    const dose = s.derived.radiationDailyDose!;
    assert.ok(Math.abs(dose.multiple - dose.dailyDoseUGy / dose.previousSevenDayAverageUGy) < 1e-9);
    assert.ok(dose.multiple < 1.25, `multiple ${dose.multiple}`);
    // Dose equivalent (estimate): µGy ÷ 1000 × 2.26 mSv/mGy.
    assert.ok(Math.abs(dose.dailyDoseMSv! - (dose.dailyDoseUGy / 1000) * 2.26) < 1e-12);
    assert.ok(Math.abs(dose.previousSevenDayAverageMSv! - (dose.previousSevenDayAverageUGy / 1000) * 2.26) < 1e-12);
  });

  it("rates gravity only when a gravity rule applies, leaves nutrition unrated with no meals yesterday, and has no pending rules", async () => {
    const s = await status();
    const minutes = s.derived.exerciseToday.minutes;
    const hour = new Date(s.at).getUTCHours();
    const expected = minutes === null ? null : minutes >= 120 ? "normal" : minutes < 60 && hour >= 18 ? "watch" : null;
    assert.equal(areaStatus(s, "gravity"), expected);
    if (minutes === null) assert.equal(s.areas.find((a) => a.area === "gravity")!.reason, "No watch data today");
    assert.equal(areaStatus(s, "nutrition"), null);
    assert.deepEqual(s.pendingRules, []);
  });

  it("reports the watch histories' heart rate, skin temperature and HRV as no recent data (older than 15 minutes); Zepp's chart-only SpO₂ is not rated at all", async () => {
    const s = await status();
    assert.deepEqual(s.noRecentData, ["heartRate", "skinTemp", "hrv"]);
    assert.equal(s.derived.hrv, null);
    assert.equal(s.metrics.find((m) => m.metric === "heartRate"), undefined);
  });

  it("reports exercise minutes against the 120-minute goal with the 64% of (220 - 35) threshold", async () => {
    // A fixed "now" and a seeded reading, so the result does not depend on the time of day the
    // suite runs (just after midnight UTC there is no heart rate yet "today"). The readings go
    // under their own id, so no other test sees them.
    const fixedNowMs = Date.parse("2026-11-14T12:00:00.000Z");
    const subject = { ...ASTRONAUT_1, id: "exercise-check" };
    const minuteAt = (iso: string, bpm: number) =>
      ({ astronautId: subject.id, metric: "heartRate" as const, value: bpm, unit: "bpm", takenAt: iso, source: "watch" as const });
    await stores.readings.add([
      minuteAt("2026-11-14T11:30:00.000Z", 140), minuteAt("2026-11-14T11:31:00.000Z", 150), minuteAt("2026-11-14T11:32:00.000Z", 90),
    ]);
    const { exerciseToday } = (await astronautStatus(stores, DEFAULT_RULE_BOOK, subject, fixedNowMs)).derived;
    assert.equal(exerciseToday.goalMinutes, 120);
    assert.ok(Math.abs(exerciseToday.thresholdBpm! - 118.4) < 1e-9);
    assert.equal(exerciseToday.day, "2026-11-14");
    assert.equal(exerciseToday.minutes, 2, "two minutes at or above 118.4 bpm, one below");
  });

  it("gives a plain-language reason for every unrated area", async () => {
    const s = await status();
    for (const area of s.areas) assert.equal(area.reason === null, area.status !== null, area.area);
    const reason = (name: string) => s.areas.find((a) => a.area === name)!.reason;
    // The Zepp heart rate covers every day of the baseline window, so Vitals reports no baseline
    // progress; Mind reports HRV's own, from the Galaxy Watch only (Zepp's nightly HRV is chart-only).
    assert.equal(reason("vitals"), "No recent heart rate, skin temperature and HRV readings");
    assert.equal(reason("nutrition"), "No meals logged yesterday");
    assert.match(reason("mind")!,
      /^Needs 2 mood check-ins in the last 3 days \(0 so far\); No recent HRV readings; HRV baseline needs readings on 7 days \([1-6] so far\)$/);
  });

  it("reports the mission dose so far and its 180-day projection in mSv against the 600 mSv limit", async () => {
    const dose = (await status()).derived.missionDose!;
    assert.equal(dose.careerLimitMSv, 600);
    assert.equal(dose.projectionDays, 180);
    assert.ok(Math.abs(dose.shareOfCareerLimit - dose.mSv / 600) < 1e-12);
    assert.ok(Math.abs(dose.projectedShareOfCareerLimit - dose.projectedMSv / 600) < 1e-12);
    assert.ok(dose.projectedMSv > 150 && dose.projectedMSv < 190, `projected ${dose.projectedMSv}`);
  });

  it("returns 404 for an unknown astronaut", async () => {
    const res = await app.inject({ method: "GET", url: "/api/astronauts/nobody/status" });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error, "unknown_astronaut");
  });
});

describe("simulated solar storm", () => {
  it("turns radiation red for the whole crew, and clearing it returns to normal", async () => {
    await app.inject({ method: "POST", url: "/api/demo/solar-storm", headers: AUTH, payload: { factor: 5 } });
    const stormy = await status();
    if (process.env.PRINT_STATUS) console.log(JSON.stringify(stormy, null, 2));
    assert.equal(areaStatus(stormy, "radiation"), "alert");
    assert.equal(stormy.overall, "alert");
    const alert = stormy.evaluations[0];
    assert.equal(alert.ruleId, "radiation-solar-event-alert");
    assert.equal(alert.title, "Radiation dose spike");
    assert.equal(alert.crewWide, true);
    assert.deepEqual(alert.metrics, ["radiationDoseRate"]);
    assert.equal(alert.source.requirementId, "[V1 4031]");
    assert.match(alert.message.what, /^The ship's radiation dose over the last 24 hours is \d+\.\d\d× the average/);
    assert.ok(stormy.derived.radiationDailyDose!.multiple >= 1.5);

    await app.inject({ method: "DELETE", url: "/api/demo/solar-storm", headers: AUTH });
    assert.equal(areaStatus(await status(), "radiation"), "normal");
  });

  it("records the storm's alert and its clearing in the alert log", async () => {
    const alerts = async (query = "") =>
      (await app.inject({ method: "GET", url: `/api/astronauts/a1/alerts${query}` })).json() as Array<{ area: string; metric: string | null; ruleId: string | null; from: string | null; to: string | null; title: string }>;
    await status();
    const before = (await alerts()).length;
    await app.inject({ method: "POST", url: "/api/demo/solar-storm", headers: AUTH, payload: { factor: 5 } });
    await status();
    await app.inject({ method: "DELETE", url: "/api/demo/solar-storm", headers: AUTH });
    await status();
    const spike = (await alerts()).slice(before).filter((c) => c.ruleId === "radiation-solar-event-alert");
    assert.ok(spike.every((c) => c.area === "radiation" && c.metric === "radiationDoseRate"));
    assert.ok((await alerts("?area=radiation")).every((c) => c.area === "radiation"));
    assert.ok((await alerts("?area=radiation")).some((c) => c.ruleId === null && c.title.startsWith("Radiation:")), "area changes too");
    assert.equal((await app.inject({ method: "GET", url: "/api/astronauts/a1/alerts?area=moon" })).statusCode, 400);
    assert.deepEqual(spike.map((c) => [c.from, c.to, c.title]), [
      ["normal", "alert", "Radiation dose spike"],
      ["alert", "normal", "Radiation dose spike: cleared"],
    ]);
    assert.equal((await app.inject({ method: "GET", url: "/api/astronauts/a1/alerts?from=nope" })).statusCode, 400);
  });

  it("replaces the recorded hours it overlaps in the charts too, labeling those buckets simulated", async () => {
    await app.inject({ method: "POST", url: "/api/demo/solar-storm", headers: AUTH, payload: { factor: 5 } });
    const chart = async (query: string) =>
      (await app.inject({ method: "GET", url: `/api/astronauts/ship/series?metric=radiationDoseRate&${query}` })).json().points as Array<{ t: string; source: string; n: number }>;
    const raw = await chart("range=24h");
    assert.ok(raw.length > 0 && raw.every((p) => p.source === "simulated"), "no recorded hour inside the storm");
    const hourly = await chart("range=24h&bucket=60");
    assert.ok(hourly.every((p) => p.source === "simulated" && p.n === 1), "one simulated reading per hour, nothing averaged in");
    await app.inject({ method: "DELETE", url: "/api/demo/solar-storm", headers: AUTH });
    assert.ok((await chart("range=24h")).every((p) => p.source === "radlab"));
  });
});

describe("nutrition over HTTP", () => {
  const logMeal = (foodId: string, eatenAt: string) =>
    app.inject({ method: "POST", url: "/api/astronauts/a1/meals", headers: AUTH, payload: { foodId, eatenAt } });

  it("rates yesterday's logged meals and shows today's running totals unrated", async () => {
    const menu = (await app.inject({ method: "GET", url: "/api/menu" })).json().foods as Array<{ id: string; calciumMg: number }>;
    const yesterdayNoon = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() - 1, 12)).toISOString();
    await logMeal(menu[0].id, yesterdayNoon);
    await logMeal(menu[1].id, new Date().toISOString());
    const s = await status();
    const { nutritionYesterday, nutritionToday } = s.derived;
    assert.equal(nutritionYesterday.mealsLogged, 1);
    assert.equal(nutritionYesterday.complete, true);
    assert.deepEqual(nutritionYesterday.totals.calciumMg, { atLeast: menu[0].calciumMg, unknownMeals: 0 });
    assert.ok(Object.values(nutritionYesterday.statuses).every((status) => status !== null), "every check rated");
    assert.notEqual(areaStatus(s, "nutrition"), null);
    assert.equal(nutritionToday.complete, false);
    assert.ok(nutritionToday.mealsLogged >= 1);
    assert.ok(Object.values(nutritionToday.statuses).every((status) => status === null), "today is not rated");
    assert.equal(nutritionToday.targets.eerKcal!.toFixed(1), "2409.0");
    assert.ok(s.evaluations.some((e) => e.area === "nutrition" && e.message.what.startsWith("Yesterday")));
  });
});

describe("vitals over HTTP", () => {
  it("rates a posted SpO₂ reading: 89% is an alert, then 95% is normal", async () => {
    await postReadings([watchReading({ metric: "spo2", unit: "%", value: 89, takenAt: new Date(Date.now() - 2000).toISOString() })]);
    const low = await status();
    assert.equal(areaStatus(low, "vitals"), "alert");
    assert.deepEqual(low.metrics.find((m) => m.metric === "spo2"), { metric: "spo2", status: "alert" });
    assert.ok(low.evaluations.some((e) => e.ruleId === "spo2-alert" && e.crewWide === false));

    await postReadings([watchReading({ metric: "spo2", unit: "%", value: 95, takenAt: new Date(Date.now() - 1000).toISOString() })]);
    assert.deepEqual((await status()).metrics.find((m) => m.metric === "spo2"), { metric: "spo2", status: "normal" });
  });

  it("does not let a newer simulated reading hide a newer real one", async () => {
    await postReadings([watchReading({ metric: "spo2", unit: "%", value: 92, takenAt: new Date(Date.now() - 800).toISOString() })]);
    await db.pool.query(
      "INSERT INTO readings (astronaut_id, metric, value, unit, taken_ms, source) VALUES ('a1', 'spo2', 99, '%', $1, 'simulated')",
      [Date.now() - 400],
    );
    const s = await status();
    assert.deepEqual(s.metrics.find((m) => m.metric === "spo2"), { metric: "spo2", status: "watch" });
    assert.equal(s.evaluations.find((e) => e.ruleId === "spo2-watch")?.message.what, "Your blood oxygen is 92%, below the normal 95%.");
  });

  it("counts a minute at or above the exercise threshold toward today's exercise minutes", async () => {
    const before = (await status()).derived.exerciseToday.minutes!;
    await postReadings([watchReading({ value: 126, takenAt: new Date(Date.now() - 500).toISOString() })]);
    assert.equal((await status()).derived.exerciseToday.minutes, before + 1);
  });
});

describe("live HRV from ibi", () => {
  /** `count` intervals alternating 1000 and 1010 ms: RMSSD 10 ms, no artifacts. */
  const steady = (count: number) => Array.from({ length: count }, (_, i) => 1000 + (i % 2) * 10);
  const hrvAt = async (windowMs: number) => {
    const { rows } = await db.pool.query("SELECT value, source FROM readings WHERE astronaut_id = 'a1' AND metric = 'hrv' AND taken_ms = $1", [windowMs]);
    return rows;
  };

  it("splits a batch crossing a 5-minute boundary across both windows by each beat's own time", async () => {
    // Recent enough that the newer window's HRV has not expired (15 minutes).
    const windowMs = Math.floor((Date.now() - 10 * MINUTE_MS) / HRV_WINDOW_MS) * HRV_WINDOW_MS;
    // The first beat is 30 s before the boundary: beats 0-29 land before it, beats 30-59 after.
    const takenAt = new Date(windowMs + HRV_WINDOW_MS - 30_000).toISOString();
    const res = await postReadings([watchReading({ metric: "ibi", unit: "ms", value: steady(60), takenAt })]);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(await hrvAt(windowMs), [{ value: 10, source: "watch" }]);
    assert.deepEqual(await hrvAt(windowMs + HRV_WINDOW_MS), [{ value: 10, source: "watch" }]);
    assert.deepEqual((await status()).derived.hrv, { rmssdMs: 10, at: new Date(windowMs + HRV_WINDOW_MS).toISOString() });
  });

  it("recomputes a window when a later batch adds beats to it", async () => {
    const windowMs = Math.floor((Date.now() - 60 * MINUTE_MS) / HRV_WINDOW_MS) * HRV_WINDOW_MS;
    const at = (secondsIn: number) => new Date(windowMs + secondsIn * 1000).toISOString();
    await postReadings([watchReading({ metric: "ibi", unit: "ms", value: steady(20), takenAt: at(0) })]);
    assert.deepEqual(await hrvAt(windowMs), [], "20 intervals are too few");
    await postReadings([watchReading({ metric: "ibi", unit: "ms", value: steady(20), takenAt: at(60) })]);
    assert.equal((await hrvAt(windowMs)).length, 1);
  });
});

describe("GET /api/astronauts/:id/tasks/today", () => {
  const tasksToday = async () => {
    const res = await app.inject({ method: "GET", url: "/api/astronauts/a1/tasks/today" });
    assert.equal(res.statusCode, 200);
    return res.json() as Array<{ taskId: string; kind: string; label: string; localTime: string | null; done: boolean; doneAt: string | null; progress: { value: number; goal: number; unit: string } | null }>;
  };

  it("lists today's schedule with the exercise task's progress toward the goal", async () => {
    const tasks = await tasksToday();
    assert.equal(tasks.length, 8);
    const exercise = tasks.find((t) => t.taskId === "exercise-daily")!;
    assert.deepEqual([exercise.kind, exercise.localTime, exercise.progress!.goal, exercise.progress!.unit], ["exercise", null, 120, "min"]);
    assert.equal(exercise.done, exercise.progress!.value >= 120);
    assert.equal((await app.inject({ method: "GET", url: "/api/astronauts/nobody/tasks/today" })).statusCode, 404);
  });

  it("marks breakfast done from a meal logged within 2 hours of 08:00", async (t) => {
    const now = new Date();
    const at0610 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 6, 10);
    if (Date.now() < at0610) return t.skip("needs a time after 06:10 UTC today");
    const menu = (await app.inject({ method: "GET", url: "/api/menu" })).json().foods as Array<{ id: string }>;
    await app.inject({ method: "POST", url: "/api/astronauts/a1/meals", headers: AUTH, payload: { foodId: menu[2].id, eatenAt: new Date(at0610).toISOString() } });
    const breakfast = (await tasksToday()).find((task) => task.taskId === "meal-0800")!;
    assert.deepEqual([breakfast.done, breakfast.doneAt], [true, new Date(at0610).toISOString()]);
  });
});

describe("GET /api/astronauts/:id/exercise/daily", () => {
  const daily = async (query: string) => app.inject({ method: "GET", url: `/api/astronauts/a1/exercise/daily${query}` });

  it("gives the last 7 UTC days against the goal, today matching the status and the exercise task", async () => {
    const minuteAgo = (n: number) => new Date(Date.now() - n * MINUTE_MS).toISOString();
    await postReadings([watchReading({ value: 150, takenAt: minuteAgo(2) }), watchReading({ value: 150, takenAt: minuteAgo(3) })]);
    const res = await daily("?range=7d");
    assert.equal(res.statusCode, 200);
    const days = res.json() as Array<{ day: string; minutes: number | null; goalMinutes: number | null }>;
    assert.equal(days.length, 7);
    assert.deepEqual(days.map((d) => d.goalMinutes), Array(7).fill(120));
    const today = days.at(-1)!;
    assert.equal(today.day, new Date().toISOString().slice(0, 10));
    const s = await status();
    assert.equal(today.minutes, s.derived.exerciseToday.minutes);
    assert.ok(today.minutes! >= 2);
    const tasks = (await app.inject({ method: "GET", url: "/api/astronauts/a1/tasks/today" })).json() as Array<{ taskId: string; progress: { value: number } | null }>;
    assert.equal(tasks.find((t) => t.taskId === "exercise-daily")!.progress!.value, today.minutes);
  });

  it("covers every day since mission day 1 for mission, each day of a from/to window, and refuses bad input", async () => {
    const mission = (await daily("?range=mission")).json() as Array<{ day: string }>;
    assert.equal(mission[0].day, DEFAULT_MISSION.startDate);
    assert.equal(mission.at(-1)!.day, new Date().toISOString().slice(0, 10));
    const window = (await daily("?from=2026-11-01T12:00:00Z&to=2026-11-03T01:00:00Z")).json() as Array<{ day: string }>;
    assert.deepEqual(window.map((d) => d.day), ["2026-11-01", "2026-11-02", "2026-11-03"]);
    assert.equal((await daily("?range=24h")).json().error, "invalid_range");
    assert.equal((await daily("?from=2020-01-01&to=2026-11-14")).json().error, "range_too_long");
    assert.equal((await app.inject({ method: "GET", url: "/api/astronauts/nobody/exercise/daily" })).statusCode, 404);
  });
});

describe("GET /api/astronauts/:id/reference-lines", () => {
  it("gives each chart's normal band and lines, with the radiation lines from the 7-day average", async () => {
    const res = await app.inject({ method: "GET", url: "/api/astronauts/a1/reference-lines" });
    assert.equal(res.statusCode, 200);
    const charts = res.json() as Array<{ metric: string; basis: string; thresholds: Array<{ value: number; label: string }> }>;
    assert.deepEqual(charts.find((c) => c.metric === "spo2")!.thresholds.map((l) => l.value), [95, 90]);
    assert.equal(charts.find((c) => c.metric === "radiationDoseRate")!.basis, "previousSevenDays");
    const labels = (metric: string) => charts.find((c) => c.metric === metric)!.thresholds.map((l) => l.label);
    assert.deepEqual(labels("noise"), ["Sleep period, watch above", "Awake, watch above", "24-hour average, alert above"]);
    assert.deepEqual(labels("co2"), ["Watch at or above", "Alert above"]);
    assert.equal((await app.inject({ method: "GET", url: "/api/astronauts/nobody/reference-lines" })).statusCode, 404);
  });

  it("rides along on the series response as `reference`, for an astronaut's and the ship's charts", async () => {
    const series = async (id: string, metric: string) =>
      (await app.inject({ method: "GET", url: `/api/astronauts/${id}/series?metric=${metric}&range=24h` })).json().reference;
    assert.deepEqual(await series("a1", "spo2"), {
      band: { low: 95, high: null }, basis: "settings",
      thresholds: [{ value: 95, status: "watch", label: "Watch below" }, { value: 90, status: "alert", label: "Alert below" }],
    });
    assert.equal((await series("ship", "radiationDoseRate")).basis, "previousSevenDays");
    assert.equal(await series("a1", "ecg"), null);
  });
});

describe("Zepp history next to live Galaxy Watch readings", () => {
  const steady = (count: number) => Array.from({ length: count }, (_, i) => 1000 + (i % 2) * 10);
  const insertZepp = (metric: string, unit: string, value: number, takenMs: number) => db.pool.query(
    "INSERT INTO readings (astronaut_id, metric, value, unit, taken_ms, source) VALUES ('a1', $1, $2, $3, $4, 'zepp')",
    [metric, value, unit, takenMs],
  );
  const zeppAt = async (metric: string, takenMs: number) => (await db.pool.query(
    "SELECT value FROM readings WHERE astronaut_id = 'a1' AND source = 'zepp' AND metric = $1 AND taken_ms = $2",
    [metric, takenMs],
  )).rows;
  /** Removes the Zepp rows a test inserted, so a failing assertion leaves nothing for later tests. */
  const removeZeppAt = (...takenMs: number[]) =>
    db.pool.query("DELETE FROM readings WHERE astronaut_id = 'a1' AND source = 'zepp' AND taken_ms = ANY($1::bigint[])", [takenMs]);

  it("deletes the Zepp heart rate in the minute of a posted watch heart rate", async () => {
    const minuteMs = Math.floor((Date.now() - 30 * MINUTE_MS) / MINUTE_MS) * MINUTE_MS;
    try {
      await insertZepp("heartRate", "bpm", 61, minuteMs);
      await insertZepp("heartRate", "bpm", 62, minuteMs + MINUTE_MS);
      await postReadings([watchReading({ value: 70, takenAt: new Date(minuteMs + 25_000).toISOString() })]);
      assert.deepEqual(await zeppAt("heartRate", minuteMs), []);
      assert.deepEqual(await zeppAt("heartRate", minuteMs + MINUTE_MS), [{ value: 62 }], "the next minute is not contested");
    } finally {
      await removeZeppAt(minuteMs, minuteMs + MINUTE_MS);
    }
  });

  it("deletes the Zepp HRV in a 5-minute window the watch's beats give an HRV for", async () => {
    const windowMs = Math.floor((Date.now() - 90 * MINUTE_MS) / HRV_WINDOW_MS) * HRV_WINDOW_MS;
    const zeppMs = windowMs + 2 * MINUTE_MS;
    try {
      await insertZepp("hrv", "ms", 56, zeppMs);
      await postReadings([watchReading({ metric: "ibi", unit: "ms", value: steady(60), takenAt: new Date(windowMs).toISOString() })]);
      assert.deepEqual(await zeppAt("hrv", zeppMs), []);
    } finally {
      await removeZeppAt(zeppMs);
    }
  });

  it("rates SpO₂ and reports the latest HRV from spot readings, never from Zepp's nightly values", async () => {
    // The newest spot reading (97%) is older than Zepp's nightly score (80%), which must not hide it.
    const nowMs = Date.now();
    try {
      await postReadings([watchReading({ metric: "spo2", unit: "%", value: 97, takenAt: new Date(nowMs - 200).toISOString() })]);
      await insertZepp("spo2", "%", 80, nowMs - 100);
      await insertZepp("hrv", "ms", 99, nowMs - 100);
      const s = await status();
      assert.deepEqual(s.metrics.find((m) => m.metric === "spo2"), { metric: "spo2", status: "normal" });
      assert.notEqual(s.derived.hrv?.rmssdMs, 99);
    } finally {
      await removeZeppAt(nowMs - 100);
    }
  });

  it("never counts Zepp's nightly SpO₂ score as taking today's SpO₂ spot check", async () => {
    const takenMs = Date.now() - 1500;
    try {
      await insertZepp("spo2", "%", 96, takenMs);
      assert.deepEqual(await postgresStores(db.pool).readings.readingTimesReadByRules("a1", "spo2", takenMs - 1, takenMs + 1), []);
    } finally {
      await removeZeppAt(takenMs);
    }
  });
});
