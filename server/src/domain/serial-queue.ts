// One-at-a-time queues for work that must never overlap in this one server process (SPEC §3): the
// status evaluations and the demo storm's presses.

/** A queued task's time is up: the queue has moved on, and the task must not change anything more. */
export class TaskTimedOut extends Error {
  constructor(readonly timeoutMs: number) {
    super(`gave up after ${timeoutMs} ms; the queue moved on`);
    this.name = "TaskTimedOut";
  }
}

/** A task in the queue; `signal` aborts when its time is up, so it can stop before writing anything. */
export type QueuedTask<T> = (signal: AbortSignal) => Promise<T>;

export type SerialQueue = <T>(task: QueuedTask<T>) => Promise<T>;

/**
 * Runs tasks one at a time, in the order they were queued. A failed task does not stop the next,
 * and neither does a hung one: after `timeoutMs` its promise rejects with TaskTimedOut, its signal
 * aborts, and the next task starts.
 */
export function serialQueue(timeoutMs: number): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: QueuedTask<T>) => {
    const run = tail.then(() => withTimeout(task, timeoutMs));
    tail = run.catch(() => undefined); // the queue itself never rejects
    return run;
  };
}

function withTimeout<T>(task: QueuedTask<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new TaskTimedOut(timeoutMs);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([task(controller.signal), timedOut]).finally(() => clearTimeout(timer));
}
