import type { FactValues, FlagFactId, NumberFactId } from "../../src/domain/rules/facts.ts";

/** Fact values by id: numbers for numeric facts, booleans for flags. Misspelled ids fail the type check. */
export type FactInput = Partial<{ [F in NumberFactId]: number } & { [F in FlagFactId]: boolean }>;

/** Facts taken at `atMs` (default 0). */
export function facts(values: FactInput, atMs = 0): FactValues {
  const result: FactValues = {};
  for (const [fact, value] of Object.entries(values) as Array<[keyof FactInput, number | boolean]>) {
    Object.assign(result, { [fact]: { value, atMs } });
  }
  return result;
}
