// When the real looped ISS record, with no simulated storm, rates Radiation 🟡 or 🔴 (SPEC §5.7,
// §13): the daily-dose rules and the career-dose rules alike, through the rules engine's own facts
// and rules. The recording plays from the server's start, so the times follow from that start, the
// mission's start (for the mission dose) and the crew's profiles. No I/O here.
import type { Status } from "@heartbeat/shared";
import { radiationReadings } from "../src/data/load-bundled.ts";
import { RULE_HISTORY_MS } from "../src/domain/mission-clock.ts";
import { RULES } from "../src/domain/rules/catalog.ts";
import { evaluateRules, worse } from "../src/domain/rules/engine.ts";
import type { RuleSettings } from "../src/domain/rules/settings.ts";
import { computeFacts } from "../src/domain/status/compute-facts.ts";
import type { AstronautProfile } from "../src/domain/status/nutrition.ts";
import type { TimedValue } from "../src/domain/status/timed-values.ts";
import { HOUR_MS } from "../src/domain/time.ts";

export interface RadiationWindow {
  status: Exclude<Status, "normal">;
  /** The first reading time rated `status`, or the forecast's start when it was already on then. */
  fromMs: number;
  /** When the status ends: the next reading time rated something else, or the forecast's end. */
  toMs: number;
  /** True when the window was already on at the forecast's start ("now"). */
  inProgress: boolean;
}

export interface ForecastContext {
  /** Mission day 1 (UTC midnight), from which the mission dose counts; null when unknown (no career rules). */
  missionStartMs: number | null;
  /** The crew's profiles; Radiation's rules are the ship's, but each profile is rated and the worst kept. */
  profiles: readonly AstronautProfile[];
  settings: RuleSettings;
}

const NO_PROFILE: AstronautProfile = { age: null, sex: null, massKg: null, heightM: null };

/** The ship's Radiation status at `nowMs` from the readings up to then, the worst over the crew's profiles. */
function radiationStatusAt(readings: readonly TimedValue[], nowMs: number, context: ForecastContext): Status | null {
  // The daily-dose rules read the 8 days before now (one hour more covers the oldest slot's edge);
  // the career-dose rules read everything since the mission's start.
  const fromMs = Math.min(nowMs - RULE_HISTORY_MS - HOUR_MS, context.missionStartMs ?? Infinity);
  const recent = readings.filter((r) => r.tMs <= nowMs && r.tMs > fromMs);
  const profiles = context.profiles.length > 0 ? context.profiles : [NO_PROFILE];
  const statuses = profiles.map((profile) => {
    const facts = computeFacts({
      nowMs, profile, missionStartMs: context.missionStartMs, sleepDayTimeZone: "UTC",
      ship: { radiationDoseRate: recent }, astronaut: {}, latest: {}, checkIns: [], meals: [], foods: [],
    }, context.settings);
    return evaluateRules(RULES, context.settings, facts, "ship").areas.find((a) => a.area === "radiation")?.status ?? null;
  });
  return statuses.reduce<Status | null>((worst, s) => (s === null ? worst : worst === null ? s : worse(worst, s)), null);
}

/**
 * Every stretch of [fromMs, toMs) in which the real record, playing from `serverStartMs`, rates
 * Radiation 🟡 or 🔴. The readings are hourly, so the status can change only at a reading's time:
 * the reading at or before `fromMs` and each one after are rated, and equal neighbors are merged.
 */
export function realRadiationWindows(
  hours: ReadonlyArray<{ t: string; uGyPerHour: number }>, serverStartMs: number, fromMs: number, toMs: number, context: ForecastContext,
): RadiationWindow[] {
  const readings = radiationReadings(hours, serverStartMs)
    .map((r) => ({ tMs: Date.parse(r.takenAt), value: r.value as number }))
    .sort((a, b) => a.tMs - b.tMs);
  const lastBefore = readings.filter((r) => r.tMs <= fromMs).at(-1)?.tMs;
  const times = [...(lastBefore === undefined ? [] : [lastBefore]), ...readings.map((r) => r.tMs).filter((t) => t > fromMs && t < toMs)];
  const windows: RadiationWindow[] = [];
  times.forEach((tMs, i) => {
    const status = radiationStatusAt(readings, tMs, context);
    if (status !== "watch" && status !== "alert") return;
    const startMs = Math.max(tMs, fromMs);
    const endMs = times[i + 1] ?? toMs;
    const last = windows.at(-1);
    if (last && last.status === status && last.toMs === startMs) last.toMs = endMs;
    else windows.push({ status, fromMs: startMs, toMs: endMs, inProgress: startMs === fromMs });
  });
  return windows;
}

/** `--days`: a whole number of days from 1 to 400, or an error saying so. */
export function parseForecastDays(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const days = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!(days >= 1 && days <= MAX_FORECAST_DAYS)) throw new Error(`--days must be a whole number from 1 to ${MAX_FORECAST_DAYS}, got ${JSON.stringify(raw)}`);
  return days;
}

/** The mission clock stores a year of loops ahead (SPEC §5.7), so a forecast can reach that far. */
export const MAX_FORECAST_DAYS = 365;
