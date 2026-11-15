// Every number the rules engine uses, in one place (SPEC §6). Each value cites where it comes from:
// SPEC, a NASA document, or a recorded owner decision. A null value would mark a number not yet
// decided: every rule that needs it stays pending (defined, reported, never fired).
import type { DisplaySettingKey, Metric } from "@heartbeat/shared";

const SETTINGS = {
  // Radiation, solar event: daily dose (rolling 24 hours) vs. the previous 7-day average
  // (SPEC §5.7, §6.5, ours).
  "radiation.solarEventWatchMultiple": 1.25,
  "radiation.solarEventAlertMultiple": 1.5,
  // Radiation, career: NASA limits career effective dose to < 600 mSv [V1 4030]; 🟡 at ≥ 80%
  // (ours); 🔴 when projected to reach the limit (SPEC §6.5). Our career figure is a dose
  // equivalent (estimate), compared with that limit as the closest stand-in (owner decision).
  "radiation.careerLimitMSv": 600,
  "radiation.careerWatchFraction": 0.8,
  "radiation.careerAlertProjectedFraction": 1,
  /**
   * mSv of dose equivalent per mGy of absorbed dose (RadLab reports absorbed dose). Owner decision:
   * 2.26 from DOSIS ISS measurements, 286 µGy/day absorbed ↔ 647 µSv/day dose equivalent
   * (Berger et al., DOSIS-3D, J. Space Weather Space Clim., 2016/2017).
   */
  "radiation.doseEquivalentPerAbsorbedDose": 2.26,
  /** Career dose before this mission. Owner decision. */
  "radiation.priorCareerDoseMSv": 0,
  /** Planned mission length, for the career projection. Owner decision. */
  "mission.plannedLengthDays": 180,

  // CO₂ [V2 6004] and OCHMO-TB-004 headache guidance (SPEC §6.5).
  "co2.oneHourAlertAboveMmHg": 3.0,
  "co2.oneHourWatchFromMmHg": 2.5,
  "co2.sevenDayWatchFromMmHg": 2.5,

  // Cabin pressure [V2 6006]: 🔴 outside 34.5 kPa < pressure ≤ 103 kPa. Owner decision: 🟡 when
  // the watch's latest reading is more than 3 kPa from its own 24-hour average (leak detection).
  "pressure.minExclusiveKPa": 34.5,
  "pressure.maxKPa": 103,
  "pressure.watchShiftFromDayAverageKPa": 3,

  // Temperature + humidity zone [V2 6012]: 🔴 outside by > 2 °C or > 10% RH (ours).
  "cabinZone.alertMarginC": 2,
  "cabinZone.alertMarginRhPct": 10,

  // Noise [V2 6079] / Flight Rule B13-152, [V2 6078] (ours, approximate), [V2 6115].
  "noise.sleepWatchAboveDba": 50,
  "noise.awakeWatchAboveDba": 58,
  "noise.dayAlertAboveDba": 70,
  /** Crew sleep period 21:30–06:00 UTC, in hours of the UTC day. Owner decision. */
  "noise.sleepStartHourUtc": 21.5,
  "noise.sleepEndHourUtc": 6,

  // SpO₂: 🟢 ≥ 95 · 🟡 90–94 · 🔴 < 90 (SPEC §6.5).
  "spo2.watchBelowPct": 95,
  "spo2.alertBelowPct": 90,

  /** Heart rate 🔴 at clear extremes, any time. Owner decision; otherwise heart rate is rated by the baseline. */
  "heartRate.alertBelowBpm": 40,
  "heartRate.alertAboveBpm": 180,

  // Personal baseline (SPEC §6.2). Owner decisions: the last 14 days of real readings, used once
  // they fall on at least 7 distinct UTC days; 🟡 beyond 2 and 🔴 beyond 3 standard deviations
  // from the mean (heart rate above, skin temperature either way, HRV below).
  "baseline.windowDays": 14,
  "baseline.minimumDistinctDays": 7,
  "baseline.watchBeyondSd": 2,
  "baseline.alertBeyondSd": 3,

  // Behavioral health combination rule (SPEC §6.4). Sleep: < 6 h for 3 nights (SPEC). Owner
  // decisions: low mood = mean ≤ 2 and high stress = mean ≥ 4 over the last 3 days of check-ins.
  "sleep.shortNightHours": 6,
  "sleep.shortNightsInARow": 3,
  "mind.windowDays": 3,
  "mind.lowMoodAverageAtOrBelow": 2,
  "mind.highStressAverageAtOrAbove": 4,
  /** Check-ins needed in the window before mood and stress are averaged (owner decision). */
  "mind.minimumCheckIns": 2,

  // Gravity (owner decision): 🟡 when exercise minutes today are under 60 at or after 18:00 UTC.
  "gravity.exerciseWatchBelowMinutes": 60,
  "gravity.exerciseCheckFromHourUtc": 18,
  /**
   * An exercise minute has heart rate at or above this fraction of the estimated max heart rate
   * (220 − age): the ACSM/CDC moderate-intensity cutoff, 64% (owner decision, SPEC §5.4).
   */
  "exercise.moderateIntensityFraction": 0.64,
  /** The daily exercise goal (SPEC §5.4): ISS astronauts exercise about 2 hours a day. Gravity is 🟢 once it is met. */
  "exercise.dailyGoalMinutes": 120,
  /** A scheduled task is done when matching real activity is recorded within this many minutes of its time (owner decision). */
  "tasks.doneWithinMinutes": 120,

  // Gamification (SPEC §7). Points a task earns once done, by kind, from the approved dashboard
  // mockup (owner decision): ECG 20, each SpO₂ check 10, mood check-in 15, each meal task 10 (per
  // meal task done, not per food logged), the daily exercise goal 40. A full day of the default
  // schedule (two SpO₂ checks, three meals) is 125.
  "points.ecg": 20,
  "points.spo2": 10,
  "points.checkIn": 15,
  "points.meal": 10,
  "points.exercise": 40,
  /** Badges (owner decision): the mood check-in done, or the exercise goal met, this many UTC days in a row. */
  "badges.checkInStreakDays": 7,
  "badges.boneGuardianDays": 7,

  // Nutrition, daily totals of the last complete UTC day (owner decision), from NASA JSC
  // "Nutrition Requirements, Standards, and Operating Bands for Exploration Missions" (2005,
  // NTRS 20200001703). Green is between each nutrient's watch bounds.
  /**
   * Req. 1, p. 14: energy as % of EER. NASA's table: 90-100% green, 80-90% yellow, <80% red, and
   * "110%" yellow / "120%" red without ranges. Owner decision 2026-11-14 (the strict reading):
   * green 90-100%, yellow 100-120%, red from 120%.
   */
  "nutrition.energyAlertBelowPct": 80,
  "nutrition.energyWatchBelowPct": 90,
  "nutrition.energyWatchAbovePct": 100,
  "nutrition.energyAlertFromPct": 120,
  /** Req. 2, p. 18: protein 0.8 g/kg per day; share of calories 15-30% green, 10-15/30-35% yellow. */
  "nutrition.proteinGPerKg": 0.8,
  "nutrition.proteinAlertBelowPctKcal": 10,
  "nutrition.proteinWatchBelowPctKcal": 15,
  "nutrition.proteinWatchAbovePctKcal": 30,
  "nutrition.proteinAlertAbovePctKcal": 35,
  /** Energy per gram of protein, the general Atwater factor, to turn grams into a share of calories. */
  "nutrition.proteinKcalPerG": 4,
  /** Req. 20, p. 78: calcium 1200-2000 mg/d green. */
  "nutrition.calciumAlertBelowMg": 1000,
  "nutrition.calciumWatchBelowMg": 1200,
  "nutrition.calciumWatchAboveMg": 2000,
  "nutrition.calciumAlertAboveMg": 2500,
  /** Req. 8, p. 45: vitamin D 25-50 µg/d green; above 50 is yellow, with no red above. */
  "nutrition.vitaminDAlertBelowUg": 10,
  "nutrition.vitaminDWatchBelowUg": 25,
  "nutrition.vitaminDWatchAboveUg": 50,
  /**
   * Req. 23, p. 34: sodium 1500-2300 mg/d green, 500-1500 yellow, <500 and >3500 red (NASA's table).
   * The table's upper yellow row reads only "3500 mg/d"; owner decision 2026-11-14: the gap
   * 2300-3500 is yellow.
   */
  "nutrition.sodiumAlertBelowMg": 500,
  "nutrition.sodiumWatchBelowMg": 1500,
  "nutrition.sodiumWatchAboveMg": 2300,
  "nutrition.sodiumAlertAboveMg": 3500,

  /**
   * Windowed averages need a reading in every slot of this many minutes (owner decision: at least
   * one reading per 15 minutes), or a slot of the source's own sampling period when that is longer.
   */
  "coverage.slotMinutes": 15,
  /** The 7-day CO₂ average needs readings on at least 5 of its 7 days (owner decision). */
  "coverage.co2SevenDayMinimumDays": 5,
} satisfies Record<string, number | null> & Record<DisplaySettingKey, number | null>;

