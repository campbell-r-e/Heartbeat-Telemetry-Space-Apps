// The relay over HTTP (SPEC §8, §9.2, §10) against a throwaway Postgres container loaded with the
// real bundled data. A test clock stands in for time, so each delay is checked to the millisecond.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import type {
  Astronaut, CheckIn, DailyLog, ExerciseDay, FoodMenu, GroundAlert, GroundCrewResponse, GroundDailyLogResponse, GroundMissionResponse, GroundNote,
  AlertLogEntry, GroundSeriesResponse, OnboardAlert, OnboardNote,
  RelayDelayResponse, RelayEvent, SeriesResponse, SolarStormConflict, SolarStormState,
} from "@heartbeat/shared";
import { DEMO_STORM_STEPS } from "@heartbeat/shared";
import type { StatusEvaluator } from "../src/domain/status/status-evaluator.ts";
import { readBundledData } from "../src/data/bundled-files.ts";
import { loadBundledData } from "../src/data/load-bundled.ts";
import { createSchema, postgresStores } from "../src/db/index.ts";
import type { Stores } from "../src/domain/ports.ts";
import { DEFAULT_MISSION } from "../src/domain/mission.ts";
import { DEFAULT_RULE_BOOK } from "../src/domain/rules/rule-book.ts";
import { DEFAULT_SCHEDULE } from "../src/domain/schedule.ts";
import { STORM_ACTIVE_MS, solarEventProfile, type SolarEventProfile } from "../src/domain/solar-storm.ts";
import { buildApp } from "../src/http/app.ts";
import { readDailyLog } from "../src/domain/relay/daily-log-relay.ts";
import { DAY_MS } from "../src/domain/time.ts";
import { SNAPSHOT_RETENTION_MS } from "../src/relay-system.ts";
import { testSleepDerivation } from "./support/sleep-job.ts";
import { testRelay, type TestRelay } from "./support/relay.ts";
import { testStatusEvaluator } from "./support/status-evaluator.ts";
import { startThrowawayPostgres, type ThrowawayPostgres } from "./support/throwaway-postgres.ts";

const TOKEN = "test-token";
const AUTH = { authorization: `Bearer ${TOKEN}` };
const MARS_CLOSE_DEMO_MS = 10_000;
const MARS_FAR_DEMO_MS = 30_000;
const SOLAR_EVENT_RULE = "radiation-solar-event-alert";

let db: ThrowawayPostgres;
let stores: Stores;
let solarEvent: SolarEventProfile;
let app: FastifyInstance;
let relay: TestRelay;
let statusEvaluator: StatusEvaluator;
let clock = Date.now();
const now = () => clock;

/**
 * When set, the next evaluation stalls after computing its status and before logging it, until
 * released: the window in which a status can go stale.
 */
let slowLogging: { reached: () => void; released: Promise<void> } | null = null;

/** The stores, except that logging a status can be held open by `slowLogging`. */
function withSlowLogging(real: Stores): Stores {
  const statusLog: Stores["statusLog"] = {
    ...real.statusLog,
    async update(astronautId, compute) {
      const slow = slowLogging;
      if (slow) {
        slowLogging = null;
        slow.reached();
        await slow.released;
      }
      return real.statusLog.update(astronautId, compute);
    },
  };
  return { ...real, statusLog };
}

/** Starts the relay and the app on the database, as src/index.ts does on every start. */
async function startServer(): Promise<void> {
  relay = testRelay(stores, now);
  statusEvaluator = testStatusEvaluator(withSlowLogging(stores), now, relay);
  app = await buildApp({ stores, token: TOKEN, solarEvent, ruleBook: DEFAULT_RULE_BOOK, now, ...relay.deps, statusEvaluator, sleepDerivation: testSleepDerivation(stores, now).job }, { logger: false });
  await relay.system.start();
}

async function stopServer(): Promise<void> {
  await relay?.system.stop();
  relay?.deps.live.close();
  await app?.close();
}

before(async () => {
  db = await startThrowawayPostgres();
  await createSchema(db.pool);
  stores = postgresStores(db.pool);
  const bundle = readBundledData();
  await loadBundledData(stores, bundle);
  await stores.schedule.replace(DEFAULT_SCHEDULE);
  await stores.mission.saveIfMissing(DEFAULT_MISSION);
  solarEvent = solarEventProfile(bundle.radiationHours);
  await startServer();
});

after(async () => {
  await stopServer();
  await db?.stop();
  assert.deepEqual(relay.errors, []);
});

/** Moves the test clock on and hands over every event that has arrived by then. */
async function advance(ms: number): Promise<void> {
  clock += ms;
  await relay.system.deliverNow();
}

const get = async <T>(url: string): Promise<T> => {
  const res = await app.inject({ method: "GET", url });
  assert.equal(res.statusCode, 200, res.body);
  return res.json();
};
const write = (method: "POST" | "PUT" | "DELETE", url: string, payload?: object) =>
  app.inject({ method, url, headers: AUTH, ...(payload ? { payload } : {}) });
const setDelay = async (setting: object): Promise<RelayDelayResponse> => {
  const res = await write("PUT", "/api/relay/delay", setting);
  assert.equal(res.statusCode, 200, res.body);
  return res.json();
};
const sent = async <E extends RelayEvent>(response: Promise<{ statusCode: number; body: string; json: () => unknown }>): Promise<E> => {
  const res = await response;
  assert.equal(res.statusCode, 202, res.body);
  return res.json() as E;
};
const lagOf = (event: { sentAt: string; deliverAt: string }) => Date.parse(event.deliverAt) - Date.parse(event.sentAt);
const onboardCrew = async () => (await get<Astronaut[]>("/api/astronauts")).map((a) => a.id);
const groundCrew = () => get<GroundCrewResponse>("/api/ground/crew");

