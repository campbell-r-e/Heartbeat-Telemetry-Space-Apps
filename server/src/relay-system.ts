// Wires the relay together (SPEC §3, §8): the queue, its delivery timer, the onboard crew effects,
// the status listener that sends alerts and snapshots to the ground, and the periodic upkeep.
// Used by src/index.ts and by tests.
import type { DailyLogChanges, LiveUpdates, PointsChanges, Stores } from "./domain/ports.ts";
import { onboardCrew, type OnboardCrew } from "./domain/relay/crew.ts";
import { dailyLogRelay, type ExerciseSettings } from "./domain/relay/daily-log-relay.ts";
import { missionRelay } from "./domain/relay/mission-relay.ts";
import { createRelay, deliverDueEvents, type Relay } from "./domain/relay/relay.ts";
import { succeeded } from "./domain/relay/outcome.ts";
import { statusRelay } from "./domain/relay/status-relay.ts";
import type { StatusListener } from "./domain/status/astronaut-status.ts";
import { DAY_MS } from "./domain/time.ts";
import { deliveryTimer } from "./jobs/delivery-timer.ts";

/** Status snapshots older than this are pruned; each astronaut's latest is always kept. */
export const SNAPSHOT_RETENTION_MS = 7 * DAY_MS;

export interface RelaySystemDeps {
  stores: Stores;
  live: LiveUpdates;
  now: () => number;
  /** How often an unchanged status is sent to the ground again ("data as of" stays fresh). */
  snapshotIntervalMs: number;
  /** The exercise settings the daily logs count exercise minutes with (the rule book's). */
  exerciseSettings: ExerciseSettings;
  /** Told when an astronaut is added or removed on board, so their points are worked out again at once (SPEC §7). */
  pointsChanges: Pick<PointsChanges, "historyChanged">;
  onError: (error: unknown) => void;
}

export interface RelaySystem {
  relay: Relay;
  statusListener: StatusListener;
  /** Writes to a day of a daily log report through it, so the next run rebuilds that day. */
  dailyLogChanges: DailyLogChanges;
  /** The spacecraft's crew management: watches report through it. */
  crew: Pick<OnboardCrew, "watchReported">;
  /** Hands over the events due now (after any run in progress). Tests call it with a fake clock. */
  deliverNow(): Promise<void>;
  /** Hands over what arrived while the server was down, starts the timer, tells the ground the crew, mission and daily logs. */
  start(): Promise<void>;
  /**
   * Periodic upkeep: watch news, a new mission day and changed daily logs go down; old status
   * snapshots and superseded daily logs are pruned.
   */
  upkeep(): Promise<void>;
  /** Stops the timer once a delivery in progress has finished. */
  stop(): Promise<void>;
}

export function createRelaySystem({ stores, live, now, snapshotIntervalMs, exerciseSettings, pointsChanges, onError }: RelaySystemDeps): RelaySystem {
  const deliverDue = () => deliverDueEvents({
    store: stores.relay, live, onArrival: crew.onArrival,
    reportRetry: (event, reason, failedAttempts, retryAtMs) => onError(new Error(
      `${event.kind} event ${event.id} failed on arrival (attempt ${failedAttempts}): ${reason}; retrying at ${new Date(retryAtMs).toISOString()}`,
    )),
    // Sent at most once per event, however often a run reaches this point.
    reportFailure: async (event, reason, failedAttempts) => {
      await relay.sendChecked("deliveryFailure", async (queue) => {
        const reported = (await queue.list("deliveryFailure")).find((failure) => failure.payload.eventId === event.id);
        return succeeded(reported
          ? { alreadySent: reported }
          : { send: { eventId: event.id, kind: event.kind, reason, attempts: failedAttempts } });
      });
    },
  }, now());
  const timer = deliveryTimer({ deliverDue, now, onError });
  const relay = createRelay({ store: stores.relay, mission: stores.mission, live, scheduler: timer, now });
  const dailyLogs = dailyLogRelay({ stores, settings: exerciseSettings, relay, now });
  const crew = onboardCrew({
    astronauts: stores.astronauts, watches: stores.watches, relayStore: stores.relay, relay, now,
    onRosterError: (error) => onError(error),
    // A crew change rereads both the astronaut's daily log and their task history.
    dailyLogChanges: {
      historyChanged(astronautId) {
        dailyLogs.historyChanged(astronautId);
        pointsChanges.historyChanged(astronautId);
      },
    },
  });
  const mission = missionRelay(stores.mission, relay, now);

  return {
    relay,
    statusListener: statusRelay({ relay, live, statusLog: stores.statusLog, snapshotIntervalMs }),
    dailyLogChanges: dailyLogs,
    crew,
    deliverNow: () => timer.deliverNow(),
    async start() {
      await timer.deliverNow();
      await crew.announceRoster();
      await mission.announceIfChanged();
      await dailyLogs.announceIfChanged();
    },
    async upkeep() {
      await crew.refreshRoster();
      await mission.announceIfChanged();
      await stores.relay.pruneHandedOver("status", now() - SNAPSHOT_RETENTION_MS);
      await dailyLogs.announceIfChanged();
      // Each daily log holds the whole mission so far: only each astronaut's newest arrived one is kept.
      await stores.relay.pruneHandedOver("dailyLog", now());
    },
    stop: () => timer.stop(),
  };
}
