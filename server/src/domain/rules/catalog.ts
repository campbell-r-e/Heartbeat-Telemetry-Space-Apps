// Every rule the engine runs (SPEC §6.4, §6.5), as data. Bands are written as exclusive ranges so
// one reading fires one message per rule family. Thresholds are setting keys (settings.ts), and
// messages quote them through {setting:key} placeholders.
import type { RuleSource } from "@heartbeat/shared";
import type { Rule } from "./rule.ts";
import { NUTRITION_CHECK_SPECS, type NutritionCheckSpec } from "./nutrition-checks.ts";

const VOL2_REV_F = "NASA-STD-3001 Vol 2 Rev F";

const SOURCES = {
  solarEvent: { requirementId: "[V1 4031]", document: "NASA-STD-3001 Vol 1 · OCHMO-TB-020; crew alerting [V2 6164]", ours: true },
  careerWatch: { requirementId: "[V1 4030]", document: "NASA-STD-3001 Vol 1 · OCHMO-TB-020", ours: true },
  careerAlert: { requirementId: "[V1 4030]", document: "NASA-STD-3001 Vol 1 · OCHMO-TB-020", ours: false },
  co2Limit: { requirementId: "[V2 6004]", document: `${VOL2_REV_F} §6.2.1.3 · OCHMO-TB-004`, ours: false },
  co2Headache: { requirementId: null, document: "OCHMO-TB-004 (guidance, not a requirement)", ours: false },
  pressureLimit: { requirementId: "[V2 6006]", document: "NASA-STD-3001 Vol 2 · OCHMO-TB-003", ours: false },
  pressureShift: { requirementId: "[V2 6006]", document: "NASA-STD-3001 Vol 2 · OCHMO-TB-003; leak detection (owner decision)", ours: true },
  zone: { requirementId: "[V2 6012]", document: `${VOL2_REV_F} §6.2.3.1, Figure 6.2-2`, ours: false },
  zoneMargin: { requirementId: "[V2 6012]", document: `${VOL2_REV_F} §6.2.3.1, Figure 6.2-2`, ours: true },
  noiseSleep: {
    requirementId: "[V2 6079]", document: `${VOL2_REV_F} §6.6.1.8 · ISS Flight Rule B13-152 (via NASA ICES-2024-354)`, ours: false,
  },
  noiseAwake: { requirementId: "[V2 6078]", document: `${VOL2_REV_F} §6.6.1.7`, ours: true },
  noiseDay: { requirementId: "[V2 6115]", document: `${VOL2_REV_F} §6.6.1.6`, ours: false },
  clinical: {
    requirementId: null, document: "Standard clinical range (vitals are not numeric limits in NASA-STD-3001; SPEC §6.5)", ours: false,
  },
  heartRateExtreme: { requirementId: null, document: "Heart rate extremes (owner decision; SPEC §6.5)", ours: true },
  baseline: { requirementId: null, document: "Personal baseline from the astronaut's own real readings (SPEC §6.2)", ours: true },
  exercise: { requirementId: null, document: "Daily exercise goal (SPEC §5.4); bands are an owner decision", ours: true },
  combination: { requirementId: null, document: "Combination rule (SPEC §6.4)", ours: true },
} as const satisfies Record<string, Omit<RuleSource, "citations">>;

/** A source with the pages backing a rule's messages (message audit, 2026-11-14, docs/message-audit-2026-11-14.md). */
const cite = (source: Omit<RuleSource, "citations">, citations: readonly string[]): RuleSource => ({ ...source, citations: [...citations] });

