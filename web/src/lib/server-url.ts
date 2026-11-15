// Where the onboard server is, for the fetch shell (lib/onboard/http.ts) and the WebSocket rewrite
// (next.config.ts). No "server-only" import, so next.config.ts can load it.

export const DEFAULT_SERVER_URL = "http://localhost:4000";

/** HEARTBEAT_SERVER_URL from the environment, or the local default (docker compose publishes port 4000). */
export function serverUrl(): string {
  return process.env.HEARTBEAT_SERVER_URL ?? DEFAULT_SERVER_URL;
}
