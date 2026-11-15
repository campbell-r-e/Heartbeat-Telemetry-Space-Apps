// Pure text formatting for numbers, clock times and durations. All times are shown in UTC.

import { DAY_MS, HOUR_MS, MINUTE_MS, MINUTES_PER_HOUR, SECOND_MS } from "./time";

/** A whole, for converting 0–1 shares to percentages. */
export const PERCENT = 100;

/** Shown wherever a value does not exist yet; never a made-up number. */
export const NO_VALUE = "—";

const LOCALE = "en-US";
const ISO_CLOCK_START = 11;
const ISO_CLOCK_END = 16;
const ISO_CLOCK_SECONDS_END = 19;

export function formatNumber(value: number, decimals: number): string {
  return value.toLocaleString(LOCALE, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** A number as given, with up to `maxDecimals` decimals and no trailing zeros ("2.26", "1,000"). */
export function formatNumberUpTo(value: number, maxDecimals: number): string {
  return value.toLocaleString(LOCALE, { maximumFractionDigits: maxDecimals });
}

/** "HH:MM" in UTC. */
export function formatUtcClock(time: string | number): string {
  return new Date(time).toISOString().slice(ISO_CLOCK_START, ISO_CLOCK_END);
}

/** "HH:MM:SS" in UTC. */
export function formatUtcClockSeconds(time: string | number): string {
  return new Date(time).toISOString().slice(ISO_CLOCK_START, ISO_CLOCK_SECONDS_END);
}

/** "Nov 14" in UTC. */
export function formatUtcDay(time: string | number): string {
  return new Date(time).toLocaleDateString(LOCALE, { month: "short", day: "numeric", timeZone: "UTC" });
}

/** "Nov 14 · 19:22 UTC". */
export function formatUtcDateTime(time: string | number): string {
  return `${formatUtcDay(time)} · ${formatUtcClock(time)} UTC`;
}

/** "45 min", "2 h", "1 h 38 min". */
export function formatMinutes(totalMinutes: number): string {
  const rounded = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(rounded / MINUTES_PER_HOUR);
  const minutes = rounded % MINUTES_PER_HOUR;
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

const SECONDS_PER_MINUTE = 60;
/** Delays under this many seconds keep one decimal ("1.3 s"). */
const TENTHS_BELOW_S = 10;

/** A relay delay or lag as people read it: "0 s", "1.3 s", "10 s", "3 min", "22 min", "3 min 5 s". */
export function formatDelay(ms: number): string {
  const seconds = Math.max(0, ms) / SECOND_MS;
  if (seconds < TENTHS_BELOW_S) return `${formatNumberUpTo(seconds, 1)} s`;
  const whole = Math.round(seconds);
  if (whole < SECONDS_PER_MINUTE) return `${whole} s`;
  const minutes = Math.floor(whole / SECONDS_PER_MINUTE);
  const rest = whole % SECONDS_PER_MINUTE;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

/** Time left as "m:ss", rounded up to the next whole second and never below "0:00". */
export function formatCountdown(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / SECOND_MS);
  const minutes = Math.floor(total / SECONDS_PER_MINUTE);
  const seconds = total % SECONDS_PER_MINUTE;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** How long ago, roughly: "40 s ago", "2 min ago", "3 h ago", "2 d ago". */
export function formatAgo(ms: number): string {
  if (ms < MINUTE_MS) return `${Math.max(0, Math.floor(ms / SECOND_MS))} s ago`;
  if (ms < HOUR_MS) return `${Math.floor(ms / MINUTE_MS)} min ago`;
  if (ms < DAY_MS) return `${Math.floor(ms / HOUR_MS)} h ago`;
  return `${Math.floor(ms / DAY_MS)} d ago`;
}
