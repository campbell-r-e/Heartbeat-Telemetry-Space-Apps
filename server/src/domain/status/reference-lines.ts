// What to draw on each metric's chart (owner decision): the normal band and the watch and alert
// lines, from the settings or, once ready, the astronaut's personal baseline (mean ± 2 and 3 SD).
// In each chart's own unit, so clients compute nothing. Labels never repeat the line's value:
// clients show the label, then the value and the chart's unit.
import type { Metric, MetricReferenceLines, ReferenceLine } from "@heartbeat/shared";
import { METRIC_UNITS } from "../metrics.ts";
import type { FactValues } from "../rules/facts.ts";
import { settingLabel } from "../rules/limits.ts";
import type { Rule } from "../rules/rule.ts";
import type { RuleBook } from "../rules/rule-book.ts";
import type { RuleSettings } from "../rules/settings.ts";
import { HOURS_PER_DAY } from "../time.ts";
import type { Baseline } from "./baseline.ts";
import { baselinesFor, HPA_PER_KPA, type StatusInputs } from "./compute-facts.ts";

const line = (value: number, status: ReferenceLine["status"], label: string): ReferenceLine => ({ value, status, label });
const chart = (metric: Metric, rest: Omit<MetricReferenceLines, "metric" | "unit">): MetricReferenceLines =>
  ({ metric, unit: METRIC_UNITS[metric], ...rest });

/** Reference lines for every metric that has any, given the loaded inputs and computed facts. */
export function referenceLines(inputs: StatusInputs, facts: FactValues, { rules, settings }: Pick<RuleBook, "rules" | "settings">): MetricReferenceLines[] {
  const baselines = baselinesFor(inputs, settings);
  return [
    spo2Lines(rules, settings),
    heartRateLines(rules, settings, baselines.heartRate),
    skinTempLines(settings, baselines.skinTemp),
    hrvLines(settings, baselines.hrv),
    co2Lines(rules, settings),
    pressureLines(rules, settings, facts),
    noiseLines(rules, settings),
    radiationLines(settings, facts),
  ].filter((lines): lines is MetricReferenceLines => lines !== null);
}

/** The baseline's watch and alert edges on the given sides (thresholds), and the normal band between the watch edges. */
function baselineBand(baseline: Baseline, settings: RuleSettings, sides: { above: boolean; below: boolean }) {
  const watchSd = settings["baseline.watchBeyondSd"];
  const alertSd = settings["baseline.alertBeyondSd"];
  if (watchSd === null || alertSd === null) return null;
  const at = (sds: number) => baseline.mean + sds * baseline.sd;
  const lines: ReferenceLine[] = [];
  if (sides.above) lines.push(line(at(watchSd), "watch", `${watchSd} SD above your baseline`), line(at(alertSd), "alert", `${alertSd} SD above your baseline`));
  if (sides.below) lines.push(line(at(-watchSd), "watch", `${watchSd} SD below your baseline`), line(at(-alertSd), "alert", `${alertSd} SD below your baseline`));
  return { band: { low: sides.below ? at(-watchSd) : null, high: sides.above ? at(watchSd) : null }, thresholds: lines };
}

function spo2Lines(rules: readonly Rule[], settings: RuleSettings): MetricReferenceLines | null {
  const watch = settings["spo2.watchBelowPct"];
  const alert = settings["spo2.alertBelowPct"];
  if (watch === null || alert === null) return null;
  return chart("spo2", {
    basis: "settings", band: { low: watch, high: null },
    thresholds: [line(watch, "watch", settingLabel(rules, "spo2-watch", "spo2.watchBelowPct")), line(alert, "alert", settingLabel(rules, "spo2-alert", "spo2.alertBelowPct"))],
  });
}

function heartRateLines(rules: readonly Rule[], settings: RuleSettings, baseline: Baseline | null): MetricReferenceLines | null {
  const low = settings["heartRate.alertBelowBpm"];
  const high = settings["heartRate.alertAboveBpm"];
  const extremes = [
    ...(low === null ? [] : [line(low, "alert", settingLabel(rules, "heart-rate-low-alert", "heartRate.alertBelowBpm"))]),
    ...(high === null ? [] : [line(high, "alert", settingLabel(rules, "heart-rate-high-alert", "heartRate.alertAboveBpm"))]),
  ];
  const band = baseline && baselineBand(baseline, settings, { above: true, below: false });
  if (!band) return extremes.length === 0 ? null : chart("heartRate", { basis: "settings", band: null, thresholds: extremes });
  return chart("heartRate", { basis: "baseline", band: band.band, thresholds: [...band.thresholds, ...extremes] });
}

