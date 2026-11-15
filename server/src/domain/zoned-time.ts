// Wall-clock times in a real IANA time zone (daylight saving time included), converted to and
// from UTC with the zone rules built into Node (Intl). Pure; used by the Zepp import and by the
// sleep day (noon to noon in the mission's sleep-day time zone).
import { DAY_MS, MINUTE_MS } from "./time.ts";

/** A local calendar date "YYYY-MM-DD" and minutes since its midnight on the wall clock. */
export interface WallTime {
  date: string;
  minuteOfDay: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The wall clock in `timeZone` at `utcMs`, written as if it were a UTC time (ms, whole seconds). */
function wallClockMs(utcMs: number, timeZone: string): number {
  const part = Object.fromEntries(formatterFor(timeZone).formatToParts(utcMs).map((p) => [p.type, Number(p.value)]));
  return Date.UTC(part.year, part.month - 1, part.day, part.hour, part.minute, part.second);
}

/** The zone's offset from UTC at `utcMs`, in ms (EDT is −4 h). */
export function offsetMsAt(utcMs: number, timeZone: string): number {
  const wholeSecondMs = Math.floor(utcMs / 1000) * 1000;
  return wallClockMs(wholeSecondMs, timeZone) - wholeSecondMs;
}

/** Whether `name` is an IANA time zone Node knows, such as "UTC" or "America/Indiana/Indianapolis". */
export function isTimeZone(name: string): boolean {
  try {
    formatterFor(name);
    return true;
  } catch {
    return false; // Intl refuses an unknown zone with a RangeError
  }
}

/** "YYYY-MM-DD" of the local date in `timeZone` at `utcMs`. */
export function localDate(utcMs: number, timeZone: string): string {
  return new Date(wallClockMs(utcMs, timeZone)).toISOString().slice(0, 10);
}

/**
 * The UTC time (ms) of a wall-clock time in `timeZone`. A time the clock shows twice (the hour
 * before the fall-back change) is read as its first occurrence, still on daylight time. A time the
 * clock skips (spring forward) is read with the offset in force before the change.
 */
export function wallTimeToUtcMs({ date, minuteOfDay }: WallTime, timeZone: string): number {
  const wallMs = Date.parse(`${date}T00:00:00Z`) + minuteOfDay * MINUTE_MS;
  // The offsets a day either side cover both sides of any change near this wall time.
  const offsetBefore = offsetMsAt(wallMs - DAY_MS, timeZone);
  const offsetAfter = offsetMsAt(wallMs + DAY_MS, timeZone);
  const matches = [offsetBefore, offsetAfter]
    .map((offset) => wallMs - offset)
    .filter((utcMs) => wallClockMs(utcMs, timeZone) === wallMs);
  return matches.length > 0 ? Math.min(...matches) : wallMs - offsetBefore;
}
