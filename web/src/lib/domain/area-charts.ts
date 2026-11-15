// What each area charts: the card's mini chart and the detail page's main chart share one
// source; the detail page then adds area-specific panels (SPEC §9.1 detail pattern).

import { EXERCISE_DAY_RANGES, type Area, type SeriesRange } from "@heartbeat/shared";
import type { ShownMetric } from "./metrics";
import { RANGE_IDS } from "./ranges";

export type ChartSource =
  | { kind: "metric"; metric: ShownMetric }
  | { kind: "checkIns"; field: "mood" | "stress" }
  | { kind: "dailyCalories" }
  | { kind: "exerciseDays" };

export type ChartSourceKind = ChartSource["kind"];

/** What each kind of chart source is, in one table: a new kind does not compile until it is described here. */
export const CHART_SOURCE_TRAITS: Record<ChartSourceKind, { daily: boolean; fromDailyLog: boolean }> = {
  /** Readings: the ground charts them from its own series. */
  metric: { daily: false, fromDailyLog: false },
  checkIns: { daily: false, fromDailyLog: true },
  /** One point per UTC day. */
  dailyCalories: { daily: true, fromDailyLog: true },
  exerciseDays: { daily: true, fromDailyLog: true },
};

/** One key per chart source, so a chart two areas share is drawn once and can be looked up. */
export function chartSourceKey(source: ChartSource): string {
  switch (source.kind) {
    case "metric":
      return `metric:${source.metric}`;
    case "checkIns":
      return `checkIns:${source.field}`;
    case "dailyCalories":
    case "exerciseDays":
      return source.kind;
  }
}

export interface ChartSpec {
  title: string;
  source: ChartSource;
}

export type SecondaryPanel =
  | { kind: "chart"; chart: ChartSpec }
  | { kind: "radiationDose" }
  | { kind: "nutrientTotals" };

export interface AreaCharts {
  main: ChartSpec;
  /** The window of the card's mini chart. */
  cardRange: SeriesRange;
  /** The ranges the detail page offers, in order; the first is the default unless 24 h is offered. */
  ranges: readonly SeriesRange[];
  secondary: SecondaryPanel[];
}

/** Calories per day make sense only over several days: one point per UTC day. */
const DAILY_RANGES: readonly SeriesRange[] = ["7d", "mission"];

const metricChart = (title: string, metric: ShownMetric): ChartSpec => ({ title, source: { kind: "metric", metric } });

export const AREA_CHARTS: Record<Area, AreaCharts> = {
  vitals: {
    main: metricChart("Heart rate", "heartRate"),
    cardRange: "24h",
    ranges: RANGE_IDS,
    secondary: [{ kind: "chart", chart: metricChart("Heart rate variability (RMSSD)", "hrv") }, { kind: "chart", chart: metricChart("Blood oxygen (SpO₂)", "spo2") }],
  },
  radiation: {
    main: metricChart("Dose rate", "radiationDoseRate"),
    cardRange: "24h",
    ranges: RANGE_IDS,
    secondary: [{ kind: "radiationDose" }],
  },
  gravity: {
    main: { title: "Exercise minutes per day (UTC)", source: { kind: "exerciseDays" } },
    cardRange: "7d",
    // Exactly the exercise endpoint's ranges, so the two lists cannot drift apart.
    ranges: EXERCISE_DAY_RANGES,
    secondary: [{ kind: "chart", chart: metricChart("Skeletal muscle mass", "bodyComposition") }],
  },

  cabin: {
    main: metricChart("CO₂", "co2"),
    cardRange: "24h",
    ranges: RANGE_IDS,
    secondary: [
      { kind: "chart", chart: metricChart("Cabin temperature", "cabinTemp") },
      { kind: "chart", chart: metricChart("Humidity", "humidity") },
      { kind: "chart", chart: metricChart("Cabin pressure (watch barometer)", "pressure") },
    ],
  },
  nutrition: {
    main: { title: "Calories per day (UTC)", source: { kind: "dailyCalories" } },
    cardRange: "7d",
    ranges: DAILY_RANGES,
    secondary: [{ kind: "nutrientTotals" }],
  },
  mind: {
    main: { title: "Mood check-ins", source: { kind: "checkIns", field: "mood" } },
    cardRange: "7d",
    ranges: RANGE_IDS,
    secondary: [
      { kind: "chart", chart: { title: "Stress check-ins", source: { kind: "checkIns", field: "stress" } } },
      { kind: "chart", chart: metricChart("Heart rate variability (RMSSD)", "hrv") },
    ],
  },
};