describe("the delay setting (PUT /api/relay/delay)", () => {
  it("starts on the ISS preset with no delay", async () => {
    const delay = await get<RelayDelayResponse>("/api/relay/delay");
    assert.deepEqual([delay.preset, delay.realTime, delay.oneWayDelayMs], ["iss", false, 0]);
  });

  it("needs the token, and refuses an unknown preset or an empty body", async () => {
    const noToken = await app.inject({ method: "PUT", url: "/api/relay/delay", payload: { preset: "moon" } });
    assert.equal(noToken.statusCode, 401);
    assert.equal((await write("PUT", "/api/relay/delay", { preset: "jupiter" })).statusCode, 400);
    assert.equal((await write("PUT", "/api/relay/delay", {})).statusCode, 400);
  });

  it("stores the preset and the real-time toggle in the mission record, each kept when the other changes", async () => {
    assert.equal((await setDelay({ preset: "marsClose" })).oneWayDelayMs, MARS_CLOSE_DEMO_MS);
    assert.equal((await setDelay({ realTime: true })).oneWayDelayMs, 3 * 60_000);
    assert.deepEqual(await stores.mission.relaySetting(), { preset: "marsClose", realTime: true });
    const back = await setDelay({ realTime: false });
    assert.deepEqual([back.preset, back.oneWayDelayMs], ["marsClose", MARS_CLOSE_DEMO_MS]);
  });
});

describe("a 🔴 reaches the flight surgeon after the delay (Mars close, demo scaling)", () => {
  let alert: OnboardAlert;

  before(async () => {
    await setDelay({ preset: "marsClose", realTime: false });
    assert.equal((await write("POST", "/api/demo/solar-storm")).statusCode, 200);
    await get("/api/astronauts/a1/status"); // the evaluation that sees the alert sends it
  });

  after(async () => {
    await write("DELETE", "/api/demo/solar-storm");
  });

  const groundAlert = async () =>
    (await get<GroundAlert[]>("/api/ground/alerts")).find((a) => a.ruleId === SOLAR_EVENT_RULE);

  it("is sent automatically, with sentAt and deliverAt for the banner countdown", async () => {
    const relayed = await get<OnboardAlert[]>("/api/astronauts/a1/relayed-alerts");
    alert = relayed.find((a) => a.ruleId === SOLAR_EVENT_RULE)!;
    assert.ok(alert, "the solar storm alert was relayed");
    assert.equal(alert.sentAt, new Date(clock).toISOString());
    assert.equal(lagOf(alert), MARS_CLOSE_DEMO_MS);
    assert.equal(alert.handling, null);
  });

  it("is not on the ground until the delay has passed, then shows its lag", async () => {
    await advance(MARS_CLOSE_DEMO_MS - 1);
    assert.equal(await groundAlert(), undefined);
    await advance(1);
    const arrived = (await groundAlert())!;
    assert.deepEqual([arrived.alertId, arrived.state, arrived.lagMs], [alert.alertId, "new", MARS_CLOSE_DEMO_MS]);
    assert.equal(arrived.receivedAt, alert.deliverAt);
    assert.ok(arrived.message?.what, "carries what the astronaut was told");
  });

  it("is acknowledged on the ground at once, and the crew learns of it one delay later", async () => {
    const ack = await sent<RelayEvent>(write("POST", `/api/ground/alerts/${alert.alertId}/acknowledge`));
    assert.equal(lagOf(ack), MARS_CLOSE_DEMO_MS);
    assert.equal((await groundAlert())!.state, "acknowledged");
    const onboardHandling = async () =>
      (await get<OnboardAlert[]>("/api/astronauts/a1/relayed-alerts")).find((a) => a.alertId === alert.alertId)!.handling;
    assert.equal(await onboardHandling(), null);
    await advance(MARS_CLOSE_DEMO_MS);
    assert.deepEqual(await onboardHandling(), { state: "acknowledged", at: ack.sentAt, receivedAt: ack.deliverAt });
  });

  it("is resolved, after which it cannot be acknowledged again; unknown alerts get 404", async () => {
    await sent(write("POST", `/api/ground/alerts/${alert.alertId}/resolve`));
    assert.equal((await groundAlert())!.state, "resolved");
    const again = await write("POST", `/api/ground/alerts/${alert.alertId}/acknowledge`);
    assert.deepEqual([again.statusCode, again.json().error], [409, "invalid_transition"]);
    assert.equal((await write("POST", "/api/ground/alerts/999999/acknowledge")).statusCode, 404);
    assert.equal((await app.inject({ method: "POST", url: `/api/ground/alerts/${alert.alertId}/resolve` })).statusCode, 401);
  });
});

describe("the crew grid on the ground holds delayed data only", () => {
  it("shows Astronaut 1's latest status snapshot once it has arrived, with its data-as-of time", async () => {
    await setDelay({ preset: "marsClose" });
    const evaluatedAt = new Date(clock).toISOString();
    await get("/api/astronauts/a1/status");
    await advance(MARS_CLOSE_DEMO_MS);
    const crew = await groundCrew();
    const a1 = crew.crew.find((m) => m.astronautId === "a1")!;
    assert.equal(a1.status?.at, evaluatedAt);
    assert.equal(crew.dataAsOf, evaluatedAt);
    assert.equal(a1.status?.areas.length, 6);
    assert.equal(crew.relay.preset, "marsClose");
  });
});

describe("surgeon notes and read receipts travel with the delay", () => {
  let note: RelayEvent;
  const onboardNotes = () => get<OnboardNote[]>("/api/astronauts/a1/notes");
  const groundNote = async () => (await get<GroundNote[]>("/api/ground/notes?astronautId=a1")).find((n) => n.noteId === note.id)!;

  it("reaches the astronaut only after the delay", async () => {
    note = await sent(write("POST", "/api/ground/notes", { astronautId: "a1", text: "Move to the shielded area, then recheck." }));
    assert.equal(lagOf(note), MARS_CLOSE_DEMO_MS);
    assert.deepEqual(await onboardNotes(), []);
    assert.equal((await write("POST", `/api/astronauts/a1/notes/${note.id}/read`)).statusCode, 404);
    await advance(MARS_CLOSE_DEMO_MS);
    const [arrived] = await onboardNotes();
    assert.deepEqual([arrived.noteId, arrived.text, arrived.readAt, arrived.receivedAt], [note.id, "Move to the shielded area, then recheck.", null, note.deliverAt]);
  });

  it("is read on board, and the ground sees the read receipt one delay later", async () => {
    const receipt = await sent<RelayEvent>(write("POST", `/api/astronauts/a1/notes/${note.id}/read`));
    const readAt = new Date(clock).toISOString();
    assert.equal((await onboardNotes())[0].readAt, readAt);
    assert.equal((await groundNote()).readAt, null);
    await advance(MARS_CLOSE_DEMO_MS);
    assert.deepEqual([(await groundNote()).readAt, (await groundNote()).readReceiptReceivedAt], [readAt, receipt.deliverAt]);
    const again = await sent<RelayEvent>(write("POST", `/api/astronauts/a1/notes/${note.id}/read`));
    assert.equal(again.id, receipt.id, "marking it read again sends nothing new");
  });

  it("refuses a note to an astronaut the ground does not know", async () => {
    const res = await write("POST", "/api/ground/notes", { astronautId: "nobody", text: "Hello" });
    assert.deepEqual([res.statusCode, res.json().error], [404, "unknown_astronaut"]);
  });
});

