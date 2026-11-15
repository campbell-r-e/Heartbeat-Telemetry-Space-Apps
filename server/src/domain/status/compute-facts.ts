// Turns loaded readings into the facts the rules compare (rules/facts.ts). Pure. A fact is left
// out when its data is missing or a setting it needs is unset; which settings a fact needs comes
// only from FACTS, the list the engine also reads to report pending rules.
import type { CheckIn, Food, MealLog, Metric, Nutrient, NutritionCheck, NutritionDay, ShipMetric } from "@heartbeat/shared";
import { NUTRITION_CHECK_SPECS, type NutritionCheckSpec } from "../rules/nutrition-checks.ts";
import { FACTS, type FactId, type FactSettingKey, type FactValue, type FactValues } from "../rules/facts.ts";
import { MISSION_SAMPLE_PERIOD_MS } from "../mission-clock.ts";
import { settingValues, type MaxReadingAges, type RuleSettings } from "../rules/settings.ts";
import { DAY_MS, HOUR_MS, MINUTE_MS, hourOfUtcDay, startOfUtcDay } from "../time.ts";
import { baselineOf, sdsAbove, type Baseline } from "./baseline.ts";
import { insideComfortZone, withinComfortZoneMargin } from "./comfort-zone.ts";
import { exerciseThresholdBpm } from "../exercise-intensity.ts";
import { exerciseMinutesSoFar } from "./exercise.ts";
import { equivalentLevelDba, sleepAndAwakeLevels } from "./noise-level.ts";
import { longestPerNight } from "../sleep/nights.ts";
import { sleepDays } from "../sleep/sleep-days.ts";
import {
  estimatedEnergyRequirement, knownTotal, nutritionDay, proteinPercentOfKcal, type AstronautProfile,
} from "./nutrition.ts";
import { careerDoseMSv, dailyDoseComparison, hoursInDays, missionDoseRate, PREVIOUS_DAYS } from "./radiation-dose.ts";
import { inWindowEndingAt, mean, newestTime, windowAverage, type TimedValue } from "./timed-values.ts";

export type MetricReadings = Partial<Record<Metric, TimedValue[]>>;

/** Everything the facts are computed from, loaded for one astronaut at one time. */
export interface StatusInputs {
  nowMs: number;
  /** Age, sex, mass and height, for exercise minutes and energy needs. */
  profile: AstronautProfile;
  /** Start of mission day 1 (UTC), from the mission settings record; null when there is none. */
  missionStartMs: number | null;
  /** The IANA time zone of the sleep day, from the mission settings record (SPEC §5.7). */
  sleepDayTimeZone: string;
  /** The ship's sensors (radiation, cabin), over the windows in `inputWindows`. */
  ship: MetricReadings;
  /** The astronaut's own real readings, over the windows in `inputWindows`. */
  astronaut: MetricReadings;
  /** The astronaut's newest real reading of each metric. */
  latest: Partial<Record<Metric, TimedValue>>;
  checkIns: readonly CheckIn[];
  /** Meals logged from the start of yesterday (UTC) to now. */
  meals: readonly MealLog[];
  /** The menu the meals refer to. */
  foods: readonly Food[];
}

/** How far back to load each metric, in ms; null loads everything stored. */
export interface InputWindows {
  ship: Record<ShipMetric, number | null>;
  astronaut: Partial<Record<Metric, number>>;
  checkInsMs: number | null;
}

/** The watch barometer reports hPa; the pressure limits are in kPa. */
export const HPA_PER_KPA = 10;

/** The metrics rated against the personal baseline (SPEC §6.2). */
export const BASELINE_METRICS = ["heartRate", "skinTemp", "hrv"] as const satisfies readonly Metric[];

/** The values of the settings `fact` needs, or null if any is unset. */
function settingsOf<F extends FactId>(fact: F, settings: RuleSettings): Record<FactSettingKey<F>, number> | null {
  return settingValues<FactSettingKey<F>>(settings, FACTS[fact].settings);
}

/** How many of the `days` 24-hour days ending at `endMs` hold at least one reading. */
function daysWithReadings(points: readonly TimedValue[], endMs: number, days: number): number {
  return Array.from({ length: days }, (_, k) => inWindowEndingAt(points, endMs - k * DAY_MS, DAY_MS).length > 0).filter(Boolean).length;
}

/** The coverage slot for a windowed average: the setting, or the source's own sampling period if longer. */
function coverageSlotMs(slotMinutes: number, samplingPeriodMs = 0): number {
  return Math.max(slotMinutes * MINUTE_MS, samplingPeriodMs);
}

