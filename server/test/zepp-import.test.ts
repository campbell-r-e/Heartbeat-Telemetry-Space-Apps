// The Zepp history import (SPEC §5.7): real time-zone conversion, sentinels, duplicates and the
// Galaxy Watch winning shared slots.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  convertZeppExport, decodedWallTime, heartRateMinutes, nightlyHrv, nightlySpo2, parseDecodedExport, sleepNights,
  type DecodedHeartRate, type DecodedSleepSession, type DecodedZeppExport,
} from "../scripts/zepp-conversion.ts";
import { localDate, offsetMsAt, wallTimeToUtcMs } from "../src/domain/zoned-time.ts";
import type { Reading } from "@heartbeat/shared";
import { PRECEDENCE_SLOTS, slotsTakenBy, withoutContestedSlots } from "../src/domain/source-precedence.ts";
import { zeppReadings, zeppSlots } from "../src/data/load-bundled.ts";
import type { ZeppHistory } from "../src/data/bundled-shapes.ts";
import { DEFAULT_MISSION } from "../src/domain/mission.ts";
import type { MissionStore } from "../src/domain/ports.ts";
import { HOUR_MS } from "../src/domain/time.ts";

const ZONE = "America/Indiana/Indianapolis";
const EDT_S = -4 * 3600;
const EST_S = -5 * 3600;
const utc = (wall: { date: string; minuteOfDay: number }) => new Date(wallTimeToUtcMs(wall, ZONE)).toISOString();
const epochS = (iso: string) => Date.parse(iso) / 1000;
const NO_GALAXY = { heartRate: [], hrv: [] };

describe("wall-clock times in America/Indiana/Indianapolis", () => {
  it("uses EDT before the 2026-11-01 change and EST from 02:00 local", () => {
    assert.equal(utc({ date: "2026-11-01", minuteOfDay: 30 }), "2026-11-01T04:30:00.000Z");
    assert.equal(utc({ date: "2026-11-01", minuteOfDay: 2 * 60 }), "2026-11-01T07:00:00.000Z");
    assert.equal(utc({ date: "2026-11-01", minuteOfDay: 10 * 60 }), "2026-11-01T15:00:00.000Z");
    assert.equal(utc({ date: "2026-10-31", minuteOfDay: 10 * 60 }), "2026-10-31T14:00:00.000Z");
  });

  it("reads the repeated 01:00-01:59 hour as its first, daylight-time occurrence", () => {
    assert.equal(utc({ date: "2026-11-01", minuteOfDay: 90 }), "2026-11-01T05:30:00.000Z");
  });

  it("reads a skipped spring-forward time with the offset before the change", () => {
    assert.equal(utc({ date: "2026-03-08", minuteOfDay: 150 }), "2026-03-08T07:30:00.000Z");
  });

  it("gives the zone's offset and local date at a UTC time", () => {
    assert.equal(offsetMsAt(Date.parse("2026-09-04T12:00:00Z"), ZONE), -4 * HOUR_MS);
    assert.equal(offsetMsAt(Date.parse("2026-11-08T12:00:00Z"), ZONE), -5 * HOUR_MS);
    assert.equal(localDate(Date.parse("2026-11-08T04:59:00Z"), ZONE), "2026-11-07");
    assert.equal(localDate(Date.parse("2026-11-08T05:00:00Z"), ZONE), "2026-11-08");
  });
});

