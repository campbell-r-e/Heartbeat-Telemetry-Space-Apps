// Converts the decoded Zepp app export into Astronaut 1's Zepp history (SPEC §5.7). Pure: the
// import script does the file reading and writing.
//
// The decoder stamped each heart-rate minute and sleep session with a fixed UTC offset per day.
// Zepp counts minutes on the local wall clock, so each time is taken back to its wall-clock
// minute with that offset and converted again with the real time zone, which also gets the
// minutes after a daylight-saving change right (owner decision).
import type { ZeppHistory } from "../src/data/bundled-shapes.ts";
import {
  arrayField, checkArray, checkEach, field, isInteger, isNumber, isNumberPair, isString, orNull,
} from "../src/data/shape-checks.ts";
import { PRECEDENCE_SLOTS, withoutContestedSlots, type GalaxyReadingTimes } from "../src/domain/source-precedence.ts";
import { DAY_MS, MINUTE_MS } from "../src/domain/time.ts";
import { localDate, wallTimeToUtcMs, type WallTime } from "../src/domain/zoned-time.ts";

/** The time zone where the Zepp app recorded local times. */
export const ZEPP_TIME_ZONE = "America/Indiana/Indianapolis";

/** Zepp's per-minute heart rate is one byte: 254 (and 255) mean "no reading", never a heart rate. */
export const NO_READING_BPM = 254;

/** Zepp writes 255 for a nightly HRV it has no value for (owner decision: never a real HRV). */
export const NO_VALUE_HRV_MS = 255;

const SECOND_MS = 1000;
const MINUTES_PER_HOUR = 60;
/** Hours asleep are kept to two decimal places, like the Zepp app's own figure. */
const HOURS_ROUNDING = 100;
const MAX_PERCENT = 100;

export interface DecodedDay {
  date: string;
  /** The fixed UTC offset (s) the decoder used for the whole day. */
  tz_offset_s: number;
  /** How many of `readings` belong to this day. */
  minutes_with_hr: number;
}

export interface DecodedHeartRate {
  /** Each local day in order; `readings` lists the days' minutes in the same order. */
  tz_by_day: DecodedDay[];
  /** [epoch seconds, bpm] per minute. */
  readings: Array<[number, number]>;
}

export interface DecodedSleepSession {
  tz_offset_s: number;
  start_epoch: number;
  end_epoch: number;
  light_min: number;
  deep_min: number;
  rem_min: number;
}

export interface DecodedReadiness {
  /** Local midnight (epoch s) of the morning the night ended. */
  ts: number;
  /** When Zepp last updated the row (epoch s); a night can have several rows. */
  updated: number;
  sleep_hrv_ms: number | null;
}

export interface DecodedSpo2Night {
  /** Local midnight (epoch s) of the morning the night ended. */
  night_ts: number;
  score: number;
}

export interface DecodedZeppExport {
  heartRate: DecodedHeartRate;
  sleepSessions: DecodedSleepSession[];
  readiness: DecodedReadiness[];
  spo2Nights: DecodedSpo2Night[];
}

/** How many source values each step left out, so the import can say what it dropped and why. */
export interface ConversionReport {
  heartRateNoReading: number;
  heartRateSameMinute: number;
  heartRateGalaxyWon: number;
  sleepInvalidSessions: number;
  /** Sessions kept as sleep readings but not their date's night (a shorter session that day). */
  sleepSessionsNotTheNight: number;
  hrvSupersededRows: number;
  hrvMissing: number;
  hrvWithoutSleepSession: number;
  hrvGalaxyWon: number;
  spo2OutOfRange: number;
  spo2WithoutSleepSession: number;
}

export interface ZeppConversion {
  history: ZeppHistory;
  report: ConversionReport;
}

const HEART_RATE_FILE = "heart_rate_minutely.json";

/** Checks the decoded files have the fields the conversion reads; throws naming the file and entry. */
export function parseDecodedExport(files: Record<keyof DecodedZeppExport, unknown>): DecodedZeppExport {
  const readings = field(HEART_RATE_FILE, files.heartRate, "readings");
  checkEach<[number, number]>(HEART_RATE_FILE, "readings", readings, isNumberPair);
  const { sleepSessions, readiness, spo2Nights } = files;
  checkArray<DecodedSleepSession>("sleep_sessions.json", "sessions", sleepSessions, {
    tz_offset_s: isInteger, start_epoch: isNumber, end_epoch: isNumber, light_min: isNumber, deep_min: isNumber, rem_min: isNumber,
  });
  checkArray<DecodedReadiness>("readiness_hrv.json", "rows", readiness, { ts: isNumber, updated: isNumber, sleep_hrv_ms: orNull(isNumber) });
  checkArray<DecodedSpo2Night>("spo2_odi_nightly.json", "nights", spo2Nights, { night_ts: isNumber, score: isNumber });
  return {
    heartRate: {
      tz_by_day: arrayField<DecodedDay>(HEART_RATE_FILE, files.heartRate, "tz_by_day", { date: isString, tz_offset_s: isInteger, minutes_with_hr: isInteger }),
      readings,
    },
    sleepSessions,
    readiness,
    spo2Nights,
  };
}