describe("events keep their order when the delay shrinks", () => {
  it("delivers a note sent after switching from Mars (far) to the ISS no earlier than the one before it", async () => {
    await setDelay({ preset: "marsFar" });
    const first = await sent<RelayEvent>(write("POST", "/api/ground/notes", { astronautId: "a1", text: "First" }));
    await setDelay({ preset: "iss" });
    const second = await sent<RelayEvent>(write("POST", "/api/ground/notes", { astronautId: "a1", text: "Second" }));
    assert.equal(lagOf(first), MARS_FAR_DEMO_MS);
    assert.equal(second.deliverAt, first.deliverAt);
    const texts = async () => (await get<OnboardNote[]>("/api/astronauts/a1/notes")).map((n) => n.text).filter((t) => t !== "Move to the shielded area, then recheck.");
    assert.deepEqual(await texts(), []);
    await advance(MARS_FAR_DEMO_MS);
    assert.deepEqual(await texts(), ["First", "Second"]);
    await setDelay({ preset: "marsClose" });
  });
});

describe("crew and watch changes take effect on board after the delay (SPEC §9.2)", () => {
  it("adds an astronaut on board one delay later, and the ground sees the new roster one more delay later", async () => {
    const add = await sent<RelayEvent>(write("POST", "/api/ground/crew/astronauts", { id: "a2", name: "Astronaut 2" }));
    assert.equal(lagOf(add), MARS_CLOSE_DEMO_MS);
    assert.deepEqual((await groundCrew()).pendingChanges.map((p) => p.changeId), [add.id]);
    assert.ok(!(await onboardCrew()).includes("a2"));
    await advance(MARS_CLOSE_DEMO_MS);
    assert.ok((await onboardCrew()).includes("a2"));
    assert.equal((await groundCrew()).crew.find((m) => m.astronautId === "a2"), undefined, "the roster is still on its way down");
    await advance(MARS_CLOSE_DEMO_MS);
    const crew = await groundCrew();
    assert.deepEqual(crew.crew.find((m) => m.astronautId === "a2"), {
      astronautId: "a2", name: "Astronaut 2", watch: null, status: null, receivedAt: null,
    });
    assert.deepEqual(crew.pendingChanges, []);
  });

  it("refuses adding an astronaut the crew already has", async () => {
    const res = await write("POST", "/api/ground/crew/astronauts", { id: "a2", name: "Again" });
    assert.deepEqual([res.statusCode, res.json().error], [409, "astronaut_exists"]);
  });

  it("assigns a watch, moves it to another astronaut, and reports no last contact or battery (no source yet)", async () => {
    await sent(write("PUT", "/api/ground/crew/astronauts/a2/watch", { watchId: "galaxy-7C21" }));
    await advance(MARS_CLOSE_DEMO_MS);
    const watchOf = async (id: string) => (await get<Astronaut[]>("/api/astronauts")).find((a) => a.id === id)!.watchId;
    assert.equal(await watchOf("a2"), "galaxy-7C21");
    await sent(write("PUT", "/api/ground/crew/astronauts/a1/watch", { watchId: "galaxy-7C21" }));
    await advance(MARS_CLOSE_DEMO_MS);
    assert.deepEqual([await watchOf("a1"), await watchOf("a2")], ["galaxy-7C21", null]);
    await advance(MARS_CLOSE_DEMO_MS);
    const a1 = (await groundCrew()).crew.find((m) => m.astronautId === "a1")!;
    assert.deepEqual(a1.watch, { watchId: "galaxy-7C21", lastContactAt: null, batteryPct: null });
    await sent(write("DELETE", "/api/ground/crew/astronauts/a1/watch"));
    await advance(MARS_CLOSE_DEMO_MS);
    assert.equal(await watchOf("a1"), null);
  });

  it("removes an astronaut after the delay; changing an unknown one gets 404", async () => {
    await sent(write("DELETE", "/api/ground/crew/astronauts/a2"));
    assert.ok((await onboardCrew()).includes("a2"));
    await advance(MARS_CLOSE_DEMO_MS);
    assert.ok(!(await onboardCrew()).includes("a2"));
    const res = await write("PUT", "/api/ground/crew/astronauts/a2/watch", { watchId: "w" });
    assert.deepEqual([res.statusCode, res.json().error], [404, "unknown_astronaut"]);
  });
});

describe("input that could never take effect is refused up front (review F002)", () => {
  it("refuses an age, mass or height outside a person's range with 400, before anything is queued", async () => {
    const before = (await groundCrew()).pendingChanges.length;
    for (const profile of [{ age: 3_000_000_000 }, { age: 151 }, { massKg: 10_000 }, { heightM: 12 }]) {
      const res = await write("POST", "/api/ground/crew/astronauts", { id: "a9", name: "Astronaut 9", ...profile });
      assert.equal(res.statusCode, 400, JSON.stringify(profile));
    }
    assert.equal((await groundCrew()).pendingChanges.length, before);
  });

  it("measures the 2,000-character note limit on the trimmed text", async () => {
    const fits = await write("POST", "/api/ground/notes", { astronautId: "a1", text: `  ${"x".repeat(2_000)}\n ` });
    assert.equal(fits.statusCode, 202, "surrounding whitespace does not count");
    assert.equal((fits.json() as RelayEvent).kind === "note" && (fits.json() as { payload: { text: string } }).payload.text.length, 2_000);
    assert.equal((await write("POST", "/api/ground/notes", { astronautId: "a1", text: "x".repeat(2_001) })).statusCode, 400);
  });

  it("refuses a whitespace-only note or name, and trims the text it sends", async () => {
    assert.equal((await write("POST", "/api/ground/notes", { astronautId: "a1", text: "  \n\t " })).statusCode, 400);
    assert.equal((await write("POST", "/api/ground/crew/astronauts", { id: "a9", name: "   " })).statusCode, 400);
    const note = await sent<RelayEvent>(write("POST", "/api/ground/notes", { astronautId: "a1", text: "  Rest now.  " }));
    assert.equal(note.kind === "note" && note.payload.text, "Rest now.");
  });
});

