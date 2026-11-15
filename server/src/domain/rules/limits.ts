// Every limit the rules use, in plain language, for the dashboard's "Limits in use" list (SPEC
// §10, GET /api/settings). Each limit belongs to a rule: its area, source and status come from that
// rule, its number from a setting the rule reads, and, for a threshold, its wording from the
// rule's status and the comparison it makes with that setting. Labels never repeat the number;
// clients show the label, then the value and unit.
import { AREAS, CHECK_IN_SCALE, type AreaLimit, type NutritionCheck, type Status } from "@heartbeat/shared";
import { MAX_HEART_RATE_AGE_BASE } from "../exercise-intensity.ts";
import { utcClockLabel } from "../time.ts";
import { ruleSettingKeys } from "./engine.ts";
import { NUTRITION_CHECK_SPECS } from "./nutrition-checks.ts";
import type { Comparison, Rule } from "./rule.ts";
import type { RuleSettings, SettingKey } from "./settings.ts";

const STATUS_WORDS: Record<Status, string> = { normal: "normal", watch: "watch", alert: "alert" };
const COMPARISON_WORDS: Record<Comparison, string> = { lt: "below", lte: "at or below", gt: "above", gte: "at or above" };

/**
 * A threshold's wording without its number, from the rule that compares the setting: "Watch
 * below", or with a subject "Blood oxygen, watch below". Throws when the rule is missing or does
 * not compare the setting exactly once, so a changed catalog cannot leave a stale label. Chart
 * reference lines and the limits list both word their thresholds here.
 */
export function settingLabel(rules: readonly Rule[], ruleId: string, setting: SettingKey, subject?: string): string {
  const rule = ruleById(rules, ruleId);
  const words = `${STATUS_WORDS[rule.status]} ${COMPARISON_WORDS[comparisonFor(rule, setting)]}`;
  return subject === undefined ? capitalize(words) : `${subject}, ${words}`;
}

/** Text that needs settings of its own (a time of day); null while any of them is unset. */
type SettingsText = string | ((settings: RuleSettings) => string | null);

interface LimitSpecBase {
  /** The rule the limit belongs to: its area, source and status. */
  ruleId: string;
  unit?: string;
  /** Multiplies the setting for display, e.g. 100 for a fraction shown in %. */
  scale?: number;
}

/** A threshold the rule compares with: labeled from the rule's status and comparison. */
interface ThresholdSpec extends LimitSpecBase {
  kind: "threshold";
  setting: SettingKey;
  /** What is compared, e.g. "Blood oxygen"; it leads the label. */
  subject?: SettingsText;
}

/** A goal, a window or another parameter of the rule, labeled in its own words. */
interface ParameterSpec extends LimitSpecBase {
  kind: "parameter";
  label: SettingsText;
  /** A setting the rule reads; none for a limit without a single number. */
  value?: SettingKey;
  /** True when crossing it gives the rule's status (or meets its goal); false for a window or a count. */
  rated: boolean;
}

type LimitSpec = ThresholdSpec | ParameterSpec;

const threshold = (ruleId: string, setting: SettingKey, unit: string, subject?: SettingsText): ThresholdSpec =>
  ({ kind: "threshold", ruleId, setting, unit, subject });
const parameter = (ruleId: string, label: SettingsText, rated: boolean, value?: SettingKey, unit?: string): ParameterSpec =>
  ({ kind: "parameter", ruleId, label, rated, value, unit });

const hours = (start: SettingKey, end: SettingKey) => (settings: RuleSettings) => {
  const [from, to] = [settings[start], settings[end]];
  return from === null || to === null ? null : `${utcClockLabel(from)}–${utcClockLabel(to)} UTC`;
};

const VITALS: readonly LimitSpec[] = [
  threshold("spo2-watch", "spo2.watchBelowPct", "%", "Blood oxygen"),
  threshold("spo2-alert", "spo2.alertBelowPct", "%", "Blood oxygen"),
  threshold("heart-rate-low-alert", "heartRate.alertBelowBpm", "bpm", "Heart rate"),
  threshold("heart-rate-high-alert", "heartRate.alertAboveBpm", "bpm", "Heart rate"),
  parameter("heart-rate-above-baseline-watch", "Watch beyond your personal baseline by more than", true, "baseline.watchBeyondSd", "SD"),
  parameter("heart-rate-above-baseline-alert", "Alert beyond your personal baseline by more than", true, "baseline.alertBeyondSd", "SD"),
  parameter("heart-rate-above-baseline-watch", "Personal baseline from your readings of the last", false, "baseline.windowDays", "days"),
  parameter("heart-rate-above-baseline-watch", "Personal baseline once readings fall on at least", false, "baseline.minimumDistinctDays", "days"),
];

