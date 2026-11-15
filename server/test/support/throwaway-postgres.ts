// Starts a disposable Postgres container for one test file and removes it afterwards, so tests
// never touch the compose database.
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import type pg from "pg";
import { createPool } from "../../src/db/pool.ts";

const IMAGE = "postgres:18.4";
const PASSWORD = "throwaway-test-password";
const READY_POLL_MS = 500;
const READY_TIMEOUT_MS = 60_000;

export interface ThrowawayPostgres {
  pool: pg.Pool;
  /** How to connect, for a test that needs a pool of its own. */
  connection: pg.PoolConfig;
  stop(): Promise<void>;
}

const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8" }).trim();

export async function startThrowawayPostgres(): Promise<ThrowawayPostgres> {
  const container = docker("run", "-d", "--rm", "-e", `POSTGRES_PASSWORD=${PASSWORD}`, "-p", "127.0.0.1::5432", IMAGE);
  try {
    const port = Number(docker("port", container, "5432/tcp").split("\n")[0].split(":").at(-1));
    await waitUntilReady(container);
    const connection = { host: "127.0.0.1", port, user: "postgres", password: PASSWORD, database: "postgres" };
    const pool = createPool(connection);
    return {
      pool,
      connection,
      async stop() {
        await pool.end();
        docker("rm", "-f", "-v", container); // -v: also its anonymous data volume, or every run leaks one
      },
    };
  } catch (err) {
    docker("rm", "-f", "-v", container); // -v: also its anonymous data volume, or every run leaks one
    throw err;
  }
}

/** pg_isready alone can pass during the image's init restart, so also run a real query. */
async function waitUntilReady(container: string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (isReady(container)) return;
    await sleep(READY_POLL_MS);
  }
  throw new Error(`Postgres in ${container} was not ready after ${READY_TIMEOUT_MS} ms`);
}

function isReady(container: string): boolean {
  try {
    docker("exec", container, "psql", "-U", "postgres", "-h", "127.0.0.1", "-c", "SELECT 1");
    return true;
  } catch {
    return false; // not accepting connections yet; the caller polls again
  }
}
