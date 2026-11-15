import type { FastifyInstance } from "fastify";
import type { ExerciseDay } from "@heartbeat/shared";
import { dailyExercise } from "../../domain/exercise-days.ts";
import type { AppDeps } from "../deps.ts";
import { invalidQuery, notFound } from "../replies.ts";
import { parseExerciseDaysQuery, type RangeOrTimesQuery } from "../time-queries.ts";
import { astronautParams, object, timeRangeQuery } from "../schemas.ts";

const dailyQuery = object({ range: { type: "string" }, ...timeRangeQuery.properties }, ["range", "from", "to"]);

// Exercise minutes per UTC day for the Gravity chart: ?range=7d|mission or ?from=&to=.
export function exerciseRoutes(app: FastifyInstance, { stores, ruleBook, now }: AppDeps) {
  app.get<{ Params: { id: string }; Querystring: RangeOrTimesQuery }>(
    "/api/astronauts/:id/exercise/daily",
    { schema: { params: astronautParams, querystring: dailyQuery } },
    async (req, reply) => {
      const nowMs = now();
      const window = parseExerciseDaysQuery(req.query, nowMs);
      if (!window.ok) return invalidQuery(reply, window);
      const astronaut = await stores.astronauts.find(req.params.id);
      if (!astronaut) return notFound(reply, "unknown_astronaut");
      const days: ExerciseDay[] = await dailyExercise(stores, { astronaut, settings: ruleBook.settings, window: window.value, nowMs });
      return days;
    },
  );
}
