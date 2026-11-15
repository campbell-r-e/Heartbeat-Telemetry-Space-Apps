"use client";

import { ServerErrorNotice } from "@/components/ServerErrorNotice";

/**
 * Shown when the onboard server cannot be reached, answers with an error, or answers in a shape this
 * dashboard does not expect. Next.js hides server error details in production, so the page names
 * both causes rather than guessing which one happened.
 */
export default function DashboardError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <ServerErrorNotice error={error} retry={retry} title="The dashboard could not load or read data from the onboard server">
      Either the server is not reachable (check that it is running with docker compose up and that HEARTBEAT_SERVER_URL points at it), or it answered in a shape this dashboard does not understand, which means the server and the dashboard are on different versions.
    </ServerErrorNotice>
  );
}
