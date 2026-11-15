// The relay queue's use cases (SPEC §3, §8): sending an event across, handing over the events
// that have arrived, and the delay setting. Each event is held until sentAt + the one-way delay.
import {
  RELAY_DIRECTIONS, type LiveChannel, type RelayDelayResponse, type RelayDirection, type RelayEvent, type RelayEventKind,
  type RelayEventOf, type RelayPayloads, type RelaySetting,
} from "@heartbeat/shared";
import type { LiveUpdates, MissionStore, RelayReader, RelayStore } from "../ports.ts";
import { DEFAULT_RELAY_SETTING, deliverAtMs, oneWayDelayMs, relayDelay } from "./delay.ts";
import { asRelayEvent } from "./events.ts";
import { retryGapMs, shouldSetAside } from "./retry-schedule.ts";
import { succeeded, type Outcome, type RelayProblem } from "./outcome.ts";

/** Told when an event joins the queue, so it is handed over on time. */
export interface DeliveryScheduler {
  eventQueued(deliverAtMs: number): void;
}

export interface RelayDeps {
  store: RelayStore;
  mission: MissionStore;
  live: LiveUpdates;
  scheduler: DeliveryScheduler;
  now: () => number;
}

/** What a guarded send decided: send this payload, or the event already sent answers the request. */
export type SendDecision<K extends RelayEventKind> = { send: RelayPayloads[K] } | { alreadySent: RelayEventOf<K> };

export interface Relay {
  /** Sends an event from its side; it arrives on the other side after the current delay. */
  send<K extends RelayEventKind>(kind: K, payload: RelayPayloads[K]): Promise<RelayEventOf<K>>;
  /**
   * Like `send`, guarded: `decide` reads the queue while no one else can send in the event's
   * direction, and the send (or refusal) follows from what it saw.
   */
  sendChecked<K extends RelayEventKind, P extends RelayProblem>(
    kind: K, decide: (queue: RelayReader) => Promise<Outcome<SendDecision<K>, P>>,
  ): Promise<Outcome<RelayEventOf<K>, P>>;
  delay(): Promise<RelayDelayResponse>;
  /**
   * Changes the preset and/or the real-time toggle, keeping a field left out. Applies to events
   * sent from now on; events already on their way keep their arrival time.
   */
  changeDelay(change: Partial<RelaySetting>): Promise<RelayDelayResponse>;
}

const SENDING_SIDE: Record<RelayDirection, LiveChannel> = { toGround: "onboard", toOnboard: "ground" };
const RECEIVING_SIDE: Record<RelayDirection, LiveChannel> = { toGround: "ground", toOnboard: "onboard" };
const BOTH_SIDES: readonly LiveChannel[] = ["onboard", "ground"];

export function createRelay({ store, mission, live, scheduler, now }: RelayDeps): Relay {
  const currentSetting = async () => (await mission.relaySetting()) ?? DEFAULT_RELAY_SETTING;

  const relay: Relay = {
    async send(kind, payload) {
      const outcome = await relay.sendChecked(kind, async () => succeeded({ send: payload }));
      if (!outcome.ok) throw new Error(`an unguarded ${kind} send was refused: ${outcome.problem}`);
      return outcome.value;
    },

    async sendChecked(kind, decide) {
      const delayMs = oneWayDelayMs(await currentSetting());
      const result = await store.inDirection(RELAY_DIRECTIONS[kind], async (queue) => {
        const decision = await decide(queue);
        if (!decision.ok) return { outcome: decision, isNew: false };
        if ("alreadySent" in decision.value) return { outcome: succeeded(decision.value.alreadySent), isNew: false };
        const sentAtMs = now();
        const event = await queue.append(kind, decision.value.send, sentAtMs, (previous) => deliverAtMs(sentAtMs, delayMs, previous));
        return { outcome: succeeded(event), isNew: true };
      });
      // Told only once the event is committed.
      if (result.isNew && result.outcome.ok) announceQueued(result.outcome.value);
      return result.outcome;
    },

    async delay() {
      return relayDelay(await currentSetting());
    },

    async changeDelay(change) {
      const setting = await mission.updateRelaySetting(change);
      if (!setting) throw new Error("there is no mission record to hold the relay delay");
      const response = relayDelay(setting);
      for (const channel of BOTH_SIDES) live.publish(channel, { type: "relayDelay", relay: response });
      return response;
    },
  };

  function announceQueued<K extends RelayEventKind>(event: RelayEventOf<K>): void {
    live.publish(SENDING_SIDE[event.direction], { type: "relaySent", event: asRelayEvent(event) });
    scheduler.eventQueued(Date.parse(event.deliverAt));
  }

  return relay;
}

/** What happens on board when an event arrives there (crew changes take effect). */
export type ArrivalEffect = (event: RelayEvent) => Promise<void>;

export interface DeliveryDeps {
  store: RelayStore;
  live: LiveUpdates;
  onArrival: ArrivalEffect;
  /** Told of a failed attempt that will be retried at `retryAtMs` (for the log). */
  reportRetry: (event: RelayEvent, reason: string, failedAttempts: number, retryAtMs: number) => void;
  /**
   * Tells the ground that `event` is being set aside after `failedAttempts` failed attempts. Must
   * be safe to repeat: it runs before the event is set aside, so a crash in between repeats it.
   */
  reportFailure: (event: RelayEvent, reason: string, failedAttempts: number) => Promise<void>;
}

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Hands over every event due by `nowMs`, in arrival order: runs its arrival effect, marks it
 * delivered and pushes it to the receiving side. A failing effect holds its own direction only
 * (owner decision): later events going the same way wait and keep their order, while the other
 * direction flows on, so a stuck crew change never delays an alert's push to the ground. The
 * failing event is retried after growing gaps (retry-schedule.ts), and once the retries have taken
 * about 10 minutes it is set aside as failed, the ground is told, and its direction flows again.
 * Returns when the run should go again: the earliest retry time of a held direction or the next
 * arrival still to come, or null.
 */
export async function deliverDueEvents(
  { store, live, onArrival, reportRetry, reportFailure }: DeliveryDeps, nowMs: number,
): Promise<number | null> {
  const heldUntil = new Map<RelayDirection, number>();
  for (const { event, failedAttempts, retryAtMs } of await store.dueUndelivered(nowMs)) {
    if (heldUntil.has(event.direction)) continue;
    if (retryAtMs !== null && retryAtMs > nowMs) {
      heldUntil.set(event.direction, retryAtMs);
      continue;
    }
    try {
      await onArrival(event);
    } catch (error) {
      const failed = failedAttempts + 1;
      if (shouldSetAside(failed)) {
        // The report goes first: if it fails, the event stays due and the next run reports again.
        await reportFailure(event, reasonOf(error), failed);
        await store.markFailed(event.id, nowMs);
        continue;
      }
      const retryAt = nowMs + retryGapMs(failed);
      await store.recordFailedAttempt(event.id, retryAt);
      reportRetry(event, reasonOf(error), failed, retryAt);
      heldUntil.set(event.direction, retryAt);
      continue;
    }
    await store.markDelivered(event.id, nowMs);
    live.publish(RECEIVING_SIDE[event.direction], { type: "relayDelivered", event });
  }
  const wakeTimes = [...heldUntil.values(), await store.nextDeliverAtMs(nowMs)].filter((ms): ms is number => ms !== null);
  return wakeTimes.length === 0 ? null : Math.min(...wakeTimes);
}