describe("several surgeon consoles at once (review F005, F008)", () => {
  // Let every change sent here arrive and be confirmed, so later tests start from a settled crew.
  after(() => advance(2 * MARS_CLOSE_DEMO_MS));

  const statuses = async (requests: Array<ReturnType<typeof write>>) => (await Promise.all(requests)).map((r) => r.statusCode).sort();

  it("adds an astronaut once when two consoles add the same id together", async () => {
    const add = () => write("POST", "/api/ground/crew/astronauts", { id: "a5", name: "Astronaut 5" });
    assert.deepEqual(await statuses([add(), add(), add()]), [202, 409, 409]);
  });

  it("acknowledges an alert once when two consoles acknowledge it together", async () => {
    await setDelay({ preset: "iss" });
    await write("DELETE", "/api/demo/solar-storm");
    await get("/api/astronauts/a1/status"); // the storm rule clears, so the next storm is a new alert
    assert.equal((await write("POST", "/api/demo/solar-storm")).statusCode, 200);
    await get("/api/astronauts/a1/status");
    await write("DELETE", "/api/demo/solar-storm");
    await advance(MARS_CLOSE_DEMO_MS); // after anything sent earlier on Mars (close): arrival order is kept
    const fresh = (await get<GroundAlert[]>("/api/ground/alerts")).find((a) => a.ruleId === SOLAR_EVENT_RULE && a.state === "new");
    assert.ok(fresh, "a new storm alert reached the ground");
    const ack = () => write("POST", `/api/ground/alerts/${fresh.alertId}/acknowledge`);
    assert.deepEqual(await statuses([ack(), ack(), ack()]), [202, 409, 409]);
    await setDelay({ preset: "marsClose" });
  });

  it("sends one read receipt when a note is marked read from the watch and the dashboard together", async () => {
    await setDelay({ preset: "iss" });
    const note = await sent<RelayEvent>(write("POST", "/api/ground/notes", { astronautId: "a1", text: "Read me twice" }));
    await advance(MARS_CLOSE_DEMO_MS);
    const read = () => write("POST", `/api/astronauts/a1/notes/${note.id}/read`);
    const receipts = (await Promise.all([read(), read(), read()])).map((r) => (r.json() as RelayEvent).id);
    assert.equal(new Set(receipts).size, 1);
    await setDelay({ preset: "marsClose" });
  });

  it("keeps both of two delay changes made together, one per field", async () => {
    await setDelay({ preset: "iss", realTime: false });
    await Promise.all([write("PUT", "/api/relay/delay", { preset: "marsFar" }), write("PUT", "/api/relay/delay", { realTime: true })]);
    const delay = await get<RelayDelayResponse>("/api/relay/delay");
    assert.deepEqual([delay.preset, delay.realTime], ["marsFar", true]);
    await setDelay({ preset: "marsClose", realTime: false });
  });
});

