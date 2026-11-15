import type pg from "pg";
import type { ScheduledTask } from "@heartbeat/shared";
import type { ScheduleStore } from "../domain/ports.ts";
import { withTransaction } from "./pool.ts";

export function scheduleRepo(pool: pg.Pool): ScheduleStore {
  return {
    replace(tasks) {
      return withTransaction(pool, async (tx) => {
        await tx.query("DELETE FROM schedule");
        if (tasks.length === 0) return 0;
        const result = await tx.query(
          `INSERT INTO schedule (id, kind, label, local_time, astronaut_id)
           SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])`,
          [tasks.map((t) => t.id), tasks.map((t) => t.kind), tasks.map((t) => t.label), tasks.map((t) => t.localTime), tasks.map((t) => t.astronautId)],
        );
        return result.rowCount ?? 0;
      });
    },

    async forAstronaut(astronautId) {
      const { rows } = await pool.query<ScheduledTask>(
        `SELECT id, kind, label, local_time AS "localTime", astronaut_id AS "astronautId" FROM schedule
         WHERE astronaut_id IS NULL OR astronaut_id = $1 ORDER BY local_time NULLS LAST, id`,
        [astronautId],
      );
      return rows;
    },
  };
}
