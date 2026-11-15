// What the spacecraft sends the ground after each status evaluation (SPEC §6.1, §8, §9.2): every
// rule that starts firing at 🔴 or 🟡 goes to the ground's alert feed (🔴 is the automatic
// flight-surgeon notification), and the crew grid gets a status snapshot whenever something
// changed, and at least once a snapshot interval.
import type { AstronautStatus, RelayedAlert, StatusSnapshot } from "@heartbeat/shared";
import type { LiveUpdates, StatusLogStore, UnsentGroundAlert } from "../ports.ts";
import type { StatusListener } from "../status/astronaut-status.ts";
import { isFiring } from "../status/status-log.ts";
import { succeeded } from "./outcome.ts";
import type { Relay } from "./relay.ts";

/** An alert log entry waiting for the ground, as the relay carries it. */
export function relayedAlert(entry: UnsentGroundAlert): RelayedAlert {
  if (entry.ruleId === null || !isFiring(entry.to)) throw new Error(`alert log entry ${entry.id} is not a rule firing`);
  return {
    alertLogId: entry.id,
    astronautId: entry.astronautId,
    ruleId: entry.ruleId,
    title: entry.title,
    area: entry.area,
    metric: entry.metric,
    status: entry.to,
    crewWide: entry.crewWide,
    message: entry.message,
    at: entry.at,
  };
}

export function statusSnapshot({ astronautId, at, overall, areas }: AstronautStatus): StatusSnapshot {
  return { astronautId, at, overall, areas };
}

export interface StatusRelayDeps {
  relay: Relay;
  live: LiveUpdates;
  statusLog: Pick<StatusLogStore, "unsentGroundAlerts" | "markSentToGround">;
  /** How long an unchanged status waits before it is sent again. */
  snapshotIntervalMs: number;
}

/**
 * Relays each evaluation. Alerts come from the alert log's outbox, written in the same transaction
 * as the change: each evaluation sends everything still in it, for every astronaut, so an alert
 * whose send failed goes with a later evaluation even if its astronaut has left the crew since
 * (owner decision). One already in the queue is never sent again, also when the id rejoins.
 * A snapshot goes when anything changed or the last one sent for the astronaut is an interval
 * old. Also pushes the fresh status to onboard clients.
 */
export function statusRelay({ relay, live, statusLog, snapshotIntervalMs }: StatusRelayDeps): StatusListener {
  // Only spaces out unchanged snapshots; after a restart the first evaluation simply sends one.
  const lastSnapshotMs = new Map<string, number>();

  async function sendUnsentAlerts(): Promise<void> {
    for (const entry of await statusLog.unsentGroundAlerts()) {
      await relay.sendChecked("alert", async (queue) => {
        const queued = (await queue.list("alert", { astronautId: entry.astronautId }))
          .find((event) => event.payload.alertLogId === entry.id);
        return succeeded(queued ? { alreadySent: queued } : { send: relayedAlert(entry) });
      });
      await statusLog.markSentToGround(entry.id);
    }
  }

  return {
    async statusEvaluated(status, changes) {
      live.publish("onboard", { type: "status", status });
      await sendUnsentAlerts();
      const atMs = Date.parse(status.at);
      const last = lastSnapshotMs.get(status.astronautId);
      if (changes.length === 0 && last !== undefined && atMs - last < snapshotIntervalMs) return;
      await relay.send("status", statusSnapshot(status));
      lastSnapshotMs.set(status.astronautId, atMs);
    },
  };
}
