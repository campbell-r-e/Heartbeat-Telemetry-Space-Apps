// The numbers each area shows: one headline (the card's main value) plus secondary readings
// (card sub-lines and detail-page key numbers), built from data for both views. Every number is
// a server value: a stored reading, a check-in, or the rules engine's derived values and the
// mission settings. Nothing is computed or typed in here; a value the server does not provide is
// an explicit "pending" readout with the reason.

import { NUTRIENTS, READING_SOURCE_LABELS, type Area, type CheckIn, type DerivedValues, type MissionDose, type MissionResponse, type Nutrient } from "@heartbeat/shared";
import { SCORE_MAX, latestCheckIn } from "./checkin";
import { NO_VALUE, PERCENT, formatNumber, formatUtcClock, formatUtcDateTime } from "./format";
import { startOfUtcDay } from "./time";
import { METRIC_DISPLAY, formatReadingNumber, unitText, type LatestIndex, type ShownMetric } from "./metrics";
import { nutrientDisplay } from "./nutrition";

export interface Readout {
  label: string;
  /** Formatted number, or NO_VALUE. */
  value: string;
  unit: string;
  /** Why there is no value, or a qualifier such as "at least". */
  note?: string;
  /** The card sub-line, when it is not just the label, value and unit. */
  line?: string;
}

export interface AreaReadouts {
  headline: Readout;
  details: Readout[];
  /** When and where the headline value was recorded, if it exists. */
  provenance: string | null;
}

export interface AreaSnapshot {
  latest: LatestIndex;
  checkIns: readonly CheckIn[];
  /** The rules engine's derived values, or null when the status could not be loaded. */
  derived: DerivedValues | null;
  mission: MissionResponse;
  /** The request's time, to tell today's readings from older ones. */
  nowMs: number;
}

const NO_READING = "No reading yet";
/** Why a value is missing when the rules engine status could not be loaded. */
export const NO_STATUS = "Needs the rules engine status";
/** Why the career dose is missing when the status loaded but has no missionDose. */
export const NO_CAREER_DOSE = "Needs the career-dose settings and radiation readings";
const NO_EXERCISE_COUNT = "Needs today's heart rate and the astronaut's age";
const NO_GOAL = "Exercise goal not set on the onboard server";
const NOT_ENOUGH_RADIATION = "Not enough recent radiation data yet";
const MULTIPLE_DECIMALS = 2;
const DOSE_DECIMALS = 1;
const ABSORBED_DECIMALS = 0;
const DAILY_DOSE_DECIMALS = 2;
const NO_CONVERSION = "Dose-equivalent setting not set";

/** A dose in mSv as shown everywhere in the app. */
export const formatDose = (mSv: number): string => formatNumber(mSv, DOSE_DECIMALS);

/** A 0–1 share as a percentage number ("4.7"). */
export const formatShare = (share: number): string => formatNumber(share * PERCENT, DOSE_DECIMALS);

function pendingReadout(label: string, unit: string, note: string): Readout {
  return { label, value: NO_VALUE, unit, note };
}

function metricReadout(snapshot: AreaSnapshot, metric: ShownMetric, label = METRIC_DISPLAY[metric].label): Readout {
  const reading = snapshot.latest.get(metric);
  const value = formatReadingNumber(metric, reading);
  return { label, value, unit: reading ? unitText(reading.unit) : "", note: value === NO_VALUE ? NO_READING : undefined };
}

function metricProvenance(snapshot: AreaSnapshot, metric: ShownMetric): string | null {
  const reading = snapshot.latest.get(metric);
  return reading ? `${formatUtcDateTime(reading.takenAt)} · ${READING_SOURCE_LABELS[reading.source]}` : null;
}

/**
 * The Samsung ECG tracker's sample rate (SPEC §5.1, watch/README.md), so a stored recording's
 * length can be shown as the watch shows it ("30 s"). The ECG is never analyzed or classified.
 */
export const ECG_SAMPLE_RATE_HZ = 500;

/** "taken 14:06 UTC" today (UTC), "taken Nov 14 · 20:05 UTC" before. */
function takenText(takenAt: string, nowMs: number): string {
  const sameUtcDay = startOfUtcDay(Date.parse(takenAt)) === startOfUtcDay(nowMs);
  return `taken ${sameUtcDay ? `${formatUtcClock(takenAt)} UTC` : formatUtcDateTime(takenAt)}`;
}

/**
 * The last ECG: when it was taken and its result as the watch shows it, the length of the raw
 * recording (owner decision: no waveform, no classification). The card line reads
 * "ECG · taken 14:06 UTC · 30 s recording".
 */