const RADIATION_RULES: readonly Rule[] = [
  {
    id: "radiation-solar-event-watch",
    title: "Radiation dose rising",
    area: "radiation", hazard: "radiation", layer: "standard", status: "watch",
    when: [
      { fact: "radiationDailyDoseMultiple", op: "gte", setting: "radiation.solarEventWatchMultiple" },
      { fact: "radiationDailyDoseMultiple", op: "lt", setting: "radiation.solarEventAlertMultiple" },
    ],
    message: {
      what: "The ship's radiation dose over the last 24 hours is {radiationDailyDoseMultiple}× the average of the 7 days before ({radiationDailyDoseUGy} vs. {radiationPreviousAverageUGy} µGy).",
      why: "A rise like this can be the start of a solar particle event. NASA limits a solar event's dose to under 250 mSv [V1 4031].",
      do: "No action is needed yet. Watch for an alert, and follow your crew's radiation plan if one comes.",
    },
    source: cite(SOURCES.solarEvent, ["OCHMO-TB-020, p. 1"]),
  },
  {
    id: "radiation-solar-event-alert",
    title: "Radiation dose spike",
    area: "radiation", hazard: "radiation", layer: "standard", status: "alert",
    when: [{ fact: "radiationDailyDoseMultiple", op: "gte", setting: "radiation.solarEventAlertMultiple" }],
    message: {
      what: "The ship's radiation dose over the last 24 hours is {radiationDailyDoseMultiple}× the average of the 7 days before ({radiationDailyDoseUGy} vs. {radiationPreviousAverageUGy} µGy). This applies to the whole crew.",
      why: "A rise this large can be a sign of a solar particle event. NASA requires the crew and operations teams to be alerted when exposure rates exceed set thresholds [V2 6164].",
      do: "Follow your mission's planned radiation sheltering steps and any instructions from the ground. An alert has been sent to the flight surgeon.",
    },
    source: cite(SOURCES.solarEvent, ["NASA-STD-3001 Vol 2 Rev F §6.8.1.6, p. 112"]),
  },
  {
    id: "radiation-career-watch",
    title: "Career radiation dose high",
    area: "radiation", hazard: "radiation", layer: "standard", status: "watch",
    when: [
      { fact: "radiationCareerFraction", op: "gte", setting: "radiation.careerWatchFraction" },
      { fact: "radiationProjectedCareerFraction", op: "lt", setting: "radiation.careerAlertProjectedFraction" },
    ],
    message: {
      what: "Your career radiation dose equivalent (estimate) is {radiationCareerDoseMSv} mSv, {radiationCareerPercentOfLimit}% of NASA's {setting:radiation.careerLimitMSv} mSv career limit (from the ship's sensor this mission).",
      why: "Career dose adds up over every mission and raises long-term cancer risk. NASA caps it at {setting:radiation.careerLimitMSv} mSv for all ages and sexes [V1 4030].",
      do: "Talk with the flight surgeon about limiting further exposure on this mission.",
    },
    source: cite(SOURCES.careerWatch, ["OCHMO-TB-020, p. 2", "OCHMO-TB-020, p. 4", "OCHMO-TB-020, p. 13 [V1 4029]"]),
  },
  {
    id: "radiation-career-alert",
    title: "Career radiation limit projected",
    area: "radiation", hazard: "radiation", layer: "standard", status: "alert",
    when: [{ fact: "radiationProjectedCareerFraction", op: "gte", setting: "radiation.careerAlertProjectedFraction" }],
    message: {
      what: "At the average dose rate so far, your career radiation dose equivalent (estimate) is projected to reach NASA's {setting:radiation.careerLimitMSv} mSv limit by the end of the {setting:mission.plannedLengthDays}-day mission.",
      why: "NASA caps career effective dose at {setting:radiation.careerLimitMSv} mSv [V1 4030].",
      do: "An alert has been sent to the flight surgeon. Talk with them about your exposure.",
    },
    source: cite(SOURCES.careerAlert, ["OCHMO-TB-020, p. 4"]),
  },
];