describe("owner decisions on the Phase 5 questions", () => {
  // Every test here runs on Mars (close); each leaves what it sent arrived and confirmed.
  before(() => setDelay({ preset: "marsClose", realTime: false }));
  after(() => advance(2 * MARS_CLOSE_DEMO_MS));

  const spo2 = (value: number) => ({
    astronautId: "a1", metric: "spo2", value, unit: "%", takenAt: new Date(clock).toISOString(), source: "watch",
  });
  const upload = (payload: object) => write("POST", "/api/readings", payload);
  const feed = () => get<GroundAlert[]>("/api/ground/alerts");

  it("relays a 🟡 to the ground's feed too, and its escalation to 🔴", async () => {
    const sinceMs = clock;
    assert.equal((await upload({ readings: [spo2(92)] })).statusCode, 200);
    await get("/api/astronauts/a1/status");
    clock += 1_000;
    assert.equal((await upload({ readings: [spo2(85)] })).statusCode, 200);
    await get("/api/astronauts/a1/status");
    await advance(MARS_CLOSE_DEMO_MS);
    const spo2Feed = (await feed()).filter((a) => a.metric === "spo2" && Date.parse(a.sentAt) >= sinceMs);
    assert.deepEqual(spo2Feed.map((a) => [a.ruleId, a.status]), [["spo2-watch", "watch"], ["spo2-alert", "alert"]]);
    // Owner decision: a 🟡 item can be acknowledged and resolved like a 🔴 one.
    const watchItem = spo2Feed[0];
    await sent(write("POST", `/api/ground/alerts/${watchItem.alertId}/acknowledge`));
    await sent(write("POST", `/api/ground/alerts/${watchItem.alertId}/resolve`));
    assert.equal((await feed()).find((a) => a.alertId === watchItem.alertId)!.state, "resolved");
    clock += 1_000;
    await upload({ readings: [spo2(98)] });
    await get("/api/astronauts/a1/status");
  });

  it("registers a watch on its first upload and reports its battery and last contact to the ground", async () => {
    const res = await upload({ readings: [spo2(98)], device: { watchId: "galaxy-4A9F", batteryPct: 64 } });
    assert.equal(res.statusCode, 200);
    const uploadedAt = new Date(clock).toISOString();
    assert.deepEqual((await groundCrew()).unassignedWatches, [], "the roster is on its way down");
    await advance(MARS_CLOSE_DEMO_MS);
    assert.deepEqual((await groundCrew()).unassignedWatches, [{ watchId: "galaxy-4A9F", lastContactAt: uploadedAt, batteryPct: 64 }]);
  });

  it("carries a worn watch's later contact and battery with the next periodic roster", async () => {
    await sent(write("PUT", "/api/ground/crew/astronauts/a1/watch", { watchId: "galaxy-4A9F" }));
    await advance(MARS_CLOSE_DEMO_MS);
    clock += 1_000;
    await upload({ readings: [spo2(98)], device: { watchId: "galaxy-4A9F", batteryPct: 61 } });
    const contactAt = new Date(clock).toISOString();
    await relay.system.upkeep();
    await advance(MARS_CLOSE_DEMO_MS);
    const crew = await groundCrew();
    assert.deepEqual(crew.crew.find((m) => m.astronautId === "a1")!.watch, { watchId: "galaxy-4A9F", lastContactAt: contactAt, batteryPct: 61 });
    assert.deepEqual(crew.unassignedWatches, []);
    await sent(write("DELETE", "/api/ground/crew/astronauts/a1/watch"));
  });

  it("accepts the watch app's exact upload: its UUID watch id, and an empty batch with an unknown battery", async () => {
    // The body the watch's ReadingsJson.encodeUpload writes (watch/app/.../ReadingsJsonTest.kt).
    const body = '{"readings":[],"device":{"watchId":"6f1c2b0e-4d8a-4c3e-9b1f-2a7d5e8c0f13","batteryPct":null}}';
    const res = await app.inject({ method: "POST", url: "/api/readings", headers: { ...AUTH, "content-type": "application/json" }, payload: body });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json(), { accepted: 0, duplicates: 0 });
    await advance(MARS_CLOSE_DEMO_MS);
    const watch = (await groundCrew()).unassignedWatches.find((w) => w.watchId === "6f1c2b0e-4d8a-4c3e-9b1f-2a7d5e8c0f13");
    assert.deepEqual(watch, { watchId: "6f1c2b0e-4d8a-4c3e-9b1f-2a7d5e8c0f13", lastContactAt: new Date(clock - MARS_CLOSE_DEMO_MS).toISOString(), batteryPct: null });
  });

  it("refuses a device report outside its ranges", async () => {
    for (const device of [{ watchId: "", batteryPct: 50 }, { watchId: "w".repeat(65), batteryPct: 50 }, { watchId: "w", batteryPct: 101 }, { watchId: "w", batteryPct: -1 }]) {
      assert.equal((await upload({ readings: [spo2(98)], device })).statusCode, 400, JSON.stringify(device));
    }
  });

  it("sends a crew-wide 🔴 once for the whole crew, shown on every astronaut's dashboard", async () => {
    await sent(write("POST", "/api/ground/crew/astronauts", { id: "a6", name: "Astronaut 6" }));
    await advance(MARS_CLOSE_DEMO_MS);
    const evaluateBoth = async () => {
      await get("/api/astronauts/a1/status");
      await get("/api/astronauts/a6/status");
    };
    await write("DELETE", "/api/demo/solar-storm");
    await evaluateBoth();
    const sinceMs = clock;
    await write("POST", "/api/demo/solar-storm");
    await evaluateBoth();
    await write("DELETE", "/api/demo/solar-storm");
    await evaluateBoth();
    await advance(MARS_CLOSE_DEMO_MS);
    const storm = (await feed()).filter((a) => a.ruleId === SOLAR_EVENT_RULE && Date.parse(a.sentAt) >= sinceMs);
    assert.equal(storm.length, 1);
    assert.equal(storm[0].crewWide, true);
    const onA6 = await get<OnboardAlert[]>("/api/astronauts/a6/relayed-alerts");
    assert.ok(onA6.some((a) => a.alertId === storm[0].alertId), "a6's dashboard shows the crew-wide alert");
  });

  it("shows the ground's charts only up to now − the one-way delay", async () => {
    const reading = spo2(97);
    await upload({ readings: [reading] });
    const url = "astronauts/a1/series?metric=spo2&range=1h";
    const has = (series: SeriesResponse) => series.points.some((p) => p.t === reading.takenAt);
    assert.ok(has(await get<SeriesResponse>(`/api/${url}`)), "on board at once");
    const ground = await get<GroundSeriesResponse>(`/api/ground/${url}`);
    assert.equal(has(ground), false);
    assert.deepEqual([ground.dataAsOf, ground.oneWayDelayMs], [new Date(clock - MARS_CLOSE_DEMO_MS).toISOString(), MARS_CLOSE_DEMO_MS]);
    clock += MARS_CLOSE_DEMO_MS;
    assert.ok(has(await get<GroundSeriesResponse>(`/api/ground/${url}`)), "on the ground one delay later");
  });

  it("tells the ground the mission through the relay", async () => {
    const { mission, receivedAt } = await get<GroundMissionResponse>("/api/ground/mission");
    assert.equal(mission?.name, DEFAULT_MISSION.name);
    assert.ok(receivedAt);
  });

  it("keeps the newest snapshot that has arrived when a newer one is still in flight (review F014)", async () => {
    await get("/api/astronauts/a1/status");
    await advance(MARS_CLOSE_DEMO_MS);
    const arrived = (await groundCrew()).crew.find((m) => m.astronautId === "a1")!.status;
    assert.ok(arrived);
    clock += SNAPSHOT_RETENTION_MS + MARS_CLOSE_DEMO_MS; // a week later…
    await get("/api/astronauts/a1/status"); // …a fresh snapshot leaves, still on its way at the prune
    await relay.system.upkeep();
    assert.deepEqual((await groundCrew()).crew.find((m) => m.astronautId === "a1")!.status, arrived, "the ground still shows it");
    await advance(MARS_CLOSE_DEMO_MS);
  });

  it("prunes status snapshots older than 7 days, keeping each astronaut's latest", async () => {
    await get("/api/astronauts/a1/status");
    await advance(MARS_CLOSE_DEMO_MS);
    const countSnapshots = async () =>
      Number((await db.pool.query("SELECT count(*) FROM relay_events WHERE kind = 'status'")).rows[0].count);
    const before = await countSnapshots();
    clock += SNAPSHOT_RETENTION_MS + 1;
    await relay.system.upkeep();
    const astronautsWithSnapshots = Number((await db.pool.query(
      "SELECT count(DISTINCT astronaut_id) FROM relay_events WHERE kind = 'status'",
    )).rows[0].count);
    assert.ok(before > astronautsWithSnapshots);
    assert.equal(await countSnapshots(), astronautsWithSnapshots);
    await relay.system.deliverNow();
  });
});

