// The pure decisions of the one-command demo reset (scripts/demo-reset-plan.ts, SPEC §13).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GroundAlert, GroundAlertState } from "@heartbeat/shared";
import {
  DEFAULT_SERVER_URL, DEMO_RELAY_SETTING, IN_FLIGHT_MARGIN_MS, STORM_RULE_IDS, alertsStillInFlight, inFlightWaitMs, parseClearedAt, parseCrewIds,
  parseDotEnv, parseGroundAlerts, parseOneWayDelayMs, parseSentAlerts, parseStormStartedAt, rehearsalAlerts, resetTarget, samsungSdkProblem,
  stormWindow, webEnvProblem,
} from "../scripts/demo-reset-plan.ts";

const STORM_STARTED = "2026-11-15T00:00:00.000Z";
const alert = (alertId: string, ruleId: string, state: GroundAlertState, sentAt = STORM_STARTED): GroundAlert => ({
  alertId, ruleId, state, alertLogId: "1", astronautId: "a1", title: "t", area: "radiation", metric: null, status: "alert", crewWide: true,
  message: null, at: sentAt, sentAt, receivedAt: "2026-11-15T00:00:30.000Z", lagMs: 30_000,
  stateChangedAt: null,
});

describe("the demo reset", () => {
  it("sets Mars (far) with demo scaling (owner decision)", () => {
    assert.deepEqual(DEMO_RELAY_SETTING, { preset: "marsFar", realTime: false });
  });

  it("knows the storm's rules from the catalog: the two daily-dose rules", () => {
    assert.deepEqual([...STORM_RULE_IDS].sort(), ["radiation-solar-event-alert", "radiation-solar-event-watch"]);
  });

  const CLEARED = "2026-11-15T00:05:00.000Z";
  const window = stormWindow(STORM_STARTED, CLEARED);

  it("resolves only open storm-rule alerts sent between the storm's start and its clear, leaving real-data alerts to the surgeon", () => {
    const feed = [
      alert("1", "radiation-solar-event-watch", "new"),
      alert("2", "radiation-solar-event-alert", "acknowledged", "2026-11-15T00:00:35.000Z"),
      alert("3", "radiation-solar-event-alert", "resolved"),
      alert("4", "co2-one-hour-watch", "new"),
      alert("5", "radiation-solar-event-alert", "new", "2026-11-14T23:59:59.999Z"), // before the storm: the real record
      alert("6", "radiation-solar-event-watch", "new", "2026-11-15T00:05:00.001Z"), // after the clear: the real record
    ];
    assert.deepEqual(rehearsalAlerts(feed, window).map((a) => a.alertId), ["1", "2"]);
    assert.deepEqual(rehearsalAlerts(feed, stormWindow(null, CLEARED)), [], "no storm since the last reset");
  });

  it("finds the storm alerts that left the ship but have not reached the ground, once each", () => {
    const sent = [alert("1", "radiation-solar-event-watch", "new"), alert("2", "radiation-solar-event-alert", "new"), alert("2", "radiation-solar-event-alert", "new"),
      alert("7", "co2-one-hour-watch", "new"), alert("8", "radiation-solar-event-alert", "new", "2026-11-14T00:00:00.000Z")];
    const onGround = [alert("1", "radiation-solar-event-watch", "new")];
    assert.deepEqual(alertsStillInFlight(sent, onGround, window).map((a) => a.alertId), ["2"]);
    assert.deepEqual(alertsStillInFlight(sent, onGround, null), []);
  });

  it("waits one link delay, the longer of before and after, plus a margin, for alerts still on the way", () => {
    assert.equal(inFlightWaitMs(10_000, 30_000), 30_000 + IN_FLIGHT_MARGIN_MS);
    assert.equal(inFlightWaitMs(180_000, 30_000), 180_000 + IN_FLIGHT_MARGIN_MS);
  });
});

