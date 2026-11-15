// The mission (name, start, day, gravity) reaches the ground through the relay (SPEC §8), like
// everything else Mission Control knows.
import type { GroundMissionResponse, MissionResponse } from "@heartbeat/shared";
import { withMissionDay } from "../mission.ts";
import type { MissionStore, RelayReader } from "../ports.ts";
import type { Relay } from "./relay.ts";

const sameMission = (a: MissionResponse, b: MissionResponse) => JSON.stringify(a) === JSON.stringify(b);

/** Sends the mission when it differs from the last one sent (on start, and when the day turns). */
export function missionRelay(mission: MissionStore, relay: Relay, now: () => number) {
  let lastSent: MissionResponse | null = null;

  return {
    async announceIfChanged(): Promise<void> {
      const record = await mission.get();
      if (!record) return;
      const current = withMissionDay(record, now());
      if (lastSent && sameMission(lastSent, current)) return;
      await relay.send("mission", current);
      lastSent = current;
    },
  };
}

/** GET /api/ground/mission: the latest mission report that has reached the ground. */
export async function groundMission(store: RelayReader, nowMs: number): Promise<GroundMissionResponse> {
  const report = await store.latestDelivered("mission", nowMs);
  return { mission: report?.payload ?? null, sentAt: report?.sentAt ?? null, receivedAt: report?.deliverAt ?? null };
}
