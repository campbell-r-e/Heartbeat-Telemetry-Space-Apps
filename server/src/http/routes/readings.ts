import type { FastifyInstance } from "fastify";
import type { Metric, Reading, ReadingsAccepted, ReadingsBatch } from "@heartbeat/shared";
import { deriveHrvFromIbi } from "../../domain/derive-hrv.ts";
import { taskActivityInUpload } from "../../domain/gamification/points-updates.ts";
import { dailyLogDaysTouched } from "../../domain/relay/daily-log-relay.ts";
import type { AstronautStore, LiveUpdates } from "../../domain/ports.ts";
import { findInvalidReading, type ReadingProblem } from "../../domain/reading-validation.ts";
import { removeOutrankedReadings } from "../../domain/source-precedence.ts";
import type { AppDeps } from "../deps.ts";
import { badRequest, notFound } from "../replies.ts";
import { id, MAX_READINGS_PER_BATCH, object, reading } from "../schemas.ts";

const BATTERY_RANGE = { min: 0, max: 100 } as const;
const device = object({
  watchId: id,
  batteryPct: { type: ["number", "null"], minimum: BATTERY_RANGE.min, maximum: BATTERY_RANGE.max },
});
const batchBody = object({ readings: { type: "array", maxItems: MAX_READINGS_PER_BATCH, items: reading }, device }, ["device"]);

export function readingRoutes(app: FastifyInstance, { stores, now, crew, live, dailyLogChanges, points }: AppDeps) {
  // Readings from the watch (or manual entry). Raw ibi intervals also update the derived hrv,
  // and Galaxy Watch heart rate and hrv replace Zepp history in the same slot (SPEC §5.7). An
  // upload with `device` registers the watch and records its contact and battery (SPEC §9.2), and
  // onboard clients are told of new readings at once.
  app.post<{ Body: ReadingsBatch }>("/api/readings", { schema: { body: batchBody } }, async (req, reply) => {
    const { readings } = req.body;
    const problem = findInvalidReading(readings, now());
    if (problem) return badRequest(reply, readingErrorBody(problem));
    const unknownId = await firstUnknownAstronaut(stores.astronauts, readings.map((r) => r.astronautId));
    if (unknownId) return notFound(reply, "unknown_astronaut", { astronautId: unknownId });
    const { inserted, duplicates } = await stores.readings.add(readings);
    // The days the batch touches are marked for the points and the ground's daily log as soon as the
    // readings are stored, even when every one was a duplicate: a retry of a batch whose first
    // attempt failed after storing them still reaches both.
    const markDays = () => {
      for (const { astronautId, atMs } of taskActivityInUpload(readings)) points.activityChanged(astronautId, atMs);
      for (const { astronautId, atMs } of dailyLogDaysTouched(readings)) dailyLogChanges.dayChanged(astronautId, atMs);
    };
    markDays();
    const derivedHrv = await deriveHrvFromIbi(stores.readings, readings);
    await removeOutrankedReadings(stores.readings, [...readings, ...derivedHrv]);
    // Again once the Zepp minutes the Galaxy Watch outranks are gone, since they count toward exercise.
    markDays();
    if (inserted > 0) announceReadings(live, readings);
    // The readings are stored either way; a watch report that fails is logged, not turned into a
    // 500 that would make the watch resend a batch it has already delivered.
    if (req.body.device) await crew.watchReported(req.body.device).catch((err) => req.log.error({ err }, "watch report failed"));
    return { accepted: inserted, duplicates } satisfies ReadingsAccepted;
  });
}

/** One "readings" live message per astronaut in the batch, naming the metrics it carried. */
function announceReadings(live: LiveUpdates, readings: readonly Reading[]): void {
  const metricsByAstronaut = new Map<string, Set<Metric>>();
  for (const { astronautId, metric } of readings) {
    metricsByAstronaut.set(astronautId, (metricsByAstronaut.get(astronautId) ?? new Set()).add(metric));
  }
  for (const [astronautId, metrics] of metricsByAstronaut) {
    live.publish("onboard", { type: "readings", astronautId, metrics: [...metrics] });
  }
}

/** The 400 body for a reading that cannot be stored: a stable error code plus the details. */
function readingErrorBody(problem: ReadingProblem) {
  switch (problem.kind) {
    case "serverDerivedMetric":
      return {
        error: "server_derived_metric", index: problem.index, metric: problem.metric,
        message: `${problem.metric} is calculated by the server; send ${problem.sendInstead} instead`,
      };
    case "takenInFuture":
      return { error: "taken_in_future", index: problem.index, takenAt: problem.takenAt };
    case "wrongUnit":
      return { error: "wrong_unit", index: problem.index, metric: problem.metric, unit: problem.unit, expectedUnit: problem.expectedUnit };
    case "wrongValueShape":
      return { error: "wrong_value_shape", index: problem.index, metric: problem.metric, expectedShape: problem.expectedShape };
    case "emptyArray":
      return { error: "empty_array", index: problem.index, metric: problem.metric, message: `${problem.metric} must contain at least one sample` };
  }
}

async function firstUnknownAstronaut(astronauts: AstronautStore, ids: readonly string[]): Promise<string | undefined> {
  for (const id of new Set(ids)) {
    if (!(await astronauts.exists(id))) return id;
  }
  return undefined;
}
