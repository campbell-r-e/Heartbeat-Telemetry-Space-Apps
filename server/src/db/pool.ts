import pg from "pg";

/** Anything that can run a query: the pool, or one client inside a transaction. */
export type Queryable = Pick<pg.Pool, "query">;

// Postgres returns BIGINT (taken_ms and friends) as text by default; every value we store fits
// safely in a JS number (ms since 1970), so the pool parses it once instead of every query.
// The parser belongs to the pools made here, not to every pg client in the process.
const BIGINT_OID = 20;
// pg declares getTypeParser as overloads that a single arrow cannot satisfy; the arrow handles
// both formats by delegating every other type to pg's own parser.
const types: pg.CustomTypesConfig = {
  getTypeParser: ((oid: number, format?: "text" | "binary") =>
    oid === BIGINT_OID ? (text: string) => Number(text) : pg.types.getTypeParser(oid, format)) as pg.CustomTypesConfig["getTypeParser"],
};

/**
 * Without `config`, connection settings come from the standard PGHOST/PGUSER/PGPASSWORD/
 * PGDATABASE/PGPORT variables. BIGINT columns come back as numbers.
 */
export function createPool(config: pg.PoolConfig = {}): pg.Pool {
  return new pg.Pool({ ...config, types });
}

/**
 * The longest one statement may run while the server is serving (review): a hung query fails
 * instead of holding a connection, a status evaluation or a storm change forever. The startup
 * import of the bundled history runs on its own pool without it.
 */
export const STATEMENT_TIMEOUT_MS = 15_000;

/** The pool the running server uses: like createPool, with STATEMENT_TIMEOUT_MS on every connection. */
export function createServicePool(config: pg.PoolConfig = {}): pg.Pool {
  return createPool({ ...config, statement_timeout: STATEMENT_TIMEOUT_MS });
}

/** Runs `work` inside one transaction on a dedicated client, rolling back if it throws. */
export async function withTransaction<T>(pool: pg.Pool, work: (tx: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let brokenClientError: Error | undefined;
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    // If ROLLBACK itself fails the connection is unusable: keep the original error for the
    // caller, and hand the rollback error to release() so pg discards the client.
    brokenClientError = await rollback(client);
    throw err;
  } finally {
    client.release(brokenClientError);
  }
}

/** Returns the error if ROLLBACK failed, otherwise undefined. */
async function rollback(client: Queryable): Promise<Error | undefined> {
  try {
    await client.query("ROLLBACK");
    return undefined;
  } catch (rollbackError) {
    return rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
  }
}
