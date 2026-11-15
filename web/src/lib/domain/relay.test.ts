import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LiveMessage, Metric, OnboardAlert, OnboardNote, RelayDelayResponse, RelayEvent } from "@heartbeat/shared";
import {
  bannerRelayText, earthLinkTile, groundNoteText, notesNewestFirst, notesToShow, onboardNoteText, READ_NOTES_SHOWN, relayedAlertFor, shouldRefresh,
} from "./relay";
import { evaluationFixture } from "./test-fixtures";

const T0 = Date.parse("2026-11-15T01:00:00.000Z");
const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();

const RELAY: RelayDelayResponse = {
  preset: "marsClose",
  realTime: false,
  label: "Mars (close)",
  oneWayDelayMs: 10_000,
  presets: [],
};

function onboardAlert(overrides: Partial<OnboardAlert> = {}): OnboardAlert {
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
    message: null,
    at: at(0),
    sentAt: at(0),
    deliverAt: at(161),
    handling: null,
    ...overrides,
  };
}

describe("earthLinkTile", () => {
  it("shows the preset and the current one-way delay from the server", () => {
    assert.deepEqual(earthLinkTile(RELAY), { value: "Mars (close) · 10 s delay", detail: "Demo scale" });
    assert.equal(earthLinkTile({ ...RELAY, realTime: true, oneWayDelayMs: 180_000 }).value, "Mars (close) · 3 min delay");
  });
});

describe("relayedAlertFor (the red banner's alert sent to the surgeon)", () => {
  const evaluation = evaluationFixture("spike", "alert", at(0));

  it("picks the newest relayed red alert of the same rule", () => {
    const older = onboardAlert({ alertId: "1", sentAt: at(-600) });
    const newer = onboardAlert({ alertId: "2", sentAt: at(0) });
    assert.equal(relayedAlertFor(evaluation, [newer, older])?.alertId, "2");
  });

  it("accepts a crew-wide alert filed under another astronaut", () => {
    assert.equal(relayedAlertFor({ ...evaluation, astronautId: "a2" }, [onboardAlert({ crewWide: true })])?.alertId, "15");
    assert.equal(relayedAlertFor({ ...evaluation, astronautId: "a2" }, [onboardAlert()]), null);
  });

  it("claims nothing for a watch banner, another rule, or an eased (yellow) send", () => {
    assert.equal(relayedAlertFor(evaluationFixture("spike", "watch", at(0)), [onboardAlert()]), null);
    assert.equal(relayedAlertFor(evaluation, [onboardAlert({ ruleId: "other" })]), null);
    assert.equal(relayedAlertFor(evaluation, [onboardAlert({ status: "watch" })]), null);
  });
});

describe("bannerRelayText", () => {
  it("counts down to the server's deliverAt as m:ss", () => {
    assert.equal(bannerRelayText(onboardAlert(), T0), "Alert sent to flight surgeon · arrives in 2:41");
    assert.equal(bannerRelayText(onboardAlert(), T0 + 160_500), "Alert sent to flight surgeon · arrives in 0:01");
  });

  it("says when it arrived, then how the surgeon handled it", () => {
    assert.equal(bannerRelayText(onboardAlert(), T0 + 200_000), "Alert sent to flight surgeon · arrived 01:02 UTC");
    const handled = onboardAlert({ handling: { state: "acknowledged", at: at(300), receivedAt: at(310) } });
    assert.equal(bannerRelayText(handled, T0 + 400_000), "Flight surgeon acknowledged · 01:05 UTC");
  });
});

