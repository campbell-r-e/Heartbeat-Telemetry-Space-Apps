import type { Astronaut } from "@heartbeat/shared";
import type { Stores } from "../ports.ts";
import type { RuleBook } from "../rules/rule-book.ts";
import { evaluateAndLogStatus, type StatusListener } from "./astronaut-status.ts";

export interface EvaluationFailure {
  /** The astronaut whose evaluation failed; null when the crew list itself could not be read. */
  astronautId: string | null;
  error: unknown;
}

/**
 * Evaluates every astronaut's status once, recording changes in the alert log and telling the
 * listener. Each astronaut is evaluated on its own, so one failure does not stop the others;
 * failures are returned by id. Never rejects, so a timer can call it without a handler.
 * Astronauts are evaluated one after another, never side by side: each reads the readings only after
 * the one before has logged, so a crew-wide change (the ship's radiation) is never logged from data
 * older than one already logged. Call it through the StatusEvaluator (status-evaluator.ts).
 */
export async function logEveryStatus(
  stores: Stores, ruleBook: RuleBook, nowMs: number, listener: StatusListener, signal?: AbortSignal,
): Promise<EvaluationFailure[]> {
  let astronauts: Astronaut[];
  try {
    astronauts = await stores.astronauts.list();
  } catch (error) {
    return [{ astronautId: null, error }];
  }
  const failures: EvaluationFailure[] = [];
  for (const astronaut of astronauts) {
    if (signal?.aborted) break; // given up: the queue has moved on, so log nothing more
    try {
      await evaluateAndLogStatus(stores, ruleBook, astronaut, nowMs, listener, signal);
    } catch (error) {
      failures.push({ astronautId: astronaut.id, error });
    }
  }
  return failures;
}
