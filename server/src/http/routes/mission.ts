import type { FastifyInstance } from "fastify";
import type { SleepDayTimeZoneChange } from "@heartbeat/shared";
import { withMissionDay } from "../../domain/mission.ts";
import { isTimeZone } from "../../domain/zoned-time.ts";
import type { AppDeps } from "../deps.ts";
import { badRequest, notFound } from "../replies.ts";

const timeZoneBody = {
  type: "object",
  required: ["timeZone"],
  additionalProperties: false,
  properties: { timeZone: { type: "string", minLength: 1, maxLength: 64 } },
} as const;

// The mission settings record with today's mission day, and the sleep day's time zone.
export function missionRoutes(app: FastifyInstance, { stores, now, sleepDerivation }: AppDeps) {
  app.get("/api/mission", async (_req, reply) => {
    const mission = await stores.mission.get();
    return mission ? withMissionDay(mission, now()) : notFound(reply, "no_mission");
  });

  // The sleep day runs noon to noon in this zone (SPEC §5.7). The sleep job derives the recent nights
  // again in the new zone before the reply, after any run already in progress, so the stored nights
  // always match the setting.
  app.put<{ Body: SleepDayTimeZoneChange }>("/api/mission/sleep-day-time-zone", { schema: { body: timeZoneBody } }, async (req, reply) => {
    const { timeZone } = req.body;
    if (!isTimeZone(timeZone)) return badRequest(reply, { error: "unknown_time_zone", timeZone, message: "Use an IANA time zone name such as UTC or America/Indiana/Indianapolis" });
    const mission = await stores.mission.updateSleepDayTimeZone(timeZone);
    if (!mission) return notFound(reply, "no_mission");
    await sleepDerivation.runNow();
    return withMissionDay(mission, now());
  });
}