describe("heart rate", () => {
  /** A decoded minute: the decoder's epoch for `minuteOfDay` on `date` under its fixed offset. */
  const decodedMinute = (date: string, minuteOfDay: number, offsetS: number) =>
    Date.parse(`${date}T00:00:00Z`) / 1000 - offsetS + minuteOfDay * 60;

  it("recovers the wall-clock minute the decoder meant", () => {
    assert.deepEqual(decodedWallTime(decodedMinute("2026-11-01", 600, EDT_S), EDT_S), { date: "2026-11-01", minuteOfDay: 600 });
  });

  const day = (date: string, offsetS: number, minutes: number) => ({ date, tz_offset_s: offsetS, minutes_with_hr: minutes });

  it("moves 2026-11-01 minutes after 02:00 to EST, where the decoder's fixed offset left them on EDT", () => {
    const decoded: DecodedHeartRate = {
      tz_by_day: [day("2026-11-01", EDT_S, 2), day("2026-11-02", EST_S, 1)],
      readings: [[decodedMinute("2026-11-01", 60, EDT_S), 60], [decodedMinute("2026-11-01", 600, EDT_S), 70], [decodedMinute("2026-11-02", 600, EST_S), 80]],
    };
    assert.deepEqual(heartRateMinutes(decoded, ZONE).points, [
      { t: "2026-11-01T05:00:00.000Z", bpm: 60 },
      { t: "2026-11-01T15:00:00.000Z", bpm: 70 },
      { t: "2026-11-02T15:00:00.000Z", bpm: 80 },
    ]);
  });

  it("keeps both days' minutes at the 2027-03-14 spring-forward change, where the decoder gives them the same epochs", () => {
    // The decoder reads the change day with EST and the next day with EDT, so 03-14 23:30 and
    // 03-15 00:30 local both decode to 2027-03-15T04:30Z; the listed counts tell them apart.
    const lateOnChangeDay = decodedMinute("2027-03-14", 23 * 60 + 30, EST_S);
    const earlyNextDay = decodedMinute("2027-03-15", 30, EDT_S);
    assert.equal(lateOnChangeDay, earlyNextDay);
    const decoded: DecodedHeartRate = {
      tz_by_day: [day("2027-03-14", EST_S, 1), day("2027-03-15", EDT_S, 1)],
      readings: [[lateOnChangeDay, 61], [earlyNextDay, 62]],
    };
    const { points, sameMinute } = heartRateMinutes(decoded, ZONE);
    assert.deepEqual(points, [
      { t: "2027-03-15T03:30:00.000Z", bpm: 61 },
      { t: "2027-03-15T04:30:00.000Z", bpm: 62 },
    ]);
    assert.equal(sameMinute, 0);
  });

  it("drops the 254 no-reading value and keeps the first of two values for one UTC minute", () => {
    const minute = decodedMinute("2026-09-04", 600, EDT_S);
    const decoded: DecodedHeartRate = {
      tz_by_day: [day("2026-09-04", EDT_S, 4)],
      readings: [[minute, 254], [minute + 60, 0], [minute + 120, 71], [minute + 120, 72]],
    };
    const { points, noReading, sameMinute } = heartRateMinutes(decoded, ZONE);
    assert.deepEqual(points, [{ t: "2026-09-04T14:02:00.000Z", bpm: 71 }]);
    assert.equal(noReading, 2);
    assert.equal(sameMinute, 1);
  });

  it("refuses a minute listed under a day it does not fall on, and counts that do not cover the readings", () => {
    const misplaced: DecodedHeartRate = { tz_by_day: [day("2026-09-04", EDT_S, 1)], readings: [[epochS("2026-09-10T12:00:00Z"), 70]] };
    assert.throws(() => heartRateMinutes(misplaced, ZONE), /listed under 2026-09-04 but falls on 2026-09-10/);
    const miscounted: DecodedHeartRate = { tz_by_day: [day("2026-09-04", EDT_S, 2)], readings: [[decodedMinute("2026-09-04", 600, EDT_S), 70]] };
    assert.throws(() => heartRateMinutes(miscounted, ZONE), /lists 2 minutes but readings has 1/);
  });
});

const session = (startIso: string, endIso: string, overrides: Partial<DecodedSleepSession> = {}): DecodedSleepSession => ({
  tz_offset_s: EDT_S, start_epoch: epochS(startIso), end_epoch: epochS(endIso), light_min: 179, deep_min: 88, rem_min: 100, ...overrides,
});

describe("sleep", () => {
  it("counts light + deep + REM as hours asleep, stamped at the wake time in UTC", () => {
    const { points, wakeByDate } = sleepNights([session("2026-09-04T06:59:00Z", "2026-09-04T13:16:00Z")], ZONE);
    assert.deepEqual(points, [{ t: "2026-09-04T13:16:00.000Z", asleepH: 6.12 }]);
    assert.equal(wakeByDate.get("2026-09-04"), "2026-09-04T13:16:00.000Z");
  });

  it("makes the longest session of a local date its night, whichever comes first, and keeps every session's sleep", () => {
    const nap = session("2026-09-20T18:00:00Z", "2026-09-20T19:30:00Z", { light_min: 60, deep_min: 10, rem_min: 5 });
    const night = session("2026-09-20T06:14:00Z", "2026-09-20T13:06:00Z");
    for (const order of [[nap, night], [night, nap]]) {
      const { points, wakeByDate, notTheNight } = sleepNights(order, ZONE);
      assert.deepEqual(points, [{ t: "2026-09-20T13:06:00.000Z", asleepH: 6.12 }, { t: "2026-09-20T19:30:00.000Z", asleepH: 1.25 }]);
      assert.equal(wakeByDate.get("2026-09-20"), "2026-09-20T13:06:00.000Z");
      assert.equal(notTheNight, 1);
    }
  });

  it("leaves out a session with a junk start, and one with more sleep than time in bed", () => {
    const junkStart = session("2026-11-03T06:00:00Z", "2026-11-03T12:00:00Z", { start_epoch: -3_000_000 });
    const tooMuchSleep = session("2026-11-04T10:00:00Z", "2026-11-04T12:00:00Z");
    const { points, invalid } = sleepNights([junkStart, tooMuchSleep], ZONE);
    assert.deepEqual(points, []);
    assert.equal(invalid, 2);
  });
});