function ecgReadout(snapshot: AreaSnapshot): Readout {
  const ecg = snapshot.latest.get("ecg");
  if (!ecg) return pendingReadout("ECG", "", NO_READING);
  const taken = takenText(ecg.takenAt, snapshot.nowMs);
  const seconds = Array.isArray(ecg.value) ? Math.round(ecg.value.length / ECG_SAMPLE_RATE_HZ) : null;
  const result = seconds === null ? null : `${seconds} s recording`;
  const note = [result, READING_SOURCE_LABELS[ecg.source]].filter((part) => part !== null).join(" · ");
  return { label: "ECG", value: taken, unit: "", note, line: ["ECG", taken, result].filter((part) => part !== null).join(" · ") };
}

function vitals(snapshot: AreaSnapshot): AreaReadouts {
  // The card shows the first three: blood oxygen, skin temperature and the ECG (demo step 2).
  return {
    headline: metricReadout(snapshot, "heartRate"),
    details: [metricReadout(snapshot, "spo2", "SpO₂"), metricReadout(snapshot, "skinTemp", "Skin"), ecgReadout(snapshot), metricReadout(snapshot, "hrv", "HRV")],
    provenance: metricProvenance(snapshot, "heartRate"),
  };
}

/** The last 24 hours' dose vs. the previous 7-day average, as the rules engine computed it (decision 4). */
function radiationMultiple(derived: DerivedValues | null): Readout {
  const label = "Times normal";
  const unit = "× the 7-day average";
  if (!derived) return pendingReadout(label, unit, NO_STATUS);
  const dose = derived.radiationDailyDose;
  if (!dose) return pendingReadout(label, unit, NOT_ENOUGH_RADIATION);
  return { label, value: formatNumber(dose.multiple, MULTIPLE_DECIMALS), unit };
}

/**
 * The last 24 hours' dose and the previous 7-day average, as dose equivalent (estimate) in mSv from
 * the server, with the absorbed dose it came from as the secondary line.
 */
function dailyDoseReadouts(derived: DerivedValues | null): [Readout, Readout] {
  const today = { label: "Last 24 h", unit: "mSv (estimate)" };
  const average = { label: "7-day average", unit: "mSv/day (estimate)" };
  const dose = derived?.radiationDailyDose;
  if (!dose) {
    const note = derived ? NOT_ENOUGH_RADIATION : NO_STATUS;
    return [pendingReadout(today.label, today.unit, note), pendingReadout(average.label, average.unit, note)];
  }
  const doseEquivalent = (label: string, unit: string, mSv: number | null, uGy: number, uGyUnit: string): Readout => {
    const absorbed = `${formatNumber(uGy, ABSORBED_DECIMALS)} ${uGyUnit} absorbed`;
    if (mSv === null) return { label, value: NO_VALUE, unit, note: `${NO_CONVERSION}; ${absorbed}` };
    return { label, value: formatNumber(mSv, DAILY_DOSE_DECIMALS), unit, note: absorbed };
  };
  return [
    doseEquivalent(today.label, today.unit, dose.dailyDoseMSv, dose.dailyDoseUGy, "µGy"),
    doseEquivalent(average.label, average.unit, dose.previousSevenDayAverageMSv, dose.previousSevenDayAverageUGy, "µGy/day"),
  ];
}

/** The career dose shown as a dose equivalent (estimate), as the server labels it (SPEC §6.7). */
export const CAREER_DOSE_LABEL = "Career dose equivalent (estimate)";

/** The mission dose from the server's missionDose (decision 5); the career limit is shown in the mission-dose bar. */
function missionDoseReadout(derived: DerivedValues | null): Readout {
  const label = "Mission dose";
  const unit = "mSv dose equivalent (estimate)";
  const dose = derived?.missionDose;
  if (!dose) return pendingReadout(label, unit, derived ? NO_CAREER_DOSE : NO_STATUS);
  return { label, value: formatDose(dose.mSv), unit };
}

function radiation(snapshot: AreaSnapshot): AreaReadouts {
  // The approved mockup's four key numbers (owner decision): times normal, today, 7-day average, mission dose.
  return {
    headline: radiationMultiple(snapshot.derived),
    details: [...dailyDoseReadouts(snapshot.derived), missionDoseReadout(snapshot.derived)],
    provenance: metricProvenance(snapshot, "radiationDoseRate"),
  };
}

