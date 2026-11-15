import type { Mission, RelaySetting } from "@heartbeat/shared";
import type { MissionStore } from "../domain/ports.ts";
import type { Queryable } from "./pool.ts";

const MISSION_ROW = 1;
const MISSION_COLUMNS = `name, start_date AS "startDate", gravity, sleep_day_time_zone AS "sleepDayTimeZone"`;

export function missionRepo(db: Queryable): MissionStore {
  return {
    async get() {
      const { rows } = await db.query<Mission>(
        `SELECT ${MISSION_COLUMNS} FROM mission WHERE id = $1`, [MISSION_ROW],
      );
      return rows[0] ?? null;
    },

    async saveIfMissing(mission) {
      await db.query(
        "INSERT INTO mission (id, name, start_date, gravity, sleep_day_time_zone) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING",
        [MISSION_ROW, mission.name, mission.startDate, mission.gravity, mission.sleepDayTimeZone],
      );
    },

    async updateSleepDayTimeZone(timeZone) {
      const { rows } = await db.query<Mission>(
        `UPDATE mission SET sleep_day_time_zone = $2 WHERE id = $1 RETURNING ${MISSION_COLUMNS}`, [MISSION_ROW, timeZone],
      );
      return rows[0] ?? null;
    },

    async relaySetting() {
      const { rows } = await db.query<RelaySetting>(
        `SELECT relay_preset AS preset, relay_real_time AS "realTime" FROM mission WHERE id = $1`, [MISSION_ROW],
      );
      return rows[0] ?? null;
    },

    async updateRelaySetting({ preset, realTime }) {
      // One statement, so two changes of different fields at once both stick.
      const { rows } = await db.query<RelaySetting>(
        `UPDATE mission SET relay_preset = COALESCE($2, relay_preset), relay_real_time = COALESCE($3, relay_real_time)
         WHERE id = $1 RETURNING relay_preset AS preset, relay_real_time AS "realTime"`,
        [MISSION_ROW, preset ?? null, realTime ?? null],
      );
      return rows[0] ?? null;
    },
  };
}
