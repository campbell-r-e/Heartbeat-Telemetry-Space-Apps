"use client";

import { ServerErrorNotice } from "@/components/ServerErrorNotice";

/**
 * Shown when the ground endpoints cannot be reached, answer with an error, or answer in a shape this
 * console does not expect. Next.js hides server error details in production, so the page names both causes.
 */
export default function ConsoleError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <ServerErrorNotice error={error} retry={retry} title="The flight surgeon console could not load or read the ground's data">
      Either the server is not reachable (check that it is running with docker compose up and that HEARTBEAT_SERVER_URL points at it), or it answered in a shape this console does not understand, which means the server and the web app are on different versions.
    </ServerErrorNotice>
  );
}
