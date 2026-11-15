import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const BEARER_PREFIX = "Bearer ";

/** Every write needs `Authorization: Bearer <token>`; reads stay open. */
export function requireTokenForWrites(app: FastifyInstance, token: string): void {
  const expected = digest(token);
  app.addHook("onRequest", async (req, reply) => {
    if (!WRITE_METHODS.has(req.method)) return;
    if (!hasValidBearer(req.headers.authorization, expected)) {
      return reply.code(401).send({ error: "unauthorized", message: "send Authorization: Bearer <token>" });
    }
  });
}

function hasValidBearer(header: string | undefined, expected: Buffer): boolean {
  if (!header?.startsWith(BEARER_PREFIX)) return false;
  return timingSafeEqual(digest(header.slice(BEARER_PREFIX.length)), expected);
}

/** Hashing first gives equal-length buffers, so the comparison time does not reveal the token length. */
function digest(text: string): Buffer {
  return createHash("sha256").update(text).digest();
}
