// The one way the server evaluates and logs statuses (SPEC §6.7): the minute check, every status
// request and the demo storm's immediate check all go through it. Evaluations run one at a time, and
// each one reads the clock and the readings only when its turn comes, so no evaluation is ever
// computed from data older than one already logged. Without that, a minute check that read the
// readings just before a storm press could log its older status after the press's newer one
// (🔴, then 🟡, then 🔴 again). The alert log's database lock stops duplicate logs, not stale ones.
// The onboard server is one process (SPEC §3), so an in-process queue covers every evaluator.
// An evaluation that hangs (say, a stuck query) is given up after EVALUATION_TIMEOUT_MS so the queue
// moves on; it checks its abort signal before logging, so a late one logs nothing.
import type { Astronaut, AstronautStatus } from "@heartbeat/shared";
import type { Stores } from "../ports.ts";
import type { RuleBook } from "../rules/rule-book.ts";
import { serialQueue } from "../serial-queue.ts";
import { evaluateAndLogStatus, type StatusListener } from "./astronaut-status.ts";
import { logEveryStatus, type EvaluationFailure } from "./log-every-status.ts";

/** How long one evaluation (one astronaut, or the whole crew) may take; a normal one takes well under a second. */
export const EVALUATION_TIMEOUT_MS = 10_000;

export interface StatusEvaluator {
  /** Evaluates and logs one astronaut's status, after every evaluation already waiting. */
  evaluate(astronaut: Astronaut): Promise<AstronautStatus>;
  /** Evaluates and logs every astronaut, one after another, after every evaluation already waiting. Never rejects. */
  evaluateCrew(): Promise<EvaluationFailure[]>;
}

export interface StatusEvaluatorDeps {
  stores: Stores;
  ruleBook: RuleBook;
  now: () => number;
  listener: StatusListener;
  /** Defaults to EVALUATION_TIMEOUT_MS. */
  timeoutMs?: number;
}

export function createStatusEvaluator({ stores, ruleBook, now, listener, timeoutMs = EVALUATION_TIMEOUT_MS }: StatusEvaluatorDeps): StatusEvaluator {
  const inTurn = serialQueue(timeoutMs);
  return {
    evaluate: (astronaut) => inTurn((signal) => evaluateAndLogStatus(stores, ruleBook, astronaut, now(), listener, signal)),
    evaluateCrew: () =>
      inTurn((signal) => logEveryStatus(stores, ruleBook, now(), listener, signal)).catch((error: unknown) => [{ astronautId: null, error }]),
  };
}
