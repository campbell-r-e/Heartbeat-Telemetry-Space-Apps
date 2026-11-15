import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import type { SolarStormCleared, SolarStormConflict, SolarStormPress, SolarStormStarted, SolarStormState } from "@heartbeat/shared";
import { serialQueue } from "../../domain/serial-queue.ts";
import {
  DEFAULT_STORM_FACTOR, MAX_STORM_FACTOR, MIN_STORM_FACTOR, roundDose, simulatedStormReadings, solarStormState, stalePressReason,
} from "../../domain/solar-storm.ts";
import { EVALUATION_TIMEOUT_MS } from "../../domain/status/status-evaluator.ts";
import type { AppDeps } from "../deps.ts";

const stormBody = {
  type: ["object", "null"],
  properties: {
    factor: { type: "number", minimum: MIN_STORM_FACTOR, maximum: MAX_STORM_FACTOR },
    expectedFactor: { type: ["number", "null"] },
  },
} as const;

/** One storm change: its check, its write and the crew's evaluation after it (which has its own limit). */
const STORM_CHANGE_TIMEOUT_MS = 2 * EVALUATION_TIMEOUT_MS;

// Demo: a labeled simulated deep-space solar storm. Replays the real Sept 11-12, 2017 ISS event
// as the 48 hours ending now, with only its rise above baseline amplified. It changes the ship's
// own (simulated) radiation data on board, so it never travels the relay; only the alerts it
// causes do, ship to ground, with the delay (SPEC §8, §13). Starting, escalating and clearing run
// one at a time (this one server process), so two presses, or a press and a clear, never interleave.
export function demoRoutes(app: FastifyInstance, { stores, solarEvent, now, statusEvaluator }: AppDeps) {
  const oneChangeAtATime = serialQueue(STORM_CHANGE_TIMEOUT_MS);

  const currentStorm = async (): Promise<SolarStormState> => {
    const { readings, startedMs } = await stores.demoStorm.read();
    return solarStormState(solarEvent, readings, startedMs, now());
  };

  /**
   * The ship evaluates every astronaut at once after the storm changes (owner decision), so an
   * alert leaves now instead of at the next minute's check, and a cleared storm is seen by the
   * rules before the next one starts. A failed evaluation is logged; the minute's check retries it.
   */
  async function evaluateCrewNow(log: FastifyBaseLogger): Promise<void> {
    const failures = await statusEvaluator.evaluateCrew();
    for (const { astronautId, error } of failures) log.error({ err: error, astronautId }, "status evaluation after the storm changed failed");
  }

  app.get("/api/demo/solar-storm", currentStorm);

  app.post<{ Body: SolarStormPress | null }>("/api/demo/solar-storm", { schema: { body: stormBody } }, async (req, reply) => {
    const outcome = await oneChangeAtATime(async (signal): Promise<SolarStormStarted | SolarStormConflict> => {
      const current = await currentStorm();
      const stale = stalePressReason(current, req.body?.expectedFactor);
      if (stale) return { error: "storm_changed", message: stale, current };
      const factor = req.body?.factor ?? DEFAULT_STORM_FACTOR;
      const pressedMs = now();
      // A storm that is on keeps its start when escalated; otherwise this press starts a new one.
      const startedMs = current.active && current.startedAt !== null ? Date.parse(current.startedAt) : pressedMs;
      const readings = simulatedStormReadings(solarEvent, factor, pressedMs);
      signal.throwIfAborted();
      await stores.demoStorm.store(readings, startedMs);
      await evaluateCrewNow(req.log);
      return { simulated: true, factor, hours: readings.length, baselineUGyPerHour: roundDose(solarEvent.baseline) };
    });
    return "error" in outcome ? reply.code(409).send(outcome) : outcome;
  });

  app.delete("/api/demo/solar-storm", (req) =>
    oneChangeAtATime(async (signal): Promise<SolarStormCleared> => {
      signal.throwIfAborted();
      await stores.demoStorm.clear();
      const clearedAt = new Date(now()).toISOString();
      await evaluateCrewNow(req.log);
      return { cleared: true, clearedAt };
    }),
  );

  // The demo reset forgets the storm's start once it has resolved that storm's alerts, so a later
  // reset never resolves alerts raised after it by real data (pending owner review).
  app.delete("/api/demo/solar-storm/started-at", () =>
    oneChangeAtATime(async () => {
      await stores.demoStorm.forgetStart();
      return currentStorm();
    }),
  );
}
