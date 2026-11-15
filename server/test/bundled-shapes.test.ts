import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readBundledData } from "../src/data/bundled-files.ts";
import { parseCabinHours, parseFoodMenu, parseRadiationHours, parseWatchHistory, parseZeppHistory } from "../src/data/bundled-shapes.ts";

const T = "2017-09-11T00:00:00Z";

describe("bundled data shapes", () => {
  it("accepts every real bundled file", () => {
    assert.doesNotThrow(() => readBundledData());
  });

  it("names the file and the first bad radiation hour", () => {
    const json = { hourly: [{ t: T, uGyPerHour: 6.1 }, { t: T, doseRate: 6.2 }] };
    assert.throws(() => parseRadiationHours(json, "radiation-iss.json"), /^Error: radiation-iss\.json: hourly\[1\]\.uGyPerHour/);
  });

  it("rejects a missing array and a time that is not a date", () => {
    assert.throws(() => parseRadiationHours({}, "r.json"), /r\.json: hourly is not an array/);
    assert.throws(() => parseRadiationHours({ hourly: [{ t: "soon", uGyPerHour: 1 }] }, "r.json"), /hourly\[0\]\.t/);
  });

  it("allows null cabin readings but not missing ones", () => {
    const hour = { t: T, tempC: null, rhPct: 45.7, co2mmHg: null };
    assert.deepEqual(parseCabinHours({ hourly: [hour] }, "c.json"), [hour]);
    const { co2mmHg: _dropped, ...missing } = hour;
    assert.throws(() => parseCabinHours({ hourly: [missing] }, "c.json"), /hourly\[0\]\.co2mmHg/);
  });

  it("checks each watch history series", () => {
    const history = { heartRate: [{ t: T, bpm: 61 }], hrv: [], skinTemp: [{ t: T, skinC: "34.7" }] };
    assert.throws(() => parseWatchHistory(history, "h.json"), /h\.json: skinTemp\[0\]\.skinC/);
  });

  it("checks each Zepp history series", () => {
    const zepp = { heartRate: [{ t: T, bpm: 61 }], hrv: [{ t: T, sleepHrvMs: 56 }], sleep: [{ t: T, asleepH: 6.1 }], spo2: [{ t: T, scorePct: 96 }] };
    assert.deepEqual(parseZeppHistory(zepp, "z.json"), zepp);
    assert.throws(() => parseZeppHistory({ ...zepp, sleep: [{ t: T, asleep_h: 6.1 }] }, "z.json"), /z\.json: sleep\[0\]\.asleepH/);
    assert.throws(() => parseZeppHistory({ ...zepp, spo2: undefined }, "z.json"), /z\.json: spo2 is not an array/);
  });

  it("checks menu foods, with optional fields allowed to be absent", () => {
    const food = {
      id: "f", name: "F", category: "c", foodType: null, serving: "1", kcal: 1, proteinG: null,
      calciumMg: null, vitaminDUg: null, sodiumMg: null,
    };
    assert.doesNotThrow(() => parseFoodMenu({ sources: [], foods: [food] }, "m.json"));
    assert.throws(() => parseFoodMenu({ sources: [], foods: [{ ...food, kcal: "1" }] }, "m.json"), /foods\[0\]\.kcal/);
  });
});
