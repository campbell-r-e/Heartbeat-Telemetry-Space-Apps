import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../deps.ts";
import { notFound, requireKnownAstronaut } from "../replies.ts";
import { astronautParams } from "../schemas.ts";

// The daily task schedule behind reminders on the watch and "Today's tasks" on the dashboard.
export function scheduleRoutes(app: FastifyInstance, { stores, now, points }: AppDeps) {
  app.get<{ Params: { id: string } }>(
    "/api/astronauts/:id/schedule",
    { schema: { params: astronautParams }, preHandler: requireKnownAstronaut(stores.astronauts) },
    async (req) => stores.schedule.forAstronaut(req.params.id),
  );

  // Today's tasks with their done-state, from real activity: the same history the points read.
  app.get<{ Params: { id: string } }>(
    "/api/astronauts/:id/tasks/today",
    { schema: { params: astronautParams } },
    async (req, reply) => {
      const astronaut = await stores.astronauts.find(req.params.id);
      if (!astronaut) return notFound(reply, "unknown_astronaut");
      return points.todayTasks(astronaut, now());
    },
  );
}