const fact = <V extends number | boolean>(value: V, atMs: number): FactValue<V> => ({ value, atMs });

/** What `loadStatusInputs` must load for these settings at `nowMs`. */
export function inputWindows(settings: RuleSettings, maxAges: MaxReadingAges, nowMs: number): InputWindows {
  const careerActive = settingsOf("radiationCareerFraction", settings) !== null;
  const baselineDays = settings["baseline.windowDays"];
  const baselineMs = baselineDays === null ? 0 : baselineDays * DAY_MS;
  const mindDays = settings["mind.windowDays"];
  return {
    ship: {
      radiationDoseRate: careerActive ? null : (PREVIOUS_DAYS + 1) * DAY_MS,
      co2: 7 * DAY_MS,
      cabinTemp: HOUR_MS,
      humidity: HOUR_MS,
    },
    astronaut: {
      heartRate: Math.max(nowMs - startOfUtcDay(nowMs), baselineMs),
      skinTemp: baselineMs,
      hrv: baselineMs,
      // The 24 hours before the newest reading, which may be up to its expiry old.
      pressure: DAY_MS + (maxAges.pressure ?? 0) * MINUTE_MS,
      noise: DAY_MS,
      sleep: (settings["sleep.shortNightsInARow"] ?? 0) * DAY_MS,
    },
    checkInsMs: mindDays === null ? null : mindDays * DAY_MS,
  };
}

export function computeFacts(inputs: StatusInputs, settings: RuleSettings): FactValues {
  return {
    ...radiationDayFacts(inputs, settings),
    ...radiationCareerFacts(inputs, settings),
    ...co2Facts(inputs, settings),
    ...comfortZoneFacts(inputs, settings),
    ...pressureFacts(inputs, settings),
    ...noiseFacts(inputs, settings),
    ...vitalsFacts(inputs),
    ...baselineFacts(inputs, settings),
    ...sleepFacts(inputs, settings),
    ...mindFacts(inputs, settings),
    ...exerciseFacts(inputs, settings),
    ...nutritionFacts(inputs, settings),
  };
}

function radiationDayFacts({ ship, nowMs }: StatusInputs, settings: RuleSettings): FactValues {
  const needs = settingsOf("radiationDailyDoseMultiple", settings);
  if (!needs) return {};
  const slotMs = coverageSlotMs(needs["coverage.slotMinutes"], MISSION_SAMPLE_PERIOD_MS);
  const daily = dailyDoseComparison(ship.radiationDoseRate ?? [], nowMs, slotMs);
  if (!daily) return {};
  return {
    radiationDailyDoseMultiple: fact(daily.multiple, daily.atMs),
    radiationDailyDoseUGy: fact(daily.dailyDoseUGy, daily.atMs),
    radiationPreviousAverageUGy: fact(daily.previousSevenDayAverageUGy, daily.atMs),
  };
}

/**
 * Career dose from the mission start (owner decision). Simulated storm hours count while the
 * storm is active, since they replace the recorded hours in the ship's readings.
 */
function radiationCareerFacts({ ship, missionStartMs }: StatusInputs, settings: RuleSettings): FactValues {
  const career = settingsOf("radiationCareerFraction", settings);
  const mission = missionStartMs === null ? null : missionDoseRate(ship.radiationDoseRate ?? [], missionStartMs);
  if (!career || !mission) return {};
  const doseSettings = {
    doseEquivalentPerAbsorbed: career["radiation.doseEquivalentPerAbsorbedDose"],
    priorCareerDoseMSv: career["radiation.priorCareerDoseMSv"],
  };
  const limit = career["radiation.careerLimitMSv"];
  const doseSoFar = careerDoseMSv(mission.meanUGyPerHour, mission.elapsedHours, doseSettings);
  const facts: FactValues = {
    radiationCareerDoseMSv: fact(doseSoFar, mission.atMs),
    radiationCareerFraction: fact(doseSoFar / limit, mission.atMs),
    radiationCareerPercentOfLimit: fact((doseSoFar / limit) * 100, mission.atMs),
  };
  const projection = settingsOf("radiationProjectedCareerFraction", settings);
  if (projection) {
    const projected = careerDoseMSv(mission.meanUGyPerHour, hoursInDays(projection["mission.plannedLengthDays"]), doseSettings);
    facts.radiationProjectedCareerFraction = fact(projected / limit, mission.atMs);
  }
  return facts;
}

