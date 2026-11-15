// The relay's pure rules: delay per preset, arrival order, crew projection, alert handling and
// which status changes are relayed.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RELAY_DIRECTIONS, type CrewRoster, type RelayEventOf, type RosterEntry, type Status } from "@heartbeat/shared";
import type { UnsentGroundAlert } from "../src/domain/ports.ts";
import { applyToRoster, crewChangeProblem, crewRoster } from "../src/domain/relay/crew.ts";
import { deliverAtMs, oneWayDelayMs, relayDelay } from "../src/domain/relay/delay.ts";
import {
  canMoveAlert, expectedRoster, failedCrewChanges, groundAlertView, pendingCrewChanges, type CrewKnowledge,
} from "../src/domain/relay/ground.ts";
import { relayedAlert } from "../src/domain/relay/status-relay.ts";
import { markGroundRelay, statesToStore, statusChanges, type SubjectState } from "../src/domain/status/status-log.ts";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;

describe("one-way delay per preset (SPEC §8)", () => {
  const cases = [
    { preset: "iss", demo: 0, real: 0 },
    { preset: "moon", demo: 1.3 * SECOND_MS, real: 1.3 * SECOND_MS },
    { preset: "marsClose", demo: 10 * SECOND_MS, real: 3 * MINUTE_MS },
    { preset: "marsFar", demo: 30 * SECOND_MS, real: 22 * MINUTE_MS },
  ] as const;
  for (const { preset, demo, real } of cases) {
    it(`${preset}: ${demo} ms scaled for the demo, ${real} ms in real time`, () => {
      assert.equal(oneWayDelayMs({ preset, realTime: false }), demo);
      assert.equal(oneWayDelayMs({ preset, realTime: true }), real);
    });
  }

  it("describes the setting and lists every preset for the selector", () => {
    const response = relayDelay({ preset: "marsClose", realTime: false });
    assert.equal(response.label, "Mars (close)");
    assert.equal(response.oneWayDelayMs, 10 * SECOND_MS);
    assert.deepEqual(response.presets.map((p) => p.preset), ["iss", "moon", "marsClose", "marsFar"]);
  });
});

describe("arrival time", () => {
  it("is the send time plus the delay", () => {
    assert.equal(deliverAtMs(1_000, 10 * SECOND_MS, null), 11_000);
  });

  it("never overtakes the event sent before it in the same direction, so order is kept when the delay shrinks", () => {
    const first = deliverAtMs(0, 30 * SECOND_MS, null); // sent on Mars (far)
    const second = deliverAtMs(5 * SECOND_MS, 0, first); // sent 5 s later after switching to the ISS
    assert.equal(second, first);
  });
});

const roster = (...ids: string[]): RosterEntry[] => ids.map((id) => ({ astronautId: id, name: id, watch: null }));
const watch = (watchId: string) => ({ watchId, lastContactAt: null, batteryPct: null });

describe("crew changes on the roster (SPEC §9.2)", () => {
  const newAstronaut = { id: "a2", name: "Astronaut 2", age: null, sex: null, massKg: null, heightM: null };

  it("adds, removes, assigns and unassigns", () => {
    const added = applyToRoster(roster("a1"), { action: "addAstronaut", astronaut: newAstronaut });
    assert.deepEqual(added.map((e) => e.astronautId), ["a1", "a2"]);
    const assigned = applyToRoster(added, { action: "assignWatch", astronautId: "a1", watchId: "w1" });
    assert.deepEqual(assigned[0].watch, watch("w1"));
    assert.equal(applyToRoster(assigned, { action: "unassignWatch", astronautId: "a1" })[0].watch, null);
    assert.deepEqual(applyToRoster(added, { action: "removeAstronaut", astronautId: "a1" }).map((e) => e.astronautId), ["a2"]);
  });

  it("moves a watch worn by someone else", () => {
    const [a1, a2] = applyToRoster([{ ...roster("a1")[0], watch: watch("w1") }, ...roster("a2")], {
      action: "assignWatch", astronautId: "a2", watchId: "w1",
    });
    assert.equal(a1.watch, null);
    assert.deepEqual(a2.watch, watch("w1"));
  });

  it("refuses adding a known id and changing an unknown astronaut", () => {
    assert.equal(crewChangeProblem(roster("a2"), { action: "addAstronaut", astronaut: newAstronaut }), "astronaut_exists");
    assert.equal(crewChangeProblem(roster("a1"), { action: "removeAstronaut", astronautId: "a9" }), "unknown_astronaut");
    assert.equal(crewChangeProblem(roster("a1"), { action: "assignWatch", astronautId: "a1", watchId: "w1" }), null);
  });
});

