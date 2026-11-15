// Points, the measurement streak, badges, the task history cache and live points updates (SPEC §7),
// with in-memory stores.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Astronaut, CheckIn, LiveMessage, PointsSummary, ScheduledTask, ScheduledTaskKind, TaskState } from "@heartbeat/shared";
import { badgeList, badgesEarnedBy, firstRunEnd, newlyEarned } from "../src/domain/gamification/badges.ts";
import { pointsSummary } from "../src/domain/gamification/points-summary.ts";
import { crewPoints, pointsUpdates, taskActivityInUpload, type CrewPointsDeps } from "../src/domain/gamification/points-updates.ts";
import { measurementStreak } from "../src/domain/gamification/streak.ts";
import { cachedTaskHistory, isSettled, type TaskHistoryStores } from "../src/domain/gamification/task-history.ts";
import type { EarnedBadge } from "../src/domain/ports.ts";
import { RULE_SETTINGS, type RuleSettings } from "../src/domain/rules/settings.ts";
import { DEFAULT_SCHEDULE } from "../src/domain/schedule.ts";
import { taskPoints } from "../src/domain/task-points.ts";
import { DAY_MS, MINUTE_MS } from "../src/domain/time.ts";
import { activitiesUsedBy, dayTaskStates, type ActivityTimes, type TaskDay } from "../src/domain/today-tasks.ts";

const DAY1 = Date.parse("2026-11-05T00:00:00Z");
const summarize = (days: readonly TaskDay[], storedBadges: readonly EarnedBadge[], settings: RuleSettings, nowMs: number) =>
  pointsSummary({ astronautId: "a1", days, storedBadges }, settings, nowMs);
const none: ActivityTimes = { meal: [], checkIn: [], ecg: [], spo2: [] };
const at = (dayStartMs: number, hhmm: string) => dayStartMs + (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))) * MINUTE_MS;

/** A day of the default schedule where the listed kinds of task are all done. */
function dayWith(dayIndex: number, doneKinds: readonly ScheduledTaskKind[]): TaskDay {
  const dayStartMs = DAY1 + dayIndex * DAY_MS;
  const tasks = DEFAULT_SCHEDULE.map((task): TaskState => ({
    taskId: task.id, kind: task.kind, label: task.label, localTime: task.localTime,
    done: doneKinds.includes(task.kind), doneAt: null, progress: null, points: taskPoints(task.kind, RULE_SETTINGS),
  }));
  return { dayStartMs, tasks };
}
const MEASUREMENTS: ScheduledTaskKind[] = ["ecg", "spo2", "checkIn"];
const EVERYTHING: ScheduledTaskKind[] = ["ecg", "spo2", "checkIn", "meal", "exercise"];
const days = (kinds: ScheduledTaskKind[][]) => kinds.map((done, i) => dayWith(i, done));

describe("task points", () => {
  it("are the mockup's values per task; a full day of the schedule (two SpO₂ checks, three meals) is 125", () => {
    assert.deepEqual(
      (["ecg", "spo2", "checkIn", "meal", "exercise"] as const).map((kind) => taskPoints(kind, RULE_SETTINGS)),
      [20, 10, 15, 10, 40],
    );
    const total = DEFAULT_SCHEDULE.reduce((sum, task) => sum + taskPoints(task.kind, RULE_SETTINGS)!, 0);
    assert.equal(total, 20 + 2 * 10 + 15 + 3 * 10 + 40);
  });

  it("earn a meal task's points once, however many foods are logged for it", () => {
    const day = DAY1;
    const meals = [at(day, "08:00"), at(day, "08:05"), at(day, "08:10")];
    const tasks = dayTaskStates(DEFAULT_SCHEDULE, { dayStartMs: day, activities: { ...none, meal: meals }, exerciseMinutes: null }, RULE_SETTINGS);
    const summary = summarize([{ dayStartMs: day, tasks }], [], RULE_SETTINGS, at(day, "10:00"));
    assert.equal(tasks.find((t) => t.taskId === "meal-0800")!.done, true);
    assert.equal(summary.today.points, 10, "breakfast only; the extra foods earn nothing");
  });

  it("come only from tasks done, and an unset points setting earns none", () => {
    const day = DAY1;
    const activity = { dayStartMs: day, activities: { ...none, ecg: [at(day, "09:10")] }, exerciseMinutes: 120 };
    const tasks = dayTaskStates(DEFAULT_SCHEDULE, activity, RULE_SETTINGS);
    assert.equal(summarize([{ dayStartMs: day, tasks }], [], RULE_SETTINGS, day).today.points, 20 + 40);
    const unset = { ...RULE_SETTINGS, "points.exercise": null };
    const withoutExercise = dayTaskStates(DEFAULT_SCHEDULE, activity, unset);
    assert.equal(withoutExercise.find((t) => t.kind === "exercise")!.points, null);
    assert.equal(summarize([{ dayStartMs: day, tasks: withoutExercise }], [], unset, day).today.points, 20);
  });
});