function co2Facts({ ship, nowMs }: StatusInputs, settings: RuleSettings): FactValues {
  const facts: FactValues = {};
  const co2 = ship.co2 ?? [];
  const hourNeeds = settingsOf("co2OneHourAverageMmHg", settings);
  const hour = hourNeeds && windowAverage(co2, nowMs, HOUR_MS, coverageSlotMs(hourNeeds["coverage.slotMinutes"], MISSION_SAMPLE_PERIOD_MS));
  if (hour) facts.co2OneHourAverageMmHg = fact(hour.value, hour.atMs);
  const weekNeeds = settingsOf("co2SevenDayAverageMmHg", settings);
  const week = weekNeeds && daysWithReadings(co2, nowMs, 7) >= weekNeeds["coverage.co2SevenDayMinimumDays"]
    ? windowAverage(co2, nowMs, 7 * DAY_MS) : null;
  if (week) facts.co2SevenDayAverageMmHg = fact(week.value, week.atMs);
  return facts;
}

function comfortZoneFacts({ ship, nowMs }: StatusInputs, settings: RuleSettings): FactValues {
  const needs = settingsOf("cabinOutsideZone", settings);
  if (!needs) return {};
  const slotMs = coverageSlotMs(needs["coverage.slotMinutes"], MISSION_SAMPLE_PERIOD_MS);
  const temp = windowAverage(ship.cabinTemp ?? [], nowMs, HOUR_MS, slotMs);
  const humidity = windowAverage(ship.humidity ?? [], nowMs, HOUR_MS, slotMs);
  if (!temp || !humidity) return {};
  const atMs = Math.max(temp.atMs, humidity.atMs);
  const point = { tempC: temp.value, rhPct: humidity.value };
  const facts: FactValues = {
    cabinTempC: fact(temp.value, temp.atMs),
    cabinHumidityPct: fact(humidity.value, humidity.atMs),
    cabinOutsideZone: fact(!insideComfortZone(point), atMs),
  };
  const margins = settingsOf("cabinBeyondZoneMargin", settings);
  if (margins) {
    const within = withinComfortZoneMargin(point, margins["cabinZone.alertMarginC"], margins["cabinZone.alertMarginRhPct"]);
    facts.cabinBeyondZoneMargin = fact(!within, atMs);
  }
  return facts;
}

function pressureFacts({ astronaut, latest, nowMs }: StatusInputs, settings: RuleSettings): FactValues {
  if (!latest.pressure) return {};
  const { tMs } = latest.pressure;
  const kPa = latest.pressure.value / HPA_PER_KPA;
  const facts: FactValues = { pressureKPa: fact(kPa, tMs) };
  const needs = settingsOf("pressureShiftKPa", settings);
  // The average covers the 24 hours before the newest reading and excludes it (owner decision):
  // the window ends just before it, so readings every 15 minutes fill every 15-minute slot.
  const justBeforeMs = tMs - 1;
  const dayAverage = needs && windowAverage(astronaut.pressure ?? [], justBeforeMs, DAY_MS, coverageSlotMs(needs["coverage.slotMinutes"]));
  if (dayAverage) {
    facts.pressureDayAverageKPa = fact(dayAverage.value / HPA_PER_KPA, tMs);
    facts.pressureShiftKPa = fact(Math.abs(kPa - dayAverage.value / HPA_PER_KPA), tMs);
  }
  return facts;
}

function noiseFacts({ astronaut, nowMs }: StatusInputs, settings: RuleSettings): FactValues {
  const needs = settingsOf("noiseDayLevelDba", settings);
  const day = needs && windowAverage(astronaut.noise ?? [], nowMs, DAY_MS, coverageSlotMs(needs["coverage.slotMinutes"]));
  if (!day) return {};
  const noise = inWindowEndingAt(astronaut.noise ?? [], nowMs, DAY_MS);
  const atMs = newestTime(noise);
  const facts: FactValues = { noiseDayLevelDba: fact(equivalentLevelDba(noise.map((r) => r.value))!, atMs) };
  const period = settingsOf("noiseSleepLevelDba", settings);
  if (!period) return facts;
  const { sleepDba, awakeDba } = sleepAndAwakeLevels(noise, {
    startHourUtc: period["noise.sleepStartHourUtc"], endHourUtc: period["noise.sleepEndHourUtc"],
  });
  if (sleepDba !== null) facts.noiseSleepLevelDba = fact(sleepDba, atMs);
  if (awakeDba !== null) facts.noiseAwakeLevelDba = fact(awakeDba, atMs);
  return facts;
}