export type SettingKey = keyof typeof SETTINGS;

export type RuleSettings = Readonly<Record<SettingKey, number | null>>;

/** The rules engine's configuration. Tests inject their own to exercise pending rules. */
export const RULE_SETTINGS: RuleSettings = SETTINGS;

/** Minutes after which a metric's newest reading expires; metrics not listed never expire. */
export type MaxReadingAges = Readonly<Partial<Record<Metric, number>>>;

/**
 * How old a metric's newest reading may be before the metric reports "no recent data" (owner
 * decision): heart rate, HRV, skin temperature and pressure 15 minutes; SpO₂ and ECG 24 hours;
 * the ship's radiation and cabin sensors 2 hours.
 */
export const MAX_READING_AGE_MINUTES: MaxReadingAges = {
  heartRate: 15,
  hrv: 15,
  skinTemp: 15,
  pressure: 15,
  spo2: 24 * 60,
  ecg: 24 * 60,
  radiationDoseRate: 2 * 60,
  co2: 2 * 60,
  cabinTemp: 2 * 60,
  humidity: 2 * 60,
};

/**
 * Estimated energy requirement, kcal/day, for adults 19 and older (Req. 1, p. 14, of the NASA
 * nutrition requirements above), with its activity factor of 1.25:
 * EER = base − perYear × age + 1.25 × (perKg × mass + perM × height).
 */
export const EER_EQUATIONS = {
  male: { base: 622, perYear: 9.53, activityFactor: 1.25, perKg: 15.9, perM: 539.6 },
  female: { base: 354, perYear: 6.91, activityFactor: 1.25, perKg: 9.36, perM: 726 },
} as const;

/** The settings among `keys` that are still unset. */
export function unsetSettings(settings: RuleSettings, keys: readonly SettingKey[]): SettingKey[] {
  return keys.filter((key) => settings[key] === null);
}

/** The values of `keys`, or null if any of them is unset. */
export function settingValues<K extends SettingKey>(settings: RuleSettings, keys: readonly K[]): Record<K, number> | null {
  const values = {} as Record<K, number>;
  for (const key of keys) {
    const value = settings[key];
    if (value === null) return null;
    values[key] = value;
  }
  return values;
}