describe("pointsSummary", () => {
  it("totals every day since mission day 1 and reports today's progress", () => {
    const summary = summarize(days([EVERYTHING, MEASUREMENTS, ["ecg"]]), [], RULE_SETTINGS, DAY1 + 2 * DAY_MS + 12 * 60 * MINUTE_MS);
    assert.equal(summary.day, "2026-11-07");
    assert.equal(summary.totalPoints, 125 + 55 + 20);
    assert.deepEqual(summary.today, { points: 20, possiblePoints: 125, tasksDone: 1, tasks: 8 });
  });

  it("is all zeros before mission day 1 (no days)", () => {
    const summary = summarize([], [], RULE_SETTINGS, DAY1 - DAY_MS);
    assert.equal(summary.totalPoints, 0);
    assert.deepEqual(summary.today, { points: 0, possiblePoints: 0, tasksDone: 0, tasks: 0 });
    assert.deepEqual(summary.streak, { days: 0, includesToday: false });
  });
});

describe("measurementStreak", () => {
  it("counts through yesterday while today is not complete, so today never breaks it early", () => {
    assert.deepEqual(measurementStreak(days([MEASUREMENTS, MEASUREMENTS, ["ecg", "spo2"]])), { days: 2, includesToday: false });
    assert.deepEqual(measurementStreak(days([MEASUREMENTS, MEASUREMENTS, []])), { days: 2, includesToday: false });
  });

  it("includes today once every measurement task is done", () => {
    assert.deepEqual(measurementStreak(days([[], MEASUREMENTS, MEASUREMENTS, MEASUREMENTS])), { days: 3, includesToday: true });
  });

  it("is broken by a past day with any measurement missing; meals and exercise do not count", () => {
    assert.deepEqual(measurementStreak(days([MEASUREMENTS, ["ecg", "checkIn"], MEASUREMENTS, []])), { days: 1, includesToday: false });
    assert.deepEqual(measurementStreak(days([["meal", "exercise"], ["meal", "exercise"], []])), { days: 0, includesToday: false });
  });

  it("needs both SpO₂ checks", () => {
    const day = dayWith(0, MEASUREMENTS);
    const oneSpo2 = { ...day, tasks: day.tasks.map((t) => (t.taskId === "spo2-2100" ? { ...t, done: false } : t)) };
    assert.deepEqual(measurementStreak([oneSpo2]), { days: 0, includesToday: false });
  });

  it("is zero with no days", () => {
    assert.deepEqual(measurementStreak([]), { days: 0, includesToday: false });
  });
});

