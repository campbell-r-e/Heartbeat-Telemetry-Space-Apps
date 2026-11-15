import "server-only";

import { connection } from "next/server";

/** The current time for one request. Waits for the request, so pages using it are never prerendered. */
export async function requestNow(): Promise<number> {
  await connection();
  return Date.now();
}
