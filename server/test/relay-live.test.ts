// Live updates over WebSocket (SPEC §10 /ws/onboard, /ws/ground) on a listening server with the
// real clock: the delivery timer hands each event over on time and both sides hear about it.
import assert from "node:assert/strict";
import { connect } from "node:net";
import { after, before, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import type { LiveMessage, RelayEvent } from "@heartbeat/shared";
import { readBundledData } from "../src/data/bundled-files.ts";
import { loadBundledData } from "../src/data/load-bundled.ts";
import { createSchema, postgresStores } from "../src/db/index.ts";
import { DEFAULT_MISSION } from "../src/domain/mission.ts";
import { DEFAULT_RULE_BOOK } from "../src/domain/rules/rule-book.ts";
import { solarEventProfile } from "../src/domain/solar-storm.ts";
import { buildApp } from "../src/http/app.ts";
import type { AppDeps } from "../src/http/deps.ts";
import { testSleepDerivation } from "./support/sleep-job.ts";
import { testRelay, type TestRelay } from "./support/relay.ts";
import { testStatusEvaluator } from "./support/status-evaluator.ts";
import { startThrowawayPostgres, type ThrowawayPostgres } from "./support/throwaway-postgres.ts";

const TOKEN = "test-token";
const AUTH = { authorization: `Bearer ${TOKEN}` };
const MOON_DELAY_MS = 1_300;
/** Timer slack allowed on top of the delay. */
const ON_TIME_TOLERANCE_MS = 500;
const MESSAGE_TIMEOUT_MS = 5_000;

let db: ThrowawayPostgres;
let app: FastifyInstance;
let appDeps: AppDeps;
let relay: TestRelay;
let baseUrl: string;

before(async () => {
  db = await startThrowawayPostgres();
  await createSchema(db.pool);
  const stores = postgresStores(db.pool);
  const bundle = readBundledData();
  await loadBundledData(stores, bundle);
  await stores.mission.saveIfMissing(DEFAULT_MISSION);
  relay = testRelay(stores, Date.now);
  appDeps = { stores, token: TOKEN, solarEvent: solarEventProfile(bundle.radiationHours), ruleBook: DEFAULT_RULE_BOOK, now: Date.now, ...relay.deps, statusEvaluator: testStatusEvaluator(stores, Date.now, relay), sleepDerivation: testSleepDerivation(stores, Date.now).job };
  app = await buildApp(appDeps, { logger: false });
  await relay.system.start();
  baseUrl = await app.listen({ port: 0, host: "127.0.0.1" });
});

after(async () => {
  await relay?.system.stop();
  relay?.deps.live.close();
  await app?.close();
  await db?.stop();
  assert.deepEqual(relay.errors, []);
});

/** A client on one side that records every message it receives. */
async function listen(side: "onboard" | "ground") {
  const socket = new WebSocket(`${baseUrl.replace("http", "ws")}/ws/${side}`);
  const messages: Array<{ at: number; message: LiveMessage }> = [];
  socket.on("message", (data) => messages.push({ at: Date.now(), message: JSON.parse(String(data)) }));
  await new Promise((resolve, reject) => socket.once("open", resolve).once("error", reject));
  return {
    socket,
    /** Resolves with the first message (already received or arriving within the timeout) that matches. */
    async next(matches: (message: LiveMessage) => boolean) {
      const deadline = Date.now() + MESSAGE_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const found = messages.find((entry) => matches(entry.message));
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`no matching message on /ws/${side} within ${MESSAGE_TIMEOUT_MS} ms`);
    },
  };
}

const isEvent = (type: "relaySent" | "relayDelivered", id: string) => (message: LiveMessage) =>
  message.type === type && message.event.id === id;