const CABIN_RULES: readonly Rule[] = [
  {
    id: "co2-one-hour-alert",
    title: "CO₂ above limit",
    area: "cabin", hazard: "environment", layer: "standard", status: "alert",
    when: [{ fact: "co2OneHourAverageMmHg", op: "gt", setting: "co2.oneHourAlertAboveMmHg" }],
    message: {
      what: "Cabin CO₂ averaged {co2OneHourAverageMmHg} mmHg over the last hour, above NASA's {setting:co2.oneHourAlertAboveMmHg} mmHg limit.",
      why: "Without enough airflow, CO₂ can collect in pockets, and higher CO₂ is linked to headaches in crews.",
      do: "Tell the crew so CO₂ removal can be checked, and tell the flight surgeon if you get a headache. An alert has been sent to the flight surgeon.",
    },
    source: cite(SOURCES.co2Limit, ["NASA-STD-3001 Vol 2 Rev F §6.2.7.1, p. 63 [V2 6107]", "OCHMO-TB-004, p. 5"]),
  },
  {
    id: "co2-one-hour-watch",
    title: "CO₂ near limit",
    area: "cabin", hazard: "environment", layer: "standard", status: "watch",
    when: [
      { fact: "co2OneHourAverageMmHg", op: "gte", setting: "co2.oneHourWatchFromMmHg" },
      { fact: "co2OneHourAverageMmHg", op: "lte", setting: "co2.oneHourAlertAboveMmHg" },
    ],
    message: {
      what: "Cabin CO₂ averaged {co2OneHourAverageMmHg} mmHg over the last hour, close to NASA's {setting:co2.oneHourAlertAboveMmHg} mmHg limit.",
      why: "NASA guidance links a 7-day average below {setting:co2.sevenDayWatchFromMmHg} mmHg to headache risk under 1%; this hour is above that level.",
      do: "Tell the crew if you get a headache, and recheck in an hour.",
    },
    source: cite(SOURCES.co2Headache, ["OCHMO-TB-004, p. 5"]),
  },
  {
    id: "co2-seven-day-watch",
    title: "CO₂ high this week",
    area: "cabin", hazard: "environment", layer: "standard", status: "watch",
    when: [{ fact: "co2SevenDayAverageMmHg", op: "gte", setting: "co2.sevenDayWatchFromMmHg" }],
    message: {
      what: "Cabin CO₂ has averaged {co2SevenDayAverageMmHg} mmHg over the last 7 days.",
      why: "NASA advises a 7-day average below {setting:co2.sevenDayWatchFromMmHg} mmHg to hold headache risk under 1%.",
      do: "Report the trend to the crew so CO₂ removal can be checked.",
    },
    source: cite(SOURCES.co2Headache, ["OCHMO-TB-004, p. 5", "OCHMO-TB-004, p. 7"]),
  },
  {
    id: "pressure-low-alert",
    title: "Cabin pressure too low",
    area: "cabin", hazard: "environment", layer: "standard", status: "alert",
    when: [{ fact: "pressureKPa", op: "lte", setting: "pressure.minExclusiveKPa" }],
    message: {
      what: "Cabin pressure at your watch reads {pressureKPa} kPa, at or below NASA's {setting:pressure.minExclusiveKPa} kPa minimum.",
      why: "Pressure this low risks hypoxia and decompression sickness.",
      do: "Check the ship's own cabin pressure display and tell the crew right away. An alert has been sent to the flight surgeon.",
    },
    source: cite(SOURCES.pressureLimit, ["OCHMO-TB-003, p. 2"]),
  },
  {
    id: "pressure-high-alert",
    title: "Cabin pressure too high",
    area: "cabin", hazard: "environment", layer: "standard", status: "alert",
    when: [{ fact: "pressureKPa", op: "gt", setting: "pressure.maxKPa" }],
    message: {
      what: "Cabin pressure at your watch reads {pressureKPa} kPa, above NASA's {setting:pressure.maxKPa} kPa maximum.",
      why: "NASA sets {setting:pressure.maxKPa} kPa as the upper limit for indefinite exposure [V2 6006].",
      do: "Report it to the crew so the pressure can be checked. An alert has been sent to the flight surgeon.",
    },
    source: cite(SOURCES.pressureLimit, ["OCHMO-TB-003, p. 3"]),
  },
  {
    id: "pressure-shift-watch",
    title: "Cabin pressure shift",
    area: "cabin", hazard: "environment", layer: "standard", status: "watch",
    when: [
      { fact: "pressureKPa", op: "gt", setting: "pressure.minExclusiveKPa" },
      { fact: "pressureKPa", op: "lte", setting: "pressure.maxKPa" },
      { fact: "pressureShiftKPa", op: "gt", setting: "pressure.watchShiftFromDayAverageKPa" },
    ],
    message: {
      what: "Cabin pressure at your watch reads {pressureKPa} kPa, {pressureShiftKPa} kPa away from its average over the last 24 hours.",
      why: "A shift like this can come from a real change in cabin pressure or from the watch sensor.",
      do: "Recheck in a few minutes and report it to the crew if it holds.",
    },
    source: cite(SOURCES.pressureShift, []),
  },
  {
    id: "cabin-comfort-zone-watch",
    title: "Cabin air outside comfort zone",
    area: "cabin", hazard: "environment", layer: "standard", status: "watch",
    when: [{ fact: "cabinOutsideZone", is: true }, { fact: "cabinBeyondZoneMargin", is: false }],
    message: {
      what: "Cabin air is {cabinTempC} °C at {cabinHumidityPct}% humidity, outside NASA's temperature and humidity zone.",
      why: "NASA limits temperature and humidity together; outside the zone crews can have dry or irritated airways, rashes, thermal discomfort or lower performance [V2 6012].",
      do: "Tell the crew so the cabin air can be checked, and tell the flight surgeon if you feel unwell.",
    },
    source: cite(SOURCES.zone, ["NASA-STD-3001 Vol 2 Rev F §6.2.3.1, p. 56"]),
  },
  {
    id: "cabin-comfort-zone-alert",
    title: "Cabin air far outside comfort zone",
    area: "cabin", hazard: "environment", layer: "standard", status: "alert",
    when: [{ fact: "cabinBeyondZoneMargin", is: true }],
    message: {
      what: "Cabin air is {cabinTempC} °C at {cabinHumidityPct}% humidity, more than {setting:cabinZone.alertMarginC} °C or {setting:cabinZone.alertMarginRhPct}% humidity outside NASA's zone.",
      why: "Far outside the zone, thermal discomfort and lower performance are more likely [V2 6012].",
      do: "Report it to the crew so the cabin air can be fixed. An alert has been sent to the flight surgeon.",
    },
    source: cite(SOURCES.zoneMargin, ["NASA-STD-3001 Vol 2 Rev F §6.2.3.1, p. 56"]),
  },
  {
    id: "noise-sleep-watch",
    title: "Noisy sleep period",
    area: "cabin", hazard: "environment", layer: "standard", status: "watch",
    when: [{ fact: "noiseSleepLevelDba", op: "gt", setting: "noise.sleepWatchAboveDba" }],
    message: {
      what: "Noise during the sleep period averaged {noiseSleepLevelDba} dBA, above the {setting:noise.sleepWatchAboveDba} dBA sleep limit.",
      why: "Noise above this level can disturb sleep; an ISS flight rule sets sleep stations at {setting:noise.sleepWatchAboveDba} dBA or below.",
      do: "Close your crew quarters and use earplugs; report loud equipment.",
    },
    source: cite(SOURCES.noiseSleep, ["ICES-2024-354 ISS Acoustics, p. 4", "ISS Crewmember Noise Exposures (InterNoise 2021), p. 7", "ISS Crewmember Noise Exposures (InterNoise 2021), p. 9"]),
  },
  {
    id: "noise-awake-watch",
    title: "Noisy work area",
    area: "cabin", hazard: "environment", layer: "standard", status: "watch",
    when: [{ fact: "noiseAwakeLevelDba", op: "gt", setting: "noise.awakeWatchAboveDba" }],
    message: {
      what: "Noise while awake averaged {noiseAwakeLevelDba} dBA, above {setting:noise.awakeWatchAboveDba} dBA, our rough dBA stand-in for NASA's NC-50 work-area limit.",
      why: "Constant noise can make it harder to talk and work, and can cause irritation and headaches.",
      do: "Wear hearing protection near loud equipment and report it.",
    },
    source: cite(SOURCES.noiseAwake, ["OCHMO-TB-035, p. 3", "ISS Crewmember Noise Exposures (InterNoise 2021), p. 2"]),
  },
  {
    id: "noise-day-alert",
    title: "Daily noise over limit",
    area: "cabin", hazard: "environment", layer: "standard", status: "alert",
    when: [{ fact: "noiseDayLevelDba", op: "gt", setting: "noise.dayAlertAboveDba" }],
    message: {
      what: "Noise over the last 24 hours averaged {noiseDayLevelDba} dBA, above NASA's {setting:noise.dayAlertAboveDba} dBA daily limit.",
      why: "A daily noise dose this high can damage hearing [V2 6115].",
      do: "Wear hearing protection now. An alert has been sent to the flight surgeon.",
    },
    source: cite(SOURCES.noiseDay, ["NASA-STD-3001 Vol 2 Rev F §6.6.1.6, p. 97", "ISS Crewmember Noise Exposures (InterNoise 2021), p. 2"]),
  },
];

