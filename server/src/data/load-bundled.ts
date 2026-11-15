import { SHIP_ID, type Astronaut, type Metric, type ReadingSource } from "@heartbeat/shared";
import { METRIC_UNITS as UNIT } from "../domain/metrics.ts";
import { MISSION_SAMPLE_PERIOD_MS, missionLoop, playTimeMs, storedLoops } from "../domain/mission-clock.ts";
import {
  isGalaxyWatch, nightSlots, OUTRANKED_SOURCE, PRECEDENCE_SLOTS, withoutContestedSlots, type GalaxyReadingTimes, type SlotOf,
} from "../domain/source-precedence.ts";
import { sleepDayTimeZoneOf } from "../domain/mission.ts";
import type { MissionStore, ReadingStore, StoredReading, Stores } from "../domain/ports.ts";
import { sleepDays } from "../domain/sleep/sleep-days.ts";
import type { BundledData, CabinHour, WatchHistory, ZeppHistory } from "./bundled-files.ts";

/** Sample profile for Astronaut 1 (used for the exercise threshold and nutrition targets). */
export const ASTRONAUT_1: Astronaut = {
  id: "a1", name: "Astronaut 1", watchId: null, age: 35, sex: "female", massKg: 66, heightM: 1.68,
};

const WATCH_HISTORY_SOURCE: ReadingSource = "wxserver";
const ZEPP_SOURCE = OUTRANKED_SOURCE;
const RADIATION_SOURCE: ReadingSource = "radlab";
const CABIN_SOURCE: ReadingSource = "osdr";

/**
 * Loads the bundled data into the database. Safe to run on every start: each source is
 * replaced, not appended. The Galaxy Watch history loads before the Zepp history, so the Zepp
 * history can leave out the slots the Galaxy Watch already has.
 */
export async function loadBundledData(stores: Stores, bundle: BundledData, nowMs = Date.now()): Promise<Record<string, number>> {
  await stores.astronauts.upsert(ASTRONAUT_1);
  const { readings, foods } = stores;
  const astronaut1 = await readings.replaceSource(ASTRONAUT_1.id, WATCH_HISTORY_SOURCE, watchHistoryReadings(bundle.astronaut1History));
  const slots = await zeppSlots(stores.mission);
  const galaxy = await galaxyReadingTimes(readings, bundle.astronaut1Zepp, slots);
  return {
    astronaut1,
    astronaut1Zepp: await readings.replaceSource(ASTRONAUT_1.id, ZEPP_SOURCE, zeppReadings(bundle.astronaut1Zepp, galaxy, slots)),
    radiation: await readings.replaceSource(SHIP_ID, RADIATION_SOURCE, radiationReadings(bundle.radiationHours, nowMs)),
    cabin: await readings.replaceSource(SHIP_ID, CABIN_SOURCE, cabinReadings(bundle.cabinHours, nowMs)),
    foods: await foods.replaceMenu(bundle.foodMenu),
  };
}

/** Astronaut 1's readings of one metric from a history file, which keep their real timestamps. */
function astronaut1Readings<P extends { t: string }>(
  metric: Metric, points: readonly P[], valueOf: (p: P) => number, source: ReadingSource,
): StoredReading[] {
  return points.map((p) => ({ astronautId: ASTRONAUT_1.id, metric, value: valueOf(p), unit: UNIT[metric], takenAt: p.t, source }));
}

/**
 * Astronaut 1's Galaxy Watch history. The file's steps array, if present, is not loaded (no
 * steps metric; the import no longer writes it); replacing the wxserver source on each start
 * also removes steps readings stored by earlier versions.
 */
export function watchHistoryReadings(history: WatchHistory): StoredReading[] {
  return [
    ...astronaut1Readings("heartRate", history.heartRate, (p) => p.bpm, WATCH_HISTORY_SOURCE),
    ...astronaut1Readings("hrv", history.hrv, (p) => p.rmssdMs, WATCH_HISTORY_SOURCE),
    ...astronaut1Readings("skinTemp", history.skinTemp, (p) => p.skinC, WATCH_HISTORY_SOURCE),
  ];
}

/**
 * Astronaut 1's Zepp OS watch history, without the heart-rate minutes, HRV windows and nights
 * the Galaxy Watch already has (the Galaxy Watch wins; SPEC §5.7).
 */
