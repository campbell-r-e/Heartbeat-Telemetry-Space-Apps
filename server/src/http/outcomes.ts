import type { FastifyReply } from "fastify";
import type { Outcome, RelayProblem } from "../domain/relay/outcome.ts";

/** HTTP code and explanation for each problem a relay use case can report. */
const PROBLEM_REPLIES: Record<RelayProblem, { code: number; message: string }> = {
  unknown_astronaut: { code: 404, message: "no such astronaut in the crew as the ground knows it (including changes on their way)" },
  astronaut_exists: { code: 409, message: "an astronaut with this id is already in the crew (or is being added)" },
  unknown_alert: { code: 404, message: "no such alert from this astronaut has reached the ground" },
  invalid_transition: { code: 409, message: "an alert can be acknowledged while new, and resolved while new or acknowledged" },
  unknown_note: { code: 404, message: "no such note has reached this astronaut" },
};

/** 202 with the event sent through the relay, or the problem's code with `{ error, message }`. */
export function replyWithOutcome<T, P extends RelayProblem>(reply: FastifyReply, outcome: Outcome<T, P>, successCode = 202) {
  if (outcome.ok) return reply.code(successCode).send(outcome.value);
  const { code, message } = PROBLEM_REPLIES[outcome.problem];
  return reply.code(code).send({ error: outcome.problem, message });
}
