// The relay's use cases with in-memory doubles: handing over events when an arrival effect fails,
// and what the status listener sends (review F003, F004, F006, F012).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AstronautStatus, CheckIn, CrewRoster, SeriesPoint, LiveMessage, RelayEvent, RelayEventKind, RelayEventOf, RelayPayloads,
} from "@heartbeat/shared";
import type { AstronautStore, RelayReader, RelayStore, UnsentGroundAlert } from "../src/domain/ports.ts";
import { onboardCrew } from "../src/domain/relay/crew.ts";
import { caloriesByDay, dailyLogDaysTouched, dailyLogRelay, readDailyLog, rebuildFromDayMs, withRecentDays, type DailyLogStores } from "../src/domain/relay/daily-log-relay.ts";
import { DEFAULT_RULE_BOOK } from "../src/domain/rules/rule-book.ts";
import type { Outcome, RelayProblem } from "../src/domain/relay/outcome.ts";
import { deliverDueEvents, type Relay, type SendDecision } from "../src/domain/relay/relay.ts";
import {
  FIRST_RETRY_GAP_MS, GIVE_UP_AFTER_MS, MAX_RETRY_GAP_MS, retryGapMs, retryTimeSpentMs, shouldSetAside,
} from "../src/domain/relay/retry-schedule.ts";
import { statusRelay } from "../src/domain/relay/status-relay.ts";
import type { NewStatusChange } from "../src/domain/status/status-log.ts";

const unused = () => { throw new Error("not used"); };
const noLive = { publish: () => {} };

const note = (id: string, seq: number): RelayEvent => ({
  id, seq, kind: "note", direction: "toOnboard", payload: { astronautId: "a1", text: id, alertId: null },
  sentAt: "2026-11-14T12:00:00.000Z", deliverAt: "2026-11-14T12:00:10.000Z",
});

/**
 * A queue double holding three due notes, keeping each one's failed attempts and retry time as the
 * store would, and recording what is delivered or set aside.
 */
function dueQueue(secondNote: { failedAttempts: number; retryAtMs: number | null } = { failedAttempts: 0, retryAtMs: null }) {
  const delivered: string[] = [];
  const failedIds: string[] = [];
  const state = new Map([["2", { ...secondNote }]]);
  const store = {
    dueUndelivered: async () => [note("1", 1), note("2", 2), note("3", 3)]
      .filter((event) => !delivered.includes(event.id) && !failedIds.includes(event.id))
      .map((event) => ({ event, failedAttempts: 0, retryAtMs: null, ...state.get(event.id) })),
    markDelivered: async (id: string) => { delivered.push(id); },
    recordFailedAttempt: async (id: string, retryAtMs: number) => {
      const before = state.get(id) ?? { failedAttempts: 0, retryAtMs: null };
      state.set(id, { failedAttempts: before.failedAttempts + 1, retryAtMs });
    },
    markFailed: async (id: string) => { failedIds.push(id); },
    nextDeliverAtMs: async () => null,
  } as unknown as RelayStore;
  return { store, delivered, failedIds, state };
}
const failSecond = async (event: RelayEvent) => {
  if (event.id === "2") throw new Error("astronauts table refused the change");
};
const noFailureReports = async () => assert.fail("nothing should be set aside yet");
const ignoreRetries = () => {};

describe("the retry schedule for a failing arrival effect (owner decision)", () => {
  it("waits 5 s, then doubles each gap up to 2 minutes", () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(retryGapMs), [5_000, 10_000, 20_000, 40_000, 80_000, 120_000, 120_000]);
    assert.equal(MAX_RETRY_GAP_MS, 120_000);
  });

  it("sets the event aside once about 10 minutes of retries have passed, not before", () => {
    const firstGivingUp = [...Array(20).keys()].map((i) => i + 1).find(shouldSetAside)!;
    assert.ok(retryTimeSpentMs(firstGivingUp) >= GIVE_UP_AFTER_MS);
    assert.ok(retryTimeSpentMs(firstGivingUp - 1) < GIVE_UP_AFTER_MS);
    assert.ok(retryTimeSpentMs(firstGivingUp) < GIVE_UP_AFTER_MS + MAX_RETRY_GAP_MS, "about 10 minutes, not much more");
  });
});