const event = <K extends "roster" | "crewChange" | "alert" | "alertState" | "deliveryFailure">(
  id: string, seq: number, kind: K, payload: RelayEventOf<K>["payload"],
  sentAt = "2026-11-14T12:00:00.000Z", deliverAt = "2026-11-14T12:00:10.000Z",
): RelayEventOf<K> => ({ id, seq, kind, direction: RELAY_DIRECTIONS[kind], payload, sentAt, deliverAt });

const rosterOf = (lastAppliedChangeSeq: number | null, ...ids: string[]): CrewRoster =>
  ({ astronauts: roster(...ids), unassignedWatches: [], lastAppliedChangeSeq });
const knowing = (overrides: Partial<CrewKnowledge>): CrewKnowledge => ({ roster: null, changes: [], failures: [], ...overrides });

describe("the ground's view of the crew", () => {
  it("counts a change as pending until a roster confirms it, and expects its effect meanwhile", () => {
    const knowledge = knowing({
      roster: event("5", 4, "roster", rosterOf(3, "a1")),
      changes: [
        event("3", 3, "crewChange", { action: "assignWatch", astronautId: "a1", watchId: "w1" }),
        event("7", 4, "crewChange", { action: "removeAstronaut", astronautId: "a1" }),
      ],
    });
    assert.deepEqual(pendingCrewChanges(knowledge).map((p) => p.changeId), ["7"]);
    assert.deepEqual(expectedRoster(knowledge), []);
  });

  it("orders changes by their send sequence, not by their ids (review F009)", () => {
    const knowledge = knowing({
      roster: event("1", 1, "roster", rosterOf(2, "a1")),
      changes: [
        event("90", 2, "crewChange", { action: "unassignWatch", astronautId: "a1" }),
        event("12", 3, "crewChange", { action: "removeAstronaut", astronautId: "a1" }),
      ],
    });
    assert.deepEqual(pendingCrewChanges(knowledge).map((p) => p.changeId), ["12"]);
  });

  it("treats every change as pending before any roster has arrived", () => {
    const knowledge = knowing({ changes: [event("1", 1, "crewChange", { action: "unassignWatch", astronautId: "a1" })] });
    assert.equal(pendingCrewChanges(knowledge).length, 1);
  });

  it("shows a change the spacecraft reported failed as failed, no longer pending (owner decision on F003)", () => {
    const remove = event("8", 5, "crewChange", { action: "removeAstronaut", astronautId: "a1" });
    const knowledge = knowing({
      roster: event("5", 4, "roster", rosterOf(4, "a1")),
      changes: [remove],
      failures: [event("9", 6, "deliveryFailure", { eventId: "8", kind: "crewChange", reason: "database refused", attempts: 5 })],
    });
    assert.deepEqual(pendingCrewChanges(knowledge), []);
    assert.deepEqual(failedCrewChanges(knowledge), [{
      changeId: "8", change: remove.payload, reason: "database refused", receivedAt: "2026-11-14T12:00:10.000Z",
    }]);
    assert.deepEqual(expectedRoster(knowledge).map((e) => e.astronautId), ["a1"]);
  });
});

describe("the roster the spacecraft sends", () => {
  const person = (id: string, watchId: string | null) =>
    ({ id, name: id, watchId, age: null, sex: null, massKg: null, heightM: null });
  const heard = (watchId: string) => ({ watchId, lastContactAt: "2026-11-14T11:59:00.000Z", batteryPct: 64 });

  it("gives each worn watch its last contact and battery, and lists registered watches no one wears", () => {
    const sent = crewRoster([person("a1", "w1"), person("a2", "w9")], [heard("w1"), heard("w2")], 3);
    assert.deepEqual(sent.astronauts.map((a) => a.watch), [heard("w1"), { watchId: "w9", lastContactAt: null, batteryPct: null }]);
    assert.deepEqual(sent.unassignedWatches, [heard("w2")]);
    assert.equal(sent.lastAppliedChangeSeq, 3);
  });
});

const ALERT_ENTRY: UnsentGroundAlert = {
  id: "41", at: "2026-11-14T12:00:00.000Z", area: "vitals", metric: "spo2", ruleId: "spo2-alert", title: "Low blood oxygen",
  from: "normal", to: "alert", message: null, astronautId: "a1", crewWide: false,
};

