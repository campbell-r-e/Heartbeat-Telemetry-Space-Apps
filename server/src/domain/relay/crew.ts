// Crew and watch management (SPEC §9.2): the flight surgeon's changes travel to the spacecraft
// through the relay and take effect there on arrival; the spacecraft then sends its new roster
// back, so the ground learns the result one delay later.
import type { Astronaut, CrewChange, CrewRoster, DeviceReport, RelayEvent, RosterEntry, WatchInfo } from "@heartbeat/shared";
import type { AstronautStore, DailyLogChanges, RelayStore, WatchStore } from "../ports.ts";
import type { ArrivalEffect, Relay } from "./relay.ts";
import type { RelayProblem } from "./outcome.ts";

/** Why the ground refuses a crew change, judged against the crew as the ground expects it. */
export type CrewChangeProblem = Extract<RelayProblem, "unknown_astronaut" | "astronaut_exists">;

/** A watch assigned before it has ever uploaded: nothing is known of its contact or battery yet. */
const unheardWatch = (watchId: string): WatchInfo => ({ watchId, lastContactAt: null, batteryPct: null });

/**
 * The roster: each crew member with their watch's last contact and battery, and the registered
 * watches no one wears.
 */
export function crewRoster(
  astronauts: readonly Astronaut[], watches: readonly WatchInfo[], lastAppliedChangeSeq: number | null,
): CrewRoster {
  const registered = new Map(watches.map((watch) => [watch.watchId, watch]));
  const worn = new Set(astronauts.flatMap((astronaut) => (astronaut.watchId === null ? [] : [astronaut.watchId])));
  return {
    astronauts: astronauts.map(({ id, name, watchId }): RosterEntry => ({
      astronautId: id, name, watch: watchId === null ? null : registered.get(watchId) ?? unheardWatch(watchId),
    })),
    unassignedWatches: watches.filter((watch) => !worn.has(watch.watchId)),
    lastAppliedChangeSeq,
  };
}

/** The roster once `change` has taken effect. Pure; mirrors applyCrewChange on board. */
export function applyToRoster(roster: readonly RosterEntry[], change: CrewChange): RosterEntry[] {
  switch (change.action) {
    case "addAstronaut":
      return [...roster, { astronautId: change.astronaut.id, name: change.astronaut.name, watch: null }];
    case "removeAstronaut":
      return roster.filter((entry) => entry.astronautId !== change.astronautId);
    case "assignWatch":
      return roster.map((entry) => {
        if (entry.astronautId === change.astronautId) return { ...entry, watch: unheardWatch(change.watchId) };
        return entry.watch?.watchId === change.watchId ? { ...entry, watch: null } : entry;
      });
    case "unassignWatch":
      return roster.map((entry) => (entry.astronautId === change.astronautId ? { ...entry, watch: null } : entry));
  }
}

/** The astronaut a change is about. */
export function changedAstronautId(change: CrewChange): string {
  return change.action === "addAstronaut" ? change.astronaut.id : change.astronautId;
}

/** Why `change` cannot apply to `roster`, or null when it can. */
export function crewChangeProblem(roster: readonly RosterEntry[], change: CrewChange): CrewChangeProblem | null {
  const known = roster.some((entry) => entry.astronautId === changedAstronautId(change));
  if (change.action === "addAstronaut") return known ? "astronaut_exists" : null;
  return known ? null : "unknown_astronaut";
}

/**
 * Applies a crew change on board at `atMs`. Safe to repeat: adding keeps an existing astronaut's
 * watch (and brings back a removed one), removing an absent astronaut does nothing, and assigning
 * sets the same watch again.
 */
export async function applyCrewChange(astronauts: AstronautStore, change: CrewChange, atMs: number): Promise<void> {
  switch (change.action) {
    case "addAstronaut":
      return astronauts.addToCrew({ ...change.astronaut, watchId: null });
    case "removeAstronaut":
      await astronauts.remove(change.astronautId, atMs);
      return;
    case "assignWatch":
      return astronauts.assignWatch(change.astronautId, change.watchId);
    case "unassignWatch":
      return astronauts.assignWatch(change.astronautId, null);
  }
}

export interface OnboardCrewDeps {
  astronauts: AstronautStore;
  watches: WatchStore;
  relayStore: RelayStore;
  relay: Relay;
  now: () => number;
  /** Told when a roster could not be sent; it is owed and goes with the next refresh. */
  onRosterError: (error: unknown) => void;
  /** Told when an astronaut is removed or added (again), so their daily log is rebuilt in full. */
  dailyLogChanges: Pick<DailyLogChanges, "historyChanged">;
}

const laterSeq = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.max(a, b));

/**
 * The spacecraft's side of crew management. Applying a crew change and sending the roster that
 * confirms it are separate steps, retried separately (owner decision): a change that took effect
 * is never reported as failed, and if the roster cannot be sent the ground sees the update late.
 */
export function onboardCrew({ astronauts, watches, relayStore, relay, now, onRosterError, dailyLogChanges }: OnboardCrewDeps) {
  // A roster is owed after a crew change or a watch report, until one is actually sent.
  let rosterOwed = false;
  // The newest crew change applied in this process; the store's hand-over record trails it by a moment.
  let appliedSeq: number | null = null;

  /** Sends the roster as it is now, confirming the crew changes applied so far. */
  async function announceRoster(): Promise<void> {
    const handedOver = await relayStore.latestHandedOver("crewChange");
    const [crew, registered] = await Promise.all([astronauts.list(), watches.list()]);
    await relay.send("roster", crewRoster(crew, registered, laterSeq(handedOver?.seq ?? null, appliedSeq)));
    rosterOwed = false; // only once the roster is on its way
  }

  /** Arrival effect: the crew change takes effect on board. The confirming roster is a separate step. */
  const onArrival: ArrivalEffect = async (event: RelayEvent) => {
    if (event.kind !== "crewChange") return;
    await applyCrewChange(astronauts, event.payload, now());
    const { action } = event.payload;
    if (action === "addAstronaut" || action === "removeAstronaut") dailyLogChanges.historyChanged(changedAstronautId(event.payload));
    appliedSeq = laterSeq(appliedSeq, event.seq);
    rosterOwed = true;
    await announceRoster().catch(onRosterError);
  };

  return {
    onArrival,
    /** E.g. on start, so the ground's crew matches the spacecraft's. */
    announceRoster,

    /**
     * Records an accepted upload from a watch. A watch's first upload registers it, and the
     * ground hears of it at once; later contact and battery go with the next roster refresh.
     */
    async watchReported(device: DeviceReport): Promise<void> {
      const { isNew } = await watches.report(device, now());
      rosterOwed = true;
      if (isNew) await announceRoster();
    },

    /** Sends the roster if one is owed: a crew change or watch news since the last one sent (called periodically). */
    async refreshRoster(): Promise<void> {
      if (rosterOwed) await announceRoster();
    },
  };
}

export type OnboardCrew = ReturnType<typeof onboardCrew>;