describe("badges", () => {
  const week = (kinds: ScheduledTaskKind[]) => Array.from({ length: 7 }, () => kinds);

  it("earns the 7-day check-in streak on the seventh day in a row, once", () => {
    const history = days([...week(["checkIn"]), ["checkIn"], [], ...week(["checkIn"])]);
    assert.deepEqual(badgesEarnedBy(history, RULE_SETTINGS), [{ badgeId: "checkInStreak", earnedOn: "2026-11-11" }]);
  });

  it("earns Bone Guardian once the exercise goal is met 7 days in a row", () => {
    const history = days([["exercise"], [], ...week(["exercise"])]);
    assert.deepEqual(badgesEarnedBy(history, RULE_SETTINGS), [{ badgeId: "boneGuardian", earnedOn: "2026-11-13" }]);
  });

  it("is not earned by six days, and never while its setting is unset", () => {
    const six = days(Array.from({ length: 6 }, () => ["checkIn", "exercise"]));
    assert.deepEqual(badgesEarnedBy(six, RULE_SETTINGS), []);
    assert.equal(firstRunEnd(days(week(["checkIn"])), () => true, null), null);
  });

  it("lists both badges in a fixed order, with the stored day or null", () => {
    const list = badgeList([{ badgeId: "boneGuardian", earnedOn: "2026-11-13" }], RULE_SETTINGS);
    assert.deepEqual(list, [
      { id: "checkInStreak", name: "7-day check-in streak", description: "Mood check-in done 7 days in a row", earnedOn: null },
      { id: "boneGuardian", name: "Bone Guardian", description: "Exercise goal met 7 days in a row", earnedOn: "2026-11-13" },
    ]);
  });

  it("stores only badges not stored yet; a stored badge keeps its day and is never taken back", () => {
    const stored = [{ badgeId: "checkInStreak" as const, earnedOn: "2026-11-11" }];
    // The activity now says a later day (a check-in was deleted, a new run completed): the stored day stands.
    assert.deepEqual(newlyEarned(stored, [{ badgeId: "checkInStreak", earnedOn: "2026-11-20" }]), []);
    assert.deepEqual(newlyEarned(stored, [{ badgeId: "boneGuardian", earnedOn: "2026-11-13" }]), [{ badgeId: "boneGuardian", earnedOn: "2026-11-13" }]);
    // The activity no longer earns it at all: still listed as earned.
    assert.equal(summarize(days([[]]), stored, RULE_SETTINGS, DAY1).badges[0].earnedOn, "2026-11-11");
  });
});

describe("taskActivityInUpload", () => {
  it("names each astronaut whose ECG, SpO₂ or heart-rate uploads can change a task, from the earliest such reading", () => {
    const t = (hhmm: string) => `2026-11-14T${hhmm}:00.000Z`;
    const readings = [
      { astronautId: "a1", metric: "skinTemp" as const, takenAt: t("01:00") }, { astronautId: "a2", metric: "spo2" as const, takenAt: t("09:00") },
      { astronautId: "a2", metric: "ecg" as const, takenAt: t("08:00") }, { astronautId: "a3", metric: "heartRate" as const, takenAt: t("10:00") },
    ];
    assert.deepEqual(taskActivityInUpload(readings), [{ astronautId: "a2", atMs: Date.parse(t("08:00")) }, { astronautId: "a3", atMs: Date.parse(t("10:00")) }]);
  });
});

describe("tasks near midnight", () => {
  const late: ScheduledTask = { id: "late", kind: "checkIn", label: "Late", localTime: "23:30", astronautId: null };
  const early: ScheduledTask = { id: "early", kind: "checkIn", label: "Early", localTime: "00:30", astronautId: null };

  it("never lets a 23:30 task and the next day's 00:30 task share one activity", () => {
    const day0 = DAY1;
    const day1 = DAY1 + DAY_MS;
    const activities = { ...none, checkIn: [at(day1, "00:00")] };
    const used = new Set<string>();
    const first = dayTaskStates([late, early], { dayStartMs: day0, activities, exerciseMinutes: null }, RULE_SETTINGS, used);
    const second = dayTaskStates([late, early], { dayStartMs: day1, activities, exerciseMinutes: null }, RULE_SETTINGS, used);
    assert.equal(first.find((t) => t.taskId === "late")!.done, true, "the 23:30 task takes the 00:00 check-in");
    assert.equal(second.find((t) => t.taskId === "early")!.done, false, "the next day's 00:30 task cannot take it again");
  });

  it("carries the used activities over from a day already worked out", () => {
    const day0 = DAY1;
    const day1 = DAY1 + DAY_MS;
    const activities = { ...none, checkIn: [at(day1, "00:00")] };
    const yesterday: TaskDay = { dayStartMs: day0, tasks: dayTaskStates([late], { dayStartMs: day0, activities, exerciseMinutes: null }, RULE_SETTINGS) };
    const today = dayTaskStates([early], { dayStartMs: day1, activities, exerciseMinutes: null }, RULE_SETTINGS, activitiesUsedBy([yesterday]));
    assert.equal(today[0].done, false);
  });
});

