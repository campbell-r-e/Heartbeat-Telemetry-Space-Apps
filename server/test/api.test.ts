// HTTP tests against a throwaway Postgres container (see support/throwaway-postgres.ts).
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { AREAS, METRICS, type Reading, type RuleSettingsResponse, type ScheduledTask } from "@heartbeat/shared";
import { METRIC_UNITS } from "../src/domain/metrics.ts";
import { DEFAULT_MISSION } from "../src/domain/mission.ts";
import { DEFAULT_SCHEDULE } from "../src/domain/schedule.ts";
import { readBundledData, readRadiationHours } from "../src/data/bundled-files.ts";
import { loadBundledData } from "../src/data/load-bundled.ts";
import { createPool, createSchema, createServicePool, postgresStores } from "../src/db/index.ts";
import { STATEMENT_TIMEOUT_MS } from "../src/db/pool.ts";
import { DEFAULT_RULE_BOOK } from "../src/domain/rules/rule-book.ts";
import { solarEventProfile } from "../src/domain/solar-storm.ts";
import { buildApp } from "../src/http/app.ts";
import { testSleepDerivation } from "./support/sleep-job.ts";
import { testRelay, type TestRelay } from "./support/relay.ts";
import { testStatusEvaluator } from "./support/status-evaluator.ts";
import { startThrowawayPostgres, type ThrowawayPostgres } from "./support/throwaway-postgres.ts";

const TOKEN = "test-token";
const AUTH = { authorization: `Bearer ${TOKEN}` };
const MENU_SIZE = 30;

let db: ThrowawayPostgres;
let app: FastifyInstance;
let relay: TestRelay;