/** The whole conversion: times in UTC, sentinels and duplicates out, and the Galaxy Watch winning shared slots. */
export function convertZeppExport(decoded: DecodedZeppExport, galaxy: Pick<GalaxyReadingTimes, "heartRate" | "hrv">, timeZone = ZEPP_TIME_ZONE): ZeppConversion {
  const heartRate = heartRateMinutes(decoded.heartRate, timeZone);
  const nights = sleepNights(decoded.sleepSessions, timeZone);
  const hrv = nightlyHrv(decoded.readiness, nights.wakeByDate, timeZone);
  const spo2 = nightlySpo2(decoded.spo2Nights, nights.wakeByDate, timeZone);
  const keptHeartRate = withoutContestedSlots(heartRate.points, galaxy.heartRate, PRECEDENCE_SLOTS.heartRate);
  const keptHrv = withoutContestedSlots(hrv.points, galaxy.hrv, PRECEDENCE_SLOTS.hrv);
  return {
    history: { heartRate: keptHeartRate, hrv: keptHrv, sleep: nights.points, spo2: spo2.points },
    report: {
      heartRateNoReading: heartRate.noReading,
      heartRateSameMinute: heartRate.sameMinute,
      heartRateGalaxyWon: heartRate.points.length - keptHeartRate.length,
      sleepInvalidSessions: nights.invalid,
      sleepSessionsNotTheNight: nights.notTheNight,
      hrvSupersededRows: hrv.superseded,
      hrvMissing: hrv.missing,
      hrvWithoutSleepSession: hrv.withoutSession,
      hrvGalaxyWon: hrv.points.length - keptHrv.length,
      spo2OutOfRange: spo2.outOfRange,
      spo2WithoutSleepSession: spo2.withoutSession,
    },
  };
}

/** The local wall-clock time the decoder meant by `epochSeconds` under its fixed `offsetSeconds`. */
export function decodedWallTime(epochSeconds: number, offsetSeconds: number): WallTime {
  const wallMs = (epochSeconds + offsetSeconds) * SECOND_MS;
  const midnightMs = Math.floor(wallMs / DAY_MS) * DAY_MS;
  return { date: new Date(midnightMs).toISOString().slice(0, 10), minuteOfDay: (wallMs - midnightMs) / MINUTE_MS };
}

const isoUtc = (ms: number) => new Date(ms).toISOString();

/** Per-minute heart rate in UTC, without "no reading" values; a repeated UTC minute keeps its first value. */
export function heartRateMinutes(decoded: DecodedHeartRate, timeZone: string) {
  const byMinute = new Map<string, { t: string; bpm: number }>();
  let noReading = 0;
  let sameMinute = 0;
  for (const { wall, bpm } of wallTimesOfMinutes(decoded)) {
    if (bpm <= 0 || bpm >= NO_READING_BPM) {
      noReading++;
      continue;
    }
    const t = isoUtc(wallTimeToUtcMs(wall, timeZone));
    if (byMinute.has(t)) sameMinute++;
    else byMinute.set(t, { t, bpm });
  }
  const points = [...byMinute.values()].sort((a, b) => a.t.localeCompare(b.t));
  return { points, noReading, sameMinute };
}

/**
 * The wall time of each heart-rate minute, read with the offset of the day it is listed under.
 * The readings list each day's minutes in tz_by_day order, minutes_with_hr per day, so the day
 * comes from the position, not the epoch: around a spring-forward change the decoder's fixed
 * offsets give the last hour of the change day and the first hour of the next day the same
 * epochs. Throws if the counts do not cover the readings or a minute decodes to another date.
 */
function wallTimesOfMinutes(decoded: DecodedHeartRate): Array<{ wall: WallTime; bpm: number }> {
  const listed = decoded.tz_by_day.reduce((sum, day) => sum + day.minutes_with_hr, 0);
  if (listed !== decoded.readings.length) {
    throw new Error(`${HEART_RATE_FILE}: tz_by_day lists ${listed} minutes but readings has ${decoded.readings.length}`);
  }
  const minutes: Array<{ wall: WallTime; bpm: number }> = [];
  let next = 0;
  for (const day of decoded.tz_by_day) {
    for (const [epochSeconds, bpm] of decoded.readings.slice(next, next + day.minutes_with_hr)) {
      const wall = decodedWallTime(epochSeconds, day.tz_offset_s);
      if (wall.date !== day.date) {
        throw new Error(`${HEART_RATE_FILE}: the minute at ${epochSeconds} is listed under ${day.date} but falls on ${wall.date}`);
      }
      minutes.push({ wall, bpm });
    }
    next += day.minutes_with_hr;
  }
  return minutes;
}

