import type { CheckIn } from "@heartbeat/shared";
import type { CheckInStore } from "../domain/ports.ts";
import type { Queryable } from "./pool.ts";

interface CheckInRow { id: number; astronaut_id: string; mood: number; stress: number; at_ms: number }

export function checkInsRepo(db: Queryable): CheckInStore {
  return {
    async add(astronautId, mood, stress, at) {
      const { rows } = await db.query<{ id: number }>(
        "INSERT INTO checkins (astronaut_id, mood, stress, at_ms) VALUES ($1, $2, $3, $4) RETURNING id",
        [astronautId, mood, stress, Date.parse(at)],
      );
      return { id: rows[0].id, astronautId, mood, stress, at };
    },

    async remove(id, astronautId) {
      const { rows } = await db.query<CheckInRow>(
        "DELETE FROM checkins WHERE id = $1 AND astronaut_id = $2 RETURNING id, astronaut_id, mood, stress, at_ms", [id, astronautId],
      );
      return rows[0] ? toCheckIn(rows[0]) : null;
    },

    async between(astronautId, fromMs, toMs) {
      const { rows } = await db.query<CheckInRow>(
        `SELECT id, astronaut_id, mood, stress, at_ms FROM checkins
         WHERE astronaut_id = $1 AND at_ms BETWEEN $2 AND $3 ORDER BY at_ms`,
        [astronautId, fromMs, toMs],
      );
      return rows.map(toCheckIn);
    },
  };
}

function toCheckIn(row: CheckInRow): CheckIn {
  return { id: row.id, astronautId: row.astronaut_id, mood: row.mood, stress: row.stress, at: new Date(row.at_ms).toISOString() };
}
