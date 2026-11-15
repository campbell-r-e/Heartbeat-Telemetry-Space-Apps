// Live sleep (SPEC §5.7): derive each astronaut's recent nights from the watch's wrist angles at
// start, every hour, and whenever a setting they depend on changes. Every run goes through this one
// job, one run at a time, so two runs never write the same nights at once; a failed run is
// reported and never ends the server.
import { deriveRecentSleep } from "../domain/derive-sleep.ts";
import type { Stores } from "../domain/ports.ts";
import { HOUR_MS } from "../domain/time.ts";
import { reportSafely } from "./report-safely.ts";
import { repeatEvery, type RepeatingJob } from "./repeating-job.ts";

/** How often the recent nights are derived again (owner decision: hourly). */
export const SLEEP_DERIVATION_INTERVAL_MS = HOUR_MS;

export interface SleepDerivationJobDeps {
  stores: Pick<Stores, "astronauts" | "readings" | "mission">;
  now: () => number;
  /** One astronaut's nights could not be derived; the others still were. */
  onAstronautFailed: (astronautId: string, error: unknown) => void;
  /** A whole run failed (for example, the crew could not be listed). */
  onError: (error: unknown) => void;
}

export interface SleepDerivationJob {
  /**
   * Runs once after any run in progress or already asked for has finished, so it reads the
   * settings as they are now; resolves when it is done. A failure is reported, never thrown.
   */
  runNow(): Promise<void>;
  /** Runs now, then every interval. */
  start(): Promise<void>;
  /** Stops the interval; resolves once the runs in progress or asked for have finished. */
  stop(): Promise<void>;
}

export function createSleepDerivationJob(deps: SleepDerivationJobDeps, intervalMs = SLEEP_DERIVATION_INTERVAL_MS): SleepDerivationJob {
  let runs: Promise<void> = Promise.resolve();
  let interval: RepeatingJob | null = null;

  const runOnce = async () => {
    const failures = await deriveRecentSleep(deps.stores, deps.now());
    for (const { astronautId, error } of failures) reportSafely((e) => deps.onAstronautFailed(astronautId, e), error);
  };

  const runNow = () => {
    runs = runs.then(() => runOnce().catch((error) => reportSafely(deps.onError, error)));
    return runs;
  };

  return {
    runNow,
    async start() {
      await runNow();
      interval = repeatEvery(intervalMs, runNow, deps.onError);
    },
    async stop() {
      await interval?.stop();
      await runs;
    },
  };
}