describe("daily logs reach the ground through the relay (check-ins, calories, exercise)", () => {
  before(() => setDelay({ preset: "marsClose", realTime: false }));
  after(() => advance(2 * MARS_CLOSE_DEMO_MS));

  const groundLog = () => get<GroundDailyLogResponse>("/api/ground/astronauts/a1/daily-log");
  const dailyLogRows = async () =>
    Number((await db.pool.query("SELECT count(*) FROM relay_events WHERE kind = 'dailyLog' AND astronaut_id = 'a1'")).rows[0].count);
  /** One minute's upkeep, then the delay passes. */
  const upkeepAndArrive = async () => {
    await relay.system.upkeep();
    await advance(MARS_CLOSE_DEMO_MS);
  };

  it("shows a new check-in and meal on the ground only once the next daily log has arrived", async () => {
    await upkeepAndArrive();
    const food = (await get<FoodMenu>("/api/menu")).foods.find((f) => f.kcal !== null && f.kcal > 0)!;
    const checkIn = (await write("POST", "/api/astronauts/a1/checkins", { mood: 2, stress: 4 })).json() as CheckIn;
    assert.equal((await write("POST", "/api/astronauts/a1/meals", { foodId: food.id })).statusCode, 200);
    const hasCheckIn = (res: GroundDailyLogResponse) => res.log?.checkIns.some((c) => c.id === checkIn.id) ?? false;

    assert.equal(hasCheckIn(await groundLog()), false, "not read from the onboard tables");
    await relay.system.upkeep();
    assert.equal(hasCheckIn(await groundLog()), false, "sent, but still on its way");
    const event = (await stores.relay.list("dailyLog", { astronautId: "a1" })).at(-1)!;
    assert.equal(Date.parse(event.deliverAt) - Date.parse(event.sentAt), MARS_CLOSE_DEMO_MS);

    await advance(MARS_CLOSE_DEMO_MS);
    const { log, sentAt, receivedAt } = await groundLog();
    assert.ok(log && hasCheckIn({ log, sentAt, receivedAt }));
    assert.deepEqual([sentAt, receivedAt], [event.sentAt, event.deliverAt]);
    const today = new Date(clock).toISOString().slice(0, 10);
    const todayCalories = log.calories.find((day) => day.day === today)!;
    assert.ok(todayCalories.kcalAtLeast >= food.kcal!, "today's calories include the meal, counted on board");
    assert.ok(todayCalories.mealsLogged >= 1);
    assert.equal(log.exercise.at(-1)?.day, today, "exercise minutes run to today");
    assert.equal(log.exercise[0].day, DEFAULT_MISSION.startDate, "from mission day 1");
    const onboardDays = await get<ExerciseDay[]>("/api/astronauts/a1/exercise/daily?range=mission");
    assert.deepEqual(log.exercise, onboardDays, "counted as the onboard exercise endpoint counts them");
  });

  it("sends nothing new when nothing changed, and keeps only each astronaut's newest arrived log", async () => {
    await upkeepAndArrive();
    const sentBefore = (await stores.relay.list("dailyLog", { astronautId: "a1" })).at(-1)!.id;
    await upkeepAndArrive();
    assert.equal((await stores.relay.list("dailyLog", { astronautId: "a1" })).at(-1)!.id, sentBefore, "unchanged: not sent again");
    await relay.system.upkeep();
    assert.equal(await dailyLogRows(), 1);
  });

  it("rebuilds only today and yesterday each minute, with the same result as a full rebuild (owner decision)", async () => {
    const astronaut = (await stores.astronauts.find("a1"))!;
    const latestSent = async () => (await stores.relay.list("dailyLog", { astronautId: "a1" })).at(-1)!.payload;
    const withoutTime = ({ at: _at, ...content }: DailyLog) => content;
    const fullRebuild = async () => withoutTime(await readDailyLog(stores, DEFAULT_RULE_BOOK.settings, astronaut, clock));
    const food = (await get<FoodMenu>("/api/menu")).foods.find((f) => f.kcal !== null)!;

    await upkeepAndArrive();
    for (let day = 0; day < 3; day += 1) {
      assert.equal((await write("POST", "/api/astronauts/a1/checkins", { mood: 1 + day, stress: 2 })).statusCode, 200);
      assert.equal((await write("POST", "/api/astronauts/a1/meals", { foodId: food.id })).statusCode, 200);
      await upkeepAndArrive();
      assert.deepEqual(withoutTime(await latestSent()), await fullRebuild(), `day ${day}: identical to a full rebuild`);
      clock += DAY_MS; // the day turns: what was today is yesterday, then kept as built
    }
    await upkeepAndArrive();
    assert.deepEqual(withoutTime(await latestSent()), await fullRebuild(), "after the days turned");
  });

  describe("a write to an earlier day reaches the ground after one delay, with no restart", () => {
    const astronautP = () => stores.astronauts.find("a1").then((a) => a!);
    const withoutTime = ({ at: _at, ...content }: DailyLog) => content;
    const fullRebuild = async () => withoutTime(await readDailyLog(stores, DEFAULT_RULE_BOOK.settings, await astronautP(), clock));
    /** Three days ago, 10:00 UTC: before yesterday, so only the write's mark makes the run rebuild it. */
    const earlierDay = () => Date.parse(`${new Date(clock - 3 * DAY_MS).toISOString().slice(0, 10)}T10:00:00.000Z`);
    const dayLabel = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const groundLog = async () => (await get<GroundDailyLogResponse>("/api/ground/astronauts/a1/daily-log")).log!;
    /** The ground's log after one run and one delay, checked against a full rebuild. */
    const arrivedLog = async () => {
      await upkeepAndArrive();
      const log = await groundLog();
      assert.deepEqual(withoutTime(log), await fullRebuild(), "the ground's log equals a full rebuild");
      return log;
    };

    before(() => upkeepAndArrive());

    it("a check-in posted with an earlier time, then deleted", async () => {
      const at = new Date(earlierDay()).toISOString();
      const checkIn = (await write("POST", "/api/astronauts/a1/checkins", { mood: 5, stress: 1, at })).json() as CheckIn;
      assert.ok((await arrivedLog()).checkIns.some((c) => c.id === checkIn.id), "added on the ground");
      assert.equal((await write("DELETE", `/api/astronauts/a1/checkins/${checkIn.id}`)).statusCode, 200);
      assert.ok(!(await arrivedLog()).checkIns.some((c) => c.id === checkIn.id), "removed on the ground");
    });

    it("a meal posted with an earlier time, then deleted", async () => {
      const at = earlierDay();
      const food = (await get<FoodMenu>("/api/menu")).foods.find((f) => f.kcal !== null && f.kcal > 0)!;
      const kcalOn = (log: DailyLog) => log.calories.find((day) => day.day === dayLabel(at))?.kcalAtLeast ?? 0;
      const before = kcalOn(await groundLog());
      const meal = (await write("POST", "/api/astronauts/a1/meals", { foodId: food.id, eatenAt: new Date(at).toISOString() })).json() as { id: number };
      assert.equal(kcalOn(await arrivedLog()), before + food.kcal!, "the day's calories grew on the ground");
      assert.equal((await write("DELETE", `/api/astronauts/a1/meals/${meal.id}`)).statusCode, 200);
      assert.equal(kcalOn(await arrivedLog()), before, "and went back");
    });

    it("heart-rate readings uploaded late", async () => {
      const startMs = earlierDay();
      const minutesOn = (log: DailyLog) => log.exercise.find((day) => day.day === dayLabel(startMs))?.minutes ?? null;
      const before = minutesOn(await groundLog());
      const readings = Array.from({ length: 30 }, (_, i) => ({
        astronautId: "a1", metric: "heartRate", value: 160, unit: "bpm", takenAt: new Date(startMs + i * 60_000).toISOString(), source: "watch",
      }));
      assert.equal((await write("POST", "/api/readings", { readings })).statusCode, 200);
      const after = minutesOn(await arrivedLog());
      assert.ok(after !== null && after > (before ?? 0), `exercise minutes on that day went up on the ground (${before} → ${after})`);
    });
  });

  it("answers with nulls for an astronaut whose log has not arrived", async () => {
    assert.deepEqual(await get<GroundDailyLogResponse>("/api/ground/astronauts/nobody/daily-log"), { log: null, sentAt: null, receivedAt: null });
  });
});

