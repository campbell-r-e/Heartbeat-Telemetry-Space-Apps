// How each stored metric is labeled and rounded on screen, and whose sensor it comes from.

import { SHIP_ID, SHIP_METRICS, type LatestReading, type Metric } from "@heartbeat/shared";
import { NO_VALUE, formatNumber } from "./format";

interface MetricDisplay {
  label: string;
  decimals: number;
}

/**
 * Metrics stored for the server's own use and never shown: the watch's raw wrist angles, from which
 * the server derives sleep (SPEC §5.7; owner decision).
 */
export const HIDDEN_METRICS = ["wristAngle"] as const satisfies readonly Metric[];

/** A metric the dashboard shows. */
export type ShownMetric = Exclude<Metric, (typeof HIDDEN_METRICS)[number]>;

const HIDDEN_METRIC_SET: ReadonlySet<Metric> = new Set(HIDDEN_METRICS);

export const isShownMetric = (metric: Metric): metric is ShownMetric => !HIDDEN_METRIC_SET.has(metric);

export const METRIC_DISPLAY: Record<ShownMetric, MetricDisplay> = {
  heartRate: { label: "Heart rate", decimals: 0 },
  spo2: { label: "Blood oxygen", decimals: 0 },
  skinTemp: { label: "Skin temperature", decimals: 1 },
  hrv: { label: "HRV (RMSSD)", decimals: 0 },
  ibi: { label: "Beat-to-beat intervals", decimals: 0 },
  ecg: { label: "ECG", decimals: 0 },
  pressure: { label: "Cabin pressure (watch)", decimals: 0 },
  noise: { label: "Cabin noise", decimals: 0 },
  bodyComposition: { label: "Skeletal muscle mass", decimals: 1 },
  sleep: { label: "Sleep", decimals: 1 },
  radiationDoseRate: { label: "Dose rate", decimals: 2 },
  co2: { label: "CO₂", decimals: 1 },
  cabinTemp: { label: "Cabin temperature", decimals: 1 },
  humidity: { label: "Humidity", decimals: 0 },
};

const SHIP_METRIC_SET: ReadonlySet<Metric> = new Set(SHIP_METRICS);

/** The id the server stores a metric under: the ship for radiation and cabin, otherwise the astronaut. */
export function metricOwner(metric: Metric, astronautId: string): string {
  return SHIP_METRIC_SET.has(metric) ? SHIP_ID : astronautId;
}

/** Units as the server sends them, mapped to how they read best on screen. */
const UNIT_TEXT: Readonly<Record<string, string>> = { "%RH": "% RH" };

export function unitText(unit: string): string {
  return UNIT_TEXT[unit] ?? unit;
}

export function formatMetricNumber(metric: ShownMetric, value: number): string {
  return formatNumber(value, METRIC_DISPLAY[metric].decimals);
}

/** The numeric value of a latest reading, or null when there is none or it is a waveform. */
export function numericValue(reading: LatestReading | undefined): number | null {
  return reading && typeof reading.value === "number" ? reading.value : null;
}

/** A latest reading as its number alone, or NO_VALUE. */
export function formatReadingNumber(metric: ShownMetric, reading: LatestReading | undefined): string {
  const value = numericValue(reading);
  return value === null ? NO_VALUE : formatMetricNumber(metric, value);
}

export type LatestIndex = ReadonlyMap<ShownMetric, LatestReading>;

/**
 * One lookup over several /latest responses (the astronaut's and the ship's metrics never overlap),
 * leaving out the hidden metrics.
 */
export function indexLatest(...lists: readonly (readonly LatestReading[])[]): LatestIndex {
  return new Map(lists.flat().flatMap((reading) => (isShownMetric(reading.metric) ? [[reading.metric, reading] as const] : [])));
}
