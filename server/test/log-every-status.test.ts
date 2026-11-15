import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Astronaut } from "@heartbeat/shared";
import { DEFAULT_RULE_BOOK } from "../src/domain/rules/rule-book.ts";
import { logEveryStatus } from "../src/domain/status/log-every-status.ts";
import { storesWithOneBroken } from "./support/fake-stores.ts";

describe("logEveryStatus (review F023)", () => {
  it("evaluates every astronaut on its own and reports a failure with the astronaut's id", async () => {
    const evaluated: string[] = [];
    const failures = await logEveryStatus(
      storesWithOneBroken(evaluated), DEFAULT_RULE_BOOK, Date.parse("2026-11-14T12:00:00Z"), { statusEvaluated: async () => {} },
    );
    assert.deepEqual(evaluated, ["fine"]);
    assert.deepEqual(failures.map((f) => [f.astronautId, (f.error as Error).message]), [["broken", "bad data row"]]);
  });

  it("reports a crew list that cannot be read as a failure instead of rejecting (review F007)", async () => {
    const unreachable = async (): Promise<Astronaut[]> => { throw new Error("database unreachable"); };
    const failures = await logEveryStatus(
      storesWithOneBroken([], unreachable), DEFAULT_RULE_BOOK, Date.parse("2026-11-14T12:00:00Z"), { statusEvaluated: async () => {} },
    );
    assert.deepEqual(failures.map((f) => [f.astronautId, (f.error as Error).message]), [[null, "database unreachable"]]);
  });
});