/** 🟡 between the watch and alert distances from baseline, 🔴 beyond the alert distance. */
const watchBand = (fact: "heartRateAboveBaselineSd" | "skinTempAwayFromBaselineSd" | "hrvBelowBaselineSd") => [
  { fact, op: "gt", setting: "baseline.watchBeyondSd" },
  { fact, op: "lte", setting: "baseline.alertBeyondSd" },
] as const;

const VITALS_RULES: readonly Rule[] = [
  {
    id: "spo2-watch",
    title: "Blood oxygen low",
    area: "vitals", hazard: null, layer: "standard", status: "watch",
    when: [
      { fact: "spo2Pct", op: "gte", setting: "spo2.alertBelowPct" },
      { fact: "spo2Pct", op: "lt", setting: "spo2.watchBelowPct" },
    ],
    message: {
      what: "Your blood oxygen is {spo2Pct}%, below the normal {setting:spo2.watchBelowPct}%.",
      why: "A low reading can be a real drop in blood oxygen, or it can come from the watch fitting loosely.",
      do: "Sit still, tighten the watch, and measure again in 5 minutes.",
    },
    source: cite(SOURCES.clinical, []),
  },
  {
    id: "spo2-alert",
    title: "Blood oxygen very low",
    area: "vitals", hazard: null, layer: "standard", status: "alert",
    when: [{ fact: "spo2Pct", op: "lt", setting: "spo2.alertBelowPct" }],
    message: {
      what: "Your blood oxygen is {spo2Pct}%, below {setting:spo2.alertBelowPct}%.",
      why: "Blood oxygen this low means the body may not be getting enough oxygen.",
      do: "Stop what you are doing and measure again now. An alert has been sent to the flight surgeon.",
    },
    source: cite(SOURCES.clinical, ["OCHMO-TB-003, p. 5"]),
  },
  {
    id: "heart-rate-low-alert",
    title: "Heart rate very low",
    area: "vitals", hazard: null, layer: "standard", status: "alert",
    when: [{ fact: "heartRateBpm", op: "lt", setting: "heartRate.alertBelowBpm" }],
    message: {
      what: "Your heart rate is {heartRateBpm} bpm, below {setting:heartRate.alertBelowBpm} bpm.",
      why: "A heart rate this low is outside the range this app treats as safe, and it needs a check.",
      do: "Take an ECG now. An alert has been sent to the flight surgeon.",
    },
    source: cite(SOURCES.heartRateExtreme, []),
  },
  {
    id: "heart-rate-high-alert",
    title: "Heart rate very high",
    area: "vitals", hazard: null, layer: "standard", status: "alert",
    when: [{ fact: "heartRateBpm", op: "gt", setting: "heartRate.alertAboveBpm" }],
    message: {
      what: "Your heart rate is {heartRateBpm} bpm, above {setting:heartRate.alertAboveBpm} bpm.",
      why: "A heart rate this high can happen during very hard exercise; at any other time it needs a check.",
      do: "Stop and rest, then take an ECG. An alert has been sent to the flight surgeon.",
    },
    source: cite(SOURCES.heartRateExtreme, []),
  },
  {
    id: "heart-rate-above-baseline-watch",
    title: "Heart rate above your normal",
    area: "vitals", hazard: null, layer: "baseline", status: "watch",
    when: watchBand("heartRateAboveBaselineSd"),
    message: {
      what: "Your heart rate is {heartRateBpm} bpm, {heartRateAboveBaselineSd} standard deviations above your baseline.",
      why: "Your heart rate is well above your usual range. Exercise and other activity raise it; if you have been resting, it is worth a check.",
      do: "Hydrate, rest 10 minutes, then recheck.",
    },
    source: cite(SOURCES.baseline, []),
  },
  {
    id: "heart-rate-above-baseline-alert",
    title: "Heart rate far above your normal",
    area: "vitals", hazard: null, layer: "baseline", status: "alert",
    when: [{ fact: "heartRateAboveBaselineSd", op: "gt", setting: "baseline.alertBeyondSd" }],
    message: {
      what: "Your heart rate is {heartRateBpm} bpm, {heartRateAboveBaselineSd} standard deviations above your baseline.",
      why: "A heart rate this far above your normal needs a check, unless you are exercising hard.",
      do: "Stop and rest, then take an ECG. An alert has been sent to the flight surgeon.",
    },
    source: cite(SOURCES.baseline, []),
  },
  {
    id: "skin-temp-off-baseline-watch",
    title: "Skin temperature off your normal",
    area: "vitals", hazard: null, layer: "baseline", status: "watch",
    when: watchBand("skinTempAwayFromBaselineSd"),
    message: {
      what: "Your skin temperature is {skinTempAwayFromBaselineSd} standard deviations away from your baseline.",
      why: "Skin temperature changes with the cabin temperature, activity and the watch fit; a lasting change is worth watching.",
      do: "Recheck in 30 minutes, and tell the flight surgeon if you feel unwell.",
    },
    source: cite(SOURCES.baseline, []),
  },
  {
    id: "skin-temp-off-baseline-alert",
    title: "Skin temperature far off your normal",
    area: "vitals", hazard: null, layer: "baseline", status: "alert",
    when: [{ fact: "skinTempAwayFromBaselineSd", op: "gt", setting: "baseline.alertBeyondSd" }],
    message: {
      what: "Your skin temperature is {skinTempAwayFromBaselineSd} standard deviations away from your baseline.",
      why: "A change this large from your normal needs a check.",
      do: "Rest and recheck now. An alert has been sent to the flight surgeon.",
    },
    source: cite(SOURCES.baseline, []),
  },
  {
    id: "hrv-below-baseline-watch",
    title: "HRV below your normal",
    area: "vitals", hazard: null, layer: "baseline", status: "watch",
    when: watchBand("hrvBelowBaselineSd"),
    message: {
      what: "Your heart rate variability is {hrvBelowBaselineSd} standard deviations below your baseline.",
      why: "Your HRV is lower than usual for you. Sleep loss and heavy workloads are common stressors in spaceflight.",
      do: "Take a short break, and aim for a full sleep period tonight.",
    },
    source: cite(SOURCES.baseline, ["NASA HRP, Risks of Human Spaceflight, p. 7"]),
  },
  {
    id: "hrv-below-baseline-alert",
    title: "HRV far below your normal",
    area: "vitals", hazard: null, layer: "baseline", status: "alert",
    when: [{ fact: "hrvBelowBaselineSd", op: "gt", setting: "baseline.alertBeyondSd" }],
    message: {
      what: "Your heart rate variability is {hrvBelowBaselineSd} standard deviations below your baseline.",
      why: "HRV this far below your normal needs a check.",
      do: "Rest now. An alert has been sent to the flight surgeon.",
    },
    source: cite(SOURCES.baseline, []),
  },
];

