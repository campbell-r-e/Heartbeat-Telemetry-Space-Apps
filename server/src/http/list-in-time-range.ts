import type { FastifyReply, FastifyRequest } from "fastify";
import { parseTimeRangeQuery, type TimeRangeQuery } from "./time-queries.ts";
import { invalidQuery } from "./replies.ts";

type ListRequest = FastifyRequest<{ Params: { id: string }; Querystring: TimeRangeQuery }>;

/**
 * Handler for GET .../:id/<things>?from=&to=: lists what `list` finds in the window, which
 * defaults to the `defaultLengthMs` before now.
 */
export function listInTimeRange<T>(
  defaultLengthMs: number,
  now: () => number,
  list: (astronautId: string, fromMs: number, toMs: number) => Promise<T[]>,
) {
  return async (req: ListRequest, reply: FastifyReply) => {
    const bounds = parseTimeRangeQuery(req.query, defaultLengthMs, now());
    if (!bounds.ok) return invalidQuery(reply, bounds);
    return list(req.params.id, bounds.value.fromMs, bounds.value.toMs);
  };
}
