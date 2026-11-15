import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type pg from "pg";
import { withTransaction } from "../src/db/pool.ts";

/** A stand-in pool whose client fails the statements named in `failing`. */
function fakePool(failing: Record<string, Error>) {
  const released: Array<Error | boolean | undefined> = [];
  const statements: string[] = [];
  const client = {
    async query(sql: string) {
      statements.push(sql);
      if (failing[sql]) throw failing[sql];
      return { rows: [], rowCount: 0 };
    },
    release(err?: Error | boolean) {
      released.push(err);
    },
  };
  // Only connect() is used by withTransaction; the cast stands in for the rest of pg.Pool.
  const pool = { connect: async () => client } as unknown as pg.Pool;
  return { pool, released, statements };
}

describe("withTransaction", () => {
  it("commits and releases the client normally", async () => {
    const { pool, released, statements } = fakePool({});
    assert.equal(await withTransaction(pool, async () => 7), 7);
    assert.deepEqual(statements, ["BEGIN", "COMMIT"]);
    assert.deepEqual(released, [undefined]);
  });

  it("rolls back and rethrows the work's error", async () => {
    const workError = new Error("work failed");
    const { pool, released, statements } = fakePool({});
    await assert.rejects(withTransaction(pool, async () => { throw workError; }), workError);
    assert.deepEqual(statements, ["BEGIN", "ROLLBACK"]);
    assert.deepEqual(released, [undefined]);
  });

  it("keeps the original error and discards the client when ROLLBACK fails", async () => {
    const workError = new Error("work failed");
    const rollbackError = new Error("connection lost");
    const { pool, released } = fakePool({ ROLLBACK: rollbackError });
    await assert.rejects(withTransaction(pool, async () => { throw workError; }), workError);
    assert.deepEqual(released, [rollbackError]);
  });
});
