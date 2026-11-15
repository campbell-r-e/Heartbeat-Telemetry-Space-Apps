import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DISPLAY_SETTING_KEYS } from "@heartbeat/shared";
import * as guard from "./response-guards";
import { evaluationFixture, statusFixture } from "./test-fixtures";

const status = statusFixture({ radiation: "alert", gravity: null }, [evaluationFixture("spike", "alert", "2026-11-14T02:00:00Z")]);

const REMOVE = Symbol("remove");
type Path = (string | number)[];

/** A deep copy of the status fixture with the value at `path` replaced (or removed). */
function changed(path: Path, value: unknown): unknown {
  const copy: unknown = structuredClone(status);
  let parent = copy as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) parent = parent[key] as Record<string | number, unknown>;
  const last = path[path.length - 1];
  if (value === REMOVE) delete parent[last];
  else parent[last] = value;
  return copy;
}

describe("isAstronautStatus", () => {
  it("accepts the shared shape, with null area statuses", () => {
    assert.equal(guard.isAstronautStatus(status), true);
  });

  it("accepts a reason, a mission dose and a missing exercise goal", () => {
    const missionDose = { mSv: 12.3, careerLimitMSv: 600, shareOfCareerLimit: 0.0205, projectedMSv: 80, projectedShareOfCareerLimit: 0.13, projectionDays: 180, at: "2026-11-14T00:00:00Z" };
    assert.equal(guard.isAstronautStatus(changed(["areas", 1, "reason"], "Not enough data")), true);
    assert.equal(guard.isAstronautStatus(changed(["derived", "missionDose"], missionDose)), true);
    assert.equal(guard.isAstronautStatus(changed(["derived", "exerciseToday", "goalMinutes"], null)), true);
  });

  const rejected: [string, Path, unknown][] = [
    ["an unknown status", ["areas", 0, "status"], "red"],
    ["an unknown area", ["areas", 0, "area"], "sleep"],
    ["a message part that is not text", ["evaluations", 0, "message", "why"], 3],
    ["a missing rule source", ["evaluations", 0, "source"], REMOVE],
    ["a rule source without citations", ["evaluations", 0, "source", "citations"], REMOVE],
    ["an evaluation without a title", ["evaluations", 0, "title"], REMOVE],
    ["an area without its reason field", ["areas", 0, "reason"], REMOVE],
    ["exercise minutes as text", ["derived", "exerciseToday", "minutes"], "45"],
    ["a missing exercise goal", ["derived", "exerciseToday", "goalMinutes"], REMOVE],
    ["a renamed radiation multiple", ["derived", "radiationDailyDose"], { dailyDoseUGy: 1, previousSevenDayAverageUGy: 1, ratio: 1, at: "x" }],
    ["a malformed HRV", ["derived", "hrv"], { rmssdMs: "56", at: "x" }],
    ["a nutrition total without its unknown count", ["derived", "nutritionToday", "totals", "kcal", "unknownMeals"], REMOVE],
    ["a missing nutrition rating", ["derived", "nutritionYesterday", "statuses", "sodium"], REMOVE],
    ["pending rules that are not a list", ["pendingRules"], {}],
    ["an unknown metric with no recent data", ["noRecentData"], ["steps"]],
    ["a mission dose missing its limit", ["derived", "missionDose"], { mSv: 1 }],
    ["a missing mission dose field", ["derived", "missionDose"], REMOVE],
  ];
  for (const [name, path, value] of rejected) {
    it(`rejects ${name}`, () => assert.equal(guard.isAstronautStatus(changed(path, value)), false));
  }

  it("rejects things that are not a status at all", () => {
    assert.equal(guard.isAstronautStatus(null), false);
    assert.equal(guard.isAstronautStatus([]), false);
  });
});

