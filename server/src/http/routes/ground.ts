import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AlertStateChange, NewAstronaut, Sex } from "@heartbeat/shared";
import type { GroundSeriesResponse, Metric } from "@heartbeat/shared";
import { groundSide } from "../../domain/relay/ground.ts";
import { groundDailyLog } from "../../domain/relay/daily-log-relay.ts";
import { groundMission } from "../../domain/relay/mission-relay.ts";
import { DAY_MS } from "../../domain/time.ts";
import type { AppDeps } from "../deps.ts";
import { replyWithOutcome } from "../outcomes.ts";
import { invalidQuery, requireAstronautWithHistoryOrShip } from "../replies.ts";
import { seriesAsOf, seriesQuery } from "../series.ts";
import { id, object, timeRangeQuery } from "../schemas.ts";
import { parseTimeRangeQuery, type SeriesQuery, type TimeRangeQuery } from "../time-queries.ts";

const DEFAULT_ALERT_FEED_MS = 7 * DAY_MS;
const MAX_NOTE_LENGTH = 2000;
const MAX_NAME_LENGTH = 100;
// Upper bounds a person's profile never exceeds, so every value accepted here is one the
// astronauts table accepts when the change arrives on board (a refused one would stall the queue).
const MAX_AGE_YEARS = 150;
const MAX_MASS_KG = 650;
const MAX_HEIGHT_M = 3;

/** Text of 1 to `maxLength` characters, measured after trimming (trimBodyText runs first). */
const trimmedText = (maxLength: number) => ({ type: "string", minLength: 1, maxLength }) as const;

/**
 * preValidation hook: trims the body's text fields, so the schema's length limits apply to the
 * text that is actually sent (whitespace-only is empty and refused).
 */
function trimBodyText(...fields: string[]) {
  return async (req: FastifyRequest) => {
    const body = req.body as Record<string, unknown> | null;
    if (typeof body !== "object" || body === null) return;
    for (const field of fields) {
      const value = body[field];
      if (typeof value === "string") body[field] = value.trim();
    }
  };
}
const newAstronautBody = object({
  id,
  name: trimmedText(MAX_NAME_LENGTH),
  age: { type: ["integer", "null"], minimum: 0, maximum: MAX_AGE_YEARS },
  sex: { type: ["string", "null"], enum: ["male", "female", null] },
  massKg: { type: ["number", "null"], exclusiveMinimum: 0, maximum: MAX_MASS_KG },
  heightM: { type: ["number", "null"], exclusiveMinimum: 0, maximum: MAX_HEIGHT_M },
}, ["age", "sex", "massKg", "heightM"]);
const astronautParams = object({ astronautId: id });
const watchBody = object({ watchId: id });
const alertParams = object({ alertId: id });
const noteBody = object({ astronautId: id, text: trimmedText(MAX_NOTE_LENGTH), alertId: id }, ["alertId"]);
const notesQuery = object({ astronautId: id }, ["astronautId"]);
const ALERT_ACTIONS = [["acknowledge", "acknowledged"], ["resolve", "resolved"]] as const satisfies ReadonlyArray<readonly [string, AlertStateChange["state"]]>;

type NewAstronautBody = Pick<NewAstronaut, "id" | "name"> & { age?: number | null; sex?: Sex | null; massKg?: number | null; heightM?: number | null };