before(async () => {
  db = await startThrowawayPostgres();
  await createSchema(db.pool);
  const stores = postgresStores(db.pool);
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

const reading = (overrides: Partial<Reading> = {}): Reading => ({
  astronautId: "a1", metric: "heartRate", value: 61, unit: "bpm", takenAt: new Date().toISOString(), source: "watch", ...overrides,
});
const postReadings = (readings: Reading[], headers: Record<string, string> = AUTH) =>
  app.inject({ method: "POST", url: "/api/readings", headers, payload: { readings } });

describe("statement time limit (review: a hung query)", () => {
  it("gives the service pool STATEMENT_TIMEOUT_MS, and Postgres cancels a statement that runs past a limit", async () => {
    const service = createServicePool(db.connection);
    const quick = createPool({ ...db.connection, statement_timeout: 100 });
    try {
      const { rows } = await service.query<{ statement_timeout: string }>("SHOW statement_timeout");
      assert.equal(rows[0].statement_timeout, `${STATEMENT_TIMEOUT_MS / 1000}s`);
      await assert.rejects(quick.query("SELECT pg_sleep(2)"), (error: { code?: string }) => error.code === "57014", "query_canceled");
    } finally {
      await service.end();
      await quick.end();
    }
  });
});

describe("astronauts", () => {
  it("lists Astronaut 1 with the sample profile", async () => {
    const crew = (await app.inject({ method: "GET", url: "/api/astronauts" })).json();
    assert.deepEqual(crew.find((a: { id: string }) => a.id === "a1"), {
      id: "a1", name: "Astronaut 1", watchId: null, age: 35, sex: "female", massKg: 66, heightM: 1.68,
    });
  });

  it("adds the age column to an astronauts table created before it existed", async () => {
    const client = await db.pool.connect();
    try {
      await client.query("CREATE SCHEMA legacy; SET search_path TO legacy");
      await client.query("CREATE TABLE astronauts (id TEXT PRIMARY KEY, name TEXT NOT NULL, watch_id TEXT, created_ms BIGINT NOT NULL)");
      await createSchema(client);
      const { rows } = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'legacy' AND table_name = 'astronauts' AND column_name = 'age'");
      assert.equal(rows.length, 1);
    } finally {
      await client.query("DROP SCHEMA legacy CASCADE; SET search_path TO DEFAULT");
      client.release();
    }
  });
});

describe("bundled data load", () => {
  it("leaves no steps readings: reloading replaces the wxserver source without them", async () => {
    await db.pool.query(
      "INSERT INTO readings (astronaut_id, metric, value, unit, taken_ms, source) VALUES ('a1', 'steps', 365, 'steps/h', 0, 'wxserver')",
    );
    await loadBundledData(postgresStores(db.pool), readBundledData());
    const { rows } = await db.pool.query("SELECT count(*)::int AS n FROM readings WHERE metric = 'steps'");
    assert.equal(rows[0].n, 0);
  });

  it("loads the Zepp history without the heart-rate minutes the Galaxy Watch has, live or imported", async () => {
    const bundle = readBundledData();
    const zepp = bundle.astronaut1Zepp;
    const watchMs = Date.parse(zepp.heartRate[0].t) + 20_000;
    const minutesOf = async (sources: string[]) => {
      const { rows } = await db.pool.query<{ minute: string }>(
        "SELECT DISTINCT taken_ms / 60000 AS minute FROM readings WHERE astronaut_id = 'a1' AND metric = 'heartRate' AND source = ANY($1)",
        [sources],
      );
      return new Set(rows.map((r) => r.minute));
    };
    try {
      await db.pool.query(
        "INSERT INTO readings (astronaut_id, metric, value, unit, taken_ms, source) VALUES ('a1', 'heartRate', 64, 'bpm', $1, 'watch')",
        [watchMs],
      );
      const loaded = await loadBundledData(postgresStores(db.pool), bundle);
      const zeppCount = zepp.heartRate.length + zepp.hrv.length + zepp.sleep.length + zepp.spo2.length;
      assert.equal(loaded.astronaut1Zepp, zeppCount - 1);
      const galaxyMinutes = await minutesOf(["wxserver", "watch"]);
      const zeppMinutes = await minutesOf(["zepp"]);
      assert.ok(galaxyMinutes.size > 1);
      assert.equal([...zeppMinutes].filter((m) => galaxyMinutes.has(m)).length, 0);
    } finally {
      // Restore the bundled state for later tests: no live reading, every Zepp minute back.
      await db.pool.query("DELETE FROM readings WHERE source = 'watch' AND taken_ms = $1", [watchMs]);
      await loadBundledData(postgresStores(db.pool), bundle);
    }
  });
});

describe("GET /api/astronauts/:id/schedule", () => {
  const schedule = (id: string) => app.inject({ method: "GET", url: `/api/astronauts/${id}/schedule` });

  it("returns the owner's daily schedule in time order", async () => {
    const res = await schedule("a1");
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json().map((t: { localTime: string; kind: string }) => `${t.localTime} ${t.kind}`), [
      "08:00 meal", "09:00 ecg", "09:00 spo2", "13:00 meal", "19:00 meal", "20:00 checkIn", "21:00 spo2", "null exercise",
    ]);
    assert.deepEqual(res.json()[1], { id: "ecg-0900", kind: "ecg", label: "ECG", localTime: "09:00", astronautId: null });
    const meals = res.json().filter((t: { kind: string }) => t.kind === "meal");
    assert.deepEqual(meals.map((t: { label: string; localTime: string }) => `${t.localTime} ${t.label}`), ["08:00 Breakfast", "13:00 Lunch", "19:00 Dinner"]);
  });

  const addTask = (id: string, label: string, localTime: string, astronautId: string | null) =>
    db.pool.query("INSERT INTO schedule (id, kind, label, local_time, astronaut_id) VALUES ($1, 'ecg', $2, $3, $4)", [id, label, localTime, astronautId]);

  it("matches the configured schedule exactly after startup's replace: stale tasks removed, changed ones updated", async () => {
    await addTask("test-stale", "No longer configured", "06:00", null);
    await db.pool.query("UPDATE schedule SET label = 'Meal logging' WHERE id = 'meal-0800'");
    await postgresStores(db.pool).schedule.replace(DEFAULT_SCHEDULE);
    const { rows } = await db.pool.query(
      `SELECT id, kind, label, local_time AS "localTime", astronaut_id AS "astronautId" FROM schedule ORDER BY local_time NULLS LAST, id`,
    );
    // Timed tasks in time order, then the task with no set time.
    const byTime = (a: ScheduledTask, b: ScheduledTask) =>
      Number(a.localTime === null) - Number(b.localTime === null) || (a.localTime ?? "").localeCompare(b.localTime ?? "") || a.id.localeCompare(b.id);
    assert.deepEqual(rows, [...DEFAULT_SCHEDULE].sort(byTime));
  });

  it("includes an astronaut's own tasks but not another astronaut's", async () => {
    await addTask("test-a1-only", "ECG", "10:30", "a1");
    await addTask("test-other-only", "ECG", "11:30", "someone-else");
    const ids = (await schedule("a1")).json().map((t: { id: string }) => t.id);
    assert.ok(ids.includes("test-a1-only"));
    assert.ok(!ids.includes("test-other-only"));
    await db.pool.query("DELETE FROM schedule WHERE id LIKE 'test-%'");
  });

  it("answers 404 for an unknown astronaut and for the ship", async () => {
    assert.equal((await schedule("nobody")).json().error, "unknown_astronaut");
    assert.equal((await schedule("ship")).statusCode, 404);
  });

  it("stores only HH:MM times", async () => {
    await assert.rejects(db.pool.query("INSERT INTO schedule (id, kind, label, local_time) VALUES ('test-bad', 'ecg', 'ECG', '25:00')"));
    await assert.rejects(db.pool.query("INSERT INTO schedule (id, kind, label, local_time) VALUES ('test-bad', 'ecg', 'ECG', '9:00')"));
  });
});

describe("token on writes", () => {
  it("rejects POST, PUT and DELETE without the token", async () => {
    for (const [method, url] of [["POST", "/api/readings"], ["PUT", "/api/readings"], ["DELETE", "/api/demo/solar-storm"], ["POST", "/api/astronauts/a1/checkins"]] as const) {
      const res = await app.inject({ method, url, payload: {} });
      assert.equal(res.statusCode, 401, `${method} ${url}`);
    }
  });

  it("rejects a wrong token", async () => {
    const res = await postReadings([reading()], { authorization: "Bearer wrong" });
    assert.equal(res.statusCode, 401);
  });

  it("leaves GETs open", async () => {
    const res = await app.inject({ method: "GET", url: "/api/astronauts/a1/latest" });
    assert.equal(res.statusCode, 200);
  });

  it("accepts a write with the token", async () => {
    const res = await app.inject({ method: "POST", url: "/api/astronauts/a1/checkins", headers: AUTH, payload: { mood: 4, stress: 2 } });
    assert.equal(res.statusCode, 200);
  });
});

describe("the pool from createPool", () => {
  it("returns BIGINT columns as numbers", async () => {
    const { rows } = await db.pool.query<{ ms: unknown }>("SELECT 1700000000000::bigint AS ms");
    assert.equal(rows[0].ms, 1_700_000_000_000);
  });
});

describe("bucketed series source label", () => {
  const HOUR = 3_600_000;
  const astronautId = "bucket-label-test";
  const insert = (hour: number, minute: number, source: string) =>
    db.pool.query(
      "INSERT INTO readings (astronaut_id, metric, value, unit, taken_ms, source) VALUES ($1, 'heartRate', 60, 'bpm', $2, $3)",
      [astronautId, hour * HOUR + minute * 60_000, source],
    );

  it("uses the source with the most readings, alphabetical on a tie, and labels any bucket with a simulated reading simulated", async () => {
    await insert(0, 1, "manual"); await insert(0, 2, "manual"); await insert(0, 3, "watch"); // majority manual
    await insert(1, 1, "watch"); await insert(1, 2, "watch"); await insert(1, 3, "manual"); // majority watch
    await insert(2, 1, "watch"); await insert(2, 2, "manual"); // tie: alphabetical
    // Not the ship's radiation, so the simulated reading does not replace the recorded ones (the storm guard).
    await insert(3, 1, "watch"); await insert(3, 2, "watch"); await insert(3, 3, "simulated");
    const points = await postgresStores(db.pool).readings.series(astronautId, "heartRate", { fromMs: null, toMs: null, bucketMinutes: 60 });
    assert.deepEqual(points.map((p) => [p.source, p.n]), [["manual", 3], ["watch", 3], ["manual", 2], ["simulated", 3]]);
  });
});

describe("latest readings", () => {
  it("refuses a stored reading with neither a number nor an array value", async () => {
    const astronautId = "latest-corrupt-row";
    await db.pool.query(
      "INSERT INTO readings (astronaut_id, metric, value, value_json, unit, taken_ms, source) VALUES ($1, 'heartRate', NULL, NULL, 'bpm', 0, 'manual')",
      [astronautId],
    );
    await assert.rejects(postgresStores(db.pool).readings.latest(astronautId, Date.now()), /has no value/);
  });
});

describe("POST /api/readings", () => {
  it("ignores duplicate readings and reports them", async () => {
    const takenAt = new Date(Date.now() - 60_000).toISOString();
    const batch = [reading({ takenAt }), reading({ takenAt }), reading({ takenAt, metric: "spo2", unit: "%", value: 97 })];

    const first = await postReadings(batch);
    assert.equal(first.statusCode, 200);
    assert.deepEqual(first.json(), { accepted: 2, duplicates: 1 });

    const second = await postReadings(batch);
    assert.deepEqual(second.json(), { accepted: 0, duplicates: 3 });

    const { rows } = await db.pool.query("SELECT count(*)::int AS n FROM readings WHERE astronaut_id = 'a1' AND taken_ms = $1", [Date.parse(takenAt)]);
    assert.equal(rows[0].n, 2);
  });

  it("rejects a reading more than 5 minutes in the future", async () => {
    const res = await postReadings([reading({ takenAt: new Date(Date.now() + 10 * 60_000).toISOString() })]);
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error, "taken_in_future");
  });

  it("rejects a unit that does not match the metric", async () => {
    const res = await postReadings([reading({ unit: "mmHg" })]);
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error, "wrong_unit");
  });

  it("accepts only the client sources watch and manual", async () => {
    assert.equal((await postReadings([reading({ source: "manual", takenAt: new Date(Date.now() - 120_000).toISOString() })])).statusCode, 200);
    for (const source of ["simulated", "wxserver", "zepp", "radlab", "osdr"] as const) {
      assert.equal((await postReadings([reading({ source })])).statusCode, 400, source);
    }
  });

  it("accepts raw beat-to-beat intervals as an ibi array in ms", async () => {
    const takenAt = new Date(Date.now() - 180_000).toISOString();
    const res = await postReadings([reading({ metric: "ibi", unit: "ms", value: [812, 798, 805], takenAt })]);
    assert.deepEqual(res.json(), { accepted: 1, duplicates: 0 });
    const { rows } = await db.pool.query("SELECT value, value_json FROM readings WHERE metric = 'ibi' AND taken_ms = $1", [Date.parse(takenAt)]);
    assert.deepEqual(rows, [{ value: null, value_json: [812, 798, 805] }]);
  });

  it("takes ecg and ibi only as arrays and every other metric only as a single number", async () => {
    const at = (secondsAgo: number) => new Date(Date.now() - 200_000 - secondsAgo * 1000).toISOString();
    const post = (overrides: Partial<Reading>) => postReadings([reading(overrides)]);
    assert.equal((await post({ metric: "ibi", unit: "ms", value: [812], takenAt: at(1) })).statusCode, 200, "one-interval ibi batch");
    assert.equal((await post({ metric: "ecg", unit: "mV", value: [0.1, 0.4, -0.2], takenAt: at(2) })).statusCode, 200);
    const scalarIbi = await post({ metric: "ibi", unit: "ms", value: 812, takenAt: at(3) });
    assert.deepEqual(scalarIbi.json(), { error: "wrong_value_shape", index: 0, metric: "ibi", expectedShape: "array" });
    const arrayHeartRate = await post({ value: [61, 62], takenAt: at(4) });
    assert.deepEqual(arrayHeartRate.json(), { error: "wrong_value_shape", index: 0, metric: "heartRate", expectedShape: "number" });
    assert.equal((await post({ value: [61], takenAt: at(5) })).statusCode, 400, "one-item array for a scalar metric");
  });

  it("refuses an empty ecg or ibi array with a named error", async () => {
    for (const [metric, unit] of [["ecg", "mV"], ["ibi", "ms"]] as const) {
      const res = await postReadings([reading(), reading({ metric, unit, value: [] })]);
      assert.equal(res.statusCode, 400, metric);
      assert.deepEqual(res.json(), { error: "empty_array", index: 1, metric, message: `${metric} must contain at least one sample` });
    }
  });

  it("refuses hrv from clients with a named error pointing to ibi: the server derives it", async () => {
    const res = await postReadings([reading(), reading({ metric: "hrv", unit: "ms", value: 52 })]);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.json(), {
      error: "server_derived_metric", index: 1, metric: "hrv", message: "hrv is calculated by the server; send ibi instead",
    });
  });

  it("rejects the removed steps metric (astronauts don't walk in microgravity)", async () => {
    const res = await postReadings([{ ...reading(), metric: "steps" as Reading["metric"], unit: "steps/h" }]);
    assert.equal(res.statusCode, 400);
  });

  it("rejects the removed movement metric", async () => {
    const res = await postReadings([{ ...reading(), metric: "movement" as Reading["metric"], unit: "steps/h" }]);
    assert.equal(res.statusCode, 400);
  });

  it("returns 404 for an unknown astronaut", async () => {
    const res = await postReadings([reading({ astronautId: "nobody" })]);
    assert.equal(res.statusCode, 404);
  });
});