// Gravity is rated only by these two rules firing (owner decision): otherwise it has no status.
const GRAVITY_RULES: readonly Rule[] = [
  {
    id: "gravity-exercise-goal-met",
    title: "Exercise goal met",
    area: "gravity", hazard: "gravity", layer: "standard", status: "normal", ratesOnlyWhenFired: true,
    when: [{ fact: "exerciseMinutesToday", op: "gte", setting: "exercise.dailyGoalMinutes" }],
    message: {
      what: "You have {exerciseMinutesToday} exercise minutes today, meeting the {setting:exercise.dailyGoalMinutes}-minute daily goal.",
      why: "Daily exercise protects bones and muscles in microgravity.",
      do: "Keep it up tomorrow.",
    },
    source: cite(SOURCES.exercise, ["NASA HRP, Risks of Human Spaceflight, p. 5"]),
  },
  {
    id: "gravity-exercise-watch",
    title: "Exercise behind pace",
    area: "gravity", hazard: "gravity", layer: "standard", status: "watch", ratesOnlyWhenFired: true,
    when: [
      { fact: "exerciseMinutesToday", op: "lt", setting: "gravity.exerciseWatchBelowMinutes" },
      { fact: "utcHourOfDay", op: "gte", setting: "gravity.exerciseCheckFromHourUtc" },
    ],
    message: {
      what: "You have {exerciseMinutesToday} exercise minutes today, under {setting:gravity.exerciseWatchBelowMinutes} this late in the day.",
      why: "Without gravity, bones and muscles weaken; all astronauts exercise during their missions to counter this.",
      do: "Fit in an exercise session before your sleep period.",
    },
    source: cite(SOURCES.exercise, ["NASA HRP, Risks of Human Spaceflight, p. 5", "NASA HRP, Risks of Human Spaceflight, p. 6"]),
  },
];