// Mission Control (SPEC §9.2). Reads see only what the relay has delivered; writes (notes,
// acknowledgments, crew and watch changes) travel to the spacecraft through the relay and answer
// 202 with the relay event, whose deliverAt says when they arrive.
export function groundRoutes(app: FastifyInstance, { stores, ruleBook, relay, now }: AppDeps) {
  const ground = groundSide({ store: stores.relay, relay, now });

  app.get("/api/ground/crew", async () => ground.crew());

  // The mission (name, day, gravity) as its last report through the relay had it.
  app.get("/api/ground/mission", async () => groundMission(stores.relay, now()));

  // Chart data as Mission Control can know it: only readings up to now − the one-way delay (an
  // approximation, owner decision: read from the onboard store, not from relayed readings). A
  // removed astronaut's stored history can still be charted (read-only).
  app.get<{ Params: { id: string }; Querystring: SeriesQuery & { metric: Metric } }>(
    "/api/ground/astronauts/:id/series",
    { schema: { params: object({ id }), querystring: seriesQuery }, preHandler: requireAstronautWithHistoryOrShip(stores.astronauts) },
    async (req, reply) => {
      const { oneWayDelayMs } = await relay.delay();
      const asOfMs = now() - oneWayDelayMs;
      const series = await seriesAsOf({ stores, ruleBook }, req.params.id, req.query, asOfMs);
      if (!series.ok) return invalidQuery(reply, series);
      return { ...series.value, dataAsOf: new Date(asOfMs).toISOString(), oneWayDelayMs } satisfies GroundSeriesResponse;
    },
  );

  // Mood and stress check-ins, calories per day and exercise minutes per day, as the astronaut's
  // last daily log through the relay had them (also for an astronaut removed since).
  app.get<{ Params: { id: string } }>(
    "/api/ground/astronauts/:id/daily-log",
    { schema: { params: object({ id }) } },
    async (req) => groundDailyLog(stores.relay, req.params.id, now()),
  );

  app.post<{ Body: NewAstronautBody }>("/api/ground/crew/astronauts", { schema: { body: newAstronautBody }, preValidation: trimBodyText("name") }, async (req, reply) => {
    const { id: astronautId, name, age = null, sex = null, massKg = null, heightM = null } = req.body;
    const astronaut: NewAstronaut = { id: astronautId, name, age, sex, massKg, heightM };
    return replyWithOutcome(reply, await ground.changeCrew({ action: "addAstronaut", astronaut }));
  });

  app.delete<{ Params: { astronautId: string } }>(
    "/api/ground/crew/astronauts/:astronautId",
    { schema: { params: astronautParams } },
    async (req, reply) => replyWithOutcome(reply, await ground.changeCrew({ action: "removeAstronaut", astronautId: req.params.astronautId })),
  );

  // Assigns a watch, or replaces the one the astronaut has; a watch worn by someone else moves.
  app.put<{ Params: { astronautId: string }; Body: { watchId: string } }>(
    "/api/ground/crew/astronauts/:astronautId/watch",
    { schema: { params: astronautParams, body: watchBody } },
    async (req, reply) => replyWithOutcome(reply, await ground.changeCrew({
      action: "assignWatch", astronautId: req.params.astronautId, watchId: req.body.watchId,
    })),
  );

  app.delete<{ Params: { astronautId: string } }>(
    "/api/ground/crew/astronauts/:astronautId/watch",
    { schema: { params: astronautParams } },
    async (req, reply) => replyWithOutcome(reply, await ground.changeCrew({ action: "unassignWatch", astronautId: req.params.astronautId })),
  );

  // The alert feed: 🔴 and 🟡 alerts that have reached the ground, sent in the range (default: the last 7 days).
  app.get<{ Querystring: TimeRangeQuery }>("/api/ground/alerts", { schema: { querystring: timeRangeQuery } }, async (req, reply) => {
    const bounds = parseTimeRangeQuery(req.query, DEFAULT_ALERT_FEED_MS, now());
    if (!bounds.ok) return invalidQuery(reply, bounds);
    return ground.alerts(bounds.value);
  });

  // Acknowledge or resolve an alert; the crew sees it after the delay.
  for (const [action, state] of ALERT_ACTIONS) {
    app.post<{ Params: { alertId: string } }>(
      `/api/ground/alerts/:alertId/${action}`,
      { schema: { params: alertParams } },
      async (req, reply) => replyWithOutcome(reply, await ground.handleAlert(req.params.alertId, state)),
    );
  }

  app.post<{ Body: { astronautId: string; text: string; alertId?: string } }>(
    "/api/ground/notes",
    { schema: { body: noteBody }, preValidation: trimBodyText("text") },
    async (req, reply) => {
      const { astronautId, text, alertId = null } = req.body;
      return replyWithOutcome(reply, await ground.sendNote({ astronautId, text, alertId }));
    },
  );

  app.get<{ Querystring: { astronautId?: string } }>(
    "/api/ground/notes", { schema: { querystring: notesQuery } }, async (req) => ground.notes(req.query.astronautId),
  );
}