/**
 * Hours asleep per sleep session, stamped at its wake time. A session whose start is not a real
 * time before its end (the decoder's junk start values), that has no sleep, or that has more
 * sleep than time in bed is left out. When a local date has more than one session (a nap and a
 * night), each keeps its sleep reading, and the longest (most time asleep) is that date's night,
 * whose wake time the nightly HRV and SpO₂ are stamped at (owner decision).
 */
export function sleepNights(sessions: readonly DecodedSleepSession[], timeZone: string) {
  const points: ZeppHistory["sleep"] = [];
  const nightByDate = new Map<string, { t: string; asleepMinutes: number }>();
  let invalid = 0;
  for (const session of sessions) {
    const asleepMinutes = session.light_min + session.deep_min + session.rem_min;
    if (!isValidSession(session, asleepMinutes)) {
      invalid++;
      continue;
    }
    const wakeMs = wallTimeToUtcMs(decodedWallTime(session.end_epoch, session.tz_offset_s), timeZone);
    const t = isoUtc(wakeMs);
    points.push({ t, asleepH: Math.round((asleepMinutes / MINUTES_PER_HOUR) * HOURS_ROUNDING) / HOURS_ROUNDING });
    const date = localDate(wakeMs, timeZone);
    const longestSoFar = nightByDate.get(date);
    if (!longestSoFar || asleepMinutes > longestSoFar.asleepMinutes) nightByDate.set(date, { t, asleepMinutes });
  }
  points.sort((a, b) => a.t.localeCompare(b.t));
  const wakeByDate = new Map([...nightByDate].map(([date, night]) => [date, night.t]));
  return { points, wakeByDate, invalid, notTheNight: points.length - wakeByDate.size };
}

function isValidSession(session: DecodedSleepSession, asleepMinutes: number): boolean {
  const inBedMinutes = (session.end_epoch - session.start_epoch) * SECOND_MS / MINUTE_MS;
  return session.start_epoch > 0 && asleepMinutes > 0 && asleepMinutes <= inBedMinutes;
}

/** The wake time of the night that ended on the local date of `localMidnightSeconds`, if Zepp has its sleep session. */
const wakeOf = (localMidnightSeconds: number, wakeByDate: ReadonlyMap<string, string>, timeZone: string) =>
  wakeByDate.get(localDate(localMidnightSeconds * SECOND_MS, timeZone));

/**
 * Zepp's nightly sleep HRV, one per night at its wake time. Zepp rewrites a night's row during the
 * morning; the row updated last is kept. A night with no HRV (null, 0 or 255) or no sleep
 * session is left out.
 */
export function nightlyHrv(rows: readonly DecodedReadiness[], wakeByDate: ReadonlyMap<string, string>, timeZone: string) {
  const latestPerNight = new Map<number, DecodedReadiness>();
  for (const row of rows) {
    const kept = latestPerNight.get(row.ts);
    if (!kept || row.updated > kept.updated) latestPerNight.set(row.ts, row);
  }
  const points: ZeppHistory["hrv"] = [];
  let missing = 0;
  let withoutSession = 0;
  for (const row of latestPerNight.values()) {
    const wake = wakeOf(row.ts, wakeByDate, timeZone);
    if (row.sleep_hrv_ms === null || row.sleep_hrv_ms <= 0 || row.sleep_hrv_ms === NO_VALUE_HRV_MS) missing++;
    else if (!wake) withoutSession++;
    else points.push({ t: wake, sleepHrvMs: row.sleep_hrv_ms });
  }
  points.sort((a, b) => a.t.localeCompare(b.t));
  return { points, superseded: rows.length - latestPerNight.size, missing, withoutSession };
}

/**
 * Zepp's nightly blood-oxygen score, one per night at its wake time. A score that is not a
 * percentage above 0, or a night with no sleep session, is left out.
 */
export function nightlySpo2(nights: readonly DecodedSpo2Night[], wakeByDate: ReadonlyMap<string, string>, timeZone: string) {
  const points: ZeppHistory["spo2"] = [];
  let outOfRange = 0;
  let withoutSession = 0;
  for (const night of nights) {
    const wake = wakeOf(night.night_ts, wakeByDate, timeZone);
    if (night.score <= 0 || night.score > MAX_PERCENT) outOfRange++;
    else if (!wake) withoutSession++;
    else points.push({ t: wake, scorePct: night.score });
  }
  points.sort((a, b) => a.t.localeCompare(b.t));
  return { points, outOfRange, withoutSession };
}