export function zeppReadings(history: ZeppHistory, galaxy: GalaxyReadingTimes, slots: ZeppSlots): StoredReading[] {
  const heartRate = withoutContestedSlots(history.heartRate, galaxy.heartRate, slots.heartRate);
  const hrv = withoutContestedSlots(history.hrv, galaxy.hrv, slots.hrv);
  const sleep = withoutContestedSlots(history.sleep, galaxy.sleep, slots.sleep);
  return [
    ...astronaut1Readings("heartRate", heartRate, (p) => p.bpm, ZEPP_SOURCE),
    ...astronaut1Readings("hrv", hrv, (p) => p.sleepHrvMs, ZEPP_SOURCE),
    ...astronaut1Readings("sleep", sleep, (p) => p.asleepH, ZEPP_SOURCE),
    ...astronaut1Readings("spo2", history.spo2, (p) => p.scorePct, ZEPP_SOURCE),
  ];
}

/** The slot each Zepp metric the Galaxy Watch can win competes in; nights follow the mission's sleep-day time zone. */
export type ZeppSlots = Record<keyof GalaxyReadingTimes, SlotOf>;

export async function zeppSlots(mission: MissionStore): Promise<ZeppSlots> {
  return { ...PRECEDENCE_SLOTS, sleep: nightSlots(sleepDays(sleepDayTimeZoneOf(await mission.get()))) };
}

/** Times of the stored Galaxy Watch readings (history and live) over the span of the Zepp history. */
async function galaxyReadingTimes(readings: ReadingStore, zepp: ZeppHistory, slots: ZeppSlots): Promise<GalaxyReadingTimes> {
  const timesOf = async (metric: keyof GalaxyReadingTimes): Promise<number[]> => {
    const points = zepp[metric];
    if (points.length === 0) return [];
    const slotOf = slots[metric];
    const window = { fromMs: slotOf(Date.parse(points[0].t)).fromMs, toMs: slotOf(Date.parse(points[points.length - 1].t)).toMs, bucketMinutes: null };
    const stored = await readings.series(ASTRONAUT_1.id, metric, window);
    return stored.filter((p) => isGalaxyWatch(p.source)).map((p) => Date.parse(p.t));
  };
  return { heartRate: await timesOf("heartRate"), hrv: await timesOf("hrv"), sleep: await timesOf("sleep") };
}

/** Each recorded point on every stored loop of the mission clock, with its play time. */
function onMissionLoop<P extends { t: string }>(points: readonly P[], startMs: number): Array<{ point: P; takenAt: string }> {
  const loop = missionLoop(points, startMs, MISSION_SAMPLE_PERIOD_MS);
  return storedLoops(loop).flatMap((k) => points.map((point) => ({ point, takenAt: new Date(playTimeMs(loop, point.t, k)).toISOString() })));
}

/** Radiation hours looping on the mission clock from `startMs`, with the original time kept alongside. */
export function radiationReadings(hours: ReadonlyArray<{ t: string; uGyPerHour: number }>, startMs: number): StoredReading[] {
  return onMissionLoop(hours, startMs).map(({ point, takenAt }) => ({
    astronautId: SHIP_ID, metric: "radiationDoseRate", value: point.uGyPerHour, unit: UNIT.radiationDoseRate,
    takenAt, source: RADIATION_SOURCE, originalTakenAt: point.t,
  }));
}

/** Cabin hours looping on the mission clock from `startMs`; a missing (null) value gives no reading for that metric. */
export function cabinReadings(hours: readonly CabinHour[], startMs: number): StoredReading[] {
  return onMissionLoop(hours, startMs).flatMap(({ point: p, takenAt }) => {
    const base = { astronautId: SHIP_ID, takenAt, source: CABIN_SOURCE, originalTakenAt: p.t };
    const rows: StoredReading[] = [];
    if (p.co2mmHg != null) rows.push({ ...base, metric: "co2", value: p.co2mmHg, unit: UNIT.co2 });
    if (p.tempC != null) rows.push({ ...base, metric: "cabinTemp", value: p.tempC, unit: UNIT.cabinTemp });
    if (p.rhPct != null) rows.push({ ...base, metric: "humidity", value: p.rhPct, unit: UNIT.humidity });
    return rows;
  });
}