describe("nightly HRV and SpO₂", () => {
  const night = "2026-09-13T04:00:00Z";
  const wakeByDate = new Map([["2026-09-13", "2026-09-13T13:31:00.000Z"]]);

  it("keeps the HRV row Zepp updated last for a night, at that night's wake time", () => {
    const rows = [
      { ts: epochS(night), updated: 300, sleep_hrv_ms: 57 },
      { ts: epochS(night), updated: 100, sleep_hrv_ms: 56 },
      { ts: epochS(night), updated: 200, sleep_hrv_ms: 55 },
    ];
    const hrv = nightlyHrv(rows, wakeByDate, ZONE);
    assert.deepEqual(hrv.points, [{ t: "2026-09-13T13:31:00.000Z", sleepHrvMs: 57 }]);
    assert.equal(hrv.superseded, 2);
  });

  it("does not make up a night: no HRV value (null or 255) or no sleep session gives no reading", () => {
    const rows = [{ ts: epochS(night), updated: 1, sleep_hrv_ms: null }, { ts: epochS("2026-09-14T04:00:00Z"), updated: 1, sleep_hrv_ms: 49 }];
    const hrv = nightlyHrv(rows, wakeByDate, ZONE);
    assert.deepEqual([hrv.points, hrv.missing, hrv.withoutSession], [[], 1, 1]);
    const unset = nightlyHrv([{ ts: epochS(night), updated: 1, sleep_hrv_ms: 255 }], wakeByDate, ZONE);
    assert.deepEqual([unset.points, unset.missing], [[], 1]);
    const spo2 = nightlySpo2([{ night_ts: epochS("2026-09-14T04:00:00Z"), score: 96 }], wakeByDate, ZONE);
    assert.deepEqual([spo2.points, spo2.withoutSession], [[], 1]);
  });

  it("takes the SpO₂ score as a percentage at the wake time, and leaves out a score that is not one", () => {
    const spo2 = nightlySpo2([{ night_ts: epochS(night), score: 96 }, { night_ts: epochS(night), score: 255 }], wakeByDate, ZONE);
    assert.deepEqual(spo2.points, [{ t: "2026-09-13T13:31:00.000Z", scorePct: 96 }]);
    assert.equal(spo2.outOfRange, 1);
  });

  it("joins a night after the change to EST by its local date", () => {
    const wakes = new Map([["2026-11-08", "2026-11-08T14:41:00.000Z"]]);
    assert.equal(nightlySpo2([{ night_ts: epochS("2026-11-08T05:00:00Z"), score: 97 }], wakes, ZONE).points[0].t, "2026-11-08T14:41:00.000Z");
  });
});

describe("the Galaxy Watch wins", () => {
  it("leaves out a Zepp point whose slot holds a Galaxy Watch reading", () => {
    const points = [{ t: "2026-11-10T12:00:00.000Z" }, { t: "2026-11-10T12:01:00.000Z" }];
    assert.deepEqual(withoutContestedSlots(points, [Date.parse("2026-11-10T12:00:37.000Z")], PRECEDENCE_SLOTS.heartRate), [{ t: "2026-11-10T12:01:00.000Z" }]);
  });

  it("gives the slots live Galaxy Watch heart rate and HRV take from the Zepp history, and none for other readings", () => {
    const reading = (metric: Reading["metric"], source: Reading["source"], takenAt: string): Reading =>
      ({ astronautId: "a1", metric, value: 1, unit: "x", takenAt, source });
    const slots = slotsTakenBy([
      reading("heartRate", "watch", "2026-11-14T21:00:37.000Z"),
      reading("hrv", "watch", "2026-11-14T21:05:00.000Z"),
      reading("spo2", "watch", "2026-11-14T21:00:00.000Z"),
      reading("heartRate", "manual", "2026-11-14T21:00:00.000Z"),
    ]);
    assert.deepEqual(slots, [
      { astronautId: "a1", metric: "heartRate", fromMs: Date.parse("2026-11-14T21:00:00Z"), toMs: Date.parse("2026-11-14T21:01:00Z") },
      { astronautId: "a1", metric: "hrv", fromMs: Date.parse("2026-11-14T21:05:00Z"), toMs: Date.parse("2026-11-14T21:10:00Z") },
    ]);
  });

  it("drops Zepp heart rate in a Galaxy minute and Zepp HRV in a Galaxy 5-minute window, and reports both", () => {
    const decoded: DecodedZeppExport = {
      heartRate: { tz_by_day: [{ date: "2026-11-08", tz_offset_s: EST_S, minutes_with_hr: 2 }], readings: [[epochS("2026-11-08T14:00:00Z"), 60], [epochS("2026-11-08T14:01:00Z"), 61]] },
      sleepSessions: [session("2026-11-08T08:21:00Z","2026-11-08T14:41:00Z", { tz_offset_s: EST_S })],
      readiness: [{ ts: epochS("2026-11-08T05:00:00Z"), updated: 1, sleep_hrv_ms: 56 }],
      spo2Nights: [{ night_ts: epochS("2026-11-08T05:00:00Z"), score: 97 }],
    };
    const galaxy = { heartRate: [Date.parse("2026-11-08T14:00:20Z")], hrv: [Date.parse("2026-11-08T14:40:00Z")] };
    const { history, report } = convertZeppExport(decoded, galaxy, ZONE);
    assert.deepEqual(history.heartRate, [{ t: "2026-11-08T14:01:00.000Z", bpm: 61 }]);
    assert.deepEqual(history.hrv, []);
    assert.deepEqual(history.sleep, [{ t: "2026-11-08T14:41:00.000Z", asleepH: 6.12 }]);
    assert.deepEqual(history.spo2, [{ t: "2026-11-08T14:41:00.000Z", scorePct: 97 }]);
    assert.equal(report.heartRateGalaxyWon, 1);
    assert.equal(report.hrvGalaxyWon, 1);
  });
});