describe("handing over due events", () => {
  it("holds a failing event and every later one, and asks to run again after the first gap", async () => {
    const { store, delivered, state } = dueQueue();
    const pushed: LiveMessage[] = [];
    const retries: Array<[string, number, number]> = [];
    const next = await deliverDueEvents({
      store, live: { publish: (_side, message) => pushed.push(message) }, onArrival: failSecond,
      reportRetry: (event, _reason, failedAttempts, retryAtMs) => retries.push([event.id, failedAttempts, retryAtMs]),
      reportFailure: noFailureReports,
    }, 0);
    assert.equal(next, FIRST_RETRY_GAP_MS);
    assert.deepEqual(retries, [["2", 1, FIRST_RETRY_GAP_MS]]);
    assert.deepEqual(state.get("2"), { failedAttempts: 1, retryAtMs: FIRST_RETRY_GAP_MS });
    assert.deepEqual(delivered, ["1"]);
    assert.deepEqual(pushed.map((m) => m.type === "relayDelivered" && m.event.id), ["1"]);
  });

  it("does not try a held event again before its retry time, and later events keep waiting", async () => {
    const { store, delivered } = dueQueue({ failedAttempts: 1, retryAtMs: 5_000 });
    let tries = 0;
    const next = await deliverDueEvents({
      store, live: noLive, onArrival: async (event) => { if (event.id === "2") tries++; },
      reportRetry: ignoreRetries, reportFailure: noFailureReports,
    }, 4_999);
    assert.deepEqual([next, tries, delivered], [5_000, 0, ["1"]]);
  });

  it("sets an event aside once its retries have taken about 10 minutes, tells the ground, and lets later events flow (owner decision on F003)", async () => {
    const lastRetry = [...Array(20).keys()].map((i) => i + 1).find(shouldSetAside)! - 1;
    const { store, delivered, failedIds } = dueQueue({ failedAttempts: lastRetry, retryAtMs: 0 });
    const reports: Array<[string, string, number]> = [];
    await deliverDueEvents({
      store, live: noLive, onArrival: failSecond, reportRetry: ignoreRetries,
      reportFailure: async (event, reason, failedAttempts) => { reports.push([event.id, reason, failedAttempts]); },
    }, 0);
    assert.deepEqual(failedIds, ["2"]);
    assert.deepEqual(reports, [["2", "astronauts table refused the change", lastRetry + 1]]);
    assert.deepEqual(delivered, ["1", "3"]);
  });
});

describe("each direction keeps its own order (owner decision on F019)", () => {
  const crewChange: RelayEvent = {
    id: "10", seq: 1, kind: "crewChange", direction: "toOnboard", payload: { action: "unassignWatch", astronautId: "a1" },
    sentAt: "2026-11-14T12:00:00.000Z", deliverAt: "2026-11-14T12:00:10.000Z",
  };
  const laterCrewChange: RelayEvent = { ...crewChange, id: "12", seq: 2 };
  const alert: RelayEvent = {
    id: "11", seq: 1, kind: "alert", direction: "toGround",
    payload: {
      alertLogId: "41", astronautId: "a1", ruleId: "spo2-alert", title: "Low blood oxygen", area: "vitals", metric: "spo2",
      status: "alert", crewWide: false, message: null, at: "2026-11-14T12:00:05.000Z",
    },
    sentAt: "2026-11-14T12:00:05.000Z", deliverAt: "2026-11-14T12:00:15.000Z",
  };
  const queue = (heldRetryAtMs: number | null) => {
    const delivered: string[] = [];
    const store = {
      dueUndelivered: async () => [crewChange, alert, laterCrewChange]
        .filter((event) => !delivered.includes(event.id))
        .map((event) => ({ event, failedAttempts: event.id === "10" && heldRetryAtMs !== null ? 1 : 0, retryAtMs: event.id === "10" ? heldRetryAtMs : null })),
      markDelivered: async (id: string) => { delivered.push(id); },
      recordFailedAttempt: async () => {},
      nextDeliverAtMs: async () => null,
    } as unknown as RelayStore;
    return { store, delivered };
  };
  const failCrewChanges = async (event: RelayEvent) => {
    if (event.kind === "crewChange") throw new Error("astronauts table refused the change");
  };

  it("delivers and pushes a ship→Earth alert on time while an Earth→ship crew change keeps failing", async () => {
    const { store, delivered } = queue(null);
    const pushed: LiveMessage[] = [];
    const next = await deliverDueEvents({
      store, live: { publish: (_side, message) => pushed.push(message) }, onArrival: failCrewChanges,
      reportRetry: ignoreRetries, reportFailure: noFailureReports,
    }, 0);
    assert.deepEqual(delivered, ["11"], "the alert went; the later crew change waits behind the failing one");
    assert.deepEqual(pushed.map((m) => m.type === "relayDelivered" && m.event.kind), ["alert"]);
    assert.equal(next, FIRST_RETRY_GAP_MS);
  });

  it("keeps the other direction flowing while the failing event waits out its retry gap", async () => {
    const { store, delivered } = queue(5_000);
    let crewTries = 0;
    const next = await deliverDueEvents({
      store, live: noLive, onArrival: async (event) => { if (event.kind === "crewChange") crewTries++; },
      reportRetry: ignoreRetries, reportFailure: noFailureReports,
    }, 1_000);
    assert.deepEqual([delivered, crewTries, next], [["11"], 0, 5_000]);
  });
});

