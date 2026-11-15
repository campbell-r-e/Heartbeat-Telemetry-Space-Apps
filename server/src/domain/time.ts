export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const HOURS_PER_DAY = 24;
export const DAY_MS = HOURS_PER_DAY * HOUR_MS;

/** Start of the UTC day containing `ms`; spacecraft local time is UTC (SPEC §7). */
export function startOfUtcDay(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

/** The start of every UTC day from the day of `fromMs` to the day of `toMs`, both included, oldest first. */
export function utcDayStarts(fromMs: number, toMs: number): number[] {
  const days: number[] = [];
  for (let day = startOfUtcDay(fromMs); day <= startOfUtcDay(toMs); day += DAY_MS) days.push(day);
  return days;
}

/** "YYYY-MM-DD" of the UTC day containing `ms`. */
export function utcDayLabel(ms: number): string {
  return new Date(startOfUtcDay(ms)).toISOString().slice(0, 10);
}

/** "21:30" for 21.5: an hour of the UTC day, with fractions, as a clock time. */
export function utcClockLabel(hourOfDay: number): string {
  const totalMinutes = Math.round(hourOfDay * 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(totalMinutes / 60))}:${pad(totalMinutes % 60)}`;
}

/** Hours since the start of the UTC day containing `ms`, with fractions (21:30 is 21.5). */
export function hourOfUtcDay(ms: number): number {
  return (ms - startOfUtcDay(ms)) / HOUR_MS;
}
