// The one-at-a-time queue every status evaluation goes through (review F001), and its time limit for
// a hung task. The race it prevents is tested against Postgres in relay-api.test.ts ("never logs a
// minute check's older status").
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_RULE_BOOK } from "../src/domain/rules/rule-book.ts";
import { serialQueue, TaskTimedOut } from "../src/domain/serial-queue.ts";
import { logEveryStatus } from "../src/domain/status/log-every-status.ts";
import { createStatusEvaluator } from "../src/domain/status/status-evaluator.ts";
import { astronaut, storesWithOneBroken } from "./support/fake-stores.ts";

const QUICK_MS = 50;
const tick = () => new Promise((resolve) => setImmediate(resolve));
const NOW = Date.parse("2026-11-14T12:00:00Z");
const quiet = { statusEvaluated: async () => {} };

describe("serialQueue", () => {
  it("starts each task only after the one before has finished, in the order queued", async () => {
    const inTurn = serialQueue(10_000);
    const events: string[] = [];
    let finishFirst!: () => void;
    const first = inTurn(async () => {
      events.push("first started");
      await new Promise<void>((resolve) => { finishFirst = resolve; });
      events.push("first finished");
      return 1;
    });
    const second = inTurn(async () => { events.push("second started"); return 2; });
    await tick();
    assert.deepEqual(events, ["first started"], "the second waits");
    finishFirst();
    assert.deepEqual([await first, await second], [1, 2]);
    assert.deepEqual(events, ["first started", "first finished", "second started"]);
  });

  it("passes a failure to its caller and still runs the next task", async () => {
    const inTurn = serialQueue(10_000);
    const failed = inTurn(async () => { throw new Error("evaluation failed"); });
    const next = inTurn(async () => "ran");
    await assert.rejects(failed, /evaluation failed/);
    assert.equal(await next, "ran");
  });

  it("gives up on a hung task after its time limit, aborts its signal, and moves on", async () => {
    const inTurn = serialQueue(QUICK_MS);
    let hungSignal!: AbortSignal;
    const hung = inTurn((signal) => { hungSignal = signal; return new Promise<never>(() => {}); });
    const next = inTurn(async () => "ran");
    await assert.rejects(hung, TaskTimedOut);
    assert.equal(hungSignal.aborted, true);
    assert.equal(await next, "ran");
  });
});

describe("a hung evaluation (review: a stuck query)", () => {
  it("is given up, logs nothing when it finally finishes, and the next evaluation still runs", async () => {
    const evaluated: string[] = [];
    let unstick!: () => void;
    const stuckRead = new Promise<void>((resolve) => { unstick = resolve; });
    const crew = async () => [astronaut("slow")];
    const evaluator = createStatusEvaluator({
      stores: storesWithOneBroken(evaluated, crew, stuckRead), ruleBook: DEFAULT_RULE_BOOK, now: () => NOW, listener: quiet, timeoutMs: QUICK_MS,
    });
    const failures = await evaluator.evaluateCrew();
    assert.equal(failures.length, 1);
    assert.ok(failures[0].error instanceof TaskTimedOut, "the minute check reports the time-out instead of hanging");
    await evaluator.evaluate(astronaut("fine")); // the queue has moved on
    assert.deepEqual(evaluated, ["fine"]);
    unstick();
    await tick();
    await tick();
    assert.deepEqual(evaluated, ["fine"], "the late evaluation of the stuck astronaut logged nothing");
  });

  it("logs nothing once its signal has aborted", async () => {
    const evaluated: string[] = [];
    const failures = await logEveryStatus(storesWithOneBroken(evaluated), DEFAULT_RULE_BOOK, NOW, quiet, AbortSignal.abort());
    assert.deepEqual([evaluated, failures], [[], []]);
  });
});
