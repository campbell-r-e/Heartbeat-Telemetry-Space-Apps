"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { LiveChannel } from "@heartbeat/shared";
import { shouldRefresh } from "@/lib/domain/relay";
import { isLiveMessage } from "@/lib/domain/response-guards";
import { SECOND_MS } from "@/lib/domain/time";

/** Messages that arrive together cause one reload. */
const SETTLE_MS = 300;
/** Wait before reconnecting after the connection drops. */
const RECONNECT_MS = 5 * SECOND_MS;

function liveUrl(channel: LiveChannel): string {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  // Next.js forwards /ws/* to the onboard server (next.config.ts rewrites).
  return `${scheme}://${window.location.host}/ws/${channel}`;
}

function parse(data: unknown): unknown {
  if (typeof data !== "string") return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Listens to the server's live updates (SPEC §10: /ws/onboard or /ws/ground) and reloads the page's
 * server data when a relay event that changes it arrives. Reconnects if the connection drops, and
 * reloads once reconnected.
 */
export function LiveRefresh({ channel, astronautId = null }: { channel: LiveChannel; /** The astronaut whose points the page shows; without it, points messages never reload the page. */ astronautId?: string | null }) {
  const router = useRouter();
  useEffect(() => {
    let socket: WebSocket | null = null;
    let settle: ReturnType<typeof setTimeout> | undefined;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let reconnecting = false;

    const refreshSoon = () => {
      clearTimeout(settle);
      settle = setTimeout(() => router.refresh(), SETTLE_MS);
    };

    const connect = () => {
      socket = new WebSocket(liveUrl(channel));
      // After a dropped connection, reload once: events sent during the gap were not heard.
      socket.onopen = () => {
        if (reconnecting && !closed) refreshSoon();
      };
      socket.onmessage = (event) => {
        const message = parse(event.data);
        if (closed || !isLiveMessage(message) || !shouldRefresh(channel, message, astronautId)) return;
        refreshSoon();
      };
      socket.onclose = () => {
        if (closed) return;
        reconnecting = true;
        reconnect = setTimeout(connect, RECONNECT_MS);
      };
    };
    connect();

    return () => {
      closed = true;
      clearTimeout(settle);
      clearTimeout(reconnect);
      // Closing while still connecting logs a browser warning; close as soon as it opens instead.
      const current = socket;
      if (current?.readyState === WebSocket.CONNECTING) current.onopen = () => current.close();
      else current?.close();
    };
  }, [channel, astronautId, router]);
  return null;
}
