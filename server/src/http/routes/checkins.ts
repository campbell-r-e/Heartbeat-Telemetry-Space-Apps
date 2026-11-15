import type { FastifyInstance } from "fastify";
import { DAY_MS } from "../../domain/time.ts";
import type { AppDeps } from "../deps.ts";
import { nowIso } from "../clock.ts";
import { listInTimeRange } from "../list-in-time-range.ts";
import { notFound, requireKnownAstronaut } from "../replies.ts";
import type { TimeRangeQuery } from "../time-queries.ts";
import { astronautParams, isoDateTime, object, score, timeRangeQuery } from "../schemas.ts";

const DEFAULT_CHECKIN_HISTORY_MS = 14 * DAY_MS;

const checkInBody = object({ mood: score, stress: score, at: isoDateTime }, ["at"]);
const checkInParams = object({ ...astronautParams.properties, checkInId: { type: "integer", minimum: 1 } });

// Mood and stress check-ins.
export function checkInRoutes(app: FastifyInstance, { stores, now, dailyLogChanges, points }: AppDeps) {
  const knownAstronaut = requireKnownAstronaut(stores.astronauts);

  app.post<{ Params: { id: string }; Body: { mood: number; stress: number; at?: string } }>(
    "/api/astronauts/:id/checkins",
    { schema: { params: astronautParams, body: checkInBody }, preHandler: knownAstronaut },
    async (req) => {
      const { mood, stress, at } = req.body;
      const checkIn = await stores.checkIns.add(req.params.id, mood, stress, at ?? nowIso(now));
      dailyLogChanges.dayChanged(checkIn.astronautId, Date.parse(checkIn.at));
      points.activityChanged(checkIn.astronautId, Date.parse(checkIn.at));
      return checkIn;
    },
  );

  app.get<{ Params: { id: string }; Querystring: TimeRangeQuery }>(
    "/api/astronauts/:id/checkins",
    { schema: { params: astronautParams, querystring: timeRangeQuery }, preHandler: knownAstronaut },
    listInTimeRange(DEFAULT_CHECKIN_HISTORY_MS, now, (id, fromMs, toMs) => stores.checkIns.between(id, fromMs, toMs)),
  );

  // Removes a mistaken check-in; like every write, it needs the token.
  app.delete<{ Params: { id: string; checkInId: number } }>(
    "/api/astronauts/:id/checkins/:checkInId",
    { schema: { params: checkInParams }, preHandler: knownAstronaut },
    async (req, reply) => {
      const deleted = await stores.checkIns.remove(req.params.checkInId, req.params.id);
      if (!deleted) return notFound(reply, "not_found");
      dailyLogChanges.dayChanged(deleted.astronautId, Date.parse(deleted.at));
      points.activityChanged(deleted.astronautId, Date.parse(deleted.at));
      return { deleted: true };
    },
  );
}
