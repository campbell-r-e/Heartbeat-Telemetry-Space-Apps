import type { FastifyInstance } from "fastify";
import { DELAY_PRESETS, type RelaySetting } from "@heartbeat/shared";
import type { AppDeps } from "../deps.ts";

const delayBody = {
  type: "object",
  minProperties: 1,
  additionalProperties: false,
  properties: { preset: { type: "string", enum: DELAY_PRESETS }, realTime: { type: "boolean" } },
} as const;

// The relay's one-way delay (SPEC §8): the mission preset and the "real time" toggle. A change
// applies to events sent from then on.
export function relayRoutes(app: FastifyInstance, { relay }: AppDeps) {
  app.get("/api/relay/delay", async () => relay.delay());

  // Either field may be left out to keep its current value.
  app.put<{ Body: Partial<RelaySetting> }>("/api/relay/delay", { schema: { body: delayBody } }, async (req) => relay.changeDelay(req.body));
}
