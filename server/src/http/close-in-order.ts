import type { FastifyInstance } from "fastify";

/**
 * On close, runs each step after the one before it has finished: e.g. stop the timers (waiting
 * for their work in progress), then close the database pool they use. One hook keeps the order
 * explicit instead of relying on the order separate hooks run in.
 */
export function closeInOrder(app: FastifyInstance, steps: ReadonlyArray<() => unknown>): void {
  app.addHook("onClose", async () => {
    for (const step of steps) await step();
  });
}