describe("notes", () => {
  const note = (noteId: string, receivedSeconds: number, readSeconds: number | null): OnboardNote => ({
    noteId,
    text: noteId,
    alertId: null,
    sentAt: at(receivedSeconds - 10),
    receivedAt: at(receivedSeconds),
    readAt: readSeconds === null ? null : at(readSeconds),
  });

  it("lists unread notes first, then the newest few read ones", () => {
    const notes = [note("read-old", 10, 20), note("unread", 30, null), ...[40, 50, 60, 70].map((s) => note(`read-${s}`, s, s + 1))];
    const shown = notesToShow(notes).map((n) => n.noteId);
    assert.equal(shown[0], "unread");
    assert.deepEqual(shown.slice(1), ["read-70", "read-60", "read-50"]);
    assert.equal(shown.length, 1 + READ_NOTES_SHOWN);
  });

  it("words a note's times in UTC", () => {
    assert.equal(onboardNoteText(note("n", 70, null)), "Sent from Earth 01:01 UTC · Received 01:01 UTC");
  });

  it("follows a ground note from sending to the read receipt", () => {
    const sent = { deliverAt: at(30), readAt: null };
    assert.equal(groundNoteText(sent, T0), "Sending · 0:30 left");
    assert.equal(groundNoteText(sent, T0 + 31_000), "Delivered 01:00 UTC · not read yet");
    assert.equal(groundNoteText({ ...sent, readAt: at(120) }, T0 + 200_000), "Read 01:02 UTC");
  });

  it("orders the surgeon's notes newest first", () => {
    assert.deepEqual(notesNewestFirst([{ sentAt: at(0) }, { sentAt: at(60) }]).map((n) => n.sentAt), [at(60), at(0)]);
  });
});

describe("shouldRefresh (live updates)", () => {
  const event = (kind: RelayEvent["kind"]) => ({ id: "1", kind }) as RelayEvent;
  const sent = (kind: RelayEvent["kind"]): LiveMessage => ({ type: "relaySent", event: event(kind) });
  const delivered = (kind: RelayEvent["kind"]): LiveMessage => ({ type: "relayDelivered", event: event(kind) });

  it("reloads the dashboard for notes, alert handling and its own alerts leaving", () => {
    assert.equal(shouldRefresh("onboard", delivered("note")), true);
    assert.equal(shouldRefresh("onboard", delivered("alertState")), true);
    assert.equal(shouldRefresh("onboard", sent("alert")), true);
  });

  it("never reloads the dashboard for its own status snapshots or readings, so loading cannot loop", () => {
    assert.equal(shouldRefresh("onboard", sent("status")), false);
    assert.equal(shouldRefresh("onboard", { type: "readings", astronautId: "a1", metrics: [] }), false);
  });

  it("reloads the console for everything arriving on the ground and its own sends", () => {
    for (const kind of ["status", "alert", "readReceipt", "roster", "mission", "dailyLog", "deliveryFailure"] as const) assert.equal(shouldRefresh("ground", delivered(kind)), true, kind);
    for (const kind of ["note", "alertState", "crewChange"] as const) assert.equal(shouldRefresh("ground", sent(kind)), true, kind);
  });

  it("reloads the dashboard, not the console, when its astronaut's points change (a task became done)", () => {
    const message = { type: "points", points: { astronautId: "a1" } } as LiveMessage;
    assert.equal(shouldRefresh("onboard", message, "a1"), true);
    assert.equal(shouldRefresh("ground", message, "a1"), false);
  });

  it("ignores another astronaut's points, and pages that show no points ignore them all", () => {
    const message = { type: "points", points: { astronautId: "a2" } } as LiveMessage;
    assert.equal(shouldRefresh("onboard", message, "a1"), false);
    assert.equal(shouldRefresh("onboard", message), false, "an area detail page names no astronaut");
  });

  it("reloads both sides when the delay changes", () => {
    const message: LiveMessage = { type: "relayDelay", relay: RELAY };
    assert.equal(shouldRefresh("onboard", message), true);
    assert.equal(shouldRefresh("ground", message), true);
  });

  it("reloads the dashboard when its astronaut uploads an ECG or SpO₂, not for the minute's other readings (demo step 2)", () => {
    const readings = (astronautId: string, ...metrics: Metric[]): LiveMessage => ({ type: "readings", astronautId, metrics });
    assert.equal(shouldRefresh("onboard", readings("a1", "ecg"), "a1"), true);
    assert.equal(shouldRefresh("onboard", readings("a1", "heartRate", "spo2"), "a1"), true);
    assert.equal(shouldRefresh("onboard", readings("a1", "heartRate", "ibi", "wristAngle", "pressure"), "a1"), false);
    assert.equal(shouldRefresh("onboard", readings("a2", "ecg"), "a1"), false, "another astronaut's ECG");
    assert.equal(shouldRefresh("onboard", readings("a1", "ecg")), false, "a page that names no astronaut");
    assert.equal(shouldRefresh("ground", readings("a1", "ecg"), "a1"), false);
  });
});