describe("the queue survives a restart", () => {
  it("keeps events in flight and hands over those that arrived while the server was down", async () => {
    const add = await sent<RelayEvent>(write("POST", "/api/ground/crew/astronauts", { id: "a3", name: "Astronaut 3" }));
    await stopServer();
    clock += MARS_CLOSE_DEMO_MS; // arrives while the server is down
    await startServer();
    assert.ok((await onboardCrew()).includes("a3"), "applied on start");
    const pending = (await groundCrew()).pendingChanges.map((p) => p.changeId);
    assert.deepEqual(pending, [add.id], "the roster confirming it is on its way down");
    await advance(MARS_CLOSE_DEMO_MS);
    assert.ok((await groundCrew()).crew.some((m) => m.astronautId === "a3"));
    assert.ok((await get<GroundNote[]>("/api/ground/notes")).some((n) => n.text === "First"), "earlier events are kept");
  });

  it("keeps a removed astronaut removed when the bundled data loads again, with their history kept", async () => {
    await sent(write("DELETE", "/api/ground/crew/astronauts/a1"));
    await advance(MARS_CLOSE_DEMO_MS);
    await stopServer();
    await loadBundledData(stores, readBundledData(), clock); // as src/index.ts does on every start
    await startServer();
    assert.ok(!(await onboardCrew()).includes("a1"));
    assert.ok((await stores.readings.latest("a1", clock)).length > 0, "their stored history stays");
    // Owner decision: the ground may still chart a removed astronaut's history; crew views hide them.
    const chart = "astronauts/a1/series?metric=heartRate&range=mission";
    assert.equal((await app.inject({ method: "GET", url: `/api/ground/${chart}` })).statusCode, 200);
    assert.equal((await app.inject({ method: "GET", url: `/api/${chart}` })).statusCode, 404);
    assert.equal((await app.inject({ method: "GET", url: "/api/ground/astronauts/nobody/series?metric=heartRate" })).statusCode, 404);
    await sent(write("POST", "/api/ground/crew/astronauts", { id: "a1", name: "Astronaut 1" }));
    await advance(MARS_CLOSE_DEMO_MS);
    assert.ok((await onboardCrew()).includes("a1"), "the ground can bring them back");
  });
});

