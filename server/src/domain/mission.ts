// The mission settings record (owner decision). It is stored on the server so every client shows
// the same mission. It also holds the relay delay setting the flight surgeon changes (SPEC §8).
import type { GravitySetting, Mission, MissionResponse } from "@heartbeat/shared";
import type { MissionStore } from "./ports.ts";
import { DAY_MS, startOfUtcDay } from "./time.ts";

/** Written to the database on first start; later changes are kept. */
export const DEFAULT_MISSION: Mission = { name: "Heartbeat ISS Demo", startDate: "2026-11-05", gravity: "iss", sleepDayTimeZone: "UTC" };

/** The sleep day's time zone: the record's, or the default before a record exists (SPEC §5.7). */
export function sleepDayTimeZoneOf(mission: Mission | null): string {
  return (mission ?? DEFAULT_MISSION).sleepDayTimeZone;
}

/** "YYYY-MM-DD". */
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Start of mission day 1: midnight UTC of the start date. */
export function missionStartDayMs(startDate: string): number {
  return Date.parse(`${startDate}T00:00:00Z`);
}

/**
 * Mission day 1 (UTC midnight of the record's start date), or the day of `nowMs` when there is no
 * mission record (owner decision). Every count "since mission day 1" starts here.
 */
export async function missionFirstDayMs(missions: Pick<MissionStore, "get">, nowMs: number): Promise<number> {
  const mission = await missions.get();
  return mission === null ? startOfUtcDay(nowMs) : missionStartDayMs(mission.startDate);
}

/** Days since the start (UTC), counting the start date as day 1. */
export function missionDay(startDate: string, nowMs: number): number {
  return Math.floor((startOfUtcDay(nowMs) - missionStartDayMs(startDate)) / DAY_MS) + 1;
}

/** How each gravity setting reads (SPEC §5.4). */
const GRAVITY_LABELS: Record<GravitySetting, string> = {
  iss: "ISS (microgravity)", moon: "Moon (0.16 g)", mars: "Mars (0.38 g)", earth: "Earth (1 g)",
};

export function withMissionDay(mission: Mission, nowMs: number): MissionResponse {
  return {
    name: mission.name,
    startDate: mission.startDate,
    missionDay: missionDay(mission.startDate, nowMs),
    gravity: { preset: mission.gravity, label: GRAVITY_LABELS[mission.gravity] },
    sleepDayTimeZone: mission.sleepDayTimeZone,
  };
}
