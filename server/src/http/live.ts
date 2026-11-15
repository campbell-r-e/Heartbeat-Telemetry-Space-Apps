// Live updates over WebSocket (SPEC §10): /ws/onboard for the astronaut dashboard and the watch,
// /ws/ground for the flight surgeon console. Push only: each message is one JSON LiveMessage.
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import type { LiveChannel } from "@heartbeat/shared";
import type { LiveUpdates } from "../domain/ports.ts";

const CHANNEL_PATHS = new Map<string, LiveChannel>([["/ws/onboard", "onboard"], ["/ws/ground", "ground"]]);
/** Clients only listen, so anything larger than a close frame's reason is refused. */
const MAX_CLIENT_FRAME_BYTES = 1024;

/**
 * The channel a request target asks for: its path (before any query) compared with the live
 * paths as plain text, so no target, however malformed, can make the lookup throw.
 */
export function channelForTarget(target: string | undefined): LiveChannel | null {
  const path = (target ?? "").split("?", 1)[0];
  return CHANNEL_PATHS.get(path) ?? null;
}

/** Answers a refused upgrade with a plain HTTP status and closes the connection. */
function refuseUpgrade(socket: Duplex, status: "400 Bad Request" | "404 Not Found"): void {
  if (socket.writable) socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export interface LiveHub extends LiveUpdates {
  /** Accepts WebSocket upgrades on the server's live paths; other upgrade requests are refused. */
  attach(server: Server): void;
  /** Disconnects every client. */
  close(): void;
}

/**
 * `onClientError` is told about a client that broke the protocol (a malformed frame, an oversized
 * one); that client is dropped and the server carries on.
 */
export function createLiveHub(onClientError: (error: Error) => void): LiveHub {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_CLIENT_FRAME_BYTES });
  sockets.on("error", onClientError);
  const listeners: Record<LiveChannel, Set<WebSocket>> = { onboard: new Set(), ground: new Set() };

  return {
    publish(channel, message) {
      const text = JSON.stringify(message);
      for (const client of listeners[channel]) {
        if (client.readyState === WebSocket.OPEN) client.send(text);
      }
    },

    attach(server) {
      const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
        const target = request.url ?? "";
        // A request target must be a path; "//..." is a network path a WebSocket client never sends.
        if (!target.startsWith("/") || target.startsWith("//")) return refuseUpgrade(socket, "400 Bad Request");
        const channel = channelForTarget(target);
        if (!channel) return refuseUpgrade(socket, "404 Not Found");
        sockets.handleUpgrade(request, socket, head, (client) => {
          listeners[channel].add(client);
          client.on("close", () => listeners[channel].delete(client));
          // Without a listener, ws rethrows a client's protocol error and the process exits.
          client.on("error", (error) => {
            listeners[channel].delete(client);
            onClientError(error);
          });
        });
      };
      // An exception escaping an "upgrade" listener would end the process: report it, drop the socket.
      server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
        socket.on("error", onClientError);
        try {
          upgrade(request, socket, head);
        } catch (error) {
          onClientError(error instanceof Error ? error : new Error(String(error)));
          socket.destroy();
        }
      });
    },

    close() {
      for (const client of sockets.clients) client.terminate();
      sockets.close();
    },
  };
}