describe("the console's two-step simulated storm (Mars far, demo scaling)", () => {
  const WATCH_RULE = "radiation-solar-event-watch";
  const storm = (factor?: number) => write("POST", "/api/demo/solar-storm", factor === undefined ? undefined : { factor });
  const clearStorm = () => write("DELETE", "/api/demo/solar-storm");
  const stormState = () => get<SolarStormState>("/api/demo/solar-storm");
  /** The storm as the console shows it: whether one is on, and its factor. */
  const stormNow = async () => { const { active, factor } = await stormState(); return { active, factor }; };
  /** The alert of the rule that left the ship at the current clock time, if any. */
  const relayedNow = async (ruleId: string) =>
    (await get<OnboardAlert[]>("/api/astronauts/a1/relayed-alerts")).find((a) => a.ruleId === ruleId && a.sentAt === new Date(clock).toISOString());
  const onGround = async (alertId: string) => (await get<GroundAlert[]>("/api/ground/alerts")).find((a) => a.alertId === alertId);

  before(async () => {
    await setDelay({ preset: "marsFar", realTime: false });
    await advance(MARS_FAR_DEMO_MS);
  });

  after(async () => {
    await clearStorm();
    await setDelay({ preset: "iss" });
    await advance(MARS_FAR_DEMO_MS);
  });

  it("reports no storm until one is started", async () => {
    assert.equal((await clearStorm()).statusCode, 200);
    assert.deepEqual(await stormNow(), { active: false, factor: null });
  });

  it("sends the 🟡 of the first press at once, with no status request, arriving 30 s later", async () => {
    await advance(1_000);
    assert.equal((await storm(DEMO_STORM_STEPS.watch)).statusCode, 200);
    const watch = await relayedNow(WATCH_RULE);
    assert.ok(watch, "the 🟡 left with the press");
    assert.deepEqual([watch.status, lagOf(watch)], ["watch", MARS_FAR_DEMO_MS]);
    assert.deepEqual(await stormNow(), { active: true, factor: DEMO_STORM_STEPS.watch });
    assert.equal((await stormState()).startedAt, new Date(clock).toISOString(), "the first press starts the storm");
  });

  it("sends the 🔴 of the second press at once, and the ground has it 30 s later", async () => {
    const startedAt = (await stormState()).startedAt;
    await advance(1_000);
    assert.equal((await storm(DEMO_STORM_STEPS.alert)).statusCode, 200);
    assert.equal((await stormState()).startedAt, startedAt, "escalating keeps the storm's start");
    const alert = await relayedNow(SOLAR_EVENT_RULE);
    assert.ok(alert, "the 🔴 left with the press");
    await advance(MARS_FAR_DEMO_MS - 1);
    assert.equal(await onGround(alert.alertId), undefined, "not on the ground yet");
    await advance(1);
    assert.equal((await onGround(alert.alertId))?.lagMs, MARS_FAR_DEMO_MS);
  });

  /** How long the race test lets a press run ahead of a stalled minute check. */
  const PRESS_HEAD_START_MS = 1_000;

  it("never logs a minute check's older status after a press's newer one (review F001)", async () => {
    // At 🟡: the minute check computes its status, then stalls before logging it; meanwhile the presenter escalates.
    assert.equal((await clearStorm()).statusCode, 200);
    await advance(1_000);
    assert.equal((await storm(DEMO_STORM_STEPS.watch)).statusCode, 200);
    await advance(1_000);
    const sinceMs = clock;
    let reached!: () => void;
    let release!: () => void;
    const tickComputed = new Promise<void>((resolve) => { reached = resolve; });
    slowLogging = { reached: () => reached(), released: new Promise<void>((resolve) => { release = resolve; }) };
    const tick = statusEvaluator.evaluateCrew();
    await tickComputed;
    const press = storm(DEMO_STORM_STEPS.alert);
    // Give the press every chance to store its readings and log ahead of the stalled check (it must
    // wait its turn instead), then free the check.
    const pressAnswered = await Promise.race([press.then(() => true), new Promise<false>((resolve) => setTimeout(() => resolve(false), PRESS_HEAD_START_MS))]);
    assert.equal(pressAnswered, false, "the press waits for the evaluation already running");
    assert.equal((await stormState()).factor, DEMO_STORM_STEPS.alert, "the storm itself is stored at once");
    release();
    assert.deepEqual(await tick, []);
    assert.equal((await press).statusCode, 200);
    await statusEvaluator.evaluateCrew(); // the next minute check
    const radiation = (await get<AlertLogEntry[]>(`/api/astronauts/a1/alerts?area=radiation&from=${new Date(sinceMs).toISOString()}`))
      .filter((entry) => entry.ruleId === null);
    assert.deepEqual(radiation.map((entry) => [entry.from, entry.to]), [["watch", "alert"]], "one escalation, never back to 🟡");
  });

  it("refuses a press made from an out-of-date view with 409, changing nothing", async () => {
    // The storm is at 🔴 (factor 5); a console that still shows "no storm" presses "Start storm".
    const stale = await write("POST", "/api/demo/solar-storm", { factor: DEMO_STORM_STEPS.watch, expectedFactor: null });
    assert.equal(stale.statusCode, 409);
    const conflict = stale.json() as SolarStormConflict;
    assert.equal(conflict.error, "storm_changed");
    assert.deepEqual([conflict.current.active, conflict.current.factor], [true, DEMO_STORM_STEPS.alert]);
    assert.match(conflict.message, /expected no storm, but the ship has a storm at factor 5/);
    assert.deepEqual(await stormNow(), { active: true, factor: DEMO_STORM_STEPS.alert }, "nothing changed");
    const current = await write("POST", "/api/demo/solar-storm", { factor: DEMO_STORM_STEPS.alert, expectedFactor: DEMO_STORM_STEPS.alert });
    assert.equal(current.statusCode, 200, "a press that matches the storm goes through");
  });

  it("sees a cleared storm at once, so the next press is a new alert", async () => {
    assert.equal((await clearStorm()).statusCode, 200);
    assert.deepEqual(await stormNow(), { active: false, factor: null });
    await advance(1_000);
    assert.equal((await storm()).statusCode, 200);
    assert.ok(await relayedNow(SOLAR_EVENT_RULE), "a new 🔴 left with the press");
  });

  it("lets only one of two presses made from the same view through; the other gets 409 (review: atomic presses)", async () => {
    assert.equal((await clearStorm()).statusCode, 200);
    await advance(1_000);
    const press = () => write("POST", "/api/demo/solar-storm", { factor: DEMO_STORM_STEPS.watch, expectedFactor: null });
    const statuses = (await Promise.all([press(), press()])).map((r) => r.statusCode).sort();
    assert.deepEqual(statuses, [200, 409]);
  });

  it("applies an escalate and a clear sent together one after the other, never interleaved", async () => {
    await advance(1_000);
    const [escalate, clear] = await Promise.all([
      write("POST", "/api/demo/solar-storm", { factor: DEMO_STORM_STEPS.alert, expectedFactor: DEMO_STORM_STEPS.watch }),
      clearStorm(),
    ]);
    // Escalate then clear: both go through. Clear then escalate: the escalate sees no storm and is refused.
    assert.equal(clear.statusCode, 200);
    assert.ok([200, 409].includes(escalate.statusCode), `escalate answered ${escalate.statusCode}`);
    assert.deepEqual(await stormNow(), { active: false, factor: null }, "either way, no storm is left");
    assert.equal((await stormState()).startedAt !== null, true, "the clear keeps the start for the reset");
  });

  it("counts a storm pressed 48 hours ago as no storm, and starts the next press afresh (pending owner review)", async () => {
    assert.equal((await storm(DEMO_STORM_STEPS.alert)).statusCode, 200);
    const oldStart = (await stormState()).startedAt;
    await advance(STORM_ACTIVE_MS);
    assert.deepEqual(await stormNow(), { active: false, factor: null });
    assert.equal((await write("POST", "/api/demo/solar-storm", { factor: DEMO_STORM_STEPS.watch, expectedFactor: null })).statusCode, 200);
    const fresh = await stormState();
    assert.deepEqual([fresh.active, fresh.factor], [true, DEMO_STORM_STEPS.watch]);
    assert.notEqual(fresh.startedAt, oldStart);
    assert.equal(fresh.startedAt, new Date(clock).toISOString());
  });

  it("forgets the storm's start on request (the reset, once it has resolved that storm's alerts)", async () => {
    const res = await write("DELETE", "/api/demo/solar-storm/started-at");
    assert.equal(res.statusCode, 200);
    assert.equal((res.json() as SolarStormState).startedAt, null);
    assert.equal((await stormState()).startedAt, null);
  });
});