describe("alert handling", () => {
  it("acknowledges a new alert and resolves a new or acknowledged one, never backwards", () => {
    assert.ok(canMoveAlert("new", "acknowledged"));
    assert.ok(canMoveAlert("new", "resolved"));
    assert.ok(canMoveAlert("acknowledged", "resolved"));
    assert.ok(!canMoveAlert("acknowledged", "acknowledged"));
    assert.ok(!canMoveAlert("resolved", "acknowledged"));
  });

  it("shows sent and received times, the lag and the latest handling", () => {
    const alert = event("9", 1, "alert", relayedAlert(ALERT_ENTRY));
    const handling = event("11", 1, "alertState", { alertId: "9", astronautId: "a1", state: "acknowledged" }, "2026-11-14T12:01:00.000Z");
    const view = groundAlertView(alert, handling);
    assert.deepEqual([view.alertId, view.alertLogId], ["9", "41"]);
    assert.equal(view.lagMs, 10 * SECOND_MS);
    assert.equal(view.state, "acknowledged");
    assert.equal(view.stateChangedAt, "2026-11-14T12:01:00.000Z");
    assert.equal(groundAlertView(alert, undefined).state, "new");
  });
});

describe("which status changes go to the ground (SPEC §6.1, owner decisions)", () => {
  const AT = "2026-11-14T12:00:00.000Z";
  const rule = (status: Status, crewWide = false): SubjectState => ({
    key: "rule:spo2-alert", title: "Low blood oxygen", message: null, status,
    subject: { kind: "rule", ruleId: "spo2-alert", area: "vitals", metrics: ["spo2"], crewWide },
  });
  const area = (status: Status): SubjectState => ({
    key: "area:vitals", title: "Vitals: alert", message: null, status, subject: { kind: "area", area: "vitals" },
  });
  const relayed = (previous: SubjectState[], current: SubjectState[], crewPrevious = new Map<string, Status>()) =>
    markGroundRelay(statusChanges("a1", AT, statesToStore(previous), current), crewPrevious);
  const sent = (result: ReturnType<typeof relayed>) =>
    result.changes.filter((c) => c.relayToGround).map((c) => [c.subject.kind, c.from, c.to]);

  it("sends a rule starting to fire at 🔴 or 🟡, and nothing for clearings or area changes", () => {
    assert.deepEqual(sent(relayed([], [rule("alert"), area("alert")])), [["rule", "normal", "alert"]]);
    assert.deepEqual(sent(relayed([], [rule("watch")])), [["rule", "normal", "watch"]]);
    assert.deepEqual(sent(relayed([rule("alert")], [])), []);
  });

  it("sends a watch that escalates to alert", () => {
    assert.deepEqual(sent(relayed([rule("watch")], [rule("alert")])), [["rule", "watch", "alert"]]);
  });

  it("sends an alert that eases to a watch (owner decision: de-escalations go to the feed too)", () => {
    assert.deepEqual(sent(relayed([rule("alert")], [rule("watch")])), [["rule", "alert", "watch"]]);
  });

  it("sends a crew-wide rule once for the crew: the first astronaut's evaluation, not the next", () => {
    const first = relayed([], [rule("alert", true)]);
    assert.deepEqual(sent(first), [["rule", "normal", "alert"]]);
    assert.deepEqual([...first.crewStates], [["rule:spo2-alert", "alert"]]);
    const second = relayed([], [rule("alert", true)], first.crewStates);
    assert.deepEqual(sent(second), [], "a2 sees the same ship event: no second alert");
    const cleared = relayed([rule("alert", true)], [], first.crewStates);
    assert.deepEqual([...cleared.crewStates], [["rule:spo2-alert", "normal"]]);
    assert.deepEqual(sent(relayed([], [rule("alert", true)], cleared.crewStates)), [["rule", "normal", "alert"]], "a new event later is sent again");
  });

  it("carries the logged entry's id, rule, metric, crew-wide flag and message to the ground", () => {
    assert.deepEqual(relayedAlert(ALERT_ENTRY), {
      alertLogId: "41", astronautId: "a1", ruleId: "spo2-alert", title: "Low blood oxygen", area: "vitals", metric: "spo2",
      status: "alert", crewWide: false, message: null, at: "2026-11-14T12:00:00.000Z",
    });
  });
});
