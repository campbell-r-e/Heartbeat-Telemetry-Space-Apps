import type { RelayEvent, RelayEventKind, RelayEventOf, RelayPayloads } from "@heartbeat/shared";
import { changedAstronautId } from "./crew.ts";

/** Which astronaut each kind of event is about; null for the whole crew or the mission. */
const ASTRONAUT_OF: { [K in RelayEventKind]: (payload: RelayPayloads[K]) => string | null } = {
  status: (snapshot) => snapshot.astronautId,
  alert: (alert) => alert.astronautId,
  readReceipt: (receipt) => receipt.astronautId,
  roster: () => null,
  mission: () => null,
  dailyLog: (log) => log.astronautId,
  deliveryFailure: () => null,
  alertState: (change) => change.astronautId,
  note: (note) => note.astronautId,
  crewChange: changedAstronautId,
};

/** The astronaut an event is about, so the queue can be read per astronaut; null for crew and mission events. */
export function eventAstronautId<K extends RelayEventKind>(kind: K, payload: RelayPayloads[K]): string | null {
  // TypeScript cannot correlate `kind` across the two lookups; the table's mapped type
  // guarantees each accessor matches its own kind's payload.
  const astronautOf = ASTRONAUT_OF[kind] as (payload: RelayPayloads[K]) => string | null;
  return astronautOf(payload);
}

/** Widens an event of one kind to the RelayEvent union, which TypeScript cannot do for a generic kind. */
export function asRelayEvent<K extends RelayEventKind>(event: RelayEventOf<K>): RelayEvent {
  return event as RelayEvent;
}