const RADIATION: readonly LimitSpec[] = [
  threshold("radiation-solar-event-watch", "radiation.solarEventWatchMultiple", "× the previous 7-day average", "Daily dose"),
  threshold("radiation-solar-event-alert", "radiation.solarEventAlertMultiple", "× the previous 7-day average", "Daily dose"),
  parameter("radiation-career-alert", "Career limit", false, "radiation.careerLimitMSv", "mSv"),
  { ...threshold("radiation-career-watch", "radiation.careerWatchFraction", "% of the career limit", "Career dose"), scale: 100 },
  { ...parameter("radiation-career-alert", "Alert when projected to reach", true, "radiation.careerAlertProjectedFraction", "% of the career limit"), scale: 100 },
  parameter("radiation-career-alert", "Projected over a mission of", false, "mission.plannedLengthDays", "days"),
  parameter("radiation-career-watch", "Dose equivalent (estimate) per absorbed dose", false, "radiation.doseEquivalentPerAbsorbedDose", "mSv/mGy"),
];

const GRAVITY: readonly LimitSpec[] = [
  parameter("gravity-exercise-goal-met", "Daily exercise goal", true, "exercise.dailyGoalMinutes", "min"),
  threshold("gravity-exercise-watch", "gravity.exerciseWatchBelowMinutes", "min", (settings) => {
    const fromHour = settings["gravity.exerciseCheckFromHourUtc"];
    return fromHour === null ? null : `Exercise today, from ${utcClockLabel(fromHour)} UTC`;
  }),
  {
    ...parameter("gravity-exercise-goal-met", "An exercise minute has heart rate at or above", false, "exercise.moderateIntensityFraction",
      `% of max heart rate (${MAX_HEART_RATE_AGE_BASE} − age)`),
    scale: 100,
  },
];

const CABIN: readonly LimitSpec[] = [
  threshold("co2-one-hour-watch", "co2.oneHourWatchFromMmHg", "mmHg", "CO₂ 1-hour average"),
  threshold("co2-one-hour-alert", "co2.oneHourAlertAboveMmHg", "mmHg", "CO₂ 1-hour average"),
  threshold("co2-seven-day-watch", "co2.sevenDayWatchFromMmHg", "mmHg", "CO₂ 7-day average"),
  threshold("pressure-low-alert", "pressure.minExclusiveKPa", "kPa", "Cabin pressure"),
  threshold("pressure-high-alert", "pressure.maxKPa", "kPa", "Cabin pressure"),
  threshold("pressure-shift-watch", "pressure.watchShiftFromDayAverageKPa", "kPa", "Pressure shift from the watch's 24-hour average"),
  parameter("cabin-comfort-zone-watch", "Temperature and humidity, watch outside NASA's zone", true),
  parameter("cabin-comfort-zone-alert", "Temperature, alert outside the zone by more than", true, "cabinZone.alertMarginC", "°C"),
  parameter("cabin-comfort-zone-alert", "Humidity, alert outside the zone by more than", true, "cabinZone.alertMarginRhPct", "% RH"),
  threshold("noise-sleep-watch", "noise.sleepWatchAboveDba", "dBA", (settings) => {
    const period = hours("noise.sleepStartHourUtc", "noise.sleepEndHourUtc")(settings);
    return period === null ? null : `Noise in the sleep period (${period})`;
  }),
  threshold("noise-awake-watch", "noise.awakeWatchAboveDba", "dBA", "Noise while awake"),
  threshold("noise-day-alert", "noise.dayAlertAboveDba", "dBA", "Noise, 24-hour average"),
];

/** Each nutrient's bands, as its rules compare them (rules generated from NUTRITION_CHECK_SPECS). */
const NUTRIENT_SUBJECTS: Record<NutritionCheck, { subject: string; unit: string }> = {
  energy: { subject: "Energy", unit: "% of energy need (EER)" },
  protein: { subject: "Protein share", unit: "% of calories" },
  calcium: { subject: "Calcium", unit: "mg" },
  vitaminD: { subject: "Vitamin D", unit: "µg" },
  sodium: { subject: "Sodium", unit: "mg" },
};

function nutrientLimits(check: NutritionCheck): LimitSpec[] {
  const spec = NUTRITION_CHECK_SPECS[check];
  const { subject, unit } = NUTRIENT_SUBJECTS[check];
  const band = (side: string, setting: SettingKey) => threshold(`nutrition-${check}-${side}`, setting, unit, subject);
  return [
    band("low-alert", spec.alertBelow),
    band("low-watch", spec.watchBelow),
    band("high-watch", spec.watchAbove),
    ...(spec.alertAbove === null ? [] : [band("high-alert", spec.alertAbove)]),
  ];
}

