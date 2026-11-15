import type { FastifyInstance } from "fastify";
import type { HealthResponse } from "@heartbeat/shared";
import type { AppDeps } from "../deps.ts";
import { nowIso } from "../clock.ts";

export function healthRoutes(app: FastifyInstance, { now }: AppDeps) {
  app.get("/api/health", async (): Promise<HealthResponse> => ({ ok: true, service: "onboard", time: nowIso(now) }));
}
