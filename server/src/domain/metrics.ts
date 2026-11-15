import { METRICS, type Metric } from "@heartbeat/shared";

export { METRICS };

/** A reading's value: a single number, or an array of numbers (a waveform or a batch of intervals). */
export type ValueShape = "number" | "array";

/**
 * The one unit each metric is stored in (matching the bundled data) and the shape of its value.
 * Every metric in the shared METRICS list must have both: a metric missing here fails the type check.
 */
export const METRIC_SPECS = {
  heartRate: { unit: "bpm", shape: "number" },
  hrv: { unit: "ms", shape: "number" },
  /**
   * Beat-to-beat intervals, one non-empty array per watch batch; takenAt is the first beat. The
   * watch drops intervals it flags as invalid before upload, and the server times each beat from
   * takenAt plus the intervals before it (SPEC §5.7).
   */
  ibi: { unit: "ms", shape: "array" },
  skinTemp: { unit: "°C", shape: "number" },
  spo2: { unit: "%", shape: "number" },
  ecg: { unit: "mV", shape: "array" },
  radiationDoseRate: { unit: "µGy/h", shape: "number" },
  co2: { unit: "mmHg", shape: "number" },
  cabinTemp: { unit: "°C", shape: "number" },
  humidity: { unit: "%RH", shape: "number" },
  pressure: { unit: "hPa", shape: "number" },
  noise: { unit: "dBA", shape: "number" },
  /** Hours slept. */
  sleep: { unit: "h", shape: "number" },
  /**
   * The wrist's z-angle in degrees: 12 five-second epoch means per watch minute, takenAt = the
   * minute's start. The server detects sleep from it (domain/sleep, SPEC §5.7).
   */
  wristAngle: { unit: "deg", shape: "array" },
  /** Skeletal muscle mass. */
  bodyComposition: { unit: "kg", shape: "number" },
} as const satisfies Record<Metric, { unit: string; shape: ValueShape }>;

type MetricUnits = { [M in Metric]: (typeof METRIC_SPECS)[M]["unit"] };

/** Each metric's unit, taken from METRIC_SPECS. */
// Object.fromEntries loses the per-key types; the mapped type restores exactly what it builds.
export const METRIC_UNITS = Object.fromEntries(
  Object.entries(METRIC_SPECS).map(([metric, spec]) => [metric, spec.unit]),
) as MetricUnits;

/**
 * Metrics only the server writes, each with the metric clients send instead: hrv is derived
 * from ibi with domain/hrv.ts, and sleep from wristAngle with domain/sleep (SPEC §5.7).
 */
export const SERVER_DERIVED_FROM = { hrv: "ibi", sleep: "wristAngle" } as const satisfies Partial<Record<Metric, Metric>>;

/** The metric a server-derived metric is calculated from, or undefined when clients may post it. */
export function derivedFrom(metric: Metric): Metric | undefined {
  return (SERVER_DERIVED_FROM as Partial<Record<Metric, Metric>>)[metric];
}

/** The unit a metric must be sent and stored in. */
export function expectedUnit(metric: Metric): string {
  return METRIC_UNITS[metric];
}

/** Whether a metric's value is a single number or an array. */
export function expectedShape(metric: Metric): ValueShape {
  return METRIC_SPECS[metric].shape;
}

export function shapeOf(value: number | readonly number[]): ValueShape {
  return Array.isArray(value) ? "array" : "number";
}
