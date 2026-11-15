import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../deps.ts";

export function menuRoutes(app: FastifyInstance, { stores }: AppDeps) {
  app.get("/api/menu", async () => stores.foods.menu());
}
