import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AREAS, type MissionDose } from "@heartbeat/shared";
import { NO_VALUE } from "./format";
import { indexLatest } from "./metrics";
import { ECG_SAMPLE_RATE_HZ, areaReadouts, careerDoseText, readoutCaption, readoutLine, type AreaSnapshot } from "./readouts";
import { MISSION_FIXTURE, nutritionDayFixture, statusFixture } from "./test-fixtures";

const noStatus: AreaSnapshot = { latest: indexLatest([]), checkIns: [], derived: null, mission: MISSION_FIXTURE, nowMs: Date.parse("2026-11-15T12:00:00Z") };
const withStatus = (edit: (derived: ReturnType<typeof statusFixture>["derived"]) => void = () => {}): AreaSnapshot => {
  const { derived } = statusFixture();
  edit(derived);
  return { ...noStatus, derived };
};

describe("readouts never invent a number", () => {
  it("show only dashes (or the server's gravity setting) with no readings and no status", () => {
    for (const id of AREAS) {
      const { headline, details } = areaReadouts(id, noStatus);
      for (const readout of [headline, ...details]) {
        if (readout.label === "Gravity") assert.equal(readout.value, MISSION_FIXTURE.gravity.label);
        else assert.equal(readout.value, NO_VALUE, `${id}: ${readout.label}`);
      }
    }
  });

  it("explain every missing value", () => {
    for (const id of AREAS) {
      const { headline, details } = areaReadouts(id, noStatus);
      for (const readout of [headline, ...details]) if (readout.value === NO_VALUE) assert.ok(readout.note, `${id}: ${readout.label} has a reason`);
    }
  });
});

describe("radiation (decisions 4 and 5: only server numbers)", () => {
  it("shows the mockup's four key numbers, all from the server: times normal, today, 7-day average, mission dose", () => {
    const dose: MissionDose = { mSv: 27.93, careerLimitMSv: 600, shareOfCareerLimit: 0.04655, projectedMSv: 117.2, projectedShareOfCareerLimit: 0.1953, projectionDays: 180, at: "x" };
    const snapshot = withStatus((d) => {
      d.radiationDailyDose = { dailyDoseUGy: 414.28, previousSevenDayAverageUGy: 409.48, multiple: 1.0117, dailyDoseMSv: 0.936, previousSevenDayAverageMSv: 0.925, at: "x" };
      d.missionDose = dose;
    });
    const { headline, details } = areaReadouts("radiation", snapshot);
    assert.deepEqual([headline, ...details].map(readoutLine), [
      "Times normal 1.01 × the 7-day average",
      "Last 24 h 0.94 mSv (estimate)",
      "7-day average 0.93 mSv/day (estimate)",
      "Mission dose 27.9 mSv dose equivalent (estimate)",
    ]);
    assert.equal(details[0].note, "414 µGy absorbed");
  });

  it("shows the absorbed dose with a reason while the dose-equivalent setting is unset", () => {
    const snapshot = withStatus((d) => (d.radiationDailyDose = { dailyDoseUGy: 414.28, previousSevenDayAverageUGy: 409.48, multiple: 1.0117, dailyDoseMSv: null, previousSevenDayAverageMSv: null, at: "x" }));
    const [today] = areaReadouts("radiation", snapshot).details;
    assert.equal(today.value, NO_VALUE);
    assert.equal(today.note, "Dose-equivalent setting not set; 414 µGy absorbed");
  });

  it("words the dose sentences under the bar from the same server numbers", () => {
    const dose: MissionDose = { mSv: 9.26, careerLimitMSv: 600, shareOfCareerLimit: 0.0154, projectedMSv: 167.9, projectedShareOfCareerLimit: 0.2798, projectionDays: 180, at: "x" };
    assert.deepEqual(careerDoseText(dose), {
      soFar: "9.3 mSv career dose equivalent (estimate) so far (1.5% of the limit)",
      projected: "Projected for a 180-day mission: ~167.9 mSv (28.0% of the limit)",
    });
  });

  it("says why the career dose is missing", () => {
    assert.equal(areaReadouts("radiation", withStatus()).details[2].note, "Needs the career-dose settings and radiation readings");
    assert.equal(areaReadouts("radiation", noStatus).details[2].note, "Needs the rules engine status");
    assert.equal(areaReadouts("radiation", withStatus()).details[0].note, "Not enough recent radiation data yet");
  });
});