describe("GET /api/astronauts/:id/series", () => {
  const series = (query: string) => app.inject({ method: "GET", url: `/api/astronauts/ship/series?metric=radiationDoseRate&${query}` });

  it("returns 400, not 500, for a huge bucket", async () => {
    const res = await series("bucket=99999999999");
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error, "invalid_bucket");
  });

  it("returns 400 for invalid dates, unknown range, and range with from/to", async () => {
    assert.equal((await series("from=not-a-date")).statusCode, 400);
    assert.equal((await series("range=2h")).statusCode, 400);
    assert.equal((await series("range=1h&from=2026-11-01T00:00:00Z")).statusCode, 400);
  });

  it("returns every point up to now for the mission range (the loop before the start and the first hour of this one)", async () => {
    const mission = (await series("range=mission")).json();
    assert.equal(mission.unit, "µGy/h");
    assert.equal(mission.points.length, readRadiationHours().length + 1);
    assert.ok(mission.points.every((p: { t: string }) => Date.parse(p.t) <= Date.now()), "no point after now");
    const future = (await series(`from=${new Date().toISOString()}&to=${new Date(Date.now() + 30 * 86_400_000).toISOString()}`)).json();
    assert.ok(future.points.length <= 1, "the loop's later hours are stored but not shown");
  });

  it("buckets on request", async () => {
    const mission = (await series("range=mission")).json();

    const daily = (await series("range=mission&bucket=1440")).json();
    assert.equal(daily.bucketMinutes, 1440);
    assert.ok(daily.points.length < mission.points.length);
  });

  it("takes the unit from the domain's unit table, even with no data or an odd stored unit", async () => {
    const unitOf = async (metric: string) =>
      (await app.inject({ method: "GET", url: `/api/astronauts/ship/series?metric=${metric}&range=mission` })).json().unit;
    assert.equal(await unitOf("spo2"), "%");
    await db.pool.query(
      "INSERT INTO readings (astronaut_id, metric, value, unit, taken_ms, source) VALUES ('ship', 'noise', 40, 'dB', 0, 'manual')",
    );
    assert.equal(await unitOf("noise"), "dBA");
    for (const metric of METRICS) assert.equal(await unitOf(metric), METRIC_UNITS[metric], metric);
  });

  it("accepts explicit from/to", async () => {
    const to = new Date().toISOString();
    const from = new Date(Date.now() - 3 * 3_600_000).toISOString();
    const res = await series(`from=${from}&to=${to}`);
    assert.equal(res.statusCode, 200);
    assert.ok(res.json().points.length >= 3);
  });
});

