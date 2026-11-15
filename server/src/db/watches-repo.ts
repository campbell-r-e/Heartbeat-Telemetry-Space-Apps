import type { WatchInfo } from "@heartbeat/shared";
import type { WatchStore } from "../domain/ports.ts";
import type { Queryable } from "./pool.ts";

interface WatchRow { id: string; battery_pct: number | null; last_contact_ms: number }

export function watchesRepo(db: Queryable): WatchStore {
  return {
    async report({ watchId, batteryPct }, atMs) {
      // xmax = 0 only on a freshly inserted row, so it tells a first upload from a later one.
      const { rows: [row] } = await db.query<{ inserted: boolean }>(
        `INSERT INTO watches (id, battery_pct, last_contact_ms, registered_ms) VALUES ($1, $2, $3, $3)
         ON CONFLICT (id) DO UPDATE SET battery_pct = excluded.battery_pct,
           last_contact_ms = GREATEST(watches.last_contact_ms, excluded.last_contact_ms)
         RETURNING (xmax = 0) AS inserted`,
        [watchId, batteryPct, atMs],
      );
      return { isNew: row.inserted };
    },

    async list() {
      const { rows } = await db.query<WatchRow>("SELECT id, battery_pct, last_contact_ms FROM watches ORDER BY registered_ms, id");
      return rows.map((row): WatchInfo => ({
        watchId: row.id, batteryPct: row.battery_pct, lastContactAt: new Date(row.last_contact_ms).toISOString(),
      }));
    },
  };
}