/** Exercise minutes today against the server's daily goal (owner: Gravity shows exercise vs. the goal). */
function exerciseReadout(derived: DerivedValues | null): Readout {
  const label = "Exercise today";
  if (!derived) return pendingReadout(label, "min", NO_STATUS);
  const { minutes, goalMinutes } = derived.exerciseToday;
  const unit = goalMinutes === null ? "min" : `/ ${goalMinutes} min`;
  if (minutes === null) return pendingReadout(label, unit, NO_EXERCISE_COUNT);
  return { label, value: String(minutes), unit, note: goalMinutes === null ? NO_GOAL : undefined };
}

function gravity(snapshot: AreaSnapshot): AreaReadouts {
  return {
    headline: exerciseReadout(snapshot.derived),
    details: [{ label: "Gravity", value: snapshot.mission.gravity.label, unit: "" }, metricReadout(snapshot, "bodyComposition", "Skeletal muscle mass")],
    provenance: snapshot.derived ? `Counted from heart rate, ${snapshot.derived.exerciseToday.day} (UTC)` : null,
  };
}

function cabin(snapshot: AreaSnapshot): AreaReadouts {
  return {
    headline: metricReadout(snapshot, "co2"),
    details: [
      metricReadout(snapshot, "cabinTemp", "Temp"),
      metricReadout(snapshot, "humidity"),
      metricReadout(snapshot, "pressure", "Pressure (watch)"),
      metricReadout(snapshot, "noise", "Noise"),
    ],
    provenance: metricProvenance(snapshot, "co2"),
  };
}

/** Today's running totals from the server (derived.nutritionToday, unrated). */
function nutrition(snapshot: AreaSnapshot): AreaReadouts {
  const today = snapshot.derived?.nutritionToday;
  const readout = (key: Nutrient): Readout => {
    const { label, unit, decimals } = nutrientDisplay(key);
    if (!today) return pendingReadout(label, unit, NO_STATUS);
    const total = today.totals[key];
    const note = total.unknownMeals > 0 ? `at least; ${total.unknownMeals} logged item(s) have no value` : undefined;
    return { label, value: formatNumber(total.atLeast, decimals), unit, note };
  };
  return {
    headline: { ...readout("kcal"), unit: "kcal today" },
    details: NUTRIENTS.filter((key) => key !== "kcal").map(readout),
    provenance: today ? `${today.mealsLogged} item(s) logged today (UTC)` : null,
  };
}

function mind(snapshot: AreaSnapshot): AreaReadouts {
  const latest = latestCheckIn(snapshot.checkIns);
  const scoreOf = (label: string, score: number | undefined, unit: string): Readout =>
    score === undefined ? pendingReadout(label, "", "No check-in yet") : { label, value: String(score), unit: `/ ${SCORE_MAX}${unit}` };
  return {
    headline: scoreOf("Mood", latest?.mood, " mood · latest check-in"),
    details: [scoreOf("Stress", latest?.stress, ""), metricReadout(snapshot, "hrv", "HRV"), metricReadout(snapshot, "sleep", "Sleep")],
    provenance: latest ? `Checked in ${formatUtcDateTime(latest.at)}` : null,
  };
}

const BUILDERS: Record<Area, (snapshot: AreaSnapshot) => AreaReadouts> = { vitals, radiation, gravity, cabin, nutrition, mind };

export function areaReadouts(area: Area, snapshot: AreaSnapshot): AreaReadouts {
  return BUILDERS[area](snapshot);
}

/** "SpO₂ 97 %" or "Exercise — / 120 min" for the card sub-lines. */
export function readoutLine(readout: Readout): string {
  return readout.line ?? [readout.label, readout.value, readout.unit].filter((part) => part !== "").join(" ");
}

/** The text beside a readout's number: its unit plus any note. */
export function readoutCaption(readout: Readout): string {
  return [readout.unit, readout.note].filter((part): part is string => part !== undefined && part !== "").join(" · ");
}

/** The career-dose sentences shown under the dose bar, from the server's missionDose only. */
export function careerDoseText(dose: MissionDose): { soFar: string; projected: string } {
  return {
    soFar: `${formatDose(dose.mSv)} mSv ${CAREER_DOSE_LABEL.toLowerCase()} so far (${formatShare(dose.shareOfCareerLimit)}% of the limit)`,
    projected: `Projected for a ${dose.projectionDays}-day mission: ~${formatDose(dose.projectedMSv)} mSv (${formatShare(dose.projectedShareOfCareerLimit)}% of the limit)`,
  };
}
