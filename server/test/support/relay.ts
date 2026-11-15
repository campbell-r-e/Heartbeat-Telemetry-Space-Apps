// The relay and live parts of AppDeps for HTTP tests, wired as src/index.ts wires them.
import type { Stores } from "../../src/domain/ports.ts";
import { crewPoints, type CrewPoints } from "../../src/domain/gamification/points-updates.ts";
import { createLiveHub, type LiveHub } from "../../src/http/live.ts";
import { createRelaySystem, type RelaySystem } from "../../src/relay-system.ts";
import { DEFAULT_RULE_BOOK } from "../../src/domain/rules/rule-book.ts";
import { MINUTE_MS } from "../../src/domain/time.ts";

export interface TestRelay {
  system: RelaySystem;
  /** Tasks and live points (SPEC §7), sharing the relay's live hub. */
  points: CrewPoints;
  /** The AppDeps fields buildApp needs for the relay and points. */
  deps: {
    relay: RelaySystem["relay"]; statusListener: RelaySystem["statusListener"]; live: LiveHub; crew: RelaySystem["crew"];
    dailyLogChanges: RelaySystem["dailyLogChanges"]; points: CrewPoints;
  };
  /** Errors the delivery timer and the points updates reported; tests expect none. */
  errors: unknown[];
  /** WebSocket clients dropped for breaking the protocol. */
  clientErrors: Error[];
}

export function testRelay(stores: Stores, now: () => number, snapshotIntervalMs = MINUTE_MS): TestRelay {
  const errors: unknown[] = [];
  const clientErrors: Error[] = [];
  const live = createLiveHub((error) => clientErrors.push(error));
  const points = crewPoints({ stores, settings: DEFAULT_RULE_BOOK.settings, live, now, onError: (error) => errors.push(error) });
  const system = createRelaySystem({
    stores, live, now, snapshotIntervalMs, exerciseSettings: DEFAULT_RULE_BOOK.settings, pointsChanges: points, onError: (error) => errors.push(error),
  });
  return {
    system,
    points,
    deps: { relay: system.relay, statusListener: system.statusListener, live, crew: system.crew, dailyLogChanges: system.dailyLogChanges, points },
    errors,
    clientErrors,
  };
}