/**
 * One daily nutrient: its bands (from NUTRITION_CHECK_SPECS) and its wording. Rules are generated
 * below so every nutrient reads the same way.
 */
interface NutrientBands extends NutritionCheckSpec {
  /** Names the nutrient in the rule titles. */
  name: string;
  /** How yesterday's amount reads in a message, and how the target range reads. */
  amount: string;
  target: string;
  whyLow: string;
  whyHigh: string;
  doLow: string;
  doHigh: string;
  source: Omit<RuleSource, "citations">;
  /** Where the low-side and high-side "why" sentences come from (message audit, 2026-11-14). */
  citesLow: readonly string[];
  citesHigh: readonly string[];
}

const NUTRITION_DOC = "NASA JSC, Nutrition Requirements, Standards, and Operating Bands for Exploration Missions (2005; NTRS 20200001703)";
const nutritionSource = (requirement: string, page: number): Omit<RuleSource, "citations"> =>
  ({ requirementId: requirement, document: `${NUTRITION_DOC}, ${requirement}, p. ${page}`, ours: false });
const NOTIFIED = " An alert has been sent to the flight surgeon.";
const NUTRITION_CITATION = "NASA Nutrition Requirements for Exploration Missions (2005)";
const nutritionPages = (...pages: number[]) => pages.map((page) => `${NUTRITION_CITATION}, p. ${page}`);