describe("decoded export shape", () => {
  const valid = {
    heartRate: { tz_by_day: [{ date: "2026-09-04", tz_offset_s: EDT_S, minutes_with_hr: 1 }], readings: [[1788505140, 70]] },
    sleepSessions: [session("2026-09-04T06:59:00Z", "2026-09-04T13:16:00Z")],
    readiness: [{ ts: 1, updated: 1, sleep_hrv_ms: null }],
    spo2Nights: [{ night_ts: 1, score: 96 }],
  };

  it("accepts the fields the conversion reads and names the first bad entry", () => {
    assert.doesNotThrow(() => parseDecodedExport(valid));
    assert.doesNotThrow(() => convertZeppExport(parseDecodedExport(valid), NO_GALAXY, ZONE));
    const badMinute = { ...valid, heartRate: { ...valid.heartRate, readings: [[1788505140, "70"]] } };
    assert.throws(() => parseDecodedExport(badMinute), /heart_rate_minutely\.json: readings\[0\]/);
    const badNight = { ...valid, spo2Nights: [{ night_ts: 1 }] };
    assert.throws(() => parseDecodedExport(badNight), /spo2_odi_nightly\.json: nights\[0\]\.score/);
    const noCount = { ...valid, heartRate: { ...valid.heartRate, tz_by_day: [{ date: "2026-09-04", tz_offset_s: EDT_S }] } };
    assert.throws(() => parseDecodedExport(noCount), /heart_rate_minutely\.json: tz_by_day\[0\]\.minutes_with_hr/);
  });
});

describe("the Galaxy Watch wins a night when the Zepp history loads", () => {
  // A Galaxy Watch night waking at 14:00 UTC on Nov 11, and Zepp nights waking at 11:00 UTC on Nov 11 and Nov 12.
  const galaxyWake = Date.parse("2026-11-11T14:00:00Z");
  const zepp: ZeppHistory = {
    heartRate: [], hrv: [], spo2: [],
    sleep: [{ t: "2026-11-11T11:00:00.000Z", asleepH: 6.5 }, { t: "2026-11-12T11:00:00.000Z", asleepH: 7.2 }],
  };
  const missionIn = (sleepDayTimeZone: string): MissionStore => {
    const unused = () => { throw new Error("not used when the Zepp history loads"); };
    return { get: async () => ({ ...DEFAULT_MISSION, sleepDayTimeZone }), saveIfMissing: unused, updateSleepDayTimeZone: unused, relaySetting: unused, updateRelaySetting: unused };
  };
  const keptNights = async (sleepDayTimeZone: string) => {
    const slots = await zeppSlots(missionIn(sleepDayTimeZone));
    return zeppReadings(zepp, { heartRate: [], hrv: [], sleep: [galaxyWake] }, slots).filter((r) => r.metric === "sleep").map((r) => r.takenAt);
  };

  it("in Indiana days, drops the Zepp night of the same local day (noon EST to noon EST) and keeps the next", async () => {
    assert.deepEqual(await keptNights("America/Indiana/Indianapolis"), ["2026-11-12T11:00:00.000Z"]);
  });

  it("in UTC days, the same wake times fall the other way: 11:00 UTC Nov 11 is the day before 14:00 UTC", async () => {
    assert.deepEqual(await keptNights("UTC"), ["2026-11-11T11:00:00.000Z"]);
  });

  it("keeps every Zepp night when the Galaxy Watch has none", async () => {
    const slots = await zeppSlots(missionIn("UTC"));
    assert.equal(zeppReadings(zepp, { heartRate: [], hrv: [], sleep: [] }, slots).filter((r) => r.metric === "sleep").length, 2);
  });
});
