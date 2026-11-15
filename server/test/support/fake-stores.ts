// Stores for evaluation tests: reads for "broken" fail, reads for "slow" wait, and the alert log
// records who was evaluated. Everything else is unused.
import type { Astronaut } from "@heartbeat/shared";
import type { Stores } from "../../src/domain/ports.ts";

export const astronaut = (id: string): Astronaut => ({ id, name: id, watchId: null, age: null, sex: null, massKg: null, heightM: null });

/**
 * Stores where every read for the astronaut "broken" fails, every read for "slow" waits for `slowRead`,
 * and the alert log records who was evaluated.
 */
export function storesWithOneBroken(evaluated: string[], crewList?: () => Promise<Astronaut[]>, slowRead: Promise<void> = Promise.resolve()): Stores {
  const unused = () => { throw new Error("not used"); };
  const failFor = async (id: string) => {
    if (id === "broken") throw new Error("bad data row");
    if (id === "slow") await slowRead;
  };
  return {
    astronauts: {
      list: crewList ?? (async () => [astronaut("broken"), astronaut("fine")]), find: unused, exists: unused, hasHistory: unused, upsert: unused, addToCrew: unused, remove: unused, assignWatch: unused,
    },
    readings: {
      add: unused, upsert: unused, replaceSource: unused, deleteSource: unused, deleteSourceInRanges: unused, latest: unused,
      arrayReadingsOverlapping: unused, arrayReadingsTakenIn: unused, replaceSourceInRange: unused, readingTimesReadByRules: unused,
      series: async (id) => { await failFor(id); return []; },
      latestReadByRules: async (id) => { await failFor(id); return []; },
    },
    checkIns: { add: unused, remove: unused, between: async () => [] },
    meals: { add: unused, remove: unused, between: async () => [] },
    foods: { replaceMenu: unused, exists: unused, menu: async () => ({ sources: [], foods: [] }) },
    schedule: { replace: unused, forAstronaut: unused },
    badges: { earned: unused, record: unused },
    mission: { saveIfMissing: unused, get: async () => null, updateSleepDayTimeZone: unused, relaySetting: unused, updateRelaySetting: unused },
    statusLog: {
      update: async (id, compute) => { evaluated.push(id); return compute(new Map(), new Map()).changes; },
      between: unused, unsentGroundAlerts: unused, markSentToGround: unused,
    },
    relay: {
      inDirection: unused, find: unused, list: unused, latestDelivered: unused, latestDeliveredPerAstronaut: unused,
      dueUndelivered: unused, markDelivered: unused, nextDeliverAtMs: unused,
      latestHandedOver: unused, recordFailedAttempt: unused, markFailed: unused, pruneHandedOver: unused,
    },
    watches: { report: unused, list: unused },
    demoStorm: { read: unused, store: unused, clear: unused, forgetStart: unused },
  };
}