const NUTRITION: readonly LimitSpec[] = [
  ...(Object.keys(NUTRITION_CHECK_SPECS) as NutritionCheck[]).flatMap(nutrientLimits),
  threshold("nutrition-protein-minimum-watch", "nutrition.proteinGPerKg", "g per kg of body mass", "Protein"),
];

const scaleUnit = `on the ${CHECK_IN_SCALE.min}–${CHECK_IN_SCALE.max} scale`;

const MIND: readonly LimitSpec[] = [
  parameter("behavioral-health-watch", "Low mood: mood check-ins average at or below", false, "mind.lowMoodAverageAtOrBelow", scaleUnit),
  parameter("behavioral-health-alert", "Alert when stress check-ins also average at or above", true, "mind.highStressAverageAtOrAbove", scaleUnit),
  parameter("behavioral-health-watch", "Check-ins averaged over the last", false, "mind.windowDays", "days"),
  parameter("behavioral-health-watch", "Check-ins needed for an average", false, "mind.minimumCheckIns"),
  parameter("behavioral-health-watch", "HRV below your personal baseline by more than", false, "baseline.watchBeyondSd", "SD"),
  parameter("behavioral-health-watch", "Short sleep: nights in a row", false, "sleep.shortNightsInARow"),
  parameter("behavioral-health-watch", "A short night has sleep under", false, "sleep.shortNightHours", "h"),
];

export const LIMIT_SPECS: readonly LimitSpec[] = [...VITALS, ...RADIATION, ...GRAVITY, ...CABIN, ...NUTRITION, ...MIND];

/**
 * The limits in use, grouped by area in AREAS order. A limit whose setting is unset is left out
 * (its rule is listed as pending instead). Throws when a spec names an unknown rule, a threshold
 * setting its rule does not compare exactly once, or a parameter setting its rule does not read,
 * so a changed catalog cannot silently mislabel a limit.
 */
export function areaLimits(rules: readonly Rule[], settings: RuleSettings): AreaLimit[] {
  const limits = LIMIT_SPECS.flatMap((spec) => {
    const limit = spec.kind === "threshold" ? resolveThreshold(spec, rules, settings) : resolveParameter(spec, rules, settings);
    return limit === null ? [] : [limit];
  });
  return AREAS.flatMap((area) => limits.filter((limit) => limit.area === area));
}

function resolveThreshold(spec: ThresholdSpec, rules: readonly Rule[], settings: RuleSettings): AreaLimit | null {
  const rule = ruleById(rules, spec.ruleId);
  const value = settings[spec.setting];
  const subject = spec.subject === undefined ? undefined : textOf(spec.subject, settings);
  if (value === null || subject === null) return null;
  const label = settingLabel(rules, spec.ruleId, spec.setting, subject);
  return { area: rule.area, label, value: scaled(spec, value), unit: spec.unit, status: rule.status, source: rule.source };
}

function resolveParameter(spec: ParameterSpec, rules: readonly Rule[], settings: RuleSettings): AreaLimit | null {
  const rule = ruleById(rules, spec.ruleId);
  if (spec.value !== undefined && !ruleSettingKeys(rule).includes(spec.value)) {
    throw new Error(`rule ${rule.id} does not read ${spec.value}; a limit's setting must be one its rule reads`);
  }
  const label = textOf(spec.label, settings);
  const value = spec.value === undefined ? undefined : settings[spec.value];
  if (label === null || value === null) return null;
  const base = { area: rule.area, label, status: spec.rated ? rule.status : null, source: rule.source };
  if (value === undefined) return base;
  return { ...base, value: scaled(spec, value), ...(spec.unit === undefined ? {} : { unit: spec.unit }) };
}

function scaled(spec: LimitSpecBase, value: number): number {
  return roundForDisplay(value * (spec.scale ?? 1));
}

function textOf(text: SettingsText, settings: RuleSettings): string | null {
  return typeof text === "function" ? text(settings) : text;
}

function ruleById(rules: readonly Rule[], id: string): Rule {
  const rule = rules.find((r) => r.id === id);
  if (!rule) throw new Error(`limit names unknown rule ${id}`);
  return rule;
}

/** The comparison the rule makes with the setting; exactly one condition may name it. */
function comparisonFor(rule: Rule, setting: SettingKey): Comparison {
  const ops = rule.when.flatMap((condition) => ("setting" in condition && condition.setting === setting ? [condition.op] : []));
  if (ops.length !== 1) throw new Error(`rule ${rule.id} compares ${setting} ${ops.length} times; a limit needs exactly one`);
  return ops[0];
}

/** Drops floating-point noise from scaling (0.64 × 100 is 64.00000000000001). */
function roundForDisplay(value: number): number {
  return Number(value.toPrecision(12));
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
