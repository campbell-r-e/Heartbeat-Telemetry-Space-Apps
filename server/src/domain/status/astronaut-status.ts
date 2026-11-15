// The status use case behind GET /api/astronauts/:id/status: loads what the rules need through
// the storage ports, computes facts and derived values, and runs the one rules engine.
import {
  NUTRITION_CHECKS, SHIP_ID, type Astronaut, type AstronautStatus, type DerivedValues, type LatestReading, type Metric,
  type ChartReference, type MetricReferenceLines, type MissionDose, type NutritionCheck, type NutritionDayStatus, type Status,
} from "@heartbeat/shared";
import { missionStartDayMs, sleepDayTimeZoneOf } from "../mission.ts";
import type { AstronautStore, CheckInStore, FoodStore, MealStore, MissionStore, ReadingStore, StatusLogStore } from "../ports.ts";
import { readByRules } from "../rule-sources.ts";
import { evaluateRules } from "../rules/engine.ts";
import { NUTRITION_CHECK_SPECS } from "../rules/nutrition-checks.ts";
import type { FactId, FactValues, ProfileField } from "../rules/facts.ts";
import type { RuleBook } from "../rules/rule-book.ts";
import type { RuleSettings } from "../rules/settings.ts";
import { startOfUtcDay, utcDayLabel } from "../time.ts";
import { computeFacts, inputWindows, yesterdayStartMs, type MetricReadings, type StatusInputs } from "./compute-facts.ts";
import { exerciseThresholdBpm } from "../exercise-intensity.ts";
import { withoutExpiredReadings } from "./freshness.ts";
import { nutritionDay, nutritionTargets, type AstronautProfile } from "./nutrition.ts";
import { doseEquivalentMSv } from "./radiation-dose.ts";
import { toTimedValue, type TimedValue } from "./timed-values.ts";
import { referenceLines } from "./reference-lines.ts";
import { markGroundRelay, statesToStore, statusChanges, subjectStates, type NewStatusChange } from "./status-log.ts";
import { unratedReason } from "./unrated-reasons.ts";

export interface StatusStores {
  readings: ReadingStore;
  checkIns: CheckInStore;
  meals: MealStore;
  foods: FoodStore;
  mission: MissionStore;
}

const PROFILE_FIELDS: readonly ProfileField[] = ["age", "sex", "massKg", "heightM"];


/** Told about every logged evaluation, with the changes it logged (the relay, SPEC §6.1). */
export interface StatusListener {
  statusEvaluated(status: AstronautStatus, changes: readonly NewStatusChange[]): Promise<void>;
}

/**
 * Evaluates the status, records any change of it in the alert log (SPEC §6.7) and tells the listener.
 * When `signal` has aborted by the time the status is computed (its queue gave up on it), nothing
 * is logged or told: a late evaluation must not log an older status after a newer one.
 */
export async function evaluateAndLogStatus(
  stores: StatusStores & { statusLog: StatusLogStore }, ruleBook: RuleBook, astronaut: Astronaut, nowMs: number,
  listener: StatusListener, signal?: AbortSignal,
): Promise<AstronautStatus> {
  const status = await astronautStatus(stores, ruleBook, astronaut, nowMs);
  signal?.throwIfAborted();
  const current = subjectStates(status);
  const changes = await stores.statusLog.update(astronaut.id, (previous, crewPrevious) => ({
    ...markGroundRelay(statusChanges(astronaut.id, status.at, previous, current), crewPrevious),
    states: statesToStore(current),
  }));
  await listener.statusEvaluated(status, changes);
  return status;
}

/** The chart reference lines for each metric, from the same inputs and facts as the status. */
export async function astronautReferenceLines(
  stores: StatusStores, ruleBook: RuleBook, astronaut: Astronaut, nowMs: number,
): Promise<MetricReferenceLines[]> {
  const loaded = await loadStatusInputs(stores, astronaut, ruleBook, nowMs);
  const { inputs } = withoutExpiredReadings(loaded, ruleBook.maxReadingAgeMinutes);
  return referenceLines(inputs, computeFacts(inputs, ruleBook.settings), ruleBook);
}

/** The ship, rated like an astronaut with no profile, for the ship's own charts. */
const SHIP_AS_SUBJECT: Astronaut = { id: SHIP_ID, name: "Ship", watchId: null, age: null, sex: null, massKg: null, heightM: null };

