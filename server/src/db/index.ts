import type pg from "pg";
import type { Stores } from "../domain/ports.ts";
import { astronautsRepo } from "./astronauts-repo.ts";
import { badgesRepo } from "./badges-repo.ts";
import { checkInsRepo } from "./checkins-repo.ts";
import { demoStormRepo } from "./demo-storm-repo.ts";
import { foodsRepo } from "./foods-repo.ts";
import { mealsRepo } from "./meals-repo.ts";
import { missionRepo } from "./mission-repo.ts";
import { readingsRepo } from "./readings-repo.ts";
import { relayRepo } from "./relay-repo.ts";
import { scheduleRepo } from "./schedule-repo.ts";
import { statusLogRepo } from "./status-log-repo.ts";
import { watchesRepo } from "./watches-repo.ts";

export { createPool, createServicePool } from "./pool.ts";
export { createSchema } from "./schema.ts";

export function postgresStores(pool: pg.Pool): Stores {
  return {
    astronauts: astronautsRepo(pool),
    badges: badgesRepo(pool),
    readings: readingsRepo(pool),
    foods: foodsRepo(pool),
    meals: mealsRepo(pool),
    checkIns: checkInsRepo(pool),
    schedule: scheduleRepo(pool),
    mission: missionRepo(pool),
    statusLog: statusLogRepo(pool),
    relay: relayRepo(pool),
    watches: watchesRepo(pool),
    demoStorm: demoStormRepo(pool),
  };
}