describe("WebSocket live updates", () => {
  it("pushes a delay change to both sides", async () => {
    const [onboard, ground] = [await listen("onboard"), await listen("ground")];
    await app.inject({ method: "PUT", url: "/api/relay/delay", headers: AUTH, payload: { preset: "moon" } });
    for (const side of [onboard, ground]) {
      const { message } = await side.next((m) => m.type === "relayDelay");
      assert.equal(message.type === "relayDelay" && message.relay.oneWayDelayMs, MOON_DELAY_MS);
      side.socket.close();
    }
  });

  it("pushes a note to the ground as sent, and to the astronaut when the timer hands it over on time", async () => {
    const [onboard, ground] = [await listen("onboard"), await listen("ground")];
    const res = await app.inject({ method: "POST", url: "/api/ground/notes", headers: AUTH, payload: { astronautId: "a1", text: "Hydrate." } });
    const note: RelayEvent = res.json();
    await ground.next(isEvent("relaySent", note.id));
    const delivered = await onboard.next(isEvent("relayDelivered", note.id));
    const lateBy = delivered.at - Date.parse(note.deliverAt);
    assert.ok(lateBy >= 0 && lateBy < ON_TIME_TOLERANCE_MS, `delivered ${lateBy} ms after deliverAt`);
    onboard.socket.close();
    ground.socket.close();
  });

  it("pushes each fresh status to the onboard side, and its new 🔴 alert to the ground on arrival", async () => {
    const [onboard, ground] = [await listen("onboard"), await listen("ground")];
    await app.inject({ method: "POST", url: "/api/demo/solar-storm", headers: AUTH });
    await app.inject({ method: "GET", url: "/api/astronauts/a1/status" });
    await onboard.next((m) => m.type === "status" && m.status.astronautId === "a1");
    const { message } = await ground.next((m) => m.type === "relayDelivered" && m.event.kind === "alert");
    assert.equal(message.type === "relayDelivered" && message.event.kind === "alert" && message.event.payload.ruleId, "radiation-solar-event-alert");
    onboard.socket.close();
    ground.socket.close();
  });

  it("pushes new readings to the onboard side as soon as they are accepted", async () => {
    const onboard = await listen("onboard");
    const takenAt = new Date().toISOString();
    const res = await app.inject({
      method: "POST", url: "/api/readings", headers: AUTH,
      payload: { readings: [{ astronautId: "a1", metric: "heartRate", value: 66, unit: "bpm", takenAt, source: "watch" }] },
    });
    assert.equal(res.statusCode, 200);
    const { message } = await onboard.next((m) => m.type === "readings");
    assert.deepEqual(message, { type: "readings", astronautId: "a1", metrics: ["heartRate"] });
    onboard.socket.close();
  });

  it("still answers 200 and pushes the readings when recording the watch fails (review F015)", async () => {
    const pushed: LiveMessage[] = [];
    const recordingHub = { publish: (_side: string, message: LiveMessage) => { pushed.push(message); }, attach: () => {}, close: () => {} };
    const failingCrew = { watchReported: async () => { throw new Error("relay queue unreachable"); } };
    const other = await buildApp(
      { ...appDeps, live: recordingHub as unknown as typeof appDeps.live, crew: failingCrew },
      { logger: false },
    );
    const takenAt = new Date().toISOString();
    const res = await other.inject({
      method: "POST", url: "/api/readings", headers: AUTH,
      payload: {
        readings: [{ astronautId: "a1", metric: "heartRate", value: 67, unit: "bpm", takenAt, source: "watch" }],
        device: { watchId: "w-fails", batteryPct: 40 },
      },
    });
    await other.close();
    assert.deepEqual([res.statusCode, res.json()], [200, { accepted: 1, duplicates: 0 }]);
    assert.deepEqual(pushed, [{ type: "readings", astronautId: "a1", metrics: ["heartRate"] }]);
  });

  it("drops a client that sends a malformed frame and keeps serving (review F001)", async () => {
    const { port } = new URL(baseUrl);
    const socket = connect(Number(port), "127.0.0.1");
    await new Promise((resolve) => socket.once("connect", resolve));
    socket.write([
      "GET /ws/onboard HTTP/1.1", `Host: 127.0.0.1:${port}`, "Upgrade: websocket", "Connection: Upgrade",
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==", "Sec-WebSocket-Version: 13", "", "",
    ].join("\r\n"));
    await new Promise((resolve) => socket.once("data", resolve)); // 101 Switching Protocols
    // A text frame without the mask every client frame must carry: a protocol error.
    socket.write(Buffer.from([0x81, 0x02, 0x68, 0x69]));
    await new Promise((resolve) => socket.once("close", resolve));
    assert.equal(relay.clientErrors.length, 1);
    assert.equal((await fetch(`${baseUrl}/api/health`)).status, 200, "the server is still up");
  });

  it("answers malformed upgrade targets with 400 and keeps serving (final spec check)", async () => {
    const { port } = new URL(baseUrl);
    for (const target of ["//", "//:", "//a:b", "ws/onboard"]) {
      const socket = connect(Number(port), "127.0.0.1");
      await new Promise((resolve) => socket.once("connect", resolve));
      socket.write([
        `GET ${target} HTTP/1.1`, "Host: x", "Connection: Upgrade", "Upgrade: websocket",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==", "Sec-WebSocket-Version: 13", "", "",
      ].join("\r\n"));
      const response = await new Promise<string>((resolve) => socket.once("data", (data) => resolve(String(data))));
      assert.match(response, /^HTTP\/1\.1 400 /, target);
      socket.destroy();
      assert.equal((await fetch(`${baseUrl}/api/health`)).status, 200, `still up after ${target}`);
    }
  });

  it("refuses other WebSocket paths", async () => {
    const socket = new WebSocket(`${baseUrl.replace("http", "ws")}/ws/elsewhere`);
    await new Promise((resolve) => socket.once("error", resolve));
  });
});
