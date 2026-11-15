import type { FastifyInstance } from "fastify";
import { onboardSide } from "../../domain/relay/onboard.ts";
import { DAY_MS } from "../../domain/time.ts";
import type { AppDeps } from "../deps.ts";
import { replyWithOutcome } from "../outcomes.ts";
import { invalidQuery, requireKnownAstronaut } from "../replies.ts";
import { astronautParams, id, object, timeRangeQuery } from "../schemas.ts";
import { parseTimeRangeQuery, type TimeRangeQuery } from "../time-queries.ts";

const DEFAULT_RELAYED_ALERTS_MS = 7 * DAY_MS;
const noteParams = object({ ...astronautParams.properties, noteId: id });

// The spacecraft's side of the relay (SPEC §9.1, §9.3): notes from the flight surgeon once they
// have arrived, read receipts back to the ground, and the alerts sent to the ground.
export function onboardRelayRoutes(app: FastifyInstance, { stores, relay, now }: AppDeps) {
  const onboard = onboardSide({ store: stores.relay, relay, now });
  const knownAstronaut = requireKnownAstronaut(stores.astronauts);

  app.get<{ Params: { id: string } }>(
    "/api/astronauts/:id/notes",
    { schema: { params: astronautParams }, preHandler: knownAstronaut },
    async (req) => onboard.notes(req.params.id),
  );

  // The astronaut read the note: the read receipt goes to the ground through the relay (202).
  // Marking a note read again answers with the receipt already sent.
  app.post<{ Params: { id: string; noteId: string } }>(
    "/api/astronauts/:id/notes/:noteId/read",
    { schema: { params: noteParams }, preHandler: knownAstronaut },
    async (req, reply) => replyWithOutcome(reply, await onboard.markNoteRead(req.params.id, req.params.noteId)),
  );

  // Alerts sent to the flight surgeon (default: the last 7 days), each with sentAt and deliverAt
  // for the banner's "arrives in m:ss" countdown, and the surgeon's handling once it has arrived.
  app.get<{ Params: { id: string }; Querystring: TimeRangeQuery }>(
    "/api/astronauts/:id/relayed-alerts",
    { schema: { params: astronautParams, querystring: timeRangeQuery }, preHandler: knownAstronaut },
    async (req, reply) => {
      const bounds = parseTimeRangeQuery(req.query, DEFAULT_RELAYED_ALERTS_MS, now());
      if (!bounds.ok) return invalidQuery(reply, bounds);
      return onboard.relayedAlerts(req.params.id, bounds.value);
    },
  );
}
