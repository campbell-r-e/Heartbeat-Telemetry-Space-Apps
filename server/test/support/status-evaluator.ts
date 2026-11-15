// The StatusEvaluator for HTTP tests, wired as src/index.ts wires it: the default rule book, the
// test's clock and the relay's status listener.
import type { Stores } from "../../src/domain/ports.ts";
import { DEFAULT_RULE_BOOK } from "../../src/domain/rules/rule-book.ts";
import { createStatusEvaluator, type StatusEvaluator } from "../../src/domain/status/status-evaluator.ts";
import type { TestRelay } from "./relay.ts";

export function testStatusEvaluator(stores: Stores, now: () => number, relay: TestRelay): StatusEvaluator {
  return createStatusEvaluator({ stores, ruleBook: DEFAULT_RULE_BOOK, now, listener: relay.deps.statusListener });
}
