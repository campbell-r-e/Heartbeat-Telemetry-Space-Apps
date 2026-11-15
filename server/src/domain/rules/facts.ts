// The named values rules compare against ("facts"). Each fact says whose data it reads, which
// metrics, the settings it cannot be computed without (the one list of them: the engine reports
// a rule pending from it, and compute-facts reads the values from it), and how to show it.
import type { Metric } from "@heartbeat/shared";
import type { SettingKey } from "./settings.ts";

/**
 * "ship" facts read the spacecraft's own sensors and apply to every astronaut (SPEC §6.4);
 * "astronaut" facts read one astronaut's data; "clock" facts read only the time.
 */
export type FactScope = "ship" | "astronaut" | "clock";

/** Astronaut profile fields a fact may need (SPEC §10 Astronaut). */
export type ProfileField = "age" | "sex" | "massKg" | "heightM";

interface FactSpec {
  scope: FactScope;
  metrics: readonly Metric[];
  settings: readonly SettingKey[];
  /** Profile fields the fact cannot be computed without; a rule waits for them like for settings. */
  profile: readonly ProfileField[];
  kind: "number" | "flag";
  /** Decimal places when shown in a message. */
  decimals: number;
  /** False when the fact is not a reading's own value, so it does not rate its metrics (e.g. exercise minutes). */
  ratesReadings: boolean;
}

const COVERAGE = "coverage.slotMinutes";
const CAREER = ["radiation.doseEquivalentPerAbsorbedDose", "radiation.priorCareerDoseMSv", "radiation.careerLimitMSv"] as const;
const BASELINE = ["baseline.windowDays", "baseline.minimumDistinctDays"] as const;
const SLEEP_PERIOD = [COVERAGE, "noise.sleepStartHourUtc", "noise.sleepEndHourUtc"] as const;
const EER_PROFILE = ["age", "sex", "massKg", "heightM"] as const;

const spec = (scope: FactScope, metrics: readonly Metric[], decimals: number, settings: readonly SettingKey[] = []) =>
  ({ scope, metrics, settings, profile: [], kind: "number", decimals, ratesReadings: true }) as const;
const flag = (scope: FactScope, metrics: readonly Metric[], settings: readonly SettingKey[] = []) =>
  ({ scope, metrics, settings, profile: [], kind: "flag", decimals: 0, ratesReadings: true }) as const;
/** A daily nutrition total of the last complete UTC day, from logged meals (no metric). */
const meals = (decimals: number, settings: readonly SettingKey[] = [], profile: readonly ProfileField[] = []) =>
  ({ ...spec("astronaut", [], decimals, settings), profile, ratesReadings: false }) as const;

