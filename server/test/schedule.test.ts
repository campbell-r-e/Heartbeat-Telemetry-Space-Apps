import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ScheduledTask } from "@heartbeat/shared";
import { DEFAULT_SCHEDULE, LOCAL_TIME_PATTERN } from "../src/domain/schedule.ts";
import { matchTimedTasks, type ActivityTimes } from "../src/domain/today-tasks.ts";
import { MINUTE_MS } from "../src/domain/time.ts";

describe("DEFAULT_SCHEDULE", () => {
  it("uses HH:MM times (or none, for the exercise task) and unique ids", () => {
    for (const task of DEFAULT_SCHEDULE) {
      if (task.kind === "exercise") assert.equal(task.localTime, null, task.id);
      else assert.match(task.localTime ?? "", LOCAL_TIME_PATTERN, task.id);
    }
    assert.equal(new Set(DEFAULT_SCHEDULE.map((t) => t.id)).size, DEFAULT_SCHEDULE.length);
  });

  it("has one daily exercise task", () => {
    assert.equal(DEFAULT_SCHEDULE.filter((t) => t.kind === "exercise").length, 1);
  });

  it("time pattern accepts 00:00 to 23:59 only", () => {
    for (const ok of ["00:00", "09:05", "23:59"]) assert.match(ok, LOCAL_TIME_PATTERN);
    for (const bad of ["24:00", "9:00", "12:60", "12:00:00", ""]) assert.doesNotMatch(bad, LOCAL_TIME_PATTERN);
  });
});

describe("matchTimedTasks", () => {
  const DAY = Date.parse("2026-11-14T00:00:00Z");
  const WINDOW = 120 * MINUTE_MS;
  const at = (hhmm: string) => Date.parse(`2026-11-14T${hhmm}:00Z`);
  const task = (id: string, kind: ScheduledTask["kind"], localTime: string): ScheduledTask => ({ id, kind, label: id, localTime, astronautId: null });
  const none: ActivityTimes = { meal: [], checkIn: [], ecg: [], spo2: [] };

  it("counts activity within 2 hours either side of the task time, edges included", () => {
    const tasks = [task("ecg", "ecg", "09:00")];
    assert.equal(matchTimedTasks(tasks, { ...none, ecg: [at("07:00")] }, DAY, WINDOW).get("ecg"), at("07:00"));
    assert.equal(matchTimedTasks(tasks, { ...none, ecg: [at("11:00")] }, DAY, WINDOW).get("ecg"), at("11:00"));
    assert.equal(matchTimedTasks(tasks, { ...none, ecg: [at("11:01")] }, DAY, WINDOW).has("ecg"), false);
  });

  it("never lets two tasks of the same kind share one activity", () => {
    const tasks = [task("breakfast", "meal", "08:00"), task("brunch", "meal", "09:00")];
    const one = matchTimedTasks(tasks, { ...none, meal: [at("08:30")] }, DAY, WINDOW);
    assert.deepEqual([...one.keys()], ["breakfast"]);
    const two = matchTimedTasks(tasks, { ...none, meal: [at("08:30"), at("08:45")] }, DAY, WINDOW);
    assert.deepEqual([...two.entries()], [["breakfast", at("08:30")], ["brunch", at("08:45")]]);
  });

  it("does not count activity of another kind", () => {
    const tasks = [task("spo2", "spo2", "09:00")];
    assert.equal(matchTimedTasks(tasks, { ...none, ecg: [at("09:00")] }, DAY, WINDOW).size, 0);
  });
});
