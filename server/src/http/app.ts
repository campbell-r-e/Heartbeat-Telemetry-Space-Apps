import Fastify from "fastify";
import cors from "@fastify/cors";
import { requireTokenForWrites } from "./auth.ts";
import type { AppDeps } from "./deps.ts";
import { astronautRoutes } from "./routes/astronauts.ts";
import { checkInRoutes } from "./routes/checkins.ts";
import { demoRoutes } from "./routes/demo.ts";
import { exerciseRoutes } from "./routes/exercise.ts";
import { healthRoutes } from "./routes/health.ts";
import { mealRoutes } from "./routes/meals.ts";
import { groundRoutes } from "./routes/ground.ts";
import { menuRoutes } from "./routes/menu.ts";
import { missionRoutes } from "./routes/mission.ts";
import { onboardRelayRoutes } from "./routes/onboard-relay.ts";
import { pointsRoutes } from "./routes/points.ts";
import { readingRoutes } from "./routes/readings.ts";
import { relayRoutes } from "./routes/relay.ts";
import { scheduleRoutes } from "./routes/schedule.ts";
import { settingsRoutes } from "./routes/settings.ts";
import { statusRoutes } from "./routes/status.ts";

const ROUTES = [healthRoutes, astronautRoutes, readingRoutes, menuRoutes, mealRoutes, checkInRoutes, scheduleRoutes, pointsRoutes, statusRoutes, exerciseRoutes, missionRoutes, settingsRoutes, demoRoutes,
  relayRoutes, groundRoutes, onboardRelayRoutes];

export async function buildApp(deps: AppDeps, opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? true });
  await app.register(cors, { origin: true });
  requireTokenForWrites(app, deps.token);
  for (const register of ROUTES) register(app, deps);
  // Closed by the composition root's ordered shutdown (src/shutdown.ts), before the pool.
  deps.live.attach(app.server);
  return app;
}
