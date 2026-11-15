// The demo reset's steps (scripts/demo-reset-run.ts) against a stand-in server: a storm's alerts,
// one still on its way, and a real-data alert raised between two resets (review).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GroundAlertState } from "@heartbeat/shared";
import { RETRY_WAIT_MS } from "../scripts/demo-reset-plan.ts";
import { runDemoReset, type ResetIo } from "../scripts/demo-reset-run.ts";

const WATCH_RULE = "radiation-solar-event-watch";
const ALERT_RULE = "radiation-solar-event-alert";
const LINK_MS = 30_000;

interface FakeAlert { alertId: string; ruleId: string; sentAt: string; arrivesMs: number; state: GroundAlertState }

/** A stand-in onboard server: a clock, the storm's start, and alerts that reach the ground at `arrivesMs`. */
function fakeServer(startMs: number) {
  let nowMs = startMs;
  let stormStartedMs: number | null = null;
  const alerts: FakeAlert[] = [];
  const iso = (ms: number) => new Date(ms).toISOString();
  const onGround = () => alerts.filter((a) => a.arrivesMs <= nowMs);
  const routes: Record<string, (body?: object) => unknown> = {
    "GET /api/relay/delay": () => ({ oneWayDelayMs: LINK_MS }),
    "PUT /api/relay/delay": () => ({ oneWayDelayMs: LINK_MS }),
    "GET /api/demo/solar-storm": () => ({ active: false, factor: null, startedAt: stormStartedMs === null ? null : iso(stormStartedMs) }),
    "DELETE /api/demo/solar-storm": () => ({ cleared: true, clearedAt: iso(nowMs) }),
    "DELETE /api/demo/solar-storm/started-at": () => { stormStartedMs = null; return { startedAt: null }; },
    "GET /api/ground/alerts": () => onGround().map(({ arrivesMs: _, ...alert }) => alert),
    "GET /api/astronauts": () => [{ id: "a1" }],
  };
  const io: ResetIo & { slept: number[]; lines: string[] } = {
    slept: [],
    lines: [],
    async call(method, path) {
      const resolve = /^\/api\/ground\/alerts\/([^/]+)\/resolve$/.exec(path);
      if (method === "POST" && resolve) {
        alerts.find((a) => a.alertId === decodeURIComponent(resolve[1]))!.state = "resolved";
        return {};
      }
      if (method === "GET" && path.startsWith("/api/astronauts/a1/relayed-alerts")) return alerts.map(({ arrivesMs: _, state: __, ...a }) => a);
      const route = routes[`${method} ${path}`];
      if (!route) throw new Error(`no route ${method} ${path}`);
      return route();
    },
    async sleep(ms) { io.slept.push(ms); nowMs += ms; },
    log(line) { io.lines.push(line); },
  };
  return {
    io,
    startStorm() { stormStartedMs = nowMs; },
    sendAlert(alertId: string, ruleId: string, arrivesAfterMs = LINK_MS) {
      alerts.push({ alertId, ruleId, sentAt: iso(nowMs), arrivesMs: nowMs + arrivesAfterMs, state: "new" });
    },
    pass(ms: number) { nowMs += ms; },
    stateOf: (alertId: string) => alerts.find((a) => a.alertId === alertId)!.state,
    stormStarted: () => stormStartedMs,
  };
}

describe("runDemoReset", () => {
  it("resolves the rehearsal's alerts, one still on its way included, and forgets the storm's start", async () => {
    const server = fakeServer(Date.parse("2026-11-15T06:00:00Z"));
    server.startStorm();
    server.sendAlert("w", WATCH_RULE);
    server.pass(40_000);
    server.sendAlert("a", ALERT_RULE); // pressed just before the reset: still on its way when it starts
    const outcome = await runDemoReset(server.io);
    assert.deepEqual(outcome, { resolved: 2, stillInFlight: 0 });
    assert.deepEqual([server.stateOf("w"), server.stateOf("a")], ["resolved", "resolved"]);
    assert.equal(server.stormStarted(), null, "the start is forgotten");
    assert.ok(server.io.lines.some((line) => line.startsWith("… Waiting 32 s")), "it says what it waits for");
  });

  it("never resolves a real-data alert raised after an earlier reset", async () => {
    const server = fakeServer(Date.parse("2026-11-15T06:00:00Z"));
    server.startStorm();
    server.sendAlert("rehearsal", ALERT_RULE);
    server.pass(LINK_MS);
    assert.equal((await runDemoReset(server.io)).resolved, 1);
    server.pass(60_000);
    server.sendAlert("real", ALERT_RULE); // the real Sept 2017 event on the loop, no storm pressed
    server.pass(LINK_MS);
    const second = await runDemoReset(server.io);
    assert.deepEqual(second, { resolved: 0, stillInFlight: 0 });
    assert.equal(server.stateOf("real"), "new", "left for the flight surgeon");
    assert.ok(server.io.lines.includes("✓ No storm since the last reset, so no rehearsal alerts to resolve"));
  });

  it("waits a while longer for an alert whose arrival is being retried, then reports it and keeps the start for a rerun", async () => {
    const server = fakeServer(Date.parse("2026-11-15T06:00:00Z"));
    server.startStorm();
    server.sendAlert("stuck", ALERT_RULE, 10 * 60_000); // its arrival keeps failing
    const outcome = await runDemoReset(server.io);
    assert.deepEqual(outcome, { resolved: 0, stillInFlight: 1 });
    assert.equal(server.stormStarted() !== null, true, "kept, so the next reset can resolve it");
    assert.ok(server.io.slept.slice(1).reduce((sum, ms) => sum + ms, 0) >= RETRY_WAIT_MS, "it looked again for a minute");
    assert.ok(server.io.lines.some((line) => line.startsWith("▲ 1 storm alert(s) are still on their way (stuck)")));
  });
});