describe("400 bodies (the API wire format)", () => {
  const get = async (url: string) => {
    const res = await app.inject({ method: "GET", url });
    assert.equal(res.statusCode, 400, url);
    return res.json();
  };
  const series = (query: string) => get(`/api/astronauts/ship/series?metric=radiationDoseRate&${query}`);

  it("series: each problem has a stable code and a message", async () => {
    assert.deepEqual(await series("bucket=0"), { error: "invalid_bucket", message: "bucket must be a whole number of minutes from 1 to 43200" });
    assert.deepEqual(await series("range=1h&to=2026-11-01T00:00:00Z"), { error: "range_and_times", message: "use either range or from/to, not both" });
    assert.deepEqual(await series("from=yesterday"), { error: "invalid_date", message: "from and to must be ISO 8601 times" });
    assert.deepEqual(await series("from=2026-11-02T00:00:00Z&to=2026-11-01T00:00:00Z"), { error: "invalid_date", message: "from must not be after to" });
    assert.deepEqual(await series("range=2h"), { error: "invalid_range", message: "range must be one of 1h, 24h, 7d, mission" });
  });

  it("series: bucket is checked first, then range with times, then dates or range", async () => {
    assert.equal((await series("range=2h&from=yesterday&bucket=abc")).error, "invalid_bucket");
    assert.equal((await series("range=2h&from=yesterday")).error, "range_and_times");
    assert.equal((await series("from=yesterday&to=2026-11-01T00:00:00Z")).error, "invalid_date");
  });

  it("meal and check-in lists reject bad times the same way", async () => {
    for (const list of ["meals", "checkins"]) {
      assert.deepEqual(await get(`/api/astronauts/a1/${list}?from=nope`), { error: "invalid_date", message: "from and to must be ISO 8601 times" });
      assert.deepEqual(
        await get(`/api/astronauts/a1/${list}?from=2026-11-02T00:00:00Z&to=2026-11-01T00:00:00Z`),
        { error: "invalid_date", message: "from must not be after to" },
      );
    }
  });

  it("readings: taken_in_future and wrong_unit name the reading", async () => {
    const takenAt = new Date(Date.now() + 10 * 60_000).toISOString();
    assert.deepEqual((await postReadings([reading({ takenAt })])).json(), { error: "taken_in_future", index: 0, takenAt });
    assert.deepEqual(
      (await postReadings([reading(), reading({ unit: "mmHg" })])).json(),
      { error: "wrong_unit", index: 1, metric: "heartRate", unit: "mmHg", expectedUnit: "bpm" },
    );
  });
});