describe("the task history cache", () => {
  const NOW = DAY1 + 3 * DAY_MS + 22 * 60 * MINUTE_MS; // day 4, 22:00
  const astronaut = { id: "a1", name: "A1", watchId: null, age: 24, sex: "male" as const, massKg: null, heightM: null };

  /** In-memory stores that count how far back each read reaches. */
  function fakeStores() {
    const checkIns: CheckIn[] = [];
    const readsFrom: number[] = [];
    const stores: TaskHistoryStores = {
      schedule: { replace: async () => 0, forAstronaut: async () => [...DEFAULT_SCHEDULE] },
      meals: { add: unreachable, remove: unreachable, between: async () => [] },
      checkIns: {
        add: unreachable, remove: unreachable,
        between: async (_id, fromMs, toMs) => {
          readsFrom.push(fromMs);
          return checkIns.filter((c) => Date.parse(c.at) >= fromMs && Date.parse(c.at) <= toMs);
        },
      },
      readings: { readingTimesReadByRules: async () => [], series: async () => [] } as unknown as TaskHistoryStores["readings"],
      mission: { get: async () => ({ name: "M", startDate: "2026-11-05", gravity: "iss", sleepDayTimeZone: "UTC" }) },
    };
    const checkIn = (day: number) => checkIns.push({ id: checkIns.length + 1, astronautId: "a1", mood: 4, stress: 2, at: new Date(at(DAY1 + day * DAY_MS, "20:00")).toISOString() });
    return { stores, checkIn, readsFrom, checkIns };
  }
  const unreachable = async (): Promise<never> => { throw new Error("not used"); };
  const checkInDone = (days: TaskDay[]) => days.map((d) => d.tasks.find((t) => t.kind === "checkIn")!.done);

  it("reads only today again once the past days are kept", async () => {
    const f = fakeStores();
    [0, 1, 2, 3].forEach(f.checkIn);
    const history = cachedTaskHistory(f.stores, RULE_SETTINGS);
    assert.deepEqual(checkInDone(await history.days(astronaut, NOW)), [true, true, true, true]);
    f.readsFrom.length = 0;
    await history.days(astronaut, NOW);
    assert.deepEqual(f.readsFrom, [DAY1 + 3 * DAY_MS - 120 * MINUTE_MS], "only today (and its match window) is read");
  });

  it("reads a past day again after a backdated write, and keeps the days before it", async () => {
    const f = fakeStores();
    [0, 2, 3].forEach(f.checkIn);
    const history = cachedTaskHistory(f.stores, RULE_SETTINGS);
    assert.deepEqual(checkInDone(await history.days(astronaut, NOW)), [true, false, true, true]);
    f.checkIn(1); // a check-in posted later for day 2
    history.activityChanged("a1", at(DAY1 + DAY_MS, "20:00"));
    f.readsFrom.length = 0;
    assert.deepEqual(checkInDone(await history.days(astronaut, NOW)), [true, true, true, true]);
    assert.deepEqual(f.readsFrom, [DAY1 + DAY_MS - 120 * MINUTE_MS], "read again from the touched day, not from day 1");
  });

  it("reads everything again after a new profile or a history change", async () => {
    const f = fakeStores();
    [0, 1, 2, 3].forEach(f.checkIn);
    const history = cachedTaskHistory(f.stores, RULE_SETTINGS);
    await history.days(astronaut, NOW);
    f.readsFrom.length = 0;
    await history.days({ ...astronaut, age: 30 }, NOW);
    assert.deepEqual(f.readsFrom, [DAY1 - 120 * MINUTE_MS]);
    f.readsFrom.length = 0;
    f.checkIns.splice(0, 1); // removed while the astronaut was off the crew
    history.historyChanged("a1");
    assert.deepEqual(checkInDone(await history.days({ ...astronaut, age: 30 }, NOW)), [false, true, true, true]);
    assert.deepEqual(f.readsFrom, [DAY1 - 120 * MINUTE_MS]);
  });

  it("gives the same days as reading everything afresh", async () => {
    const f = fakeStores();
    [0, 2, 3].forEach(f.checkIn);
    const cached = cachedTaskHistory(f.stores, RULE_SETTINGS);
    await cached.days(astronaut, NOW - DAY_MS); // kept as of yesterday
    f.checkIn(1);
    cached.activityChanged("a1", at(DAY1 + DAY_MS, "20:00"));
    const fresh = cachedTaskHistory(f.stores, RULE_SETTINGS);
    assert.deepEqual(await cached.days(astronaut, NOW), await fresh.days(astronaut, NOW));
  });
});