describe("gravity (owner: exercise minutes against the server goal)", () => {
  it("leads with exercise minutes and shows the server's gravity setting", () => {
    const snapshot = withStatus((d) => (d.exerciseToday = { day: "2026-11-14", minutes: 45, goalMinutes: 120, thresholdBpm: 125 }));
    const { headline, details } = areaReadouts("gravity", snapshot);
    assert.equal(readoutLine(headline), "Exercise today 45 / 120 min");
    assert.equal(readoutLine(details[0]), "Gravity ISS (microgravity)");
  });

  it("explains a missing count, and a missing goal", () => {
    assert.equal(areaReadouts("gravity", withStatus()).headline.note, "Needs today's heart rate and the astronaut's age");
    const noGoal = withStatus((d) => (d.exerciseToday = { day: "2026-11-14", minutes: 30, goalMinutes: null, thresholdBpm: 125 }));
    assert.equal(readoutCaption(areaReadouts("gravity", noGoal).headline), "min · Exercise goal not set on the onboard server");
  });
});

describe("nutrition (today's totals from the server)", () => {
  it("shows the server's running totals and flags lower bounds", () => {
    const snapshot = withStatus((d) => {
      d.nutritionToday = nutritionDayFixture({ kcal: 1620, proteinG: 68 });
      d.nutritionToday.totals.kcal.unknownMeals = 1;
    });
    const { headline, details } = areaReadouts("nutrition", snapshot);
    assert.equal(readoutCaption(headline), "kcal today · at least; 1 logged item(s) have no value");
    assert.equal(headline.value, "1,620");
    assert.equal(readoutLine(details[0]), "Protein 68 g");
  });
});

describe("mind (sleep from the onboard server)", () => {
  it("shows the newest night's hours asleep the server derived from the watch", () => {
    const latest = indexLatest([{ metric: "sleep", value: 7.42, unit: "h", takenAt: "2026-11-14T07:00:00Z", source: "watch" }]);
    const sleep = areaReadouts("mind", { ...noStatus, latest }).details.find((d) => d.label === "Sleep");
    assert.equal(sleep && readoutLine(sleep), "Sleep 7.4 h");
  });
});

describe("vitals: the last ECG (demo step 2; no waveform, no classification)", () => {
  const ecgTaken = (takenAt: string, samples: number) =>
    indexLatest([{ metric: "ecg", value: Array<number>(samples).fill(0.1), unit: "mV", takenAt, source: "watch" }]);
  const ecgOf = (latest: ReturnType<typeof indexLatest>) => areaReadouts("vitals", { ...noStatus, latest }).details.find((d) => d.label === "ECG")!;

  it("reads “ECG · taken HH:MM UTC” with the recording's length, as the watch shows it, for today's ECG", () => {
    const ecg = ecgOf(ecgTaken("2026-11-15T09:04:00Z", 30 * ECG_SAMPLE_RATE_HZ));
    assert.equal(readoutLine(ecg), "ECG · taken 09:04 UTC · 30 s recording");
    assert.equal(ecg.value, "taken 09:04 UTC");
    assert.equal(readoutCaption(ecg), "30 s recording · Galaxy Watch");
  });

  it("names the day of an ECG taken before today (UTC)", () => {
    assert.equal(readoutLine(ecgOf(ecgTaken("2026-11-14T20:05:00Z", 30 * ECG_SAMPLE_RATE_HZ))), "ECG · taken Nov 14 · 20:05 UTC · 30 s recording");
  });

  it("is among the card's sub-lines, after SpO₂ and skin temperature", () => {
    assert.deepEqual(areaReadouts("vitals", noStatus).details.slice(0, 3).map((d) => d.label), ["SpO₂", "Skin", "ECG"]);
  });
});
