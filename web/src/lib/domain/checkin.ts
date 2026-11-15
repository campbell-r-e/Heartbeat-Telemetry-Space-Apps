// The daily mood and stress check-in (SPEC §5.6): mood as five faces, stress 1–5.

import { CHECK_IN_LABELS, CHECK_IN_SCALE, type CheckIn, type SeriesRange } from "@heartbeat/shared";
import type { ChartData, ChartPoint, ValueScale } from "./chart";
import { chartWindow } from "./ranges";

/** The check-in scale, defined once in @heartbeat/shared. */
export const SCORE_MIN = CHECK_IN_SCALE.min;
export const SCORE_MAX = CHECK_IN_SCALE.max;

/** How far back the dashboard reads check-ins (the server's default window, SPEC §10). */
export const CHECK_IN_HISTORY_DAYS = 14;

export interface ScoreChoice {
  value: number;
  /** Accessible name and visible caption; one choice per point of CHECK_IN_SCALE. */
  label: string;
}

export const MOOD_CHOICES: readonly ScoreChoice[] = [
  { value: 1, label: "Very low" },
  { value: 2, label: "Low" },
  { value: 3, label: "Okay" },
  { value: 4, label: "Good" },
  { value: 5, label: "Very good" },
];

export const STRESS_CHOICES: readonly ScoreChoice[] = [
  { value: 1, label: "Calm" },
  { value: 2, label: "Mild" },
  { value: 3, label: "Moderate" },
  { value: 4, label: "High" },
  { value: 5, label: "Very stressed" },
];

/** "1 is very low, 5 is very good.", from the shared scale and its end labels. */
export function scaleHint(field: keyof typeof CHECK_IN_LABELS): string {
  const labels = CHECK_IN_LABELS[field];
  return `${SCORE_MIN} is ${labels.min}, ${SCORE_MAX} is ${labels.max}.`;
}

/** A whole-number score from 1 to 5 out of a form field, or null when it is missing or out of range. */
export function parseScore(raw: FormDataEntryValue | null): number | null {
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
  const score = Number(raw);
  return score >= SCORE_MIN && score <= SCORE_MAX ? score : null;
}

export function latestCheckIn(checkIns: readonly CheckIn[]): CheckIn | null {
  return checkIns.reduce<CheckIn | null>((latest, c) => (latest === null || Date.parse(c.at) > Date.parse(latest.at) ? c : latest), null);
}

export function newestFirst(checkIns: readonly CheckIn[]): CheckIn[] {
  return [...checkIns].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** The check-in charts' axis: always the whole 1–5 scale. */
export const CHECK_IN_AXIS: ValueScale = { min: SCORE_MIN, max: SCORE_MAX };

/**
 * A mood or stress chart over `range`, ending at `endMs` (now on the dashboard; when the daily log
 * was read on board for the surgeon): the check-ins in the window, on the whole 1–5 scale.
 */
export function checkInChartData(checkIns: readonly CheckIn[], field: "mood" | "stress", range: SeriesRange, endMs: number): ChartData {
  const all = checkInSeries(checkIns, field);
  const window = chartWindow(range, endMs, all[0]?.tMs ?? null);
  return {
    points: all.filter((point) => point.tMs >= window.fromMs && point.tMs <= window.toMs),
    unit: `/ ${SCORE_MAX}`,
    decimals: 0,
    reference: null,
    goal: null,
    window,
    timeUnit: "time",
    scale: CHECK_IN_AXIS,
  };
}

export function checkInSeries(checkIns: readonly CheckIn[], field: "mood" | "stress"): ChartPoint[] {
  return [...checkIns]
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .map((checkIn) => ({ tMs: Date.parse(checkIn.at), value: checkIn[field], simulated: false }));
}

/** The note under the Save button, as in the approved mockup. */
export function saveNote(ready: boolean, saved: boolean, checkInTime: string | null): string {
  if (saved) return "✓ Sent to the onboard server";
  if (!ready) return "Pick a mood and a stress level to save.";
  return checkInTime ? `Counts toward today’s ${checkInTime} check-in task.` : "Counts toward today’s check-in task.";
}
