import type { MealLog } from "@heartbeat/shared";
import type { MealStore } from "../domain/ports.ts";
import type { Queryable } from "./pool.ts";

interface MealRow { id: number; astronaut_id: string; food_id: string; eaten_ms: number }

export function mealsRepo(db: Queryable): MealStore {
  return {
    async add(astronautId, foodId, eatenAt) {
      const { rows } = await db.query<{ id: number }>(
        "INSERT INTO meals (astronaut_id, food_id, eaten_ms) VALUES ($1, $2, $3) RETURNING id",
        [astronautId, foodId, Date.parse(eatenAt)],
      );
      return { id: rows[0].id, astronautId, foodId, eatenAt };
    },

    async remove(id, astronautId) {
      const { rows } = await db.query<MealRow>(
        "DELETE FROM meals WHERE id = $1 AND astronaut_id = $2 RETURNING id, astronaut_id, food_id, eaten_ms", [id, astronautId],
      );
      return rows[0] ? toMealLog(rows[0]) : null;
    },

    async between(astronautId, fromMs, toMs) {
      const { rows } = await db.query<MealRow>(
        `SELECT id, astronaut_id, food_id, eaten_ms FROM meals
         WHERE astronaut_id = $1 AND eaten_ms BETWEEN $2 AND $3 ORDER BY eaten_ms`,
        [astronautId, fromMs, toMs],
      );
      return rows.map(toMealLog);
    },
  };
}

function toMealLog(row: MealRow): MealLog {
  return { id: row.id, astronautId: row.astronaut_id, foodId: row.food_id, eatenAt: new Date(row.eaten_ms).toISOString() };
}