describe("the task history near midnight, while resuming, and with other windows", () => {
  const astronaut = { id: "a1", name: "A1", watchId: null, age: 24, sex: "male" as const, massKg: null, heightM: null };
  const LATE: ScheduledTask = { id: "late", kind: "checkIn", label: "Late", localTime: "23:30", astronautId: null };
  const EARLY: ScheduledTask = { id: "early", kind: "checkIn", label: "Early", localTime: "00:30", astronautId: null };
  const NOON: ScheduledTask = { id: "noon", kind: "checkIn", label: "Noon", localTime: "12:00", astronautId: null };
  const dayAt = (day: number, hhmm: string) => at(DAY1 + day * DAY_MS, hhmm);

  /** In-memory stores with a given schedule; `gate`, when set, holds every check-in read until it resolves. */
  function storesWith(schedule: ScheduledTask[]) {
    const checkIns: CheckIn[] = [];
    const reads: number[] = [];
    let gate: Promise<void> | null = null;
    const stores = {
      schedule: { forAstronaut: async () => schedule },
      meals: { between: async () => [] },
      checkIns: {
        between: async (_id: string, fromMs: number, toMs: number) => {
          reads.push(fromMs);
          // The rows are taken before waiting, as a database read sees what was committed when it ran.
          const rows = checkIns.filter((c) => Date.parse(c.at) >= fromMs && Date.parse(c.at) <= toMs);
          if (gate) await gate;
          return rows;
        },
      },
      readings: { readingTimesReadByRules: async () => [], series: async () => [] },
      mission: { get: async () => ({ name: "M", startDate: "2026-11-05", gravity: "iss" as const, sleepDayTimeZone: "UTC" }) },
    } as unknown as TaskHistoryStores;
    const checkIn = (atMs: number) => checkIns.push({ id: checkIns.length + 1, astronautId: "a1", mood: 4, stress: 2, at: new Date(atMs).toISOString() });
    return { stores, checkIn, reads, setGate: (g: Promise<void> | null) => { gate = g; } };
  }
  const doneIds = (days: TaskDay[]) => days.map((d) => d.tasks.filter((t) => t.done).map((t) => t.taskId));
  const freshDays = (stores: TaskHistoryStores, nowMs: number, settings: RuleSettings = RULE_SETTINGS) =>
    cachedTaskHistory(stores, settings).days(astronaut, nowMs);

  it("does not settle yesterday at 00:01 while a check-in stamped 00:03 can still complete its 23:30 task (the reported repro)", async () => {
    const f = storesWith([LATE]);
    const history = cachedTaskHistory(f.stores, RULE_SETTINGS);
    f.checkIn(dayAt(1, "00:03")); // stored at 23:59 with the 5-minute clock skew a reading may have
    history.activityChanged("a1", dayAt(1, "00:03"));
    await history.days(astronaut, dayAt(1, "00:01")); // the minute's upkeep, just after midnight
    const later = dayAt(1, "02:00");
    assert.deepEqual(doneIds(await history.days(astronaut, later)), [["late"], []]);
    assert.deepEqual(await history.days(astronaut, later), await freshDays(f.stores, later));
  });

  it("settles a day only once its last match window and the clock skew have passed", () => {
    const day = DAY1;
    const windowMs = 120 * MINUTE_MS;
    assert.equal(isSettled(day, day + DAY_MS + windowMs + 5 * MINUTE_MS - 1, windowMs), false);
    assert.equal(isSettled(day, day + DAY_MS + windowMs + 5 * MINUTE_MS, windowMs), true);
  });

  it("reads the day before again after a write at 00:30 that completes its 23:30 task", async () => {
    const f = storesWith([LATE]);
    const history = cachedTaskHistory(f.stores, RULE_SETTINGS);
    const now = dayAt(3, "22:00");
    assert.deepEqual(doneIds(await history.days(astronaut, now)), [[], [], [], []]);
    f.checkIn(dayAt(2, "00:30"));
    history.activityChanged("a1", dayAt(2, "00:30"));
    assert.deepEqual(doneIds(await history.days(astronaut, now)), [[], ["late"], [], []]);
  });

  it("carries the activities the kept days used when it resumes, so 23:30 and 00:30 never share a check-in", async () => {
    const f = storesWith([EARLY, LATE]);
    f.checkIn(dayAt(2, "00:00")); // inside both the day-1 23:30 window and the day-2 00:30 window
    const history = cachedTaskHistory(f.stores, RULE_SETTINGS);
    const now = dayAt(3, "22:00");
    await history.days(astronaut, now);
    f.checkIn(dayAt(2, "12:00"));
    history.activityChanged("a1", dayAt(2, "12:00")); // resume from day 2, with days 0 and 1 kept
    f.reads.length = 0;
    const resumed = await history.days(astronaut, now);
    assert.equal(f.reads[0], DAY1 + 2 * DAY_MS - 120 * MINUTE_MS, "resumed from day 2");
    assert.deepEqual(doneIds(resumed).slice(1, 3), [["late"], []], "the day-2 00:30 task cannot take the check-in day 1 used");
    assert.deepEqual(resumed, await freshDays(f.stores, now));
  });

  it("keeps nothing from a read a mark landed in, and the next read sees the write", async () => {
    const f = storesWith([NOON]);
    const history = cachedTaskHistory(f.stores, RULE_SETTINGS);
    const now = dayAt(3, "22:00");
    await history.days(astronaut, now);
    let release!: () => void;
    f.setGate(new Promise((resolve) => { release = resolve; }));
    const readsBefore = f.reads.length;
    const reading = history.days(astronaut, now);
    while (f.reads.length === readsBefore) await new Promise((resolve) => setImmediate(resolve));
    // A backdated check-in for day 1 is written after the read took its rows, while it waits.
    f.checkIn(dayAt(1, "12:00"));
    history.activityChanged("a1", dayAt(1, "12:00"));
    release();
    f.setGate(null);
    await reading;
    assert.deepEqual(doneIds(await history.days(astronaut, now)), [[], ["noon"], [], []]);
  });

  for (const windowMinutes of [30, 600, 1500]) {
    it(`gives the same days as a fresh read with a ${windowMinutes}-minute window, read after read`, async () => {
      const settings = { ...RULE_SETTINGS, "tasks.doneWithinMinutes": windowMinutes };
      const f = storesWith([EARLY, NOON, LATE]);
      for (const [day, hhmm] of [[0, "23:50"], [1, "00:10"], [1, "11:00"], [2, "06:00"], [3, "23:40"], [4, "00:20"]] as const) f.checkIn(dayAt(day, hhmm));
      const history = cachedTaskHistory(f.stores, settings);
      const writes: Array<[number, string]> = [[1, "23:55"], [3, "12:10"], [5, "00:05"]];
      for (let step = 0; step < 14; step++) {
        const now = DAY1 + step * 12 * 60 * MINUTE_MS + 7 * MINUTE_MS;
        const write = writes.find(([day, hhmm]) => dayAt(day, hhmm) <= now && dayAt(day, hhmm) > now - 12 * 60 * MINUTE_MS);
        if (write) {
          f.checkIn(dayAt(write[0], write[1]));
          history.activityChanged("a1", dayAt(write[0], write[1]));
        }
        assert.deepEqual(await history.days(astronaut, now), await freshDays(f.stores, now, settings), `step ${step}`);
      }
    });
  }
});

