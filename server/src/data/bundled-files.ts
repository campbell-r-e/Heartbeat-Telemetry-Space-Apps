// Reads the data files bundled in server/data/ (produced by the scripts in server/scripts/).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FoodMenu } from "@heartbeat/shared";
import type { HourlyDose } from "../domain/solar-storm.ts";
import {
  parseCabinHours, parseFoodMenu, parseRadiationHours, parseWatchHistory, parseZeppHistory,
  type CabinHour, type WatchHistory, type ZeppHistory,
} from "./bundled-shapes.ts";

export type { CabinHour, WatchHistory, ZeppHistory } from "./bundled-shapes.ts";

/** server/data/, where the bundled files live (the data scripts write here too). */
export const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");

/** Everything bundled in server/data/, parsed once at startup. */
export interface BundledData {
  astronaut1History: WatchHistory;
  astronaut1Zepp: ZeppHistory;
  radiationHours: HourlyDose[];
  cabinHours: CabinHour[];
  foodMenu: FoodMenu;
}

export function readBundledData(): BundledData {
  return {
    astronaut1History: readAstronaut1History(),
    astronaut1Zepp: readAstronaut1Zepp(),
    radiationHours: readRadiationHours(),
    cabinHours: readCabinHours(),
    foodMenu: readFoodMenu(),
  };
}

/** Reads a bundled file and checks its shape with `parse`, which throws naming the file. */
function readJson<T>(fileName: string, parse: (json: unknown, file: string) => T): T {
  return parse(JSON.parse(readFileSync(join(DATA_DIR, fileName), "utf8")), fileName);
}

export const readAstronaut1History = () => readJson("astronaut1-history.json", parseWatchHistory);
export const readAstronaut1Zepp = () => readJson("astronaut1-zepp.json", parseZeppHistory);
export const readRadiationHours = () => readJson("radiation-iss.json", parseRadiationHours);
export const readCabinHours = () => readJson("cabin-iss.json", parseCabinHours);
export const readFoodMenu = () => readJson("space-food.json", parseFoodMenu);
