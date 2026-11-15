import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ScheduledTask } from "@heartbeat/shared";
import { firstTimeOf, nextDue, nextReminder, taskSummary } from "./schedule";
import { taskFixture as task } from "./test-fixtures";

const scheduled = (id: string, localTime: string | null, kind: ScheduledTask["kind"]): ScheduledTask => ({ id, kind, label: id, localTime, astronautId: null });
const at = (iso: string) => Date.parse(iso);

describe("nextDue", () => {
  it("is later today when the time has not passed", () => {
    const due = nextDue(task("ecg", "09:00"), at("2026-11-14T08:40:00Z"));
    assert.equal(due?.dueAtMs, at("2026-11-14T09:00:00Z"));
    assert.equal(due?.minutesUntil, 20);
  });

  it("rolls to tomorrow once today's time has passed", () => {
    assert.equal(nextDue(task("ecg", "09:00"), at("2026-11-14T09:01:00Z"))?.dueAtMs, at("2026-11-15T09:00:00Z"));
  });

  it("has no due time for the untimed exercise task or an invalid time", () => {
    assert.equal(nextDue(task("exercise-daily", null), at("2026-11-14T09:00:00Z")), null);
    assert.equal(nextDue(task("bad", "9am"), at("2026-11-14T09:00:00Z")), null);
  });
});

describe("nextReminder", () => {
  const tasks = [task("meal", "08:00"), task("spo2", "21:00"), task("checkin", "20:00")];

  it("picks the soonest upcoming task", () => {
    assert.equal(nextReminder(tasks, at("2026-11-14T19:30:00Z"))?.task.taskId, "checkin");
  });

  it("skips tasks the server reports as done", () => {
    assert.equal(nextReminder([task("checkin", "20:00", true), task("spo2", "21:00")], at("2026-11-14T19:30:00Z"))?.task.taskId, "spo2");
  });

  it("wraps to tomorrow's first task late in the day, and is null with nothing timed", () => {
    assert.equal(nextReminder(tasks, at("2026-11-14T22:00:00Z"))?.dueAtMs, at("2026-11-15T08:00:00Z"));
    assert.equal(nextReminder([task("exercise-daily", null)], at("2026-11-14T22:00:00Z")), null);
  });
});

describe("taskSummary", () => {
  it("counts the tasks the server reports as done", () => {
    assert.equal(taskSummary([task("a", "08:00", true), task("b", "09:00"), task("exercise-daily", null)]), "1 of 3 done");
  });
});

describe("firstTimeOf", () => {
  it("finds the time of a kind of task, skipping untimed ones", () => {
    assert.equal(firstTimeOf([scheduled("m", "08:00", "meal"), scheduled("c", "20:00", "checkIn"), scheduled("x", null, "exercise")], "checkIn"), "20:00");
    assert.equal(firstTimeOf([scheduled("x", null, "exercise")], "exercise"), null);
  });
});