describe("POST /api/astronauts/:id/checkins", () => {
  it("takes check-in scores on the 1-5 scale only", async () => {
    for (const [mood, stress, status] of [[1, 5, 200], [0, 3, 400], [3, 6, 400], [2.5, 3, 400]] as const) {
      const res = await app.inject({ method: "POST", url: "/api/astronauts/a1/checkins", headers: AUTH, payload: { mood, stress } });
      assert.equal(res.statusCode, status, `mood ${mood}, stress ${stress}`);
    }
  });
});

describe("menu and meals", () => {
  it("serves the 30-item menu from the database", async () => {
    const menu = (await app.inject({ method: "GET", url: "/api/menu" })).json();
    assert.equal(menu.foods.length, MENU_SIZE);
    assert.ok(menu.sources.length > 0);
  });

  it("validates food ids against the database", async () => {
    const bad = await app.inject({ method: "POST", url: "/api/astronauts/a1/meals", headers: AUTH, payload: { foodId: "moon-cheese" } });
    assert.equal(bad.statusCode, 400);
    const good = await app.inject({ method: "POST", url: "/api/astronauts/a1/meals", headers: AUTH, payload: { foodId: "scrambled-eggs" } });
    assert.equal(good.statusCode, 200);
  });

  it("deletes a logged meal, and answers unknown_astronaut for an unknown id like every :id route", async () => {
    const meal = (await app.inject({ method: "POST", url: "/api/astronauts/a1/meals", headers: AUTH, payload: { foodId: "scrambled-eggs" } })).json();
    const unknown = await app.inject({ method: "DELETE", url: `/api/astronauts/nobody/meals/${meal.id}`, headers: AUTH });
    assert.equal(unknown.statusCode, 404);
    assert.equal(unknown.json().error, "unknown_astronaut");
    const deleted = await app.inject({ method: "DELETE", url: `/api/astronauts/a1/meals/${meal.id}`, headers: AUTH });
    assert.deepEqual(deleted.json(), { deleted: true });
    const again = await app.inject({ method: "DELETE", url: `/api/astronauts/a1/meals/${meal.id}`, headers: AUTH });
    assert.equal(again.json().error, "not_found");
  });
});

