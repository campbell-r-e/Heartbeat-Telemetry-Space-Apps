// JSON Schema building blocks shared by the routes, so each route states only what is its own.
import { CHECK_IN_SCALE } from "../domain/checkins.ts";
import { METRICS } from "../domain/metrics.ts";
import { CLIENT_READING_SOURCES } from "../domain/reading-validation.ts";

export const MAX_ID_LENGTH = 64;
export const MAX_UNIT_LENGTH = 32;
export const MAX_READINGS_PER_BATCH = 5000;
export const MAX_ARRAY_VALUE_ITEMS = 20_000;

export const id = { type: "string", minLength: 1, maxLength: MAX_ID_LENGTH } as const;
export const isoDateTime = { type: "string", format: "date-time" } as const;
export const metric = { type: "string", enum: METRICS } as const;
export const score = { type: "integer", minimum: CHECK_IN_SCALE.min, maximum: CHECK_IN_SCALE.max } as const;

/** An object schema; every property not listed in `optional` is required. */
export function object(properties: Record<string, object>, optional: readonly string[] = []) {
  return {
    type: "object",
    required: Object.keys(properties).filter((key) => !optional.includes(key)),
    properties,
  } as const;
}

/** Optional ISO from/to times, used by every list endpoint. */
export const timeRangeQuery = object({ from: { type: "string" }, to: { type: "string" } }, ["from", "to"]);

export const astronautParams = object({ id });

export const reading = object({
  astronautId: id,
  // Every metric passes here; findInvalidReading refuses the server-derived ones with a named error.
  metric,
  // One schema listing both types, so Fastify's type coercion leaves the value as sent: with
  // anyOf it turned a one-item array into a number (and back). Which shape each metric takes is
  // a domain rule (METRIC_SPECS), checked by findInvalidReading.
  value: { type: ["number", "array"], items: { type: "number" }, maxItems: MAX_ARRAY_VALUE_ITEMS },
  unit: { type: "string", maxLength: MAX_UNIT_LENGTH },
  takenAt: isoDateTime,
  source: { type: "string", enum: CLIENT_READING_SOURCES },
});