describe("a crew change and its confirming roster are separate steps (owner decision on F018)", () => {
  const removal: RelayEvent = {
    id: "30", seq: 7, kind: "crewChange", direction: "toOnboard", payload: { action: "removeAstronaut", astronautId: "a2" },
    sentAt: "2026-11-14T12:00:00.000Z", deliverAt: "2026-11-14T12:00:10.000Z",
  };

  function crewWithFailingRosters() {
    const removed: string[] = [];
    const rosters: CrewRoster[] = [];
    const rosterErrors: unknown[] = [];
    let failRosters = true;
    const historyChanged: string[] = [];
    const crew = onboardCrew({
      astronauts: { list: async () => [], remove: async (id: string) => { removed.push(id); return true; } } as unknown as AstronautStore,
      watches: { report: unused, list: async () => [] },
      relayStore: { latestHandedOver: async () => null } as unknown as RelayStore,
      relay: {
        send: async (_kind: string, roster: CrewRoster) => {
          if (failRosters) throw new Error("relay queue unreachable");
          rosters.push(roster);
        },
      } as unknown as Relay,
      now: () => 0,
      onRosterError: (error) => rosterErrors.push(error),
      dailyLogChanges: { historyChanged: (id: string) => { historyChanged.push(id); } },
    });
    return { crew, removed, rosters, rosterErrors, historyChanged, recover: () => { failRosters = false; } };
  }

  it("hands the change over as applied even when the roster cannot be sent, so it is never reported failed", async () => {
    const { crew, removed, rosterErrors, historyChanged } = crewWithFailingRosters();
    const delivered: string[] = [];
    const store = {
      dueUndelivered: async () => (delivered.length ? [] : [{ event: removal, failedAttempts: 0, retryAtMs: null }]),
      markDelivered: async (id: string) => { delivered.push(id); },
      nextDeliverAtMs: async () => null,
    } as unknown as RelayStore;
    await deliverDueEvents({
      store, live: noLive, onArrival: crew.onArrival, reportRetry: () => assert.fail("no retry: the change applied"),
      reportFailure: noFailureReports,
    }, 0);
    assert.deepEqual([removed, delivered], [["a2"], ["30"]]);
    assert.deepEqual(historyChanged, ["a2"], "the removal rebuilds their daily log in full");
    assert.equal(rosterErrors.length, 1, "the failed roster send is reported for the log");
  });

  it("sends the owed roster, confirming the change, with a later refresh", async () => {
    const { crew, rosters, recover } = crewWithFailingRosters();
    await crew.onArrival(removal);
    assert.equal(rosters.length, 0);
    recover();
    await crew.refreshRoster();
    assert.deepEqual(rosters.map((r) => r.lastAppliedChangeSeq), [7]);
    await crew.refreshRoster();
    assert.equal(rosters.length, 1, "nothing more is owed");
  });
});

