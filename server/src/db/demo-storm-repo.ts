import type pg from "pg";
import { SHIP_ID } from "@heartbeat/shared";
import type { DemoStormStore, StormReading } from "../domain/ports.ts";
import { withTransaction } from "./pool.ts";
import { deleteSource, insertReadings } from "./readings-repo.ts";

const MISSION_ROW = 1;
const STORM_SOURCE = "simulated";

// The storm's readings are the ship's `simulated` radiation; its start lives in the mission record.
const STORM_READINGS = `
  SELECT taken_ms AS "takenMs", value FROM readings
  WHERE astronaut_id = $1 AND metric = 'radiationDoseRate' AND source = $2 AND value IS NOT NULL
  ORDER BY taken_ms`;
const SET_STARTED = "UPDATE mission SET demo_storm_started_ms = $2 WHERE id = $1";

export function demoStormRepo(pool: pg.Pool): DemoStormStore {
  return {
    async read() {
      const [readings, started] = await Promise.all([
        pool.query<StormReading>(STORM_READINGS, [SHIP_ID, STORM_SOURCE]),
        pool.query<{ started: number | null }>("SELECT demo_storm_started_ms AS started FROM mission WHERE id = $1", [MISSION_ROW]),
      ]);
      return { readings: readings.rows, startedMs: started.rows[0]?.started ?? null };
    },

    store(readings, startedMs) {
      return withTransaction(pool, async (tx) => {
        await deleteSource(tx, SHIP_ID, STORM_SOURCE);
        await insertReadings(tx, readings);
        await tx.query(SET_STARTED, [MISSION_ROW, startedMs]);
      });
    },

    clear: () => deleteSource(pool, SHIP_ID, STORM_SOURCE),

    async forgetStart() {
      await pool.query(SET_STARTED, [MISSION_ROW, null]);
    },
  };
}