function skinTempLines(settings: RuleSettings, baseline: Baseline | null): MetricReferenceLines | null {
  const band = baseline && baselineBand(baseline, settings, { above: true, below: true });
  return band ? chart("skinTemp", { basis: "baseline", ...band }) : null;
}

function hrvLines(settings: RuleSettings, baseline: Baseline | null): MetricReferenceLines | null {
  const band = baseline && baselineBand(baseline, settings, { above: false, below: true });
  return band ? chart("hrv", { basis: "baseline", ...band }) : null;
}

function co2Lines(rules: readonly Rule[], settings: RuleSettings): MetricReferenceLines | null {
  const watch = settings["co2.oneHourWatchFromMmHg"];
  const alert = settings["co2.oneHourAlertAboveMmHg"];
  if (watch === null || alert === null) return null;
  return chart("co2", {
    basis: "settings", band: { low: null, high: watch },
    thresholds: [line(watch, "watch", settingLabel(rules, "co2-one-hour-watch", "co2.oneHourWatchFromMmHg")), line(alert, "alert", settingLabel(rules, "co2-one-hour-alert", "co2.oneHourAlertAboveMmHg"))],
  });
}

/** In hPa, the watch barometer's unit: NASA's absolute range, and the shift band around the watch's own 24-hour average. */
function pressureLines(rules: readonly Rule[], settings: RuleSettings, facts: FactValues): MetricReferenceLines | null {
  const min = settings["pressure.minExclusiveKPa"];
  const max = settings["pressure.maxKPa"];
  const shift = settings["pressure.watchShiftFromDayAverageKPa"];
  if (min === null || max === null) return null;
  const limits = [line(min * HPA_PER_KPA, "alert", settingLabel(rules, "pressure-low-alert", "pressure.minExclusiveKPa")),
    line(max * HPA_PER_KPA, "alert", settingLabel(rules, "pressure-high-alert", "pressure.maxKPa")),
  ];
  const average = facts.pressureDayAverageKPa?.value;
  if (average === undefined || shift === null) {
    return chart("pressure", { basis: "settings", band: { low: min * HPA_PER_KPA, high: max * HPA_PER_KPA }, thresholds: limits });
  }
  const shiftLines = [
    line((average + shift) * HPA_PER_KPA, "watch", `${shift} kPa above the 24-hour average`),
    line((average - shift) * HPA_PER_KPA, "watch", `${shift} kPa below the 24-hour average`),
  ];
  return chart("pressure", {
    basis: "settings", band: { low: (average - shift) * HPA_PER_KPA, high: (average + shift) * HPA_PER_KPA }, thresholds: [...shiftLines, ...limits],
  });
}

function noiseLines(rules: readonly Rule[], settings: RuleSettings): MetricReferenceLines | null {
  const sleep = settings["noise.sleepWatchAboveDba"];
  const awake = settings["noise.awakeWatchAboveDba"];
  const day = settings["noise.dayAlertAboveDba"];
  if (sleep === null || awake === null || day === null) return null;
  return chart("noise", {
    basis: "settings", band: { low: null, high: awake },
    thresholds: [
      line(sleep, "watch", settingLabel(rules, "noise-sleep-watch", "noise.sleepWatchAboveDba", "Sleep period")),
      line(awake, "watch", settingLabel(rules, "noise-awake-watch", "noise.awakeWatchAboveDba", "Awake")),
      line(day, "alert", settingLabel(rules, "noise-day-alert", "noise.dayAlertAboveDba", "24-hour average")),
    ],
  });
}

/** In µGy/h: the previous 7-day average dose rate times the solar-event multiples. */
function radiationLines(settings: RuleSettings, facts: FactValues): MetricReferenceLines | null {
  const watch = settings["radiation.solarEventWatchMultiple"];
  const alert = settings["radiation.solarEventAlertMultiple"];
  const previousDailyDose = facts.radiationPreviousAverageUGy?.value;
  if (watch === null || alert === null || previousDailyDose === undefined) return null;
  const averageRate = previousDailyDose / HOURS_PER_DAY;
  return chart("radiationDoseRate", {
    basis: "previousSevenDays", band: { low: null, high: averageRate * watch },
    thresholds: [line(averageRate * watch, "watch", `${watch}× the 7-day average`), line(averageRate * alert, "alert", `${alert}× the 7-day average`)],
  });
}
