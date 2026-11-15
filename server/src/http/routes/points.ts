import type { FastifyInstance } from "fastify";
import type { AstronautSummary } from "@heartbeat/shared";
import type { AppDeps } from "../deps.ts";
import { notFound } from "../replies.ts";
import { astronautParams } from "../schemas.ts";

// Points, streak and badges (SPEC §7) for the dashboard and the watch, and the compact summary
// (status per area plus points) a small screen needs.
export function pointsRoutes(app: FastifyInstance, { stores, now, statusEvaluator, points }: AppDeps) {
  app.get<{ Params: { id: string } }>(
    "/api/astronauts/:id/points",
    { schema: { params: astronautParams } },
    async (req, reply) => {
      const astronaut = await stores.astronauts.find(req.params.id);
      if (!astronaut) return notFound(reply, "unknown_astronaut");
      return points.summary(astronaut, now());
    },
  );

  // Like a status request, it records status changes in the alert log, through the same one-at-a-time
  // queue (status-evaluator.ts), so it never logs an older status after a newer one.
  app.get<{ Params: { id: string } }>(
    "/api/astronauts/:id/summary",
    { schema: { params: astronautParams } },
    async (req, reply) => {
      const astronaut = await stores.astronauts.find(req.params.id);
      if (!astronaut) return notFound(reply, "unknown_astronaut");
      const nowMs = now();
      const [status, pointsSummary] = await Promise.all([
        statusEvaluator.evaluate(astronaut),
        points.summary(astronaut, nowMs),
      ]);
      const summary: AstronautSummary = { astronautId: astronaut.id, at: status.at, overall: status.overall, areas: status.areas, points: pointsSummary };
      return summary;
    },
  );
}
