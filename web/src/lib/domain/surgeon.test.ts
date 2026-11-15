import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GroundAlert, GroundCrewMember, GroundCrewResponse, PendingCrewChange, RelayDelayResponse, WatchInfo } from "@heartbeat/shared";
import {
  alertCard, alertChartWindow, ALERT_CHART_EMPTY_TEXT, ALERT_CHART_LOOKBACK_MS, ALERT_CHART_SPAN_TEXT, consoleHref, emptyFeedText, crewCard, dataAsOfText, delayOptions, describeChange, feedAlerts,
  groundChartSpecs, maskWatchId, missionLine, openAlertCount, otherWatches, parseConsoleView, rosterRows, spareWatchText, syncBadge, watchLine,
} from "./surgeon";
import { MISSION_FIXTURE } from "./test-fixtures";

const T0 = Date.parse("2026-11-15T01:00:00.000Z");
const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();

const RELAY: RelayDelayResponse = {
  preset: "marsClose",
  realTime: false,
  label: "Mars (close)",
  oneWayDelayMs: 10_000,
  presets: [
    { preset: "iss", label: "ISS", realDelayMs: 0, demoDelayMs: 0 },
    { preset: "marsClose", label: "Mars (close)", realDelayMs: 180_000, demoDelayMs: 10_000 },
  ],
};

function groundAlert(overrides: Partial<GroundAlert> = {}): GroundAlert {
  return {
    alertId: "15",
    alertLogId: "4",
    astronautId: "a1",
    ruleId: "spike",
    title: "Radiation dose spike",
    area: "radiation",
    metric: "radiationDoseRate",
    status: "alert",
    crewWide: false,
    message: { what: "Dose up.", why: "Solar event.", do: "Shelter." },
    at: at(0),
    sentAt: at(0),
    receivedAt: at(10),
    lagMs: 10_000,
    state: "new",
    stateChangedAt: null,
    ...overrides,
  };
}

const watch = (watchId: string, overrides: Partial<WatchInfo> = {}): WatchInfo => ({ watchId, lastContactAt: at(-120), batteryPct: 64, ...overrides });

function member(astronautId: string, overrides: Partial<GroundCrewMember> = {}): GroundCrewMember {
  return { astronautId, name: `Astronaut ${astronautId}`, watch: null, status: null, receivedAt: null, ...overrides };
}

const names = new Map([["a1", "Astronaut 1"]]);

describe("console view (in the URL)", () => {
  it("reads the tab, filter and open alert, falling back to the defaults", () => {
    assert.deepEqual(parseConsoleView({ tab: "crew", filter: "watch", open: "15" }), { tab: "crew", filter: "watch", open: "15" });
    assert.deepEqual(parseConsoleView({ tab: "nope", filter: ["alert", "x"] }), { tab: "alerts", filter: "alert", open: null });
  });

  it("writes short links, leaving out the defaults", () => {
    assert.equal(consoleHref({ tab: "alerts", filter: "all", open: null }), "/surgeon");
    assert.equal(consoleHref({ tab: "alerts", filter: "alert", open: "15" }), "/surgeon?filter=alert&open=15");
  });
});

describe("header", () => {
  it("names the mission, day and crew size from the last mission report", () => {
    assert.equal(missionLine({ mission: MISSION_FIXTURE, sentAt: at(0), receivedAt: at(0) }, 3), "Heartbeat ISS Demo · Day 10 · Crew of 3");
    assert.equal(missionLine({ mission: null, sentAt: null, receivedAt: null }, 1), "Mission not reported yet · Crew of 1");
  });

  it("shows the newest snapshot's time in UTC, or a dash before the first", () => {
    assert.equal(dataAsOfText(at(5), T0 + 185_000), "01:00:05 UTC · 3 min ago");
    assert.equal(dataAsOfText(at(5), T0 + 45_000), "01:00:05 UTC · 40 s ago");
    assert.equal(dataAsOfText(null, T0), "—");
  });

  it("labels each preset with the server's name and the delay it gives now, with both delays in the tooltip", () => {
    const options = delayOptions(RELAY);
    assert.deepEqual(options.map((o) => [o.label, o.selected]), [["ISS · 0 s", false], ["Mars (close) · 10 s", true]]);
    assert.equal(delayOptions({ ...RELAY, realTime: true })[1].label, "Mars (close) · 3 min");
    assert.equal(options[1].description, "Mars (close): 3 min real, 10 s demo");
  });
});