function nutrientRules(n: NutrientBands): Rule[] {
  const base = { area: "nutrition", hazard: null, layer: "standard" } as const;
  const source = (side: "low" | "high") => cite(n.source, side === "low" ? n.citesLow : n.citesHigh);
  const title = (side: "low" | "high") => `${n.name} ${side} yesterday`;
  const message = (side: "low" | "high", alert: boolean) => ({
    what: `Yesterday ${n.amount}, ${side === "low" ? "below" : "above"} the daily target of ${n.target}.`,
    why: side === "low" ? n.whyLow : n.whyHigh,
    do: (side === "low" ? n.doLow : n.doHigh) + (alert ? NOTIFIED : ""),
  });
  const rules: Rule[] = [
    { ...base, id: `nutrition-${n.check}-low-alert`, title: title("low"), source: source("low"), status: "alert", when: [{ fact: n.fact, op: "lt", setting: n.alertBelow }], message: message("low", true) },
    {
      ...base, id: `nutrition-${n.check}-low-watch`, title: title("low"), source: source("low"), status: "watch", message: message("low", false),
      when: [{ fact: n.fact, op: "gte", setting: n.alertBelow }, { fact: n.fact, op: "lt", setting: n.watchBelow }],
    },
    {
      ...base, id: `nutrition-${n.check}-high-watch`, title: title("high"), source: source("high"), status: "watch", message: message("high", false),
      when: [
        { fact: n.fact, op: "gt", setting: n.watchAbove },
        ...(n.alertAbove ? [{ fact: n.fact, op: n.alertAboveIncludesEdge ? "lt" : "lte", setting: n.alertAbove } as const] : []),
      ],
    },
  ];
  if (n.alertAbove) {
    rules.push({ ...base, id: `nutrition-${n.check}-high-alert`, title: title("high"), source: source("high"), status: "alert", when: [{ fact: n.fact, op: n.alertAboveIncludesEdge ? "gte" : "gt", setting: n.alertAbove }], message: message("high", true) });
  }
  return rules;
}

// Daily totals of yesterday, the last complete UTC day (owner decision).
const NUTRIENT_BANDS: readonly NutrientBands[] = [
  {
    citesLow: nutritionPages(8), citesHigh: nutritionPages(12),
    ...NUTRITION_CHECK_SPECS.energy, name: "Energy intake",
    amount: "you logged {energyDayKcal} kcal, {energyDayPctOfEer}% of your estimated energy requirement ({eerKcal} kcal)",
    target: "{setting:nutrition.energyWatchBelowPct}–{setting:nutrition.energyWatchAbovePct}%",
    whyLow: "Eating less than the body needs leads to loss of body mass, mostly muscle and fat, which has been common in spaceflight.",
    whyHigh: "Eating well above your needs over many days leads to weight gain.",
    doLow: "Eat full meals and add snacks today.",
    doHigh: "Choose smaller portions today.",
    source: nutritionSource("Req. 1", 14),
  },
  {
    citesLow: nutritionPages(15, 18), citesHigh: nutritionPages(17),
    ...NUTRITION_CHECK_SPECS.protein, name: "Protein share",
    amount: "{proteinDayPctOfKcal}% of your calories came from protein",
    target: "{setting:nutrition.proteinWatchBelowPctKcal}–{setting:nutrition.proteinWatchAbovePctKcal}% of calories",
    whyLow: "Protein helps protect muscle, which shrinks in microgravity.",
    whyHigh: "Very high protein intake can increase calcium loss from bone.",
    doLow: "Add protein-rich menu items today.",
    doHigh: "Balance today's meals with more vegetables and grains.",
    source: nutritionSource("Req. 2", 18),
  },
  {
    citesLow: nutritionPages(74, 76), citesHigh: nutritionPages(74, 77),
    ...NUTRITION_CHECK_SPECS.calcium, name: "Calcium",
    amount: "you logged {calciumDayMg} mg of calcium",
    target: "{setting:nutrition.calciumWatchBelowMg}–{setting:nutrition.calciumWatchAboveMg} mg",
    whyLow: "Bones lose calcium in microgravity, and too little in the diet adds to the loss.",
    whyHigh: "Too much calcium raises the risk of kidney stones, which is already higher in spaceflight.",
    doLow: "Add calcium-rich menu items today.",
    doHigh: "Choose fewer calcium-rich items today.",
    source: nutritionSource("Req. 20", 78),
  },
  {
    citesLow: nutritionPages(44), citesHigh: nutritionPages(44),
    ...NUTRITION_CHECK_SPECS.vitaminD, name: "Vitamin D",
    amount: "you logged {vitaminDDayUg} µg of vitamin D",
    target: "{setting:nutrition.vitaminDWatchBelowUg}–{setting:nutrition.vitaminDWatchAboveUg} µg",
    whyLow: "Without sunlight, astronauts depend on food and supplements for the vitamin D their bones need.",
    whyHigh: "Very high vitamin D intake over time can be harmful.",
    doLow: "Add vitamin D-rich menu items today, and ask the flight surgeon about supplements.",
    doHigh: "Choose fewer vitamin D-rich items today, and tell the flight surgeon if you take a supplement.",
    source: nutritionSource("Req. 8", 45),
  },
  {
    citesLow: nutritionPages(32, 33), citesHigh: nutritionPages(33),
    ...NUTRITION_CHECK_SPECS.sodium, name: "Sodium",
    amount: "you logged {sodiumDayMg} mg of sodium",
    target: "{setting:nutrition.sodiumWatchBelowMg}–{setting:nutrition.sodiumWatchAboveMg} mg",
    whyLow: "Too little sodium can upset the body's fluid and electrolyte balance.",
    whyHigh: "High sodium is linked to bone loss, kidney stones and high blood pressure.",
    doLow: "Add a salted item to today's meals.",
    doHigh: "Choose lower-sodium items today.",
    source: nutritionSource("Req. 23", 34),
  },
];

