import type { Metric, Reading, ReadingSource } from "@heartbeat/shared";
import { derivedFrom, expectedShape, expectedUnit, shapeOf, type ValueShape } from "./metrics.ts";
import { MINUTE_MS } from "./time.ts";

/**
 * The sources a client may post. Bundled sources are loaded by the server, and "simulated" is
 * written only by the solar storm demo (SPEC §5.7).
 */
export const CLIENT_READING_SOURCES = ["watch", "manual"] as const satisfies readonly ReadingSource[];

/** Allows for a watch clock running slightly ahead of the server's. */
export const MAX_CLOCK_SKEW_MS = 5 * MINUTE_MS;

/** Why a reading cannot be stored; `index` is its position in the batch. */
export type ReadingProblem =
  | { kind: "serverDerivedMetric"; index: number; metric: Metric; sendInstead: Metric }
  | { kind: "takenInFuture"; index: number; takenAt: string }
  | { kind: "wrongUnit"; index: number; metric: Metric; unit: string; expectedUnit: string }
  | { kind: "wrongValueShape"; index: number; metric: Metric; expectedShape: ValueShape }
  | { kind: "emptyArray"; index: number; metric: Metric };

/** The first reading in the batch that cannot be stored, or null when all are valid. */
export function findInvalidReading(readings: readonly Reading[], nowMs: number): ReadingProblem | null {
  for (const [index, reading] of readings.entries()) {
    const sendInstead = derivedFrom(reading.metric);
    if (sendInstead !== undefined) {
      return { kind: "serverDerivedMetric", index, metric: reading.metric, sendInstead };
    }
    if (Date.parse(reading.takenAt) > nowMs + MAX_CLOCK_SKEW_MS) {
      return { kind: "takenInFuture", index, takenAt: reading.takenAt };
    }
    const expected = expectedUnit(reading.metric);
    if (expected !== reading.unit) {
      return { kind: "wrongUnit", index, metric: reading.metric, unit: reading.unit, expectedUnit: expected };
    }
    const shape = expectedShape(reading.metric);
    if (shapeOf(reading.value) !== shape) {
      return { kind: "wrongValueShape", index, metric: reading.metric, expectedShape: shape };
    }
    if (Array.isArray(reading.value) && reading.value.length === 0) {
      return { kind: "emptyArray", index, metric: reading.metric };
    }
  }
  return null;
}