describe("alert feed", () => {
  const alerts = [
    groundAlert({ alertId: "1", status: "watch", receivedAt: at(10) }),
    groundAlert({ alertId: "2", receivedAt: at(30), state: "resolved" }),
    groundAlert({ alertId: "3", receivedAt: at(20) }),
  ];

  it("lists the newest arrival first and filters by status", () => {
    assert.deepEqual(feedAlerts(alerts, "all").map((a) => a.alertId), ["2", "3", "1"]);
    assert.deepEqual(feedAlerts(alerts, "watch").map((a) => a.alertId), ["1"]);
    assert.deepEqual(feedAlerts(alerts, "alert").map((a) => a.alertId), ["2", "3"]);
  });

  it("counts every alert not yet resolved", () => {
    assert.equal(openAlertCount(alerts), 2);
  });

  it("shows ship send and ground receive times in UTC with the server's lag", () => {
    const card = alertCard(groundAlert(), names);
    assert.equal(card.times, "Sent 01:00:00 UTC ship · Received 01:00:10 UTC ground · 10 s delay");
    assert.equal(card.who, "Astronaut 1");
    assert.equal(card.what, "Dose up.");
    assert.equal(card.told, "Shelter.");
  });

  it("names a crew-wide alert for the whole crew, but addresses its note to the astronaut it is filed under", () => {
    const card = alertCard(groundAlert({ crewWide: true }), names);
    assert.equal(card.who, "Whole crew");
    assert.equal(card.recipient, "Astronaut 1");
  });

  it("allows acknowledging only while new, and resolving until resolved", () => {
    assert.deepEqual([alertCard(groundAlert(), names).canAcknowledge, alertCard(groundAlert(), names).canResolve], [true, true]);
    const acknowledged = alertCard(groundAlert({ state: "acknowledged" }), names);
    assert.deepEqual([acknowledged.canAcknowledge, acknowledged.canResolve, acknowledged.stateText], [false, true, "Acknowledged"]);
    const resolved = alertCard(groundAlert({ state: "resolved" }), names);
    assert.deepEqual([resolved.canAcknowledge, resolved.canResolve, resolved.emphasis], [false, false, "done"]);
  });

  it("gives only an unresolved red alert the urgent border", () => {
    assert.equal(alertCard(groundAlert(), names).emphasis, "urgent");
    assert.equal(alertCard(groundAlert({ status: "watch" }), names).emphasis, "normal");
  });

  it("says what the filter found nothing of, over the feed's own window", () => {
    assert.equal(emptyFeedText("all"), "No alerts have reached the ground in the last 7 days.");
    assert.equal(emptyFeedText("watch"), "No ▲ Watch alerts have reached the ground in the last 7 days.");
    assert.equal(emptyFeedText("alert"), "No ■ Alert alerts have reached the ground in the last 7 days.");
  });

  it("words the alert chart's captions from its lookback", () => {
    assert.equal(ALERT_CHART_SPAN_TEXT, "−6 h → alert");
    assert.match(ALERT_CHART_EMPTY_TEXT, /the 6 hours before this alert/);
  });

  it("says so when the server sent no message", () => {
    assert.equal(alertCard(groundAlert({ message: null }), names).what, "—");
  });

  it("charts the 6 hours before the alert, with the alert near the right edge", () => {
    const window = alertChartWindow(at(0));
    assert.equal(window.alertMs - window.fromMs, ALERT_CHART_LOOKBACK_MS);
    assert.ok(window.toMs > window.alertMs);
  });
});

describe("crew summary", () => {
  it("shows each area's server status with its symbol and short name", () => {
    const card = crewCard(
      member("a1", {
        status: { astronautId: "a1", at: at(0), overall: "alert", areas: [{ area: "radiation", status: "alert", reason: null }, { area: "nutrition", status: "normal", reason: null }] },
      }),
      T0,
    );
    assert.equal(card.status, "alert");
    assert.deepEqual(card.areas[1], { name: "Radiation", symbol: "■", tone: "bad" });
    assert.deepEqual(card.areas[4], { name: "Food", symbol: "●", tone: "ok" });
    assert.deepEqual(card.areas[0], { name: "Vitals", symbol: "○", tone: "neutral" });
  });

  it("describes the watch: masked id, last contact and battery", () => {
    assert.equal(watchLine(watch("abcd-4A9F"), T0), "Watch ••••4A9F · 2 min ago · 64%");
    assert.equal(watchLine(watch("abcd-4A9F", { lastContactAt: null, batteryPct: null }), T0), "Watch ••••4A9F · no contact yet");
    assert.equal(watchLine(null, T0), "No watch assigned");
    assert.equal(spareWatchText(watch("x-7C21"), T0), "Watch · ID ••••7C21 · last contact 2 min ago");
    assert.equal(maskWatchId("12"), "••••12");
  });
});