function vitalsFacts({ latest }: StatusInputs): FactValues {
  const facts: FactValues = {};
  if (latest.spo2) facts.spo2Pct = fact(latest.spo2.value, latest.spo2.tMs);
  if (latest.heartRate) facts.heartRateBpm = fact(latest.heartRate.value, latest.heartRate.tMs);
  return facts;
}

/** Standard deviations from baseline: heart rate above, skin temperature either way, HRV below. */
export type BaselineMetric = (typeof BASELINE_METRICS)[number];

/**
 * Each baseline metric's personal baseline, the one the rules and the charts both use: from the
 * readings before the newest real reading (which is the one rated), or from all readings up to
 * now when there is no recent one. Null until the baseline settings are set and it is ready.
 */
export function baselinesFor(inputs: StatusInputs, settings: RuleSettings): Record<BaselineMetric, Baseline | null> {
  const needs = settingsOf("heartRateAboveBaselineSd", settings);
  const of = (metric: BaselineMetric): Baseline | null => {
    if (!needs) return null;
    const cutoffMs = inputs.latest[metric]?.tMs ?? inputs.nowMs + 1;
    return baselineOf(inputs.astronaut[metric] ?? [], cutoffMs, inputs.nowMs, {
      windowDays: needs["baseline.windowDays"], minimumDistinctDays: needs["baseline.minimumDistinctDays"],
    });
  };
  return { heartRate: of("heartRate"), skinTemp: of("skinTemp"), hrv: of("hrv") };
}

function baselineFacts(inputs: StatusInputs, settings: RuleSettings): FactValues {
  const baselines = baselinesFor(inputs, settings);
  const sds = (metric: BaselineMetric) => {
    const latest = inputs.latest[metric];
    const baseline = baselines[metric];
    return latest && baseline ? { value: sdsAbove(latest.value, baseline), atMs: latest.tMs } : null;
  };
  const facts: FactValues = {};
  const heartRate = sds("heartRate");
  if (heartRate) facts.heartRateAboveBaselineSd = fact(heartRate.value, heartRate.atMs);
  const skin = sds("skinTemp");
  if (skin) facts.skinTempAwayFromBaselineSd = fact(Math.abs(skin.value), skin.atMs);
  const hrv = sds("hrv");
  if (hrv) facts.hrvBelowBaselineSd = fact(-hrv.value, hrv.atMs);
  return facts;
}

function sleepFacts({ astronaut, sleepDayTimeZone }: StatusInputs, settings: RuleSettings): FactValues {
  const needs = settingsOf("shortSleepNightsInARow", settings);
  const nights = longestPerNight(astronaut.sleep ?? [], sleepDays(sleepDayTimeZone));
  if (!needs || nights.length === 0) return {};
  const inARow = nights.findIndex((night) => night.value >= needs["sleep.shortNightHours"]);
  return { shortSleepNightsInARow: fact(inARow === -1 ? nights.length : inARow, nights[0].tMs) };
}

function mindFacts({ checkIns }: StatusInputs, settings: RuleSettings): FactValues {
  const needs = settingsOf("moodAverage", settings);
  if (!needs || checkIns.length === 0 || checkIns.length < needs["mind.minimumCheckIns"]) return {};
  const atMs = Math.max(...checkIns.map((c) => Date.parse(c.at)));
  return {
    moodAverage: fact(mean(checkIns.map((c) => c.mood))!, atMs),
    stressAverage: fact(mean(checkIns.map((c) => c.stress))!, atMs),
  };
}

/** Exercise minutes today; none without a heart-rate reading today, so Gravity is unrated then (owner decision). */
function exerciseFacts({ astronaut, profile, nowMs }: StatusInputs, settings: RuleSettings): FactValues {
  const facts: FactValues = { utcHourOfDay: fact(hourOfUtcDay(nowMs), nowMs) };
  const minutes = exerciseMinutesSoFar(astronaut.heartRate ?? [], exerciseThresholdBpm(profile.age, settings), nowMs);
  if (minutes !== null) facts.exerciseMinutesToday = fact(minutes, nowMs);
  return facts;
}

/** Start of yesterday (UTC): the last complete day, the one nutrition is rated on. */
export function yesterdayStartMs(nowMs: number): number {
  return startOfUtcDay(nowMs) - DAY_MS;
}

