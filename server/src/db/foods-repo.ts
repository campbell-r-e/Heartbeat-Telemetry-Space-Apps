import type pg from "pg";
import type { Food, FoodMenu, FoodSource } from "@heartbeat/shared";
import type { FoodStore } from "../domain/ports.ts";
import { withTransaction, type Queryable } from "./pool.ts";

const MENU_INFO_ROW = 1;

const SELECT_FOODS = `
  SELECT id, name, category, food_type AS "foodType", serving, kcal, protein_g AS "proteinG",
         calcium_mg AS "calciumMg", vitamin_d_ug AS "vitaminDUg", sodium_mg AS "sodiumMg",
         source_by_field AS "sourceByField", note
  FROM foods ORDER BY position`;

const INSERT_FOODS = `
  INSERT INTO foods (id, name, category, food_type, serving, kcal, protein_g, calcium_mg, vitamin_d_ug,
                     sodium_mg, source_by_field, note, position)
  SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::float8[], $7::float8[],
                       $8::float8[], $9::float8[], $10::float8[], $11::jsonb[], $12::text[], $13::int[])`;

export function foodsRepo(pool: pg.Pool): FoodStore {
  return {
    replaceMenu(menu) {
      return withTransaction(pool, async (tx) => {
        await tx.query("DELETE FROM foods");
        await tx.query("DELETE FROM food_sources");
        await insertSources(tx, menu.sources);
        await insertFoods(tx, menu.foods);
        await tx.query(
          `INSERT INTO menu_info (id, notes) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET notes = excluded.notes`,
          [MENU_INFO_ROW, menu.notes ?? null],
        );
        return menu.foods.length;
      });
    },

    async menu() {
      const [sources, foods, info] = await Promise.all([
        pool.query<FoodSource>("SELECT id, title, url FROM food_sources ORDER BY position"),
        pool.query<Food>(SELECT_FOODS),
        pool.query<{ notes: string | null }>("SELECT notes FROM menu_info WHERE id = $1", [MENU_INFO_ROW]),
      ]);
      const notes = info.rows[0]?.notes ?? undefined;
      return { sources: sources.rows, notes, foods: foods.rows.map(dropNullOptionals) };
    },

    async exists(foodId) {
      const { rowCount } = await pool.query("SELECT 1 FROM foods WHERE id = $1", [foodId]);
      return (rowCount ?? 0) > 0;
    },
  };
}

async function insertSources(db: Queryable, sources: readonly FoodSource[]): Promise<void> {
  await db.query(
    "INSERT INTO food_sources (id, title, url, position) SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::int[])",
    [sources.map((s) => s.id), sources.map((s) => s.title), sources.map((s) => s.url), sources.map((_, i) => i)],
  );
}

async function insertFoods(db: Queryable, foods: readonly Food[]): Promise<void> {
  const column = <K extends keyof Food>(key: K) => foods.map((f) => f[key] ?? null);
  await db.query(INSERT_FOODS, [
    column("id"), column("name"), column("category"), column("foodType"), column("serving"),
    column("kcal"), column("proteinG"), column("calciumMg"), column("vitaminDUg"), column("sodiumMg"),
    foods.map((f) => (f.sourceByField ? JSON.stringify(f.sourceByField) : null)),
    column("note"), foods.map((_, i) => i),
  ]);
}

/** Keeps the JSON shape of the bundled menu: optional fields are omitted rather than null. */
function dropNullOptionals(food: Food): Food {
  const { sourceByField, note, ...rest } = food;
  return {
    ...rest,
    ...(sourceByField ? { sourceByField } : {}),
    ...(note ? { note } : {}),
  };
}