/**
 * One chart's reference (band and lines) for an astronaut's or the ship's metric; null when the
 * metric has none or the id is unknown.
 */
export async function chartReference(
  stores: StatusStores & { astronauts: AstronautStore }, ruleBook: RuleBook, id: string, metric: Metric, nowMs: number,
): Promise<ChartReference | null> {
  const subject = id === SHIP_ID ? SHIP_AS_SUBJECT : await stores.astronauts.find(id);
  if (!subject) return null;
  const forMetric = (await astronautReferenceLines(stores, ruleBook, subject, nowMs)).find((lines) => lines.metric === metric);
  if (!forMetric) return null;
  const { band, thresholds, basis } = forMetric;
  return { band, thresholds, basis };
}

export async function astronautStatus(
  stores: StatusStores, ruleBook: RuleBook, astronaut: Astronaut, nowMs: number,
): Promise<AstronautStatus> {
  const loaded = await loadStatusInputs(stores, astronaut, ruleBook, nowMs);
  const { inputs, noRecentData } = withoutExpiredReadings(loaded, ruleBook.maxReadingAgeMinutes);
  const computed = computeFacts(inputs, ruleBook.settings);
  const missingProfile = PROFILE_FIELDS.filter((field) => astronaut[field] === null);
  const verdict = evaluateRules(ruleBook.rules, ruleBook.settings, computed, astronaut.id, missingProfile);
  const checkStatus = (check: NutritionCheck): Status | null => {
    const spec = NUTRITION_CHECK_SPECS[check];
    const ratedBy = new Set<FactId>([spec.fact, ...spec.alsoRatedBy]);
    const rules = ruleBook.rules.filter((rule) => rule.when.some((condition) => ratedBy.has(condition.fact)));
    return evaluateRules(rules, ruleBook.settings, computed, astronaut.id, missingProfile).overall;
  };
  const derived = derivedValues(computed, inputs, ruleBook.settings, checkStatus);
  const context = { inputs, rules: ruleBook.rules, settings: ruleBook.settings, noRecentData, missingProfile, nutritionYesterday: derived.nutritionYesterday };
  return {
    astronautId: astronaut.id,
    at: new Date(nowMs).toISOString(),
    ...verdict,
    areas: verdict.areas.map((a) => ({ ...a, reason: a.status === null ? unratedReason(a.area, context) : null })),
    noRecentData,
    derived,
  };
}

/**
 * Loads the ship's readings and the astronaut's own real readings over the windows the settings
 * need, plus check-ins, the meals since the start of yesterday and the menu.
 */
export async function loadStatusInputs(
  stores: StatusStores, astronaut: Astronaut, ruleBook: RuleBook, nowMs: number,
): Promise<StatusInputs> {
  const windows = inputWindows(ruleBook.settings, ruleBook.maxReadingAgeMinutes, nowMs);
  const series = async (id: string, metric: Metric, lookbackMs: number | null) =>
    stores.readings.series(id, metric, { fromMs: lookbackMs === null ? null : nowMs - lookbackMs, toMs: nowMs, bucketMinutes: null });
  const [ship, own, latest, checkIns, meals, menu, mission] = await Promise.all([
    loadEach(windows.ship, async (metric, lookbackMs) => (await series(SHIP_ID, metric, lookbackMs)).map(toTimedValue)),
    loadEach(windows.astronaut, async (metric, lookbackMs) => readByRules(metric, await series(astronaut.id, metric, lookbackMs))),
    stores.readings.latestReadByRules(astronaut.id, nowMs).then(latestNumbers),
    windows.checkInsMs === null ? [] : stores.checkIns.between(astronaut.id, nowMs - windows.checkInsMs, nowMs),
    stores.meals.between(astronaut.id, yesterdayStartMs(nowMs), nowMs),
    stores.foods.menu(),
    stores.mission.get(),
  ]);
  const missionStartMs = mission === null ? null : missionStartDayMs(mission.startDate);
  return { nowMs, profile: profileOf(astronaut), missionStartMs, sleepDayTimeZone: sleepDayTimeZoneOf(mission), ship, astronaut: own, latest, checkIns, meals, foods: menu.foods };
}

