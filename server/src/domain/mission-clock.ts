// Mission data (radiation, cabin) comes from past ISS missions, so it plays on the app's own
// mission clock (SPEC §5.7). Owner decision: the recording loops continuously. Its first point
// plays when the server starts, it plays in real time, and it starts again from the beginning
// when it ends, so there is always a current reading. The loop before the start supplies the
// preceding days (for the rolling 24-hour dose and its 7-day baseline). Readings after "now" are
// stored but never shown or rated.
import { PREVIOUS_DAYS } from "./status/radiation-dose.ts";
import { DAY_MS, HOUR_MS } from "./time.ts";

/**
 * The bundled RadLab and OSDR recordings are hourly means, and the simulated storm replays the
 * same hourly record: every mission reading covers one hour.
 */
export const MISSION_SAMPLE_PERIOD_MS = HOUR_MS;
/** The history the rules read before now: the rolling day and the 7 days before it (radiation, CO₂). */
export const RULE_HISTORY_MS = (PREVIOUS_DAYS + 1) * DAY_MS;
/** How far ahead of the start loops are stored; restart the server within this to keep a current reading. */
export const MISSION_CLOCK_HORIZON_MS = 366 * DAY_MS;

export interface MissionLoop {
  /** When the recording's first point plays (the server start). */
  startMs: number;
  /** One loop: the recording's span plus one sample period, so the seam keeps the sample spacing. */
  periodMs: number;
  firstOriginalMs: number;
}

/** The loop for a recording sampled every `samplePeriodMs`, starting at `startMs`. */
export function missionLoop(points: ReadonlyArray<{ t: string }>, startMs: number, samplePeriodMs: number): MissionLoop {
  if (points.length === 0) throw new Error("bundled mission data is empty");
  const times = points.map((p) => Date.parse(p.t));
  const firstOriginalMs = Math.min(...times);
  return { startMs, periodMs: Math.max(...times) - firstOriginalMs + samplePeriodMs, firstOriginalMs };
}

/** The loop numbers stored: enough loops before the start (k < 0) for the rules' history, then up to the horizon. */
export function storedLoops(loop: MissionLoop): number[] {
  const before = loopsBeforeStart(loop);
  const last = Math.ceil(MISSION_CLOCK_HORIZON_MS / loop.periodMs);
  return Array.from({ length: last + before + 1 }, (_, i) => i - before);
}

export function loopsBeforeStart(loop: MissionLoop): number {
  return Math.ceil(RULE_HISTORY_MS / loop.periodMs);
}

/** Where an original point plays on loop `k` (k = 0 starts at the server start). */
export function playTimeMs(loop: MissionLoop, originalT: string, k: number): number {
  return loop.startMs + (Date.parse(originalT) - loop.firstOriginalMs) + k * loop.periodMs;
}