/**
 * Yesterday's daily totals (owner decision: today is still running, so it is not rated). A total
 * counts only when every meal logged that day has a value for it; a day with no meals has none.
 */
function nutritionFacts({ meals, foods, profile, nowMs }: StatusInputs, settings: RuleSettings): FactValues {
  const startMs = yesterdayStartMs(nowMs);
  const day = nutritionDay(meals, foods, startMs, true);
  const atMs = startMs + DAY_MS - 1;
  const facts: FactValues = {};
  const eer = estimatedEnergyRequirement(profile);
  const toPctOfEer = (kcal: number) => (eer === null ? null : (kcal / eer) * 100);
  const kcal = knownTotal(day, "kcal");
  const energyPct = ratedTotal(day, "kcal", "energy", settings, toPctOfEer);
  if (kcal !== null) facts.energyDayKcal = fact(kcal, atMs);
  if (eer !== null) facts.eerKcal = fact(eer, atMs);
  if (energyPct !== null) {
    facts.energyDayPctOfEer = fact(energyPct, atMs);
    if (kcal === null) facts.energyDayKcal = fact(day.totals.kcal.atLeast, atMs);
  }
  const proteinG = knownTotal(day, "proteinG");
  const proteinNeeds = settingsOf("proteinDayPctOfKcal", settings);
  if (proteinNeeds && proteinG !== null && kcal !== null && kcal > 0) {
    facts.proteinDayPctOfKcal = fact(proteinPercentOfKcal(proteinG, kcal, proteinNeeds["nutrition.proteinKcalPerG"]), atMs);
  }
  Object.assign(facts, proteinMinimumFacts(day, profile, settings, atMs));
  const calcium = ratedTotal(day, "calciumMg", "calcium", settings);
  const vitaminD = ratedTotal(day, "vitaminDUg", "vitaminD", settings);
  const sodium = ratedTotal(day, "sodiumMg", "sodium", settings);
  if (calcium !== null) facts.calciumDayMg = fact(calcium, atMs);
  if (vitaminD !== null) facts.vitaminDDayUg = fact(vitaminD, atMs);
  if (sodium !== null) facts.sodiumDayMg = fact(sodium, atMs);
  return facts;
}

/**
 * The value a nutrition check rates: the day's total when every meal has a value; otherwise the
 * "at least" total only when its band is already certain, i.e. it is in the check's top band,
 * which more intake cannot leave (owner decision). Null otherwise.
 */
function ratedTotal(
  day: NutritionDay, nutrient: Nutrient, check: NutritionCheck, settings: RuleSettings,
  toBandValue: (total: number) => number | null = (total) => total,
): number | null {
  const known = knownTotal(day, nutrient);
  if (known !== null) return toBandValue(known);
  const { atLeast, unknownMeals } = day.totals[nutrient];
  if (unknownMeals === 0) return null;
  const lowerBound = toBandValue(atLeast);
  return lowerBound !== null && inTopBand(lowerBound, NUTRITION_CHECK_SPECS[check], settings) ? lowerBound : null;
}

/** Whether `value` is in the highest band of the check (🔴 above, or 🟡 above where NASA gives no red). */
function inTopBand(value: number, spec: NutritionCheckSpec, settings: RuleSettings): boolean {
  const topEdge = settings[spec.alertAbove ?? spec.watchAbove];
  if (topEdge === null) return false;
  return spec.alertAbove !== null && spec.alertAboveIncludesEdge ? value >= topEdge : value > topEdge;
}

/**
 * Yesterday's protein in grams per kg of body mass, for the Req. 2 minimum. With unknown meals,
 * only an "at least" amount already at the minimum is certain (more intake cannot fall below it).
 */
function proteinMinimumFacts(day: NutritionDay, profile: AstronautProfile, settings: RuleSettings, atMs: number): FactValues {
  const needs = settingsOf("proteinDayGPerKg", settings);
  if (!needs || profile.massKg === null || day.mealsLogged === 0) return {};
  const { atLeast, unknownMeals } = day.totals.proteinG;
  const perKg = atLeast / profile.massKg;
  if (unknownMeals > 0 && perKg < needs["nutrition.proteinGPerKg"]) return {};
  return {
    proteinDayGPerKg: fact(perKg, atMs),
    proteinDayG: fact(atLeast, atMs),
    proteinMinimumG: fact(needs["nutrition.proteinGPerKg"] * profile.massKg, atMs),
  };
}
