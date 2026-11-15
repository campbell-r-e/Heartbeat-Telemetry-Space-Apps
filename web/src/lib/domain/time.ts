// Time arithmetic for the dashboard. Every clock time the app shows is UTC: the schedule's
// "spacecraft local time" is assumed to be UTC (SPEC §7).

export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const MINUTES_PER_HOUR = 60;
export const HOURS_PER_DAY = 24;
export const HOUR_MS = MINUTES_PER_HOUR * MINUTE_MS;
export const DAY_MS = HOURS_PER_DAY * HOUR_MS;

/** One year in seconds, for how long the browser remembers a choice (theme, crew member). */
export const ONE_YEAR_S = (365 * DAY_MS) / SECOND_MS;

/** Midnight UTC at the start of the day that contains `nowMs`. */
export function startOfUtcDay(nowMs: number): number {
  return Math.floor(nowMs / DAY_MS) * DAY_MS;
}

/** Midnight UTC at the end of the day that contains `nowMs`. */
export function endOfUtcDay(nowMs: number): number {
  return startOfUtcDay(nowMs) + DAY_MS;
}

/** Minutes since midnight UTC for an "HH:MM" clock time, or null if the text is not one. */
export function parseClockMinutes(hhmm: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours >= HOURS_PER_DAY || minutes >= MINUTES_PER_HOUR) return null;
  return hours * MINUTES_PER_HOUR + minutes;
}
