import "server-only";

// HTTP plumbing to the onboard server: a thin shell around fetch. What a response means is decided
// in lib/domain/onboard-response.ts. Server-side only: the write token lives in a server-only
// environment variable and never reaches the browser.

import type { Guard } from "../domain/guards";
import { readOnboardResponse } from "../domain/onboard-response";
import { serverUrl } from "../server-url";

export type Query = Record<string, string | number | undefined>;

function writeToken(): string {
  const token = process.env.HEARTBEAT_TOKEN;
  if (!token) throw new Error("HEARTBEAT_TOKEN is not set; add it to web/.env.local (see web/.env.example).");
  return token;
}

function url(path: string, query: Query = {}): string {
  const target = new URL(path, serverUrl());
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) target.searchParams.set(key, String(value));
  }
  return target.toString();
}

/** GET (open on the server), checked against `guard`. Never cached: this is live telemetry. */
export async function getJson<T>(path: string, guard: Guard<T>, query?: Query): Promise<T> {
  const response = await fetch(url(path, query), { cache: "no-store" });
  return readOnboardResponse(response.status, path, await response.text(), guard);
}

/** POST, PUT or DELETE with the shared write token (SPEC §10), checked against `guard`. */
export async function sendJson<T>(method: "POST" | "PUT" | "DELETE", path: string, guard: Guard<T>, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${writeToken()}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(url(path), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  return readOnboardResponse(response.status, path, await response.text(), guard);
}