describe("Crew & Watches", () => {
  const pending = (change: PendingCrewChange["change"], arrivesSeconds: number): PendingCrewChange => ({
    changeId: `c${arrivesSeconds}`,
    change,
    sentAt: at(arrivesSeconds - 10),
    arrivesOnboardAt: at(arrivesSeconds),
  });
  const ground: Pick<GroundCrewResponse, "crew" | "pendingChanges" | "unassignedWatches"> = {
    crew: [member("a1", { watch: watch("w-1111") }), member("a2")],
    unassignedWatches: [watch("w-2222")],
    pendingChanges: [
      pending({ action: "unassignWatch", astronautId: "a2" }, 30),
      pending({ action: "addAstronaut", astronaut: { id: "a3", name: "Astronaut 3", age: null, sex: null, massKg: null, heightM: null } }, 40),
    ],
  };

  it("lists the roster, then astronauts still being added", () => {
    const rows = rosterRows(ground, T0);
    assert.deepEqual(rows.map((r) => [r.astronautId, r.onRoster]), [["a1", true], ["a2", true], ["a3", false]]);
    assert.equal(rows[0].watchText, "••••1111");
    assert.equal(rows[0].battery, "64%");
    assert.equal(rows[1].battery, "—");
    assert.equal(rows[0].pending, null);
    assert.equal(rows[1].pending?.changeId, "c30");
  });

  it("shows one row for an astronaut added, removed and added again within one delay", () => {
    const add = (seconds: number) =>
      pending({ action: "addAstronaut", astronaut: { id: "a9", name: `Astronaut 9 (${seconds})`, age: null, sex: null, massKg: null, heightM: null } }, seconds);
    const readded = rosterRows({ crew: [], pendingChanges: [add(10), pending({ action: "removeAstronaut", astronautId: "a9" }, 20), add(30)] }, T0);
    assert.deepEqual(readded.map((r) => [r.astronautId, r.name, r.pending?.changeId]), [["a9", "Astronaut 9 (30)", "c30"]]);
  });

  it("shows no being-added row once the newest change on the way removes them", () => {
    const add = pending({ action: "addAstronaut", astronaut: { id: "a9", name: "Astronaut 9", age: null, sex: null, massKg: null, heightM: null } }, 10);
    assert.deepEqual(rosterRows({ crew: [], pendingChanges: [add, pending({ action: "removeAstronaut", astronautId: "a9" }, 20)] }, T0), []);
  });

  it("shows Synced, then Sending with the time left, then Confirming until the roster comes back", () => {
    assert.deepEqual(syncBadge(null, T0), { text: "Synced", tone: "ok" });
    assert.deepEqual(syncBadge({ arrivesOnboardAt: at(72) }, T0), { text: "Sending · 1:12 left", tone: "warn" });
    assert.deepEqual(syncBadge({ arrivesOnboardAt: at(72) }, T0 + 80_000), { text: "Confirming", tone: "warn" });
  });

  it("offers every other known watch for reassigning", () => {
    assert.deepEqual(otherWatches(ground, "a2").map((w) => w.watchId), ["w-2222", "w-1111"]);
    assert.deepEqual(otherWatches(ground, "a1").map((w) => w.watchId), ["w-2222"]);
  });

  it("describes each kind of crew change", () => {
    assert.equal(describeChange({ action: "assignWatch", astronautId: "a1", watchId: "w-1111" }, names), "Assign watch ••••1111 to Astronaut 1");
    assert.equal(describeChange({ action: "unassignWatch", astronautId: "a1" }, names), "Unassign Astronaut 1's watch");
    assert.equal(describeChange({ action: "removeAstronaut", astronautId: "zz" }, names), "Remove zz");
  });
});

describe("groundChartSpecs", () => {
  it("lists every dashboard chart once, in area order, including the daily-log charts", () => {
    const sources = groundChartSpecs().map((spec) => spec.source);
    const keys = sources.map((source) => JSON.stringify(source));
    assert.equal(new Set(keys).size, keys.length, "a chart two areas share is drawn once");
    assert.deepEqual(sources[0], { kind: "metric", metric: "heartRate" });
    for (const kind of ["exerciseDays", "dailyCalories", "checkIns"]) assert.ok(sources.some((source) => source.kind === kind), kind);
    assert.equal(sources.filter((source) => source.kind === "checkIns").length, 2, "mood and stress");
  });
});
