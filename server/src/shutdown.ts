// The server's shutdown order (used by src/index.ts, tested in test/delivery-timer.test.ts).
import type { FastifyInstance } from "fastify";
import { closeInOrder } from "./http/close-in-order.ts";

/** What the server stops on close. */
export interface RunningParts {
  statusLogJob: { stop(): Promise<void> };
  sleepJob: { stop(): Promise<void> };
  relaySystem: { stop(): Promise<void> };
  /** Live points updates still being worked out (SPEC §7). */
  points: { settled(): Promise<void> };
  live: { close(): void };
  pool: { end(): Promise<void> };
}

/**
 * On close: stop the every-minute evaluation, the hourly sleep derivation and the relay (each
 * finishing its work in progress), let the points updates in progress finish, then disconnect
 * the live WebSocket clients, and only then close the database pool they all use.
 */
export function shutdownInOrder(app: FastifyInstance, { statusLogJob, sleepJob, relaySystem, points, live, pool }: RunningParts): void {
  closeInOrder(app, [
    () => statusLogJob.stop(), () => sleepJob.stop(), () => relaySystem.stop(), () => points.settled(), () => live.close(), () => pool.end(),
  ]);
}