describe("telling the ground about a set-aside event (review F013)", () => {
  it("keeps the event due when the report fails, and reports and sets it aside on the next run", async () => {
    const lastRetry = [...Array(20).keys()].map((i) => i + 1).find(shouldSetAside)! - 1;
    const { store, failedIds } = dueQueue({ failedAttempts: lastRetry, retryAtMs: 0 });
    const reports: string[] = [];
    let reportFails = true;
    const deps = {
      store, live: noLive, onArrival: failSecond, reportRetry: ignoreRetries,
      reportFailure: async (event: RelayEvent) => {
        if (reportFails) throw new Error("relay queue unreachable");
        reports.push(event.id);
      },
    };
    await assert.rejects(deliverDueEvents(deps, 0), /relay queue unreachable/);
    assert.deepEqual(failedIds, [], "not set aside while the ground has not been told");
    reportFails = false;
    await deliverDueEvents(deps, 0);
    assert.deepEqual([reports, failedIds], [["2"], ["2"]]);
  });
});

describe("watch news for the ground (review F015)", () => {
  it("keeps watch news waiting when the roster send fails, and sends it with the next refresh", async () => {
    let failSend = true;
    const rosters: unknown[] = [];
    const crew = onboardCrew({
      astronauts: { list: async () => [] } as unknown as AstronautStore,
      watches: { report: async () => ({ isNew: false }), list: async () => [] },
      relayStore: { latestHandedOver: async () => null } as unknown as RelayStore,
      relay: {
        send: async (_kind: string, payload: unknown) => {
          if (failSend) throw new Error("relay queue unreachable");
          rosters.push(payload);
        },
      } as unknown as Relay,
      now: () => 0,
      onRosterError: () => {},
      dailyLogChanges: { historyChanged: () => {} },
    });
    await crew.watchReported({ watchId: "w1", batteryPct: 50 });
    await assert.rejects(crew.refreshRoster(), /relay queue unreachable/);
    failSend = false;
    await crew.refreshRoster();
    assert.equal(rosters.length, 1, "the news was still waiting");
    await crew.refreshRoster();
    assert.equal(rosters.length, 1, "and is cleared once sent");
  });
});

/** A relay that records what it sends, failing the sends `failing` says to fail. */
function recordingRelay(failing: (kind: RelayEventKind) => boolean = () => false) {
  const sent: Array<{ kind: RelayEventKind; payload: unknown }> = [];
  let seq = 0;
  const queued = (): RelayEventOf<"alert">[] => sent.filter((s) => s.kind === "alert").map((s, i) => ({
    id: String(i + 1), seq: i + 1, kind: "alert", direction: "toGround", payload: s.payload as RelayPayloads["alert"],
    sentAt: "", deliverAt: "",
  }));
  const queue = { list: async () => queued() } as unknown as RelayReader;
  const relay: Relay = {
    async send(kind, payload) {
      if (failing(kind)) throw new Error(`${kind} send failed`);
      sent.push({ kind, payload });
      return { id: String(++seq) } as RelayEventOf<typeof kind>;
    },
    async sendChecked<K extends RelayEventKind, P extends RelayProblem>(
      kind: K, decide: (queue: RelayReader) => Promise<Outcome<SendDecision<K>, P>>,
    ): Promise<Outcome<RelayEventOf<K>, P>> {
      if (failing(kind)) throw new Error(`${kind} send failed`);
      const decision = await decide(queue);
      if (!decision.ok) return decision;
      if ("send" in decision.value) sent.push({ kind, payload: decision.value.send });
      return { ok: true, value: {} as RelayEventOf<K> };
    },
    delay: unused,
    changeDelay: unused,
  };
  return { relay, sent };
}

/** An alert log outbox holding `entries` until each is marked sent. */
function outbox(entries: UnsentGroundAlert[]) {
  const unsent = [...entries];
  return {
    unsentGroundAlerts: async () => [...unsent],
    markSentToGround: async (id: string) => { unsent.splice(unsent.findIndex((e) => e.id === id), 1); },
    unsent,
  };
}

