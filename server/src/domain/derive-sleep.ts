// Live sleep (SPEC §5.7): the server detects each noon-to-noon day's sleep period from the watch's
// wristAngle minutes with domain/sleep (van Hees et al. 2018) and stores it as one `sleep`
// reading in hours, stamped at the waking time, under the watch's source. A day is analyzed once it
// has ended, because the paper's threshold and longest block are taken over the whole day; it is
// analyzed again on later runs, so wristAngle minutes the watch uploads late still count.
import type { Astronaut, ReadingSource } from "@heartbeat/shared";
import { METRIC_UNITS } from "./metrics.ts";
import { sleepDayTimeZoneOf } from "./mission.ts";
import type { MetricRange, ReadingStore, Stores, StoredReading } from "./ports.ts";
import { epochGrid } from "./sleep/epochs.ts";
import { sleepDays, wakeTimesOf, type AnalysisDay } from "./sleep/sleep-days.ts";
import { detectSleepPeriod } from "./sleep/sleep-period.ts";
import { OUTRANKED_SOURCE } from "./source-precedence.ts";

/** The live watch app is the only source of wristAngle, and its sleep is stored under the same source. */
export const SLEEP_SOURCE: ReadingSource = "watch";

/** How many ended days each run analyzes again, so a week of late uploads (a watch offline for days) still counts. */
export const REANALYZED_DAYS = 7;

export interface SleepDerivationFailure {
  astronautId: string;
  error: unknown;
}

/**
 * Derives the sleep reading of each of the last REANALYZED_DAYS ended days for every astronaut,
 * in the mission's sleep-day time zone, replacing what an earlier run stored. The day still running
 * holds no watch night (no provisional reading), which also clears nights an earlier time zone put
 * there. Each astronaut runs on its own, so one failure does not stop the others; failures are
 * returned by id.
 */
export async function deriveRecentSleep(
  stores: Pick<Stores, "astronauts" | "readings" | "mission">, nowMs: number,
): Promise<SleepDerivationFailure[]> {
  const astronauts = await stores.astronauts.list();
  const days = sleepDays(sleepDayTimeZoneOf(await stores.mission.get()));
  const running = days.containing(nowMs);
  const ended = days.ended(nowMs, REANALYZED_DAYS);
  const results = await Promise.allSettled(astronauts.map((astronaut) => deriveAstronautSleep(stores.readings, astronaut, ended, running)));
  return results.flatMap((result, i) => (result.status === "rejected" ? [{ astronautId: astronauts[i].id, error: result.reason }] : []));
}

async function deriveAstronautSleep(readings: ReadingStore, astronaut: Astronaut, ended: readonly AnalysisDay[], running: AnalysisDay): Promise<void> {
  for (const day of ended) await deriveDaySleep(readings, astronaut.id, day);
  await readings.replaceSourceInRange(SLEEP_SOURCE, nightOf(astronaut.id, running), []);
}

/**
 * Replaces the day's watch sleep reading with the one detected from its wristAngle minutes (none
 * when no sleep period is found). A Zepp night in the same day is removed: the Galaxy Watch wins.
 */
export async function deriveDaySleep(readings: ReadingStore, astronautId: string, day: AnalysisDay): Promise<StoredReading | null> {
  const minutes = await readings.arrayReadingsTakenIn(SLEEP_SOURCE, { astronautId, metric: "wristAngle", fromMs: day.startMs, toMs: day.endMs });
  const period = detectSleepPeriod(day, epochGrid(day, minutes));
  const night = nightOf(astronautId, day);
  if (period === null) {
    await readings.replaceSourceInRange(SLEEP_SOURCE, night, []);
    return null;
  }
  const sleep: StoredReading = {
    astronautId, metric: "sleep", value: period.asleepHours, unit: METRIC_UNITS.sleep, takenAt: new Date(period.wakeMs).toISOString(), source: SLEEP_SOURCE,
  };
  await readings.replaceSourceInRange(SLEEP_SOURCE, night, [sleep]);
  await readings.deleteSourceInRanges(OUTRANKED_SOURCE, [night]);
  return sleep;
}

/** The sleep readings stamped in a day: the readings store range of its waking times. */
const nightOf = (astronautId: string, day: AnalysisDay): MetricRange => ({ astronautId, metric: "sleep", ...wakeTimesOf(day) });
