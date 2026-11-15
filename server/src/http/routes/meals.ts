import type { FastifyInstance } from "fastify";
import { DAY_MS } from "../../domain/time.ts";
import type { AppDeps } from "../deps.ts";
import { nowIso } from "../clock.ts";
import { listInTimeRange } from "../list-in-time-range.ts";
import { badRequest, notFound, requireKnownAstronaut } from "../replies.ts";
import type { TimeRangeQuery } from "../time-queries.ts";
import { astronautParams, id, isoDateTime, object, timeRangeQuery } from "../schemas.ts";

const DEFAULT_MEAL_HISTORY_MS = DAY_MS;

const mealBody = object({ foodId: id, eatenAt: isoDateTime }, ["eatenAt"]);
const mealParams = object({ ...astronautParams.properties, mealId: { type: "integer", minimum: 1 } });

export function mealRoutes(app: FastifyInstance, { stores, now, dailyLogChanges, points }: AppDeps) {
  const knownAstronaut = requireKnownAstronaut(stores.astronauts);

  app.post<{ Params: { id: string }; Body: { foodId: string; eatenAt?: string } }>(
    "/api/astronauts/:id/meals",
    { schema: { params: astronautParams, body: mealBody }, preHandler: knownAstronaut },
    async (req, reply) => {
      const { foodId, eatenAt } = req.body;
      if (!(await stores.foods.exists(foodId))) return badRequest(reply, { error: "unknown_food", foodId });
      const meal = await stores.meals.add(req.params.id, foodId, eatenAt ?? nowIso(now));
      dailyLogChanges.dayChanged(meal.astronautId, Date.parse(meal.eatenAt));
      points.activityChanged(meal.astronautId, Date.parse(meal.eatenAt));
      return meal;
    },
  );

  app.get<{ Params: { id: string }; Querystring: TimeRangeQuery }>(
    "/api/astronauts/:id/meals",
    { schema: { params: astronautParams, querystring: timeRangeQuery }, preHandler: knownAstronaut },
    listInTimeRange(DEFAULT_MEAL_HISTORY_MS, now, (id, fromMs, toMs) => stores.meals.between(id, fromMs, toMs)),
  );

  app.delete<{ Params: { id: string; mealId: number } }>(
    "/api/astronauts/:id/meals/:mealId",
    { schema: { params: mealParams }, preHandler: knownAstronaut },
    async (req, reply) => {
      const deleted = await stores.meals.remove(req.params.mealId, req.params.id);
      if (!deleted) return notFound(reply, "not_found");
      dailyLogChanges.dayChanged(deleted.astronautId, Date.parse(deleted.eatenAt));
      points.activityChanged(deleted.astronautId, Date.parse(deleted.eatenAt));
      return { deleted: true };
    },
  );
}