/** Req. 2's minimum, beside the share-of-calories bands; NASA gives no red band for it (owner decision). */
const PROTEIN_MINIMUM_RULE: Rule = {
  id: "nutrition-protein-minimum-watch",
  title: "Protein below minimum yesterday",
  area: "nutrition", hazard: null, layer: "standard", status: "watch",
  when: [{ fact: "proteinDayGPerKg", op: "lt", setting: "nutrition.proteinGPerKg" }],
  message: {
    what: "Yesterday you logged {proteinDayG} g of protein, below your minimum of {proteinMinimumG} g ({setting:nutrition.proteinGPerKg} g per kg of body mass).",
    why: "Protein helps protect muscle, which shrinks in microgravity.",
    do: "Add protein-rich menu items today.",
  },
  source: cite(nutritionSource("Req. 2", 18), nutritionPages(15, 18)),
};

const NUTRITION_RULES: readonly Rule[] = [...NUTRIENT_BANDS.flatMap(nutrientRules), PROTEIN_MINIMUM_RULE];

/** Low mood and low HRV, plus short sleep once sleep data exists (owner decision). */
const BEHAVIORAL_HEALTH_WHEN = [
  { fact: "shortSleepNightsInARow", op: "gte", setting: "sleep.shortNightsInARow", onlyWithData: true },
  { fact: "moodAverage", op: "lte", setting: "mind.lowMoodAverageAtOrBelow" },
  { fact: "hrvBelowBaselineSd", op: "gt", setting: "baseline.watchBeyondSd" },
] as const;

const COMBINATION_RULES: readonly Rule[] = [
  {
    id: "behavioral-health-watch",
    title: "Possible behavioral health concern",
    area: "mind", hazard: "isolation", layer: "combination", status: "watch",
    when: [...BEHAVIORAL_HEALTH_WHEN, { fact: "stressAverage", op: "lt", setting: "mind.highStressAverageAtOrAbove" }],
    message: {
      what: "Your mood check-ins over the last {setting:mind.windowDays} days averaged low ({moodAverage}), and your HRV is {hrvBelowBaselineSd} standard deviations below your baseline.",
      why: "Isolation, confinement and disrupted sleep add up on long missions.",
      do: "Protect your next sleep period and consider a private call with the flight surgeon or family.",
    },
    source: cite(SOURCES.combination, ["NASA HRP, Risks of Human Spaceflight, p. 7", "ISS Crewmember Noise Exposures (InterNoise 2021), p. 9"]),
  },
  {
    id: "behavioral-health-alert",
    title: "Behavioral health concern",
    area: "mind", hazard: "isolation", layer: "combination", status: "alert",
    when: [...BEHAVIORAL_HEALTH_WHEN, { fact: "stressAverage", op: "gte", setting: "mind.highStressAverageAtOrAbove" }],
    message: {
      what: "Your mood check-ins averaged low ({moodAverage}) and your stress check-ins high ({stressAverage}) over the last {setting:mind.windowDays} days, and your HRV is {hrvBelowBaselineSd} standard deviations below your baseline.",
      why: "Isolation, confinement and disrupted sleep add up on long missions.",
      do: "An alert has been sent to the flight surgeon. You can ask them for a private conference.",
    },
    source: cite(SOURCES.combination, ["NASA HRP, Risks of Human Spaceflight, p. 7", "ISS Crewmember Noise Exposures (InterNoise 2021), p. 9"]),
  },
];

/**
 * Every rule, in display order within each area. The §6.4 radiation event rule is
 * radiation-solar-event-alert: it reads only the ship's sensors, so it applies to the whole crew.
 */
export const RULES: readonly Rule[] = [
  ...VITALS_RULES, ...RADIATION_RULES, ...GRAVITY_RULES, ...CABIN_RULES, ...NUTRITION_RULES, ...COMBINATION_RULES,
];