const ALERT: UnsentGroundAlert = {
  id: "41", at: "2026-11-14T12:00:00.000Z", area: "radiation", metric: "radiationDoseRate", ruleId: "radiation-solar-event-alert",
  title: "Radiation dose spike", from: "normal", to: "alert", message: null, astronautId: "a1", crewWide: true,
};
const status = (atMs: number) => ({ astronautId: "a1", at: new Date(atMs).toISOString(), overall: "alert", areas: [] }) as unknown as AstronautStatus;
const SOME_CHANGE = [{} as NewStatusChange];
const MINUTE_MS = 60_000;

describe("the status listener", () => {
  it("sends an unchanged status again only once the snapshot interval has passed", async () => {
    const { relay, sent } = recordingRelay();
    const listener = statusRelay({ relay, live: noLive, statusLog: outbox([]), snapshotIntervalMs: MINUTE_MS });
    await listener.statusEvaluated(status(0), []);
    await listener.statusEvaluated(status(MINUTE_MS - 1), []);
    await listener.statusEvaluated(status(MINUTE_MS - 1), SOME_CHANGE); // a change goes at once
    await listener.statusEvaluated(status(2 * MINUTE_MS - 1), []);
    assert.equal(sent.filter((s) => s.kind === "status").length, 3);
  });

  it("retries a snapshot whose send failed at the next evaluation, not an interval later (review F004)", async () => {
    let failStatus = true;
    const { relay, sent } = recordingRelay((kind) => kind === "status" && failStatus);
    const listener = statusRelay({ relay, live: noLive, statusLog: outbox([]), snapshotIntervalMs: MINUTE_MS });
    await assert.rejects(listener.statusEvaluated(status(0), []), /status send failed/);
    failStatus = false;
    await listener.statusEvaluated(status(1_000), []);
    assert.equal(sent.filter((s) => s.kind === "status").length, 1, "the failed snapshot was not counted as sent");
  });

  it("keeps an alert whose send failed in the outbox and sends it with the next evaluation (review F004)", async () => {
    let failAlerts = true;
    const { relay, sent } = recordingRelay((kind) => kind === "alert" && failAlerts);
    const log = outbox([ALERT]);
    const listener = statusRelay({ relay, live: noLive, statusLog: log, snapshotIntervalMs: MINUTE_MS });
    await assert.rejects(listener.statusEvaluated(status(0), SOME_CHANGE), /alert send failed/);
    assert.equal(log.unsent.length, 1, "still unsent");
    failAlerts = false;
    await listener.statusEvaluated(status(1_000), []);
    assert.deepEqual(sent.filter((s) => s.kind === "alert").map((s) => (s.payload as RelayPayloads["alert"]).alertLogId), ["41"]);
    assert.equal(log.unsent.length, 0);
  });

  it("does not send an alert twice when it reached the queue but was not marked sent", async () => {
    const { relay, sent } = recordingRelay();
    const log = outbox([ALERT]);
    const listener = statusRelay({
      relay, live: noLive, snapshotIntervalMs: MINUTE_MS,
      statusLog: { ...log, markSentToGround: async () => { throw new Error("connection lost"); } },
    });
    await assert.rejects(listener.statusEvaluated(status(0), SOME_CHANGE), /connection lost/);
    const retry = statusRelay({ relay, live: noLive, statusLog: log, snapshotIntervalMs: MINUTE_MS });
    await retry.statusEvaluated(status(1_000), []);
    assert.equal(sent.filter((s) => s.kind === "alert").length, 1);
    assert.equal(log.unsent.length, 0);
  });

  it("still sends an alert left in the outbox by an astronaut who has since been removed (owner decision on F012)", async () => {
    const { relay, sent } = recordingRelay();
    const log = outbox([{ ...ALERT, id: "77", astronautId: "gone", crewWide: false }]);
    const listener = statusRelay({ relay, live: noLive, statusLog: log, snapshotIntervalMs: MINUTE_MS });
    await listener.statusEvaluated(status(0), []); // an evaluation of a1, who is still on board
    assert.deepEqual(sent.filter((s) => s.kind === "alert").map((s) => (s.payload as RelayPayloads["alert"]).astronautId), ["gone"]);
    assert.equal(log.unsent.length, 0);
  });
});