describe("response guards for the crew, schedule and charts", () => {
  const astronaut = { id: "a1", name: "Astronaut 1", watchId: null, age: 24, sex: "male", massKg: 104.3, heightM: 1.8 };

  it("check the crew and its profile fields", () => {
    assert.equal(guard.isCrew([astronaut]), true);
    assert.equal(guard.isCrew([{ ...astronaut, sex: "other" }]), false);
    assert.equal(guard.isCrew([{ id: "a1", name: "Astronaut 1", watchId: null, age: 24 }]), false);
  });

  it("check the schedule, including the untimed exercise task (a changed shape fails at the boundary)", () => {
    assert.equal(guard.isSchedule([{ id: "exercise-daily", kind: "exercise", label: "Exercise", localTime: null, astronautId: null }]), true);
    assert.equal(guard.isSchedule({ tasks: [] }), false);
    assert.equal(guard.isSchedule([{ id: "ecg-0900", kind: "ecg", label: "ECG", astronautId: null }]), false);
  });

  it("check series points and their reference (band, lines and basis)", () => {
    const series = { astronautId: "ship", metric: "co2", unit: "mmHg", bucketMinutes: null, points: [{ t: "2026-11-14T00:00:00Z", value: 2.4, n: 1, source: "osdr" }], reference: null };
    const reference = { band: { low: null, high: 2.5 }, thresholds: [{ value: 3, status: "alert", label: "1-hour limit" }], basis: "settings" };
    assert.equal(guard.isSeries(series), true);
    assert.equal(guard.isSeries({ ...series, reference }), true);
    assert.equal(guard.isSeries({ ...series, reference: { ...reference, basis: "guess" } }), false);
    assert.equal(guard.isSeries({ ...series, reference: { ...reference, thresholds: [{ value: 3, status: "normal", label: "x" }] } }), false);
    assert.equal(guard.isSeries({ ...series, reference: undefined }), false);
    assert.equal(guard.isSeries({ ...series, points: [{ t: "x", value: "2.4", n: 1, source: "osdr" }] }), false);
  });

  it("check exercise minutes per day, allowing a day with no count", () => {
    assert.equal(guard.isExerciseDays([{ day: "2026-11-14", minutes: 4, goalMinutes: 120 }, { day: "2026-11-13", minutes: null, goalMinutes: null }]), true);
    assert.equal(guard.isExerciseDays([{ day: "2026-11-14", minutes: "4", goalMinutes: 120 }]), false);
  });

  it("check menu foods, allowing missing nutrient values as null", () => {
    const food = { id: "eggs", name: "Eggs", category: "Breakfast", foodType: null, serving: "1", kcal: null, proteinG: 1, calciumMg: 1, vitaminDUg: 1, sodiumMg: 1 };
    assert.equal(guard.isMenu({ sources: [], foods: [food] }), true);
    assert.equal(guard.isMenu({ sources: [], foods: [{ ...food, kcal: "183" }] }), false);
  });

  it("check meal logs, check-ins and delete replies", () => {
    assert.equal(guard.isMealLogs([{ id: 1, astronautId: "a1", foodId: "eggs", eatenAt: "x" }]), true);
    assert.equal(guard.isCheckIns([{ id: 1, astronautId: "a1", mood: 4, stress: 2 }]), false);
    assert.equal(guard.isDeleted({ deleted: true }), true);
    assert.equal(guard.isDeleted({ deleted: false }), false);
  });
});

describe("response guards for mission, tasks, alerts and settings", () => {
  it("check the mission", () => {
    const mission = { name: "Heartbeat ISS Demo", startDate: "2026-11-05", missionDay: 10, gravity: { preset: "iss", label: "ISS (microgravity)" }, sleepDayTimeZone: "UTC" };
    assert.equal(guard.isMission(mission), true);
    assert.equal(guard.isMission({ ...mission, sleepDayTimeZone: undefined }), false);
    assert.equal(guard.isMission({ ...mission, missionDay: undefined }), false);
    assert.equal(guard.isMission({ ...mission, gravity: { preset: "jupiter", label: "?" } }), false);
  });

  it("check task states, including the untimed exercise task", () => {
    const exercise = { taskId: "exercise-daily", kind: "exercise", label: "Exercise", localTime: null, done: false, doneAt: null, progress: { value: 45, goal: 120, unit: "min" }, points: 40 };
    assert.equal(guard.isTaskStates([exercise]), true);
    assert.equal(guard.isTaskStates([{ ...exercise, points: null }]), true);
    assert.equal(guard.isTaskStates([{ ...exercise, done: "no" }]), false);
    assert.equal(guard.isTaskStates([{ ...exercise, doneAt: undefined }]), false);
    assert.equal(guard.isTaskStates([{ ...exercise, points: undefined }]), false);
  });

  it("check the points summary and its badges", () => {
    const summary = {
      astronautId: "a1", at: "x", day: "2026-11-15", totalPoints: 1240, today: { points: 60, possiblePoints: 125, tasksDone: 3, tasks: 8 },
      streak: { days: 9, includesToday: false },
      badges: [{ id: "boneGuardian", name: "Bone Guardian", description: "d", earnedOn: null }],
    };
    assert.equal(guard.isPointsSummary(summary), true);
    assert.equal(guard.isPointsSummary({ ...summary, badges: [{ ...summary.badges[0], id: "gold" }] }), false);
    assert.equal(guard.isPointsSummary({ ...summary, streak: { days: 9 } }), false);
  });

  it("check the alert log", () => {
    const entry = { id: "1", at: "x", area: "radiation", metric: null, ruleId: "r", title: "T", from: null, to: "alert", message: { what: "w", why: "y", do: "d" } };
    assert.equal(guard.isAlertLog([entry]), true);
    assert.equal(guard.isAlertLog([{ ...entry, ruleId: null, message: null }]), true);
    assert.equal(guard.isAlertLog([{ ...entry, to: "red" }]), false);
  });

  it("check the settings: every display key present, and the plain-language limits", () => {
    const settings = Object.fromEntries(DISPLAY_SETTING_KEYS.map((key) => [key, 1]));
    const limit = { area: "vitals", label: "Blood oxygen, watch below", value: 95, unit: "%", status: "watch", source: { requirementId: null, document: "d", ours: false, citations: [] } };
    const zone = { area: "cabin", label: "Temperature and humidity, watch outside NASA's zone", status: "watch", source: limit.source };
    assert.equal(guard.isSettings({ settings, maxReadingAgeMinutes: { co2: 120 }, limits: [limit, zone] }), true);
    assert.equal(guard.isSettings({ settings: { ...settings, [DISPLAY_SETTING_KEYS[0]]: "2.26" }, maxReadingAgeMinutes: {}, limits: [] }), false);
    assert.equal(guard.isSettings({ settings: {}, maxReadingAgeMinutes: {}, limits: [] }), false);
    assert.equal(guard.isSettings({ settings, maxReadingAgeMinutes: {}, limits: [{ ...limit, value: "95" }] }), false);
  });
});

