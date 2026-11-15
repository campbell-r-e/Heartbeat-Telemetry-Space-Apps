// Hands relay events over on time: one timer set for the earliest waiting event, moved earlier
// whenever a sooner event joins the queue. Runs never overlap, so events keep their order.
import type { DeliveryScheduler } from "../domain/relay/relay.ts";
import { reportSafely } from "./report-safely.ts";

/** setTimeout's longest delay; a later event is checked again then. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
/** How soon to try again after a failed run (e.g. the database was briefly unreachable). */
const RETRY_AFTER_FAILURE_MS = 5_000;

export interface DeliveryTimerDeps {
  /** Hands over every event due now; returns when the next waiting one is due, or null. */
  deliverDue: () => Promise<number | null>;
  now: () => number;
  onError: (error: unknown) => void;
}

export interface DeliveryTimer extends DeliveryScheduler {
  /**
   * Hands over everything due now (on start: what arrived while the server was down), after any
   * run in progress, and sets the timer for the next event.
   */
  deliverNow(): Promise<void>;
  /** Stops the timer; resolves once a run in progress has finished. */
  stop(): Promise<void>;
}

export function deliveryTimer({ deliverDue, now, onError }: DeliveryTimerDeps): DeliveryTimer {
  let handle: NodeJS.Timeout | undefined;
  let dueAtMs: number | null = null;
  let running: Promise<void> = Promise.resolve();
  let stopped = false;

  function wakeAt(atMs: number | null): void {
    if (stopped || atMs === null) return;
    if (handle !== undefined && dueAtMs !== null && dueAtMs <= atMs) return;
    clearTimeout(handle);
    dueAtMs = atMs;
    handle = setTimeout(run, Math.min(Math.max(0, atMs - now()), MAX_TIMEOUT_MS));
  }

  function run(): Promise<void> {
    clearTimeout(handle);
    handle = undefined;
    dueAtMs = null;
    running = running.then(deliverDue).then(wakeAt, (error: unknown) => {
      reportSafely(onError, error);
      wakeAt(now() + RETRY_AFTER_FAILURE_MS);
    });
    return running;
  }

  return {
    deliverNow: run,
    eventQueued: wakeAt,
    stop() {
      stopped = true;
      clearTimeout(handle);
      return running;
    },
  };
}