describe("calories per day for the ground's daily log", () => {
  const food = (id: string, kcal: number | null) => ({
    id, name: id, category: "Entrées", foodType: null, serving: "1", kcal, proteinG: null, calciumMg: null, vitaminDUg: null, sodiumMg: null,
  });
  const meal = (id: number, foodId: string, eatenAt: string) => ({ id, astronautId: "a1", foodId, eatenAt });

  it("totals each UTC day with meals, oldest first, counting a meal with no published kcal as unknown", () => {
    const foods = [food("pasta", 400), food("tea", null)];
    const meals = [
      meal(3, "pasta", "2026-11-15T08:00:00.000Z"),
      meal(1, "pasta", "2026-11-14T12:00:00.000Z"),
      meal(2, "tea", "2026-11-14T23:59:00.000Z"),
    ];
    assert.deepEqual(caloriesByDay(meals, foods), [
      { day: "2026-11-14", kcalAtLeast: 400, mealsLogged: 2, mealsWithoutKcal: 1 },
      { day: "2026-11-15", kcalAtLeast: 400, mealsLogged: 1, mealsWithoutKcal: 0 },
    ]);
  });

  it("has no days without meals", () => {
    assert.deepEqual(caloriesByDay([], []), []);
  });
});

describe("the daily log relay (review F018)", () => {
  const NOW = Date.parse("2026-11-15T12:00:00.000Z");
  const astronaut = (id: string) => ({ id, name: id, watchId: null, age: 30, sex: "female" as const, massKg: 60, heightM: 1.7 });

  /** In-memory stores: two astronauts, check-ins only (no meals, readings or menu items). */
  /**
   * In-memory stores: two astronauts whose profiles can change, check-ins, and heart rate (no meals
   * or menu items). `failReads` makes the next check-in reads throw, as a failing database would.
   */
  function fakeStores() {
    const checkIns: CheckIn[] = [];
    const heartRates: SeriesPoint[] = [];
    const profiles = [astronaut("a1"), astronaut("a2")];
    let failReads = 0;
    const stores = {
      astronauts: { list: async () => profiles.map((profile) => ({ ...profile })) },
      checkIns: {
        between: async (id: string, fromMs: number, toMs: number) => {
          if (failReads-- > 0) throw new Error("database unavailable");
          return checkIns.filter((c) => c.astronautId === id && Date.parse(c.at) >= fromMs && Date.parse(c.at) <= toMs);
        },
      },
      meals: { between: async () => [] },
      foods: { menu: async () => ({ sources: [], foods: [] }) },
      readings: {
        series: async (id: string, _metric: string, window: { fromMs: number; toMs: number }) =>
          id === "a1" ? heartRates.filter((p) => Date.parse(p.t) >= window.fromMs && Date.parse(p.t) <= window.toMs) : [],
      },
      mission: { get: async () => ({ name: "Test", startDate: "2026-11-10", gravity: "iss" as const, sleepDayTimeZone: "UTC" }) },
    } as unknown as DailyLogStores;
    const addCheckIn = (astronautId: string, at: string) => checkIns.push({ id: checkIns.length + 1, astronautId, mood: 3, stress: 3, at });
    /** Thirty minutes of a1's heart rate at `bpm` from `startIso`. */
    const addHeartRate = (startIso: string, bpm: number) => {
      for (let i = 0; i < 30; i += 1) heartRates.push({ t: new Date(Date.parse(startIso) + i * 60_000).toISOString(), value: bpm, n: 1, source: "watch" });
    };
    const setAge = (astronautId: string, age: number) => { profiles.find((p) => p.id === astronautId)!.age = age; };
    return { stores, addCheckIn, addHeartRate, setAge, failNextReads: (count: number) => { failReads = count; } };
  }

  function fakeSend(failures: number) {
    const sent: RelayPayloads["dailyLog"][] = [];
    let left = failures;
    return {
      sent,
      relay: {
        send: (async (_kind: RelayEventKind, payload: unknown) => {
          if (left-- > 0) throw new Error("queue unavailable");
          sent.push(payload as RelayPayloads["dailyLog"]);
          return { id: String(sent.length) } as never;
        }) as Relay["send"],
      },
    };
  }

  it("tries a failed send again at the next run", async () => {
    const { stores } = fakeStores();
    const { relay, sent } = fakeSend(1);
    const logs = dailyLogRelay({ stores, settings: DEFAULT_RULE_BOOK.settings, relay, now: () => NOW });
    await assert.rejects(logs.announceIfChanged(), /queue unavailable/);
    assert.equal(sent.length, 0);
    await logs.announceIfChanged();
    assert.deepEqual(sent.map((log) => log.astronautId), ["a1", "a2"], "a1's log is sent again, then a2's");
  });

  it("resends only the astronaut whose log changed, and nothing when nothing did", async () => {
    const { stores, addCheckIn } = fakeStores();
    const { relay, sent } = fakeSend(0);
    const logs = dailyLogRelay({ stores, settings: DEFAULT_RULE_BOOK.settings, relay, now: () => NOW });
    await logs.announceIfChanged();
    await logs.announceIfChanged();
    assert.equal(sent.length, 2, "unchanged: not sent again");
    addCheckIn("a2", "2026-11-15T11:00:00.000Z");
    await logs.announceIfChanged();
    assert.deepEqual(sent.slice(2).map((log) => [log.astronautId, log.checkIns.length]), [["a2", 1]]);
  });

  it("rebuilds from yesterday, from further back only when the last run was longer ago, never before mission day 1", () => {
    const day = (date: string) => Date.parse(`${date}T00:00:00.000Z`);
    const missionStart = day("2026-11-10");
    assert.equal(rebuildFromDayMs("2026-11-15T11:59:00.000Z", missionStart, NOW), day("2026-11-14"), "a minute ago: yesterday");
    assert.equal(rebuildFromDayMs("2026-11-12T08:00:00.000Z", missionStart, NOW), day("2026-11-12"), "three days ago: from that day");
    assert.equal(rebuildFromDayMs("2026-11-15T11:59:00.000Z", day("2026-11-15"), NOW), day("2026-11-15"), "mission starts today");
  });

  it("rebuilds from an earlier day a write changed, and the relay sends it at the next run", async () => {
    const day = (date: string) => Date.parse(`${date}T00:00:00.000Z`);
    assert.equal(rebuildFromDayMs("2026-11-15T11:59:00.000Z", day("2026-11-10"), NOW, day("2026-11-11")), day("2026-11-11"));
    assert.equal(rebuildFromDayMs("2026-11-15T11:59:00.000Z", day("2026-11-10"), NOW, day("2026-11-01")), day("2026-11-10"), "never before mission day 1");

    const { stores, addCheckIn } = fakeStores();
    const { relay, sent } = fakeSend(0);
    const logs = dailyLogRelay({ stores, settings: DEFAULT_RULE_BOOK.settings, relay, now: () => NOW });
    await logs.announceIfChanged();
    addCheckIn("a1", "2026-11-11T09:00:00.000Z"); // four days ago: not rebuilt unless marked
    await logs.announceIfChanged();
    assert.equal(sent.length, 2, "unmarked, the earlier day is kept as built");
    logs.dayChanged("a1", Date.parse("2026-11-11T09:00:00.000Z"));
    await logs.announceIfChanged();
    assert.deepEqual(sent.slice(2).map((log) => [log.astronautId, log.checkIns.length]), [["a1", 1]]);
    await logs.announceIfChanged();
    assert.equal(sent.length, 3, "the mark is used once");
  });

  it("keeps a changed-day mark when the rebuild's read fails, and sends the day at the next run (review F101)", async () => {
    const { stores, addCheckIn, failNextReads } = fakeStores();
    const { relay, sent } = fakeSend(0);
    const logs = dailyLogRelay({ stores, settings: DEFAULT_RULE_BOOK.settings, relay, now: () => NOW });
    await logs.announceIfChanged();
    addCheckIn("a1", "2026-11-11T09:00:00.000Z");
    logs.dayChanged("a1", Date.parse("2026-11-11T09:00:00.000Z"));
    failNextReads(1);
    await assert.rejects(logs.announceIfChanged(), /database unavailable/);
    await logs.announceIfChanged();
    assert.deepEqual(sent.slice(2).map((log) => [log.astronautId, log.checkIns.length]), [["a1", 1]], "the earlier day still reached the ground");
  });

  it("rebuilds the whole history after a profile change, matching a full rebuild (review F102)", async () => {
    const { stores, addHeartRate, setAge } = fakeStores();
    const { relay, sent } = fakeSend(0);
    const logs = dailyLogRelay({ stores, settings: DEFAULT_RULE_BOOK.settings, relay, now: () => NOW });
    addHeartRate("2026-11-11T09:00:00.000Z", 110); // below the threshold at 30, above it at 80
    await logs.announceIfChanged();
    const dayMinutes = (log: RelayPayloads["dailyLog"]) => log.exercise.find((day) => day.day === "2026-11-11")?.minutes;
    assert.equal(dayMinutes(sent[0]), 0);
    setAge("a1", 80); // e.g. removed and added again with a corrected age, within one minute
    await logs.announceIfChanged();
    const a1 = (await stores.astronauts.list()).find((a) => a.id === "a1")!;
    const { at: _at, ...full } = await readDailyLog(stores, DEFAULT_RULE_BOOK.settings, a1, NOW);
    const { at: _sentAt, ...latest } = sent.at(-1)!;
    assert.deepEqual(latest, full, "identical to a full rebuild with the new age");
    assert.ok((dayMinutes(sent.at(-1)!) ?? 0) > 0, "the earlier day was counted again");
  });

  it("rebuilds the whole history when told the astronaut was removed or added again", async () => {
    const { stores, addCheckIn } = fakeStores();
    const { relay, sent } = fakeSend(0);
    const logs = dailyLogRelay({ stores, settings: DEFAULT_RULE_BOOK.settings, relay, now: () => NOW });
    await logs.announceIfChanged();
    addCheckIn("a2", "2026-11-10T09:00:00.000Z"); // mission day 1, unmarked
    await logs.announceIfChanged();
    assert.equal(sent.length, 2);
    logs.historyChanged("a2");
    await logs.announceIfChanged();
    assert.deepEqual(sent.slice(2).map((log) => [log.astronautId, log.checkIns.length]), [["a2", 1]]);
  });

  it("marks each UTC day of uploaded heart rate once, and nothing for other metrics", () => {
    const reading = (metric: string, takenAt: string, astronautId = "a1") => ({ astronautId, metric: metric as "heartRate", takenAt });
    assert.deepEqual(
      dailyLogDaysTouched([
        reading("heartRate", "2026-11-11T09:00:00.000Z"),
        reading("heartRate", "2026-11-11T23:00:00.000Z"),
        reading("heartRate", "2026-11-12T01:00:00.000Z", "a2"),
        reading("spo2", "2026-11-09T01:00:00.000Z"),
      ]),
      [{ astronautId: "a1", atMs: Date.parse("2026-11-11T00:00:00.000Z") }, { astronautId: "a2", atMs: Date.parse("2026-11-12T00:00:00.000Z") }],
    );
  });

  it("keeps the days before yesterday as built and replaces the recent ones", () => {
    const log = (days: string[], checkInAt: string[]) => ({
      astronautId: "a1",
      at: "t",
      checkIns: checkInAt.map((at, i) => ({ id: i, astronautId: "a1", mood: 3, stress: 3, at })),
      calories: days.map((day) => ({ day, kcalAtLeast: 100, mealsLogged: 1, mealsWithoutKcal: 0 })),
      exercise: days.map((day) => ({ day, minutes: 10, goalMinutes: 120 })),
    });
    const built = log(["2026-11-12", "2026-11-13", "2026-11-14"], ["2026-11-12T08:00:00.000Z", "2026-11-14T08:00:00.000Z"]);
    const recent = log(["2026-11-14", "2026-11-15"], ["2026-11-14T08:00:00.000Z", "2026-11-15T08:00:00.000Z"]);
    const merged = withRecentDays(built, recent, Date.parse("2026-11-14T00:00:00.000Z"));
    assert.deepEqual(merged.exercise.map((day) => day.day), ["2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
    assert.deepEqual(merged.checkIns.map((c) => c.at.slice(0, 10)), ["2026-11-12", "2026-11-14", "2026-11-15"]);
  });
});