describe("crewPoints", () => {
  function crewHarness(crew: () => Promise<Astronaut[]>) {
    let nowMs = DAY1 + 10 * 60 * MINUTE_MS;
    const published: PointsSummary[] = [];
    const errors: Array<{ error: unknown; astronautId: string | null }> = [];
    const checkIns: CheckIn[] = [{ id: 1, astronautId: "a1", mood: 4, stress: 2, at: new Date(at(DAY1, "09:00")).toISOString() }];
    const stores = {
      astronauts: { list: crew, find: async (id: string) => (await crew()).find((a) => a.id === id) ?? null },
      badges: { earned: async () => [], record: async () => [] },
      schedule: { replace: async () => 0, forAstronaut: async () => [{ id: "c", kind: "checkIn" as const, label: "Check-in", localTime: "09:00", astronautId: null }] },
      meals: { between: async () => [] },
      checkIns: { between: async (id: string, fromMs: number, toMs: number) => checkIns.filter((c) => c.astronautId === id && Date.parse(c.at) >= fromMs && Date.parse(c.at) <= toMs) },
      readings: { readingTimesReadByRules: async () => [], series: async () => [] },
      mission: { get: async () => ({ name: "M", startDate: "2026-11-05", gravity: "iss" as const, sleepDayTimeZone: "UTC" }) },
    } as unknown as CrewPointsDeps["stores"];
    const points = crewPoints({
      stores, settings: RULE_SETTINGS, now: () => nowMs, onError: (error, astronautId) => errors.push({ error, astronautId }),
      live: { publish: (_channel, message) => { if (message.type === "points") published.push(message.points); } },
    });
    return { points, published, errors, setNow: (ms: number) => { nowMs = ms; } };
  }
  const member = (id: string): Astronaut => ({ id, name: id, watchId: null, age: 24, sex: null, massKg: null, heightM: null });

  it("works out every crew member's points, and pushes today reset once a new day begins", async () => {
    const h = crewHarness(async () => [member("a1"), member("a2")]);
    await h.points.crewChanged();
    await h.points.settled();
    assert.deepEqual(h.published.map((p) => [p.astronautId, p.today.points]), [["a1", 15], ["a2", 0]]);
    h.setNow(DAY1 + DAY_MS + 60 * MINUTE_MS);
    await h.points.crewChanged();
    await h.points.settled();
    const a1 = h.published.filter((p) => p.astronautId === "a1").at(-1)!;
    assert.deepEqual([a1.day, a1.today.points, a1.totalPoints], ["2026-11-06", 0, 15]);
  });

  it("reports a crew list that cannot be read with no astronaut", async () => {
    const failure = new Error("database down");
    const h = crewHarness(async () => { throw failure; });
    await h.points.crewChanged();
    assert.deepEqual(h.errors, [{ error: failure, astronautId: null }]);
  });
});

