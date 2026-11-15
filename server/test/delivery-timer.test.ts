// The delivery timer and the other repeating work, on node:test's mock clock (review F006, F007,
// F010), and the order the server closes in.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import Fastify from "fastify";
import { deliveryTimer } from "../src/jobs/delivery-timer.ts";
import { repeatEvery } from "../src/jobs/repeating-job.ts";
import { shutdownInOrder } from "../src/shutdown.ts";

const failOnError = (error: unknown) => assert.fail(`unexpected error: ${String(error)}`);

/** Lets pending promise callbacks run. */
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe("the delivery timer", () => {
  let clockMs: number;
  const now = () => clockMs;
  beforeEach(() => {
    mock.timers.enable({ apis: ["setTimeout"], now: 0 });
    clockMs = 0;
  });
  afterEach(() => mock.timers.reset());

  /** Moves both the mock timers and the timer's clock on. */
  const tickBy = async (ms: number) => {
    clockMs += ms;
    mock.timers.tick(ms);
    await settle();
  };

  it("runs when the earliest queued event is due, and a sooner event moves it earlier", async () => {
    const runs: number[] = [];
    const timer = deliveryTimer({ deliverDue: async () => { runs.push(clockMs); return null; }, now, onError: failOnError });
    timer.eventQueued(10_000);
    timer.eventQueued(30_000); // later: changes nothing
    timer.eventQueued(4_000); // sooner: moves the timer
    await tickBy(4_000);
    assert.deepEqual(runs, [4_000]);
    await tickBy(26_000);
    assert.deepEqual(runs, [4_000], "the later events were for deliverDue to report, which said none wait");
    await timer.stop();
  });

  it("sets itself for the next waiting event that a run reports", async () => {
    const runs: number[] = [];
    const due = [5_000, null];
    const timer = deliveryTimer({ deliverDue: async () => { runs.push(clockMs); return due.shift() ?? null; }, now, onError: failOnError });
    await timer.deliverNow();
    await tickBy(5_000);
    assert.deepEqual(runs, [0, 5_000]);
    await timer.stop();
  });

  it("never overlaps runs: a second request waits for the first", async () => {
    const log: string[] = [];
    let release!: () => void;
    const firstRun = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    const timer = deliveryTimer({
      deliverDue: async () => {
        const n = ++calls;
        log.push(`start ${n}`);
        if (n === 1) await firstRun;
        log.push(`end ${n}`);
        return null;
      },
      now, onError: failOnError,
    });
    const first = timer.deliverNow();
    const second = timer.deliverNow();
    await settle();
    assert.deepEqual(log, ["start 1"]);
    release();
    await Promise.all([first, second]);
    assert.deepEqual(log, ["start 1", "end 1", "start 2", "end 2"]);
    await timer.stop();
  });

  it("reports a failed run and tries again 5 s later", async () => {
    const errors: unknown[] = [];
    let calls = 0;
    const timer = deliveryTimer({
      deliverDue: async () => {
        calls++;
        if (calls === 1) throw new Error("database unreachable");
        return null;
      },
      now, onError: (error) => errors.push(error),
    });
    await timer.deliverNow();
    assert.deepEqual(errors.map((e) => (e as Error).message), ["database unreachable"]);
    await tickBy(4_999);
    assert.equal(calls, 1);
    await tickBy(1);
    assert.equal(calls, 2);
    await timer.stop();
  });

  it("keeps running after an error reporter that throws (review F010)", async () => {
    let calls = 0;
    const timer = deliveryTimer({
      deliverDue: async () => {
        calls++;
        if (calls === 1) throw new Error("first run fails");
        return null;
      },
      now, onError: () => { throw new Error("the logger is broken"); },
    });
    await timer.deliverNow();
    await timer.deliverNow();
    assert.equal(calls, 2, "the second run still calls deliverDue");
    await timer.stop();
  });

  it("waits at most setTimeout's longest delay, then checks again (review F011)", async () => {
    const longestMs = 2 ** 31 - 1;
    const runs: number[] = [];
    const timer = deliveryTimer({ deliverDue: async () => { runs.push(clockMs); return null; }, now, onError: failOnError });
    timer.eventQueued(30 * 24 * 60 * 60_000); // 30 days away: past what setTimeout can wait
    await tickBy(longestMs - 1);
    assert.deepEqual(runs, []);
    await tickBy(1);
    assert.deepEqual(runs, [longestMs]);
    await timer.stop();
  });

  it("stops: waits for the run in progress and sets no further timer", async () => {
    let release!: () => void;
    let finished = false;
    let calls = 0;
    const timer = deliveryTimer({
      deliverDue: async () => {
        calls++;
        await new Promise<void>((resolve) => { release = resolve; });
        finished = true;
        return 1_000;
      },
      now, onError: failOnError,
    });
    void timer.deliverNow();
    await settle();
    const stopped = timer.stop();
    release();
    await stopped;
    assert.ok(finished, "stop resolved only after the run finished");
    timer.eventQueued(0);
    await tickBy(5_000);
    assert.equal(calls, 1);
  });
});

