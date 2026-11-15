// Why an area has no status, in plain language for the "No status" cards (owner decision). Every
// number comes from the settings or the data; the text only explains what is missing.
import type { Area, Metric, NutritionDay } from "@heartbeat/shared";
import { ruleMetrics } from "../rules/engine.ts";
import type { ProfileField } from "../rules/facts.ts";
import type { Rule } from "../rules/rule.ts";
import type { RuleSettings } from "../rules/settings.ts";
import { DAY_MS, hourOfUtcDay } from "../time.ts";
import { distinctDays } from "./baseline.ts";
import { BASELINE_METRICS, type BaselineMetric, type StatusInputs } from "./compute-facts.ts";
import { exerciseThresholdBpm } from "../exercise-intensity.ts";
import { exerciseMinutesSoFar, hasHeartRateToday } from "./exercise.ts";
import { PREVIOUS_DAYS } from "./radiation-dose.ts";
import { sampleStandardDeviation } from "./timed-values.ts";

/** What the reasons are worked out from. */
export interface UnratedContext {
  inputs: StatusInputs;
  /** The rules, so an area's metrics are the ones its rules read. */
  rules: readonly Rule[];
  settings: RuleSettings;
  noRecentData: readonly Metric[];
  missingProfile: readonly ProfileField[];
  /** Yesterday's nutrition, the day the Nutrition area is rated on. */
  nutritionYesterday: NutritionDay;
}

const METRIC_NAMES: Partial<Record<Metric, string>> = {
  heartRate: "heart rate", skinTemp: "skin temperature", hrv: "HRV", spo2: "blood oxygen",
  radiationDoseRate: "radiation", co2: "CO₂", cabinTemp: "cabin temperature", humidity: "humidity",
  pressure: "pressure", noise: "noise",
};
const PROFILE_NAMES: Record<ProfileField, string> = { age: "age", sex: "sex", massKg: "body mass", heightM: "height" };
const NOT_ENOUGH_DATA = "Not enough data yet";

export function unratedReason(area: Area, context: UnratedContext): string {
  const reasons = REASONS[area](context).filter((reason): reason is string => reason !== null);
  return reasons.length > 0 ? reasons.join("; ") : NOT_ENOUGH_DATA;
}

const REASONS: Record<Area, (context: UnratedContext) => Array<string | null>> = {
  vitals: (c) => [expired(c, "vitals"), baselineProgress(c, BASELINE_METRICS, "Baseline")],
  radiation: (c) => [expired(c, "radiation") ?? `Not enough radiation readings yet for the ${PREVIOUS_DAYS + 1}-day comparison`],
  gravity: (c) => [missingProfile(c, ["age"]) ?? exerciseProgress(c)],
  cabin: (c) => [expired(c, "cabin")],
  nutrition: (c) => [missingProfile(c, ["age", "sex", "massKg", "heightM"]), nutritionDayReason(c.nutritionYesterday)],
  // Mind's baseline rules read HRV only, so its progress is HRV's (owner decision).
  mind: (c) => [checkInProgress(c), expired(c, "mind"), baselineProgress(c, ["hrv"], "HRV baseline")],
};

/** The metrics an area's rules read, from the rule book. */
function areaMetrics(rules: readonly Rule[], area: Area): Metric[] {
  return [...new Set(rules.filter((rule) => rule.area === area).flatMap(ruleMetrics))];
}

function expired({ noRecentData, rules }: UnratedContext, area: Area): string | null {
  const names = areaMetrics(rules, area).filter((metric) => noRecentData.includes(metric)).map((metric) => METRIC_NAMES[metric] ?? metric);
  return names.length === 0 ? null : `No recent ${listOf(names)} readings`;
}

function missingProfile({ missingProfile: missing }: UnratedContext, needed: readonly ProfileField[]): string | null {
  const names = needed.filter((field) => missing.includes(field)).map((field) => PROFILE_NAMES[field]);
  return names.length === 0 ? null : `Needs the astronaut's ${listOf(names)}`;
}

/**
 * Progress toward the personal baseline of `metrics` (the readings the rules read), from the one
 * with the most days of readings; `name` starts the sentence ("Baseline", "HRV baseline").
 */
function baselineProgress({ inputs, settings }: UnratedContext, metrics: readonly BaselineMetric[], name: string): string | null {
  const needed = settings["baseline.minimumDistinctDays"];
  const windowDays = settings["baseline.windowDays"];
  if (needed === null || windowDays === null) return null;
  const windowStartMs = inputs.nowMs - windowDays * DAY_MS;
  const histories = metrics.map((metric) => inputs.astronaut[metric] ?? []);
  const days = Math.max(0, ...histories.map((history) => distinctDays(history, windowStartMs, inputs.nowMs)));
  if (days < needed) return `${name} needs readings on ${needed} days (${days} so far)`;
  const ready = histories.filter((history) => distinctDays(history, windowStartMs, inputs.nowMs) >= needed);
  const noSpread = ready.every((history) => sampleStandardDeviation(history.filter((r) => r.tMs >= windowStartMs).map((r) => r.value)) === 0);
  return noSpread ? `${name} readings do not vary yet, so there is no normal range to compare with` : null;
}

function checkInProgress({ inputs, settings }: UnratedContext): string | null {
  const needed = settings["mind.minimumCheckIns"];
  const days = settings["mind.windowDays"];
  if (needed === null || days === null || inputs.checkIns.length >= needed) return null;
  return `Needs ${needed} mood check-ins in the last ${days} days (${inputs.checkIns.length} so far)`;
}

/**
 * Gravity is unrated while no gravity rule fires: before the check hour short of the goal, and
 * after it between the watch level and the goal (on pace). Says how far today's exercise is.
 */
function exerciseProgress({ inputs, settings }: UnratedContext): string {
  const heartRates = inputs.astronaut.heartRate ?? [];
  if (!hasHeartRateToday(heartRates, inputs.nowMs)) return "No watch data today";
  const minutes = exerciseMinutesSoFar(heartRates, exerciseThresholdBpm(inputs.profile.age, settings), inputs.nowMs);
  const goal = settings["exercise.dailyGoalMinutes"];
  const fromHour = settings["gravity.exerciseCheckFromHourUtc"];
  const soFar = `Exercise ${minutes} of ${goal} min today`;
  if (fromHour === null || hourOfUtcDay(inputs.nowMs) >= fromHour) return `${soFar} — on pace`;
  return `${soFar}; rated from ${String(fromHour).padStart(2, "0")}:00 UTC`;
}

function nutritionDayReason(day: NutritionDay): string | null {
  if (day.mealsLogged === 0) return "No meals logged yesterday";
  const unknown = Object.values(day.totals).some((total) => total.unknownMeals > 0);
  return unknown ? "Some of yesterday's meals have no value for a nutrient" : null;
}

/** "a", "a and b", "a, b and c". */
function listOf(names: readonly string[]): string {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