describe("the server's answers, checked before use", () => {
  it("accepts the alert list and refuses another shape, saying to rebuild the server", () => {
    const feed = [alert("1", "radiation-solar-event-watch", "new")];
    assert.deepEqual(parseGroundAlerts(feed), feed);
    for (const bad of [null, {}, [{ alertId: "1" }], [{ ...feed[0], state: "closed" }], [{ ...feed[0], sentAt: "soon" }]]) {
      assert.throws(() => parseGroundAlerts(bad), /alert list has an unexpected shape; rebuild it/);
    }
  });

  it("reads the link delay and the storm's start", () => {
    assert.equal(parseOneWayDelayMs({ preset: "marsFar", oneWayDelayMs: 30_000 }), 30_000);
    assert.throws(() => parseOneWayDelayMs({ preset: "marsFar" }), /link delay has an unexpected shape/);
    assert.equal(parseStormStartedAt({ active: false, factor: null, startedAt: STORM_STARTED }), STORM_STARTED);
    assert.equal(parseStormStartedAt({ active: false, factor: null, startedAt: null }), null);
    assert.throws(() => parseStormStartedAt({ active: false, factor: null }), /storm state has an unexpected shape/);
  });

  it("reads the clear's time, the crew and the alerts that left the ship", () => {
    assert.equal(parseClearedAt({ cleared: true, clearedAt: STORM_STARTED }), STORM_STARTED);
    assert.throws(() => parseClearedAt({ cleared: true }), /storm clear has an unexpected shape/);
    assert.deepEqual(parseCrewIds([{ id: "a1", name: "Astronaut 1" }]), ["a1"]);
    assert.throws(() => parseCrewIds([{ name: "x" }]), /crew list has an unexpected shape/);
    assert.equal(parseSentAlerts([{ alertId: "1", ruleId: "r", sentAt: STORM_STARTED, deliverAt: STORM_STARTED }]).length, 1);
    assert.throws(() => parseSentAlerts([{ alertId: "1" }]), /relayed alert list has an unexpected shape/);
  });
});

describe("parseDotEnv", () => {
  it("reads KEY=VALUE lines, skipping comments and blanks, and removes one pair of quotes", () => {
    const text = "# a comment\n\nHEARTBEAT_TOKEN=abc123\nPOSTGRES_PASSWORD = \"p w\"\r\nQUOTED='x'\nnot a pair\n";
    assert.deepEqual(parseDotEnv(text), { HEARTBEAT_TOKEN: "abc123", POSTGRES_PASSWORD: "p w", QUOTED: "x" });
  });
});

describe("resetTarget", () => {
  it("takes the token from the environment first, then the root .env, and the default server", () => {
    assert.deepEqual(resetTarget({ HEARTBEAT_TOKEN: "env" }, "HEARTBEAT_TOKEN=file"), { serverUrl: DEFAULT_SERVER_URL, token: "env" });
    assert.deepEqual(resetTarget({}, "HEARTBEAT_TOKEN=file"), { serverUrl: DEFAULT_SERVER_URL, token: "file" });
    assert.equal(resetTarget({ HEARTBEAT_SERVER_URL: "http://localhost:4100" }, "HEARTBEAT_TOKEN=file").serverUrl, "http://localhost:4100");
  });

  it("says what to set when there is no token", () => {
    assert.throws(() => resetTarget({}, null), /HEARTBEAT_TOKEN is not set/);
    assert.throws(() => resetTarget({}, "POSTGRES_PASSWORD=x"), /HEARTBEAT_TOKEN is not set/);
  });
});

describe("webEnvProblem", () => {
  it("is null when web/.env.local has the server's token", () => {
    assert.equal(webEnvProblem("t", "HEARTBEAT_SERVER_URL=http://localhost:4000\nHEARTBEAT_TOKEN=t\n"), null);
  });

  it("names a missing file, a missing token and a different token", () => {
    assert.match(webEnvProblem("t", null)!, /missing: run `cp web\/.env.example web\/.env.local`/);
    assert.match(webEnvProblem("t", "HEARTBEAT_SERVER_URL=x")!, /no HEARTBEAT_TOKEN/);
    assert.match(webEnvProblem("t", "HEARTBEAT_TOKEN=other")!, /differs/);
  });
});

describe("samsungSdkProblem", () => {
  it("is null when watch/app/libs/ holds an .aar, and says where it goes otherwise", () => {
    assert.equal(samsungSdkProblem(["samsung-health-sensor-api-1.4.1.aar"]), null);
    assert.match(samsungSdkProblem([])!, /watch\/app\/libs\/ has no Samsung Health Sensor SDK \.aar/);
    assert.match(samsungSdkProblem(null)!, /watch\/README\.md/, "no libs folder at all");
  });
});