describe("a repeating job (the every-minute status evaluation)", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setInterval"] }));
  afterEach(() => mock.timers.reset());

  it("reports a failing tick instead of leaving an unhandled rejection, and keeps ticking (review F007)", async () => {
    const errors: unknown[] = [];
    let ticks = 0;
    const job = repeatEvery(60_000, async () => {
      ticks++;
      throw new Error("pool exhausted");
    }, (error) => errors.push(error));
    mock.timers.tick(60_000);
    await settle();
    mock.timers.tick(60_000);
    await settle();
    assert.equal(ticks, 2);
    assert.deepEqual(errors.map((e) => (e as Error).message), ["pool exhausted", "pool exhausted"]);
    await job.stop();
  });

  it("keeps ticking after an error reporter that throws, and still stops (review F011)", async () => {
    let ticks = 0;
    const job = repeatEvery(60_000, async () => {
      ticks++;
      throw new Error("tick fails");
    }, () => { throw new Error("the logger is broken"); });
    mock.timers.tick(60_000);
    await settle();
    mock.timers.tick(60_000);
    await settle();
    assert.equal(ticks, 2);
    await job.stop();
  });

  it("never starts a tick while the last one runs (review F011)", async () => {
    let release!: () => void;
    let ticks = 0;
    const job = repeatEvery(60_000, async () => {
      ticks++;
      await new Promise<void>((resolve) => { release = resolve; });
    }, failOnError);
    mock.timers.tick(60_000);
    await settle();
    mock.timers.tick(60_000); // the first tick is still running
    await settle();
    assert.equal(ticks, 1);
    release();
    await settle();
    mock.timers.tick(60_000);
    await settle();
    assert.equal(ticks, 2, "the next interval starts a tick again");
    release();
    await job.stop();
  });

  it("stops after the tick in progress has finished", async () => {
    let release!: () => void;
    let finished = false;
    const job = repeatEvery(60_000, async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      finished = true;
    }, failOnError);
    mock.timers.tick(60_000);
    await settle();
    const stopped = job.stop();
    release();
    await stopped;
    assert.ok(finished);
  });
});

describe("closing the server", () => {
  it("stops the jobs (waiting for their work), then disconnects live clients, and only then closes the pool", async () => {
    const app = Fastify({ logger: false });
    const order: string[] = [];
    const slowly = async (step: string) => {
      await new Promise((resolve) => setImmediate(resolve));
      order.push(step);
    };
    shutdownInOrder(app, {
      statusLogJob: { stop: () => slowly("status job stopped") },
      sleepJob: { stop: () => slowly("sleep job stopped") },
      relaySystem: { stop: () => slowly("relay stopped") },
      points: { settled: () => slowly("points settled") },
      live: { close: () => { order.push("live clients disconnected"); } },
      pool: { end: async () => { order.push("pool ended"); } },
    });
    await app.close();
    assert.deepEqual(order, ["status job stopped", "sleep job stopped", "relay stopped", "points settled", "live clients disconnected", "pool ended"]);
  });
});
