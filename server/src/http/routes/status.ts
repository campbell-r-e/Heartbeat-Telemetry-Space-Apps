import type { FastifyInstance } from "fastify";
import { astronautReferenceLines } from "../../domain/status/astronaut-status.ts";
import { DAY_MS } from "../../domain/time.ts";
import type { AppDeps } from "../deps.ts";
import { AREAS, type Area } from "@heartbeat/shared";
import { invalidQuery, notFound, requireKnownAstronaut } from "../replies.ts";
import { parseTimeRangeQuery, type TimeRangeQuery } from "../time-queries.ts";
import { astronautParams, object, timeRangeQuery } from "../schemas.ts";

const DEFAULT_ALERT_HISTORY_MS = 7 * DAY_MS;
const alertsQuery = object({ ...timeRangeQuery.properties, area: { type: "string", enum: AREAS } }, ["from", "to", "area"]);

// The rules engine's verdict for one astronaut: every client shows this instead of applying
// thresholds itself. Ship data (radiation, cabin air) counts for every astronaut. Each
// evaluation also records any status change in the alert log and relays new 🔴 and 🟡 alerts.
export function statusRoutes(app: FastifyInstance, { stores, ruleBook, now, statusEvaluator }: AppDeps) {
  app.get<{ Params: { id: string } }>(
    "/api/astronauts/:id/status",
    { schema: { params: astronautParams } },
    async (req, reply) => {
      const astronaut = await stores.astronauts.find(req.params.id);
      if (!astronaut) return notFound(reply, "unknown_astronaut");
      return statusEvaluator.evaluate(astronaut);
    },
  );

  // What to draw on each metric's chart: the normal band and the watch and alert lines.
  app.get<{ Params: { id: string } }>(
    "/api/astronauts/:id/reference-lines",
    { schema: { params: astronautParams } },
    async (req, reply) => {
      const astronaut = await stores.astronauts.find(req.params.id);
      if (!astronaut) return notFound(reply, "unknown_astronaut");
      return astronautReferenceLines(stores, ruleBook, astronaut, now());
    },
  );

  // The alert log: status changes in a time range (default: the last 7 days), oldest first,
  // optionally for one area.
  app.get<{ Params: { id: string }; Querystring: TimeRangeQuery & { area?: Area } }>(
    "/api/astronauts/:id/alerts",
    { schema: { params: astronautParams, querystring: alertsQuery }, preHandler: requireKnownAstronaut(stores.astronauts) },
    async (req, reply) => {
      const bounds = parseTimeRangeQuery(req.query, DEFAULT_ALERT_HISTORY_MS, now());
      if (!bounds.ok) return invalidQuery(reply, bounds);
      return stores.statusLog.between(req.params.id, bounds.value.fromMs, bounds.value.toMs, req.query.area);
    },
  );
}
