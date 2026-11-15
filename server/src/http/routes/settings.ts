import type { FastifyInstance } from "fastify";
import type { RuleSettingsResponse } from "@heartbeat/shared";
import { areaLimits } from "../../domain/rules/limits.ts";
import type { AppDeps } from "../deps.ts";

// Every number the rules use, and every limit in plain language, so clients show the server's
// numbers and wording instead of typing their own.
export function settingsRoutes(app: FastifyInstance, { ruleBook }: AppDeps) {
  app.get("/api/settings", async (): Promise<RuleSettingsResponse> => ({
    settings: ruleBook.settings,
    maxReadingAgeMinutes: ruleBook.maxReadingAgeMinutes,
    limits: areaLimits(ruleBook.rules, ruleBook.settings),
  }));
}
