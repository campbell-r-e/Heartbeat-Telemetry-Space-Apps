// One sleep reading per night for the rules (owner decision, SPEC §6.7). A night is the noon-to-noon
// day (in the sleep-day time zone) its waking time closes, the same night a watch reading is derived for and the slot the
// Galaxy Watch wins over Zepp in. Storage already keeps the Galaxy Watch's night over Zepp's; when a
// night still holds two readings (a Zepp nap and a night), the longest counts, as the Zepp import
// treats the longest session as that date's night (SPEC §5.7).
import type { TimedValue } from "../status/timed-values.ts";
import type { SleepDays } from "./sleep-days.ts";

/** The longest sleep reading of each night, newest night first. */
export function longestPerNight(readings: readonly TimedValue[], days: SleepDays): TimedValue[] {
  const byNight = new Map<number, TimedValue>();
  for (const reading of readings) {
    const night = days.ofWake(reading.tMs).startMs;
    const kept = byNight.get(night);
    if (!kept || reading.value > kept.value) byNight.set(night, reading);
  }
  return [...byNight.entries()].sort(([a], [b]) => b - a).map(([, reading]) => reading);
}
