// Checks that each bundled data file has the shape the server relies on, so a re-fetched or
// hand-edited file fails at startup with the file and the first bad entry named, instead of
// loading undefined values as NULL readings.
import type { Food, FoodMenu, FoodSource } from "@heartbeat/shared";
import type { HourlyDose } from "../domain/solar-storm.ts";
import { arrayField, checkValue, field, isNumber, isString, isStringMap, isTime, optional, orNull } from "./shape-checks.ts";

export interface WatchHistory {
  heartRate: Array<{ t: string; bpm: number }>;
  hrv: Array<{ t: string; rmssdMs: number }>;
  skinTemp: Array<{ t: string; skinC: number }>;
}

/** Astronaut 1's Zepp OS watch history (SPEC §5.7); every time is UTC. */
export interface ZeppHistory {
  /** Per-minute heart rate. */
  heartRate: Array<{ t: string; bpm: number }>;
  /** Zepp's nightly sleep HRV, stamped at the night's wake time. */
  hrv: Array<{ t: string; sleepHrvMs: number }>;
  /** Hours asleep (light + deep + REM), stamped at the session's wake time. */
  sleep: Array<{ t: string; asleepH: number }>;
  /** Zepp's nightly blood-oxygen score, stamped at the night's wake time. */
  spo2: Array<{ t: string; scorePct: number }>;
}

export interface CabinHour {
  t: string;
  tempC: number | null;
  rhPct: number | null;
  co2mmHg: number | null;
}

/** The entry type of one of a history's arrays. */
type Entry<T, K extends keyof T> = T[K] extends ReadonlyArray<infer E> ? E : never;

export function parseWatchHistory(json: unknown, file: string): WatchHistory {
  return {
    heartRate: arrayField<Entry<WatchHistory, "heartRate">>(file, json, "heartRate", { t: isTime, bpm: isNumber }),
    hrv: arrayField<Entry<WatchHistory, "hrv">>(file, json, "hrv", { t: isTime, rmssdMs: isNumber }),
    skinTemp: arrayField<Entry<WatchHistory, "skinTemp">>(file, json, "skinTemp", { t: isTime, skinC: isNumber }),
  };
}

export function parseZeppHistory(json: unknown, file: string): ZeppHistory {
  return {
    heartRate: arrayField<Entry<ZeppHistory, "heartRate">>(file, json, "heartRate", { t: isTime, bpm: isNumber }),
    hrv: arrayField<Entry<ZeppHistory, "hrv">>(file, json, "hrv", { t: isTime, sleepHrvMs: isNumber }),
    sleep: arrayField<Entry<ZeppHistory, "sleep">>(file, json, "sleep", { t: isTime, asleepH: isNumber }),
    spo2: arrayField<Entry<ZeppHistory, "spo2">>(file, json, "spo2", { t: isTime, scorePct: isNumber }),
  };
}

export function parseRadiationHours(json: unknown, file: string): HourlyDose[] {
  return arrayField<HourlyDose>(file, json, "hourly", { t: isTime, uGyPerHour: isNumber });
}

export function parseCabinHours(json: unknown, file: string): CabinHour[] {
  return arrayField<CabinHour>(file, json, "hourly", { t: isTime, tempC: orNull(isNumber), rhPct: orNull(isNumber), co2mmHg: orNull(isNumber) });
}

export function parseFoodMenu(json: unknown, file: string): FoodMenu {
  const sources = arrayField<FoodSource>(file, json, "sources", { id: isString, title: isString, url: isString });
  const notes = field(file, json, "notes");
  checkValue<string | undefined>(file, "notes", notes, optional(isString));
  const nutrient = orNull(isNumber);
  const foods = arrayField<Food>(file, json, "foods", {
    id: isString, name: isString, category: isString, foodType: orNull(isString), serving: isString,
    kcal: nutrient, proteinG: nutrient, calciumMg: nutrient, vitaminDUg: nutrient, sodiumMg: nutrient,
    sourceByField: optional(isStringMap), note: optional(isString),
  });
  return notes === undefined ? { sources, foods } : { sources, notes, foods };
}
