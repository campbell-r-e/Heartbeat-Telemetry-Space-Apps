import type pg from "pg";
import type { Astronaut } from "@heartbeat/shared";
import type { AstronautStore } from "../domain/ports.ts";
import { withTransaction } from "./pool.ts";

// A removed astronaut keeps its row (and its readings) with removed_ms set; every crew read skips it.
const SELECT_CREW = `
  SELECT id, name, watch_id AS "watchId", age, sex, mass_kg AS "massKg", height_m AS "heightM" FROM astronauts
  WHERE removed_ms IS NULL`;

const INSERT_OR_UPDATE_PROFILE = `
  INSERT INTO astronauts (id, name, watch_id, age, sex, mass_kg, height_m, created_ms) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  ON CONFLICT (id) DO UPDATE SET name = excluded.name, age = excluded.age,
    sex = excluded.sex, mass_kg = excluded.mass_kg, height_m = excluded.height_m`;

const profileValues = (astronaut: Astronaut) =>
  [astronaut.id, astronaut.name, astronaut.watchId, astronaut.age, astronaut.sex, astronaut.massKg, astronaut.heightM, Date.now()];

export function astronautsRepo(pool: pg.Pool): AstronautStore {
  return {
    async list() {
      const { rows } = await pool.query<Astronaut>(`${SELECT_CREW} ORDER BY created_ms`);
      return rows;
    },

    async find(id) {
      const { rows } = await pool.query<Astronaut>(`${SELECT_CREW} AND id = $1`, [id]);
      return rows[0] ?? null;
    },

    async exists(id) {
      const { rowCount } = await pool.query("SELECT 1 FROM astronauts WHERE id = $1 AND removed_ms IS NULL", [id]);
      return (rowCount ?? 0) > 0;
    },

    async hasHistory(id) {
      const { rowCount } = await pool.query("SELECT 1 FROM astronauts WHERE id = $1", [id]);
      return (rowCount ?? 0) > 0;
    },

    async upsert(astronaut) {
      await pool.query(INSERT_OR_UPDATE_PROFILE, profileValues(astronaut));
    },

    async addToCrew(astronaut) {
      await pool.query(`${INSERT_OR_UPDATE_PROFILE}, removed_ms = NULL`, profileValues(astronaut));
    },

    async remove(id, atMs) {
      const { rowCount } = await pool.query(
        "UPDATE astronauts SET removed_ms = $2, watch_id = NULL WHERE id = $1 AND removed_ms IS NULL", [id, atMs],
      );
      return (rowCount ?? 0) > 0;
    },

    assignWatch(id, watchId) {
      return withTransaction(pool, async (tx) => {
        // A watch is worn by one astronaut: assigning it takes it from anyone else first.
        if (watchId !== null) await tx.query("UPDATE astronauts SET watch_id = NULL WHERE watch_id = $1 AND id <> $2", [watchId, id]);
        await tx.query("UPDATE astronauts SET watch_id = $2 WHERE id = $1 AND removed_ms IS NULL", [id, watchId]);
      });
    },
  };
}