describe("solar storm demo", () => {
  it("stores 48 simulated hours ending now, none below the real hour", async () => {
    const before = Date.now();
    const res = await app.inject({ method: "POST", url: "/api/demo/solar-storm", headers: AUTH, payload: { factor: 5 } });
    const after = Date.now();
    assert.equal(res.statusCode, 200);
    const { rows } = await db.pool.query<{ value: number; taken_ms: number }>(
      "SELECT value, taken_ms FROM readings WHERE astronaut_id = 'ship' AND source = 'simulated' ORDER BY taken_ms",
    );
    const real = solarEventProfile(readRadiationHours()).hours;
    assert.equal(rows.length, real.length);
    rows.forEach((row, i) => assert.ok(row.value >= real[i] && row.value >= 0));
    // All at once: every point is at or before the request, and the last one is "now".
    assert.ok(rows.every((row) => row.taken_ms <= after));
    const last = rows.at(-1)!.taken_ms;
    assert.ok(last >= before && last <= after, `last point ${last} not within the request ${before}-${after}`);
  });
});

describe("GET /api/mission", () => {
  it("returns the mission settings record with today's mission day (day 1 = the start date, UTC)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/mission" });
    assert.equal(res.statusCode, 200);
    const startMs = Date.parse("2026-11-05T00:00:00Z");
    const expectedDay = Math.floor((Date.now() - startMs) / 86_400_000) + 1;
    assert.deepEqual(res.json(), {
      name: "Heartbeat ISS Demo", startDate: "2026-11-05", missionDay: expectedDay, gravity: { preset: "iss", label: "ISS (microgravity)" },
      sleepDayTimeZone: "UTC",
    });
  });

  it("keeps a changed record when the default is saved again on start", async () => {
    await db.pool.query("UPDATE mission SET name = 'Changed by the surgeon'");
    await postgresStores(db.pool).mission.saveIfMissing(DEFAULT_MISSION);
    assert.equal((await app.inject({ method: "GET", url: "/api/mission" })).json().name, "Changed by the surgeon");
    await db.pool.query("UPDATE mission SET name = $1", [DEFAULT_MISSION.name]);
  });
});