export const FACTS = {
  /** Last 24 hours' dose ÷ the average daily dose of the 7 days before. */
  radiationDailyDoseMultiple: spec("ship", ["radiationDoseRate"], 2, [COVERAGE]),
  radiationDailyDoseUGy: spec("ship", ["radiationDoseRate"], 0, [COVERAGE]),
  radiationPreviousAverageUGy: spec("ship", ["radiationDoseRate"], 0, [COVERAGE]),
  radiationCareerDoseMSv: spec("ship", ["radiationDoseRate"], 1, CAREER),
  radiationCareerPercentOfLimit: spec("ship", ["radiationDoseRate"], 0, CAREER),
  /** Career dose equivalent (estimate) ÷ the career limit. */
  radiationCareerFraction: spec("ship", ["radiationDoseRate"], 2, CAREER),
  radiationProjectedCareerFraction: spec("ship", ["radiationDoseRate"], 2, [...CAREER, "mission.plannedLengthDays"]),

  co2OneHourAverageMmHg: spec("ship", ["co2"], 2, [COVERAGE]),
  co2SevenDayAverageMmHg: spec("ship", ["co2"], 2, ["coverage.co2SevenDayMinimumDays"]),
  /** 1-hour averages, the point checked against the temperature + humidity zone. */
  cabinTempC: spec("ship", ["cabinTemp"], 1, [COVERAGE]),
  cabinHumidityPct: spec("ship", ["humidity"], 0, [COVERAGE]),
  cabinOutsideZone: flag("ship", ["cabinTemp", "humidity"], [COVERAGE]),
  cabinBeyondZoneMargin: flag("ship", ["cabinTemp", "humidity"], [COVERAGE, "cabinZone.alertMarginC", "cabinZone.alertMarginRhPct"]),

  /** The watch barometer reads the cabin around the astronaut. */
  pressureKPa: spec("astronaut", ["pressure"], 1),
  /** The watch's own average over the 24 hours before its latest reading. */
  pressureDayAverageKPa: spec("astronaut", ["pressure"], 1, [COVERAGE]),
  /** Distance of the latest reading from the watch's own average over the 24 hours before it. */
  pressureShiftKPa: spec("astronaut", ["pressure"], 1, [COVERAGE]),
  /** Equivalent continuous levels (energy averages) over the last 24 hours. */
  noiseDayLevelDba: spec("astronaut", ["noise"], 0, [COVERAGE]),
  noiseSleepLevelDba: spec("astronaut", ["noise"], 0, SLEEP_PERIOD),
  noiseAwakeLevelDba: spec("astronaut", ["noise"], 0, SLEEP_PERIOD),

  spo2Pct: spec("astronaut", ["spo2"], 0),
  heartRateBpm: spec("astronaut", ["heartRate"], 0),
  /** Standard deviations of the latest reading above the 14-day baseline mean. */
  heartRateAboveBaselineSd: spec("astronaut", ["heartRate"], 1, BASELINE),
  /** Standard deviations from the baseline mean, either way. */
  skinTempAwayFromBaselineSd: spec("astronaut", ["skinTemp"], 1, BASELINE),
  hrvBelowBaselineSd: spec("astronaut", ["hrv"], 1, BASELINE),

  /** Most recent consecutive nights under the short-night hours. */
  shortSleepNightsInARow: spec("astronaut", ["sleep"], 0, ["sleep.shortNightHours", "sleep.shortNightsInARow"]),
  moodAverage: spec("astronaut", [], 1, ["mind.windowDays", "mind.minimumCheckIns"]),
  stressAverage: spec("astronaut", [], 1, ["mind.windowDays", "mind.minimumCheckIns"]),

  /** Exercise minutes in the current UTC day (SPEC §5.4); needs the astronaut's age. */
  exerciseMinutesToday: { ...spec("astronaut", ["heartRate"], 0, ["exercise.moderateIntensityFraction"]), profile: ["age"], ratesReadings: false },
  /** Energy eaten as % of the estimated energy requirement (EER). */
  energyDayPctOfEer: meals(0, [], EER_PROFILE),
  energyDayKcal: meals(0),
  eerKcal: meals(0, [], EER_PROFILE),
  /** Share of the day's calories from protein. */
  proteinDayPctOfKcal: meals(0, ["nutrition.proteinKcalPerG"]),
  /** Protein per kg of body mass, for the Req. 2 minimum. */
  proteinDayGPerKg: meals(2, ["nutrition.proteinGPerKg"], ["massKg"]),
  proteinDayG: meals(0),
  proteinMinimumG: meals(0, ["nutrition.proteinGPerKg"], ["massKg"]),
  calciumDayMg: meals(0),
  vitaminDDayUg: meals(1),
  sodiumDayMg: meals(0),

  /** Hours since the start of the UTC day. */
  utcHourOfDay: spec("clock", [], 1),
} as const satisfies Record<string, FactSpec>;

export type FactId = keyof typeof FACTS;

type FactIdOfKind<K extends FactSpec["kind"]> = { [F in FactId]: (typeof FACTS)[F]["kind"] extends K ? F : never }[FactId];
export type NumberFactId = FactIdOfKind<"number">;
export type FlagFactId = FactIdOfKind<"flag">;

/** The settings a fact needs, as a union of keys. */
export type FactSettingKey<F extends FactId> = (typeof FACTS)[F]["settings"][number];

export interface FactValue<V extends number | boolean = number | boolean> {
  value: V;
  /** Time of the newest reading the value comes from. */
  atMs: number;
}

/** The facts that could be computed; a missing fact means no recent data (or its settings are unset). */
export type FactValues = { [F in NumberFactId]?: FactValue<number> } & { [F in FlagFactId]?: FactValue<boolean> };

export function isFactId(name: string): name is FactId {
  return Object.hasOwn(FACTS, name);
}
