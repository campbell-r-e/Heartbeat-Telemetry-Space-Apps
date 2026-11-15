import type { FastifyReply, FastifyRequest } from "fastify";
import { SHIP_ID } from "@heartbeat/shared";
import type { AstronautStore } from "../domain/ports.ts";
import type { QueryProblem } from "./time-queries.ts";

export function badRequest(reply: FastifyReply, body: { error: string; [detail: string]: unknown }) {
  return reply.code(400).send(body);
}

export function invalidQuery(reply: FastifyReply, problem: QueryProblem) {
  return badRequest(reply, { error: problem.error, message: problem.message });
}

export function notFound(reply: FastifyReply, error: string, details: Record<string, unknown> = {}) {
  return reply.code(404).send({ error, ...details });
}

type AstronautRequest = FastifyRequest<{ Params: { id: string } }>;

/** preHandler that answers 404 unless :id is a known astronaut. */
export function requireKnownAstronaut(astronauts: AstronautStore) {
  return (req: AstronautRequest, reply: FastifyReply) => rejectUnknownAstronaut(astronauts, req.params.id, reply);
}

/** Like requireKnownAstronaut, but also accepts the ship's own sensor id. */
export function requireKnownAstronautOrShip(astronauts: AstronautStore) {
  return async (req: AstronautRequest, reply: FastifyReply) => {
    if (req.params.id === SHIP_ID) return;
    return rejectUnknownAstronaut(astronauts, req.params.id, reply);
  };
}

/** Accepts the ship, the crew and removed astronauts, whose stored history stays readable. */
export function requireAstronautWithHistoryOrShip(astronauts: AstronautStore) {
  return async (req: AstronautRequest, reply: FastifyReply) => {
    if (req.params.id === SHIP_ID) return;
    if (!(await astronauts.hasHistory(req.params.id))) return notFound(reply, "unknown_astronaut");
  };
}

async function rejectUnknownAstronaut(astronauts: AstronautStore, id: string, reply: FastifyReply) {
  if (!(await astronauts.exists(id))) return notFound(reply, "unknown_astronaut");
}