function profileOf({ age, sex, massKg, heightM }: Astronaut): AstronautProfile {
  return { age, sex, massKg, heightM };
}

/** Reads each metric's readings over its lookback. */
async function loadEach(
  lookbacks: Partial<Record<Metric, number | null>>,
  read: (metric: Metric, lookbackMs: number | null) => Promise<TimedValue[]>,
): Promise<MetricReadings> {
  const entries = await Promise.all(Object.entries(lookbacks).map(async ([metric, lookbackMs]) =>
    [metric, await read(metric as Metric, lookbackMs ?? null)] as const));
  return Object.fromEntries(entries);
}

function latestNumbers(latest: readonly LatestReading[]): Partial<Record<Metric, TimedValue>> {
  return Object.fromEntries(latest.flatMap((r) =>
    typeof r.value === "number" ? [[r.metric, { tMs: Date.parse(r.takenAt), value: r.value }]] : []));
}

/**
 * Values clients show as-is (SPEC §5.4, §5.5, §5.7): latest HRV, today's exercise minutes, the
 * radiation multiple, and nutrition today (unrated) and yesterday (rated), taken from the same
 * facts the rules read.
 */
export function derivedValues(
  facts: FactValues, inputs: StatusInputs, settings: RuleSettings, checkStatus: (check: NutritionCheck) => Status | null,
): DerivedValues {
  const { nowMs, profile } = inputs;
  const hrv = inputs.latest.hrv;
  const multiple = facts.radiationDailyDoseMultiple;
  const dailyDose = facts.radiationDailyDoseUGy;
  const previousAverage = facts.radiationPreviousAverageUGy;
  const targets = nutritionTargets(profile, settings);
  const perAbsorbed = settings["radiation.doseEquivalentPerAbsorbedDose"];
  const asDoseEquivalent = (absorbedUGy: number) => (perAbsorbed === null ? null : doseEquivalentMSv(absorbedUGy, perAbsorbed));
  const statuses =(rate: (check: NutritionCheck) => Status | null) =>
    Object.fromEntries(NUTRITION_CHECKS.map((check) => [check, rate(check)])) as NutritionDayStatus["statuses"];
  return {
    hrv: hrv ? { rmssdMs: hrv.value, at: new Date(hrv.tMs).toISOString() } : null,
    exerciseToday: {
      day: utcDayLabel(nowMs),
      minutes: facts.exerciseMinutesToday?.value ?? null,
      goalMinutes: settings["exercise.dailyGoalMinutes"],
      thresholdBpm: exerciseThresholdBpm(profile.age, settings),
    },
    radiationDailyDose: multiple && dailyDose && previousAverage ? {
      dailyDoseUGy: dailyDose.value,
      previousSevenDayAverageUGy: previousAverage.value,
      multiple: multiple.value,
      dailyDoseMSv: asDoseEquivalent(dailyDose.value),
      previousSevenDayAverageMSv: asDoseEquivalent(previousAverage.value),
      at: new Date(multiple.atMs).toISOString(),
    } : null,
    missionDose: missionDose(facts, settings),
    nutritionToday: {
      ...nutritionDay(inputs.meals, inputs.foods, startOfUtcDay(nowMs), false), targets, statuses: statuses(() => null),
    },
    nutritionYesterday: {
      ...nutritionDay(inputs.meals, inputs.foods, yesterdayStartMs(nowMs), true), targets, statuses: statuses(checkStatus),
    },
  };
}

/** The career-dose facts in mSv, so clients show the mission dose without computing it. */
function missionDose(facts: FactValues, settings: RuleSettings): MissionDose | null {
  const dose = facts.radiationCareerDoseMSv;
  const share = facts.radiationCareerFraction;
  const projectedShare = facts.radiationProjectedCareerFraction;
  const limitMSv = settings["radiation.careerLimitMSv"];
  const plannedMissionDays = settings["mission.plannedLengthDays"];
  if (!dose || !share || !projectedShare || limitMSv === null || plannedMissionDays === null) return null;
  return {
    mSv: dose.value,
    careerLimitMSv: limitMSv,
    shareOfCareerLimit: share.value,
    projectedMSv: projectedShare.value * limitMSv,
    projectedShareOfCareerLimit: projectedShare.value,
    projectionDays: plannedMissionDays,
    at: new Date(dose.atMs).toISOString(),
  };
}
