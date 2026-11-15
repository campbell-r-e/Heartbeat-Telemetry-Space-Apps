import type { FastifyInstance } from "fastify";
import type { Metric } from "@heartbeat/shared";
import type { AppDeps } from "../deps.ts";
import { invalidQuery, requireKnownAstronautOrShip } from "../replies.ts";
import { astronautParams } from "../schemas.ts";
import { seriesAsOf, seriesQuery } from "../series.ts";
import type { SeriesQuery } from "../time-queries.ts";

type Params = { id: string };

export function astronautRoutes(app: FastifyInstance, { stores, ruleBook, now }: AppDeps) {
  // The ship's own sensors (radiation, cabin) are read through the same endpoints under SHIP_ID.
  const knownAstronautOrShip = requireKnownAstronautOrShip(stores.astronauts);

  app.get("/api/astronauts", async () => stores.astronauts.list());

  // Latest value of every metric.
  app.get<{ Params: Params }>(
    "/api/astronauts/:id/latest",
    { schema: { params: astronautParams }, preHandler: knownAstronautOrShip },
    async (req) => stores.readings.latest(req.params.id, now()),
  );

  // Chart data as of now (see series.ts for the query).
  app.get<{ Params: Params; Querystring: SeriesQuery & { metric: Metric } }>(
    "/api/astronauts/:id/series",
    { schema: { params: astronautParams, querystring: seriesQuery }, preHandler: knownAstronautOrShip },
    async (req, reply) => {
      const series = await seriesAsOf({ stores, ruleBook }, req.params.id, req.query, now());
      return series.ok ? series.value : invalidQuery(reply, series);
    },
  );
}