describe("pointsUpdates", () => {
  const summary = (totalPoints: number, at = "2026-11-05T10:00:00.000Z"): PointsSummary => ({
    astronautId: "a1", at, day: "2026-11-05", totalPoints,
    today: { points: totalPoints, possiblePoints: 115, tasksDone: 1, tasks: 8 }, streak: { days: 0, includesToday: false }, badges: [],
  });

  function harness(values: PointsSummary[]) {
    const published: LiveMessage[] = [];
    const errors: unknown[] = [];
    let computes = 0;
    const updates = pointsUpdates({
      live: { publish: (_channel, message) => { published.push(message); } },
      onError: (error) => errors.push(error),
      compute: async () => values[Math.min(computes++, values.length - 1)],
    });
    return { updates, published, errors, computes: () => computes };
  }

  it("pushes a points message when the summary changed, and not again when only the time changed", async () => {
    const h = harness([summary(20), summary(20, "2026-11-05T10:01:00.000Z"), summary(35)]);
    for (let i = 0; i < 3; i++) {
      h.updates.changed("a1");
      await h.updates.settled();
    }
    assert.deepEqual(h.published.map((m) => (m.type === "points" ? m.points.totalPoints : null)), [20, 35]);
  });

  it("folds changes asked for during a run into one more run", async () => {
    const h = harness([summary(20), summary(35)]);
    h.updates.changed("a1");
    h.updates.changed("a1");
    h.updates.changed("a1");
    await h.updates.settled();
    assert.equal(h.computes(), 2);
    assert.equal(h.published.length, 2);
  });

  it("reports a failed recompute and keeps working", async () => {
    let fail = true;
    const errors: unknown[] = [];
    const published: LiveMessage[] = [];
    const updates = pointsUpdates({
      live: { publish: (_c, m) => { published.push(m); } },
      onError: (error) => errors.push(error),
      compute: async () => {
        if (fail) throw new Error("database down");
        return summary(10);
      },
    });
    updates.changed("a1");
    await updates.settled();
    fail = false;
    updates.changed("a1");
    await updates.settled();
    assert.equal(errors.length, 1);
    assert.equal(published.length, 1);
  });
});