describe("response guards for the relay", () => {
  const relay = {
    preset: "marsFar",
    realTime: false,
    label: "Mars (far)",
    oneWayDelayMs: 30000,
    presets: [{ preset: "iss", label: "ISS", realDelayMs: 0, demoDelayMs: 0 }],
  };
  const groundCrew = {
    relay,
    dataAsOf: null,
    crew: [{ astronautId: "a1", name: "Astronaut 1", watch: { watchId: "w", lastContactAt: null, batteryPct: null }, status: null, receivedAt: null }],
    unassignedWatches: [],
    pendingChanges: [{ changeId: "9", change: { action: "unassignWatch", astronautId: "a1" }, sentAt: "t", arrivesOnboardAt: "t" }],
    failedChanges: [],
  };

  it("accepts the delay setting and refuses an unknown preset", () => {
    assert.equal(guard.isRelayDelay(relay), true);
    assert.equal(guard.isRelayDelay({ ...relay, preset: "venus" }), false);
  });

  it("checks the ground crew, including each pending crew change's shape", () => {
    assert.equal(guard.isGroundCrew(groundCrew), true);
    const badChange = { ...groundCrew, pendingChanges: [{ ...groundCrew.pendingChanges[0], change: { action: "assignWatch", astronautId: "a1" } }] };
    assert.equal(guard.isGroundCrew(badChange), false);
  });

  it("accepts a relay event answer and refuses an unknown kind", () => {
    assert.equal(guard.isRelayEvent({ id: "1", kind: "note", sentAt: "t", deliverAt: "t", payload: {} }), true);
    assert.equal(guard.isRelayEvent({ id: "1", kind: "gossip", sentAt: "t", deliverAt: "t" }), false);
  });

  it("checks the ground's daily log, and accepts one that has not arrived yet", () => {
    assert.equal(guard.isGroundDailyLog({ log: null, sentAt: null, receivedAt: null }), true);
    const log = { astronautId: "a1", at: "t", checkIns: [], calories: [{ day: "d", kcalAtLeast: 900, mealsLogged: 2, mealsWithoutKcal: 0 }], exercise: [] };
    assert.equal(guard.isGroundDailyLog({ log, sentAt: "t", receivedAt: "t" }), true);
    assert.equal(guard.isGroundDailyLog({ log: { ...log, calories: [{ day: "d" }] }, sentAt: "t", receivedAt: "t" }), false);
  });

  it("reads live messages by type and event kind only", () => {
    assert.equal(guard.isLiveMessage({ type: "relayDelivered", event: { id: "1", kind: "note" } }), true);
    assert.equal(guard.isLiveMessage({ type: "relayDelivered", event: { id: "1" } }), false);
    assert.equal(guard.isLiveMessage({ type: "hello" }), false);
    assert.equal(guard.isLiveMessage({ type: "points", points: { astronautId: "a1" } }), true);
    assert.equal(guard.isLiveMessage({ type: "points" }), false);
    assert.equal(guard.isLiveMessage(null), false);
  });

  it("checks a readings message's astronaut and metric list, which the dashboard reloads by", () => {
    assert.equal(guard.isLiveMessage({ type: "readings", astronautId: "a1", metrics: ["ecg"] }), true);
    assert.equal(guard.isLiveMessage({ type: "readings", astronautId: "a1" }), false);
    assert.equal(guard.isLiveMessage({ type: "readings", metrics: ["ecg"] }), false);
    assert.equal(guard.isLiveMessage({ type: "readings", astronautId: "a1", metrics: ["waveform"] }), false);
  });

  it("checks the demo storm's state and the answers to starting and clearing it", () => {
    assert.equal(guard.isSolarStormState({ active: false, factor: null, startedAt: null }), true);
    assert.equal(guard.isSolarStormState({ active: true, factor: 1.3, startedAt: "2026-11-15T06:11:29.514Z" }), true);
    assert.equal(guard.isSolarStormState({ active: true, factor: 1.3 }), false);
    assert.equal(guard.isStormStarted({ simulated: true, factor: 5, hours: 48, baselineUGyPerHour: 16.25 }), true);
    assert.equal(guard.isStormStarted({ simulated: true, factor: 5 }), false);
    assert.equal(guard.isStormStarted({ simulated: false, factor: 5, hours: 48, baselineUGyPerHour: 16.25 }), false);
    assert.equal(guard.isStormCleared({ cleared: true, clearedAt: "2026-11-15T06:12:04.586Z" }), true);
    assert.equal(guard.isStormCleared({ cleared: true }), false);
  });
});
