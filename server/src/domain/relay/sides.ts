// What the ground and onboard use cases share.
import type { RelayReader } from "../ports.ts";
import type { Relay } from "./relay.ts";

/** What each side of the relay reads and sends through. */
export interface RelaySides {
  store: RelayReader;
  relay: Relay;
  now: () => number;
}

/** The last item per key, in list (arrival) order. */
export function latestByKey<T>(items: readonly T[], key: (item: T) => string): Map<string, T> {
  return new Map(items.map((item) => [key(item), item]));
}