describe("GET /api/settings", () => {
  it("exposes every rule setting and the expiry ages", async () => {
    const body = (await app.inject({ method: "GET", url: "/api/settings" })).json();
    assert.equal(body.settings["spo2.watchBelowPct"], 95);
    assert.equal(body.settings["exercise.dailyGoalMinutes"], 120);
    assert.equal(body.settings["radiation.careerLimitMSv"], 600);
    assert.equal(body.maxReadingAgeMinutes.heartRate, 15);
  });

  it("lists every limit in plain language per area, the number beside the label", async () => {
    const { limits } = (await app.inject({ method: "GET", url: "/api/settings" })).json() as RuleSettingsResponse;
    assert.deepEqual(new Set(limits.map((l) => l.area)), new Set(AREAS));
    const goal = limits.find((l) => l.area === "gravity" && l.status === "normal")!;
    assert.deepEqual([goal.label, goal.value, goal.unit, goal.source.document.startsWith("Daily exercise goal")], ["Daily exercise goal", 120, "min", true]);
  });
});

describe("DELETE /api/astronauts/:id/checkins/:checkInId", () => {
  it("removes a posted check-in, needs the token, and answers not_found the second time", async () => {
    const posted = (await app.inject({ method: "POST", url: "/api/astronauts/a1/checkins", headers: AUTH, payload: { mood: 2, stress: 4 } })).json();
    const url = `/api/astronauts/a1/checkins/${posted.id}`;
    assert.equal((await app.inject({ method: "DELETE", url })).statusCode, 401);
    assert.deepEqual((await app.inject({ method: "DELETE", url, headers: AUTH })).json(), { deleted: true });
    const listed = (await app.inject({ method: "GET", url: "/api/astronauts/a1/checkins" })).json();
    assert.equal(listed.some((c: { id: number }) => c.id === posted.id), false);
    assert.equal((await app.inject({ method: "DELETE", url, headers: AUTH })).json().error, "not_found");
    assert.equal((await app.inject({ method: "DELETE", url: `/api/astronauts/nobody/checkins/${posted.id}`, headers: AUTH })).statusCode, 404);
  });
});
